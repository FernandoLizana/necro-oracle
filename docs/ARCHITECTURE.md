# Architecture

Each package or feature spec owns one section below. Later specs (sandbox, llm, ledger) append their own sections; they do not edit this one.

## @necro/github

`@necro/github` turns a public GitHub repository reference into an oracle `RepoSnapshot`. It also fetches public dependency data (PyPI, npm, OSV.dev) for the detectors. It parses archives and never executes repository code.

### Dependency direction

`oracle` <- `grimoires` <- `coven` <- (`web`, `cli`, `mcp-server`, `action`). `@necro/github` is an adapter: it depends on `@necro/oracle` (types, `buildSnapshotFromFileMap`, `NecroError`) and is injected into `coven` through the oracle's `GitHubSnapshotBuilder` port. `oracle` imports nothing from this package. Other packages import it only through `packages/github/src/index.ts`.

### Ports

All I/O goes through three ports in `src/ports.ts`. Package logic never reads globals.

| Port | Shape | Notes |
| --- | --- | --- |
| `FetchPort` | `(req) => Promise<FetchResponse>` | Requests carry an absolute https URL, `timeoutMs`, `redirect: "manual"` and an optional `AbortSignal`. Adapters must not follow redirects. Transport failures are thrown as `FetchTransportError` (`timeout` or `network`). |
| `ClockPort` | `nowMs()` | One reading per build, used for both `createdAt` and the age fields in the metadata. |
| `EnvPort` | `get("GITHUB_TOKEN")` | The only secret the package can read. |

`SummonerDeps` bundles the three. Production adapters are `createSystemFetchPort` and `systemClock` (`src/adapters`). Tests use fakes from `src/testing` and recorded fixtures; no unit test touches the network.

### Summon sequence

`GitHubSummoner` implements `GitHubSnapshotBuilder`. `summon(input)` and `buildDetailed(ref)` return a `SummonResult` (`snapshot`, `extras`, `cache`); `build(ref)` returns only the snapshot.

1. `parseRepoRef` (pure) validates the input and throws `INVALID_REPO_URL` with a reason code, without echoing the input.
2. `resolveRefDetailed` makes REST call 1 (`GET /repos/{owner}/{repo}`, canonical owner and name, privacy, default branch) and REST call 2 (`GET /repos/{owner}/{repo}/commits/{ref}`, the commit SHA). A private repository is rejected with `REPO_PRIVATE`.
3. The cache key `owner/name@sha` (exact case) is checked. A hit returns a copy of the stored result. Concurrent builds for the same key share one in-flight promise.
4. On a miss, three requests run in parallel under one `AbortController`: `pulls` (open pull requests, oldest first, `per_page=1`), `releases/latest`, and the tarball. If any of them fails with a hard error, the controller aborts the others.
5. `extractTarball` streams the archive, applies the caps, and yields a file map. `mapRepoMeta` combines the repo, pulls and release data into the metadata. `buildSnapshotFromFileMap` (oracle) builds the snapshot.
6. The result is cached with its effective TTL and returned with `cache: "miss"`.

`extras` carries `stars`, `defaultBranch`, `hasWorkflowsDir` and `degradedFields`.

### REST call budget

`GitHubClient` is the only module that builds headers or calls `FetchPort` for GitHub hosts. It counts REST calls and refuses a sixth one (`REST_CALL_BUDGET = 5`).

| Case | Calls |
| --- | --- |
| Normal | 4: repo, commit, pulls, release |
| Repository renamed (call 1 answers 301, 307 or 308 to `api.github.com`) | 5: the redirect is followed once, and only for the first repo request |

The tarball download is not a REST call and does not count against the budget. REST responses are read with a 2 MiB cap. Timeouts: 15 s per REST call, 40 s for the tarball, 10 s for external registries.

### Layered caps

Each layer rejects early; the oracle's own limits apply last.

| Layer | Limit | Error |
| --- | --- | --- |
| Compressed archive | 50 MB (`MAX_COMPRESSED_BYTES`) | `DOWNLOAD_TOO_LARGE`, `limit: "compressed"` |
| Uncompressed content | 200 MB (`MAX_UNCOMPRESSED_BYTES`) | `DOWNLOAD_TOO_LARGE`, `limit: "uncompressed"` |
| Archive entries | 100,000 (`MAX_ENTRIES`) | `DOWNLOAD_TOO_LARGE`, `limit: "entries"` |
| Per-file text | 1 MB (oracle) | file marked oversize by the snapshot builder |
| File count | 5,000 (oracle) | applied by `buildSnapshotFromFileMap` |

Extraction limits can be overridden through `SummonerOptions.limits` (`ExtractionLimits`, defaults in `DEFAULT_LIMITS`). Binary files are detected by a NUL byte in the first 8000 bytes; vendored and VCS paths (`node_modules`, `.git`, `vendor`, `third_party`, `bower_components`, `site-packages`) are skipped.

### Host and Authorization policy

`headersFor(url, token)` is pure and is the SSRF guard. It requires https, the default port and no credentials in the URL.

| Host | Allowed | `Authorization` |
| --- | --- | --- |
| `api.github.com` | yes | `Bearer` token when one is configured |
| `github.com` | yes | `Bearer` token when one is configured |
| `codeload.github.com` | yes | never |
| `pypi.org`, `registry.npmjs.org`, `api.osv.dev` | yes | never |
| any other host | no | refused with `VALIDATION_FAILED` (`host-not-allowed`) |

`api.github.com` requests also send `Accept: application/vnd.github+json` and `X-GitHub-Api-Version`. The token is read from `EnvPort` per request and is masked by `redactSecrets` in messages, details and causes.

### Token-aware tarball path

`GitHubClient.openTarball` picks the route by whether a token is present.

- No token: a direct request to `https://codeload.github.com/{owner}/{name}/tar.gz/{sha}`. Redirects are not followed.
- Token: a request to `api.github.com` with `Authorization`. If it answers with a redirect, exactly one hop is followed, and only to `https://codeload.github.com` on the default port. That second request carries no `Authorization`. Any other redirect target fails with `VALIDATION_FAILED` (`redirect-refused`).

Owner and name are checked against a segment pattern and the SHA must be 40 hex characters before a URL is built.

### Optional-call degradation

`pulls` and `releases/latest` are optional. A 404 or a body that fails schema validation is `absent` (the field is simply missing). A 5xx, a timeout or a network error becomes a degraded outcome with cause `http-5xx`, `timeout` or `network`; the build continues and `extras.degradedFields` lists the affected fields (`"pulls"`, `"release"`). Other failures, such as rate limiting, fail the build like the required calls. `classifyFailure` in `src/http-failure.ts` holds this mapping and takes the `optional` flag from the request context.

### Cache

`SnapshotCache` is an in-memory, per-process LRU keyed by `owner/name@sha`. It stores the `SummonResult`; callers receive fresh top-level copies, so they cannot mutate an entry.

| Setting | Value |
| --- | --- |
| Default TTL | 7 days (`DEFAULT_TTL_MS`) |
| TTL when `degradedFields` is non-empty | `min(configured TTL, 10 minutes)` (`DEGRADED_TTL_MS`, via `effectiveTtlMs`) |
| Default max entries | 20 |

Both the TTL and the entry count are set through `SummonerOptions.cache`. Expiry uses `ClockPort`.

### External data

`fetchExternalData(snapshot | manifests, deps)` is separate from the summon path and reports unresolved lookups instead of failing. It queries PyPI and npm for registry metadata and OSV.dev for advisories. Entries that cannot be resolved are returned in `skipped` with a `SkipReason` instead of failing the call.

| Limit | Value |
| --- | --- |
| Registry queries | 300 |
| OSV detail fetches | 200 |
| OSV batch size | 1000 |
| Concurrency | 8 |
| Registry JSON | 10 MiB per response |
| OSV JSON | 5 MiB per response |

### Public API

Exported from `src/index.ts`:

- Intake: `parseRepoRef`, `resolveRef`, `ParsedRepoRefSchema`, `ParsedRepoRef`.
- Summoning: `GitHubSummoner`, `createSummoner`, `SummonExtras`, `SummonResult`, `SummonerOptions`.
- External data: `fetchExternalData`, `ExternalDataResult`, `SkippedDependency`, `SkipReason`.
- Metadata: `mapRepoMeta`, `MappedMeta`, `MetaInputs`, `OptionalOutcome`.
- Cache: `cacheKey`, `effectiveTtlMs`, `SnapshotCache`.
- Client: `GitHubClient`.
- Errors: `SummonerError`, `SummonerErrorCode` (`INVALID_REPO_URL`, `REPO_NOT_FOUND`, `REPO_PRIVATE`, `RATE_LIMITED`, `NETWORK_TIMEOUT`, `DOWNLOAD_TOO_LARGE`, `VALIDATION_FAILED`, `REF_NOT_FOUND`, `AUTH_INVALID`, `UPSTREAM_UNAVAILABLE`).
- Limits: `DEFAULT_LIMITS`, `ExtractionLimits`.
- Ports and adapters: `FetchPort`, `FetchRequest`, `FetchResponse`, `FetchTransportError`, `ClockPort`, `EnvPort`, `SummonerDeps`, `createSystemFetchPort`, `systemClock`.
- Types: `DegradedCause`, `DegradedField`.

### Package boundaries

- Repository content is data. It is parsed from the tarball stream (`tar-stream`), never executed or imported.
- Network access exists only through `FetchPort`; the client and the external-data module are the only callers.
- The token is never written to snapshots, errors, cache entries or logs.
- No LLM, sandbox or ledger code lives here.

### Known risks

- **Authenticated 404 is ambiguous (Q2).** With a token, GitHub answers 404 both for a missing repository and for a private one the token cannot see. The package cannot prove absence, so `REPO_NOT_FOUND` means "not visible to this caller". Without a token, a 404 is treated as absent.
- **Quota without a token (Q6).** Unauthenticated REST calls share GitHub's low per-IP quota. A normal build uses 4 calls, so a handful of readings can exhaust it and surface `RATE_LIMITED`. Configure `GITHUB_TOKEN` for any shared deployment.
- **`tar-stream` install footprint (Q9).** `tar-stream@3.2.2` declares `bare-fs` (plus `b4a`, `streamx`, `fast-fifo`). We never call an fs path, but the dependency enlarges the install and the audit surface.
- **Memory near the 200 MB cap (Q10).** The uncompressed limit is enforced while streaming, but a repository close to the cap can hold a large file map in memory at once. Limits are injectable through `SummonerOptions.limits`, so constrained hosts can lower them.
- **Per-process cache (Q11).** `SnapshotCache` lives in one process. Serverless instances do not share it, and a cold start loses it, so identical readings may re-download. A shared cache belongs to a later spec.
- **OSV coverage is exact-pin only (Q12).** Advisories are looked up only for dependencies pinned to an exact version. Ranges, unpinned and unresolvable entries come back in `skipped`, so a clean advisory list is not proof of no vulnerabilities.
- **`DecompressionStream` buffering.** It buffers roughly 16 KiB internally. A tiny corrupt gzip body is therefore fully read before the error appears, so cancelling the download on that error saves nothing. The compressed cap still bounds the cost.

## @necro/ui-crt and the web terminal

`@necro/ui-crt` is the browser-safe CRT design system and the pure terminal core; `apps/web` is the Next.js App Router application that mounts it, serves the two HTTP routes it talks to, and ships the demo bundle. The split is strict: all terminal logic (parsing, rendering, the session state machine, motion and sound) is pure and side-effect-free in `@necro/ui-crt`; every side effect (HTTP, storage, media, Web Audio, timers) lives behind a port that `apps/web` supplies.

### Module map

`packages/ui-crt/src` (barrelled through `src/index.ts`; nothing is imported across the package boundary except through that barrel):

| Area | Files | Role |
| --- | --- | --- |
| Protocol and ports | `protocol.ts`, `ports.ts` | Types only. `protocol.ts` holds the wire shapes the browser shares with the API (`SummonSummary`, `ReadingResponse`, `ReadingPhase`, `ProgressEvent`, `ApiPort`, `DemoBundle`, `DemoPort`, `PlayableSpread`); `ports.ts` holds the injected side-effect seams (`StoragePort`, `MediaPort`, `VisibilityPort`, `FramePort`, `SoundLoaderPort`, `SoundEngine`, `TerminalPorts`). |
| Command | `command/{types,parse,print}.ts` | Total `parseCommand` (returns `null` for empty/whitespace input), `printCommand`, and `MAX_ENTRY_LENGTH`. |
| Text | `text/{sanitize,wrap}.ts` | `sanitizeText` (strips C0/C1 except `\n`, ANSI and bidi controls) and the 72-column wrapper (`LINE_WIDTH = 72`). |
| Voice | `voice/{voice-table,phrases}.ts` | `VOICE_TABLE` (one mystical line per card and orientation), the fixed Oracle_Voice copy (`BOOT_PHRASE`, `PRE_READING_PHRASE`, `DEMO_LABEL`, `PHASE_VOICE`, `EXTERNAL_SKIP_NOTE`) and `vitalityVoice`. |
| Render | `render/{blocks,evidence-link,reading,summary,help,explain,demo-label,errors,resurrect-diff,resurrect-vitality}.ts` and the Visual_Layer renderers `render/{boot,ascii-card,ascii-art,load-card-art,rot}.ts` | The block/line/segment output model, the single `buildEvidenceLink` builder, the renderers (incl. the resurrection diff and Vitality_Delta), the four terminal-raised error builders (`networkError`, `upstreamError`, `invalidResponseError`, `demoUnavailableError`), and the pure Visual_Layer renderers: the Boot_Frame_Renderer (`bootFrame`, `BOOT_STEP_COUNT`, `BOOT_LOGO_TEXT_EQUIVALENT`), the ASCII_Card_Renderer + Card_Back (`asciiCard`, `asciiCardBack`, `CARD_COLS`/`CARD_ROWS`/`ART_ROWS`), the per-CardId art table (`CARD_ART`, `GENERIC_ART`, `artFor` in `ascii-art.ts`), and the Rot_Transform (`rot`). The art table is reached only through `loadCardArt` in `render/load-card-art.ts`, whose literal-path dynamic `import("./ascii-art.js")` is the sole first-render reference to the table, so it ships as its own lazy chunk outside the terminal initial route (R11.4) — the same split pattern as the sound engine. |
| Motion and prefs | `motion/{reveal,motion-mode,boot-schedule,card-reveal,glitch,decay}.ts`, `prefs/prefs.ts` | Pure reveal schedule, effective-motion resolution, the Boot_Sequence schedule (`bootStepAt`, `BOOT_TOTAL_MS`), the Card_Reveal schedule (`cardRevealSchedule`, `CardRevealStep`, `CARD_FLIP_MS`), the Glitch_Profile (`glitchProfile`, `GlitchParams`, `GLITCH_MAX_DURATION_MS`), the Decay_Sequence (`decaySequence` — non-decreasing decay amounts, first 0 and last 1, driving the Resurrection_Animation rot frames), and the persisted-preference parsers plus their storage-key constants. |
| Session | `session/{state,reducer,history,log,pinned-ref,demo-seed,visual-reading}.ts`, `demo/catalog.ts` | `initialState` (seeding the `boot` and `cardReveal` slices), the pure `step(state, action) => { state, effects }` reducer (boot / `boot.tick` / `boot.skip` and the card-reveal schedule), bounded command history (`HISTORY_MAX`) and output log (`LOG_MAX_LINES`), `formatPinnedRef`, the Demo_Seed resolution (`DEMO_SEED`, `resolveSeed`, `isDemoSession`) the Visual_Layer feeds to glitch/rot, and the order-preserving `visualCards` selector. |
| Sound | `sound/{sound-reducer,sound-cue,engine-types,load-engine,engine}.ts` | The pure sound state machine (`soundReducer`, `soundActivity`), the four core Visual_Layer cue definitions and their pure gate (`SOUND_CUES`, `soundCueAllowed`), and the lazy Web Audio engine. `load-engine.ts` is the production `SoundLoaderPort`; `engine.ts` is never barrelled — it is reached only through a literal-path dynamic import so it ships as a separate chunk. |
| Components and hooks | `components/*.tsx`, `hooks/*.ts` | `Screen`, `Terminal`, `OutputLog`, `OutputBlockView`, `Card`, `Spread`, `EvidenceScroll`, `CommandLine`, `ButtonRow`, the Visual_Layer overlays (`BootOverlay`, `AsciiCardView`, `CardReveal`, `RotReveal`/`RotOverlay`, `VitalityCounter`), and the `use-terminal`/`use-reveal`/`use-boot`/`use-rot`/`use-count-up`/`use-motion`/`use-sound` hooks that wire the pure reducer to the browser. |
| Tokens and CSS | `tokens.ts`, `crt.css` | The CRT design tokens are the single source of truth; the stylesheet mirrors them (a test parses both and asserts they match). |

`apps/web/src`:

| Area | Files | Role |
| --- | --- | --- |
| App shell | `app/layout.tsx`, `app/page.tsx`, `components/TerminalScreen.tsx` | `page.tsx` is a server component that server-renders the client `TerminalScreen`, which builds the browser ports and mounts `@necro/ui-crt`'s `Terminal`. The static document carries the full shell and a `<noscript>` block stating the boot phrase and that the terminal needs JavaScript. |
| Browser adapters | `terminal/{api-client,browser-ports,ndjson}.ts` | `createApiPort` is the one seam to the HTTP routes (summon outcome table + streaming reader); `createBrowserPorts` builds the storage/media/visibility/frame/sound ports; `createNdjsonParser` is the incremental NDJSON line splitter. |
| Wire schemas | `protocol/{schemas,stream}.ts` | The zod schemas for the request/response bodies and the NDJSON stream lines (see below). |
| Server handlers | `server/handlers/{guard,summon,readings,phase,external-skip}.ts` | The shared request/response guard pipeline, the two route handlers, the monotonic phase reporter and the external-skip decision. |
| Server support | `server/{composition,deps,client-ip,error-map,redact,pinned-ref}.ts`, `server/limiter/{port,upstash,fallback,chain}.ts` | The composition root (the only reader of `process.env`), the route-deps assembly, client-IP hashing, the error mapper, token redaction, the pinned-ref round-trip, and the rate-limiter chain. |
| Routes and middleware | `app/api/summon/route.ts`, `app/api/readings/route.ts`, `middleware.ts` | Thin bindings pinning the Node runtime and delegating to the handlers; the CSP middleware. |
| Demo | `demo/{build-demo,load-bundle}.ts`, `demo/bundle.generated.json`, `scripts/demo-bundle/generate.ts` | The demo bundle generator, the lazy validating loader, the generated bundle and the regeneration script. |
| Budget gate | `scripts/check-web-budget.mjs` | The post-build bundle-size / leak / chunk-separation gate. |

### Visual_Layer overlays (additive, reversible)

The Visual_Layer (boot sequence, framed ASCII tarot cards with a one-by-one reveal, severity glitch, and the resurrection rot-and-rebirth) is wired into `Terminal.tsx` as **additive, decorative overlays over the already-mounted terminal** — never a rewrite of the output. The authoritative text stays in the single `role="log"` region exactly as the pure `renderReading` / `renderFileResults` / `renderResurrectVitality` renderers produce it, so the Live_Region announces every card and the resurrection result exactly once. The overlays are `aria-hidden` visual flourishes layered on top of that text.

- `use-terminal` drives `use-boot` (frame-ticked boot steps, any-key skip, focus) alongside the reused `use-reveal` typewriter, and exposes `bootFrameForRender` (from `bootFrame(state.boot.stepIndex)`) and `visualSeed` (from `resolveSeed(state)`). The boot frame loop is gated on `state.boot.seen` so no stray frame is scheduled during the first render before the one-time `boot` action resolves the real Motion_Mode.
- `Terminal.tsx` keeps setting `document.documentElement.dataset.js = "ready"` unconditionally and immediately in its mount effect (never deferred by boot), so `#no-js-note` is hidden the moment the client mounts regardless of boot state. `apps/web/src/app/layout.tsx` and the `#no-js-note` contract are never modified.
- `BootOverlay` draws the boot frame while `state.boot.phase === "playing"`. `CardReveal` (pure selector `visualCards(state)`) draws one framed `AsciiCardView` per drawn position in the Reading's exact order — Card_Back → flip (gated on `state.cardReveal.flippedCount`) → `AsciiCard` with `glitchProfile(severity)` in full motion. `RotOverlay` plays the rot-then-rebirth decay (`useRot` / `rot` / `decaySequence`, Flash_Limit-capped) over a settled ritual while the diff / Vitality_Delta stay in the log. `VitalityCounter` (optional flourish) counts the Vitality_Delta from `beforeVitality` to `afterVitality` alongside the rebirth via the `useCountUp` FramePort tick (paced to `MIN_COUNT_FRAME_MS` in full motion, final value instantly in reduced motion); it is `aria-hidden` so the announced delta stays the log's once-announced text (D1). The per-CardId illustration table (`ascii-art.ts`) is fetched via `loadCardArt()` in its own lazy chunk after mount, so it stays outside the first terminal render.

#### Pure renderers and motion math

The split from design decision D1 keeps all the Visual_Layer's computation in pure modules with no clock, network, DOM or unseeded randomness; the client hooks supply elapsed time through `FramePort` and the view applies the result in CSS.

- **Boot_Frame_Renderer** (`render/boot.ts`). `bootFrame(stepIndex)` maps a step index to a cumulative `BootFrame` of width-bounded (≤ 72-column) `OutputLine`s: a memory-check readout in dry Oracle_Voice accumulating one line per step, the `NECROMANTIC SYSTEMS 1986` ASCII logo, a phosphor warm-up line, and finally the ready frame. Indexing is total and saturating — any index at or beyond `BOOT_STEP_COUNT - 1` returns the ready frame, and negative / fractional / `NaN` indices clamp to the first — so the driving hook can never index out of range. `BOOT_LOGO_TEXT_EQUIVALENT` carries the logo's accessible reading. The pacing lives in `motion/boot-schedule.ts`: `bootStepAt(elapsedMs)` clamps into `0..BOOT_STEP_COUNT-1` and the whole sequence fits inside `BOOT_TOTAL_MS` (≤ 3500 ms).
- **ASCII_Card_Renderer** (`render/ascii-card.ts`) and the lazy **art table** (`render/ascii-art.ts`). `asciiCard(cardId, orientation, art)` returns a fixed `CARD_ROWS` (13) × `CARD_COLS` (24) box-drawing face for every card in both orientations (numeral row, name row, divider, `ART_ROWS` illustration rows, divider, footer, border), with an `accessibleText` equivalent. The renderer accepts the loaded illustration table as an argument instead of importing it, so it stays free of the lazy art chunk; `asciiCardBack()` is the single shared Card_Back. An unknown id raises a typed `NecroError` (`CARD_UNKNOWN`). The bespoke per-CardId motifs live in `render/ascii-art.ts` and ship in their own chunk fetched by `loadCardArt()` after mount (R11.4). See `docs/DECK.md` → "ASCII card faces".
- **Glitch_Profile** (`motion/glitch.ts`). `glitchProfile(severity)` is the pure map from a CardDraw severity (`0..3`) to bounded `GlitchParams` — `intensity = severity`, `offsetPx = severity*2`, `tearCount = severity`, `corruptChars = severity*3`, `durationMs = min(300, severity*90)`. Severity 0 yields all-zero params (a calm card is perfectly steady); every field is non-decreasing in severity; `durationMs` is capped at `GLITCH_MAX_DURATION_MS` (300 ms) to honour the Flash_Limit. `AsciiCardView` applies these as the CSS glitch only in full motion, sets `data-burning` only on `tower`/`devil`, and adds the tower shake only at severity ≥ 2.
- **Card_Reveal schedule** (`motion/card-reveal.ts`). `cardRevealSchedule(positions)` returns one `CardRevealStep` per spread position in order (`positionIndex` increasing by 1 from 0) with non-decreasing flip offsets: card *n* flips (`CARD_FLIP_MS` = 600 ms) only after card *n−1*'s flip plus its full typewriter reveal (`revealDurationMs(diagnosisLength, "full")`) complete. An empty spread yields `[]`.
- **Rot_Transform** (`render/rot.ts`) and **Decay_Sequence** (`motion/decay.ts`). `rot(source, decay, seed)` clamps `decay` to `[0,1]` (`0` returns the source unchanged), replaces only existing non-newline positions so the total length and line count are preserved for every decay, and grows the corrupted-position set monotonically with decay via a single seeded (`mulberry32`) permutation of eligible positions — the lower-decay set is always a subset of the higher-decay set. It is deterministic given `(source, decay, seed)`, with `seed` the only randomness source. `decaySequence(frameCount)` produces the non-decreasing decay amounts (first 0, last 1) that `useRot` steps through to animate the rot before the revived code, unchanged diff and Vitality_Delta render.

#### Glitch, rot, flip and the Flash_Limit (CSS tokens)

The animations are driven entirely from the CRT design tokens in `tokens.ts`, mirrored into the single `crt.css` (a test parses both and asserts they match). The Visual_Layer added `CRT_BURNING_AMBER` (`#ffb000`, Tower/Devil `data-burning` only), `CRT_STILL_DEAD` (`#ff3355`, STILL DEAD only), and the motion ceilings `CRT_GLITCH_MAX_MS`, `CRT_SHAKE_MS`, `CRT_FLIP_MS` and `CRT_ROT_FRAME_MIN_MS`, keeping the tarot-ux palette (foreground `#33ff66`, background `#001a00`, dim `#1f9e45`) with no new base colours. The glitch keyframes layer chromatic `±offsetPx` text-shadow and `tearCount` clip-path slices with transient corruption that never changes the selectable text; flip, rot and the tower shake have their own keyframes; reversed cards rotate 180° with the numeral/name overlay counter-rotated upright. Every glitch animation uses `animation-iteration-count: 1` and the rot cadence is capped at `CRT_ROT_FRAME_MIN_MS` so luminance changes stay ≤ 2/sec — both documented inline in `crt.css` as the Flash_Limit caps. Reduced motion disables pulsing glow, flicker, afterglow, and every Visual_Layer animation, rendering all cards face-up with full text in one synchronous render.

#### Sound cues and demo determinism

Four core cues (`SOUND_CUES` in `sound/sound-cue.ts`) fire on boot completion, card reveal, glitch and resurrection rebirth, dispatched through the existing `{ type: "sound", event }` action and the lazy `SoundEngine`. `soundCueAllowed` (built on `soundActivity`) gates them: off by default, never before the first user gesture, never autoplay, silent while off, and independent of motion (a cue may fire in reduced motion when sound is on). Determinism in Demo mode comes from `session/demo-seed.ts`: `resolveSeed(state)` returns the fixed `DEMO_SEED` when `isDemoSession(state)` (a demo-flagged reading) and a deterministic per-reading/ritual seed otherwise, so a demo reading's glitch params and rot outputs reproduce exactly across renders. Under `bootSignal` (`?boot=skip`) the boot fast-forwards but the seed stays `DEMO_SEED`; a demo run without the signal plays the full deterministic boot and animations.

An OPTIONAL ambient Resurrection hum (`sound/ambient-hum.ts`, task 21.1) layers a low continuous drone under the base hum while the rot-then-rebirth animation plays. The pure `ambientHumActive({ sound, motionMode, resurrectionPlaying })` gate is true only when sound resolves on (reusing the Click/Hum/cue condition), the Motion_Mode is `full`, and the animation is actively playing; `RotOverlay` reports its rot-playing state up through `Terminal.tsx`, `use-terminal` feeds the gate into `useSound`, and the lazy `SoundEngine.ambient(on)` fades its own 25 Hz oscillator in/out under the capped master. The drone stops at rebirth, on `sound off`, when hidden, or in reduced motion — it is additive, default-off, gesture-gated, adds nothing to the initial route (the engine stays a separate chunk), and is audio-only so it adds no luminance flash and no accessibility surface (Requirement 13's drop-if-it-breaks guardrails hold).

### The `@necro/oracle/client` rule

Everything bundled into the browser imports oracle types and schemas only through the single `@necro/oracle/client` subpath — never the main `@necro/oracle` entry, never `@necro/github`, never `@necro/config`, and never a `node:*` builtin. `@necro/oracle/client` is a Client_Safe_Entry whose import closure is restricted to `zod` plus the pure registry/schema/snapshot-type/error modules, so pulling it in never drags tree-sitter, the tarball downloader, TOML/OSV code or any Node builtin into the client bundle. `@necro/ui-crt`'s `protocol.ts` imports `Reading` and `RepoRef` from `@necro/oracle/client`; `apps/web`'s `protocol/schemas.ts` imports `ReadingSchema`, `RepoRefSchema` and `NecroErrorCodeSchema` from the same subpath.

This boundary is enforced two ways. The flat-config ESLint blocks in `eslint.config.js` scope a `no-restricted-imports` rule over all of `packages/ui-crt/src/**` and over the explicitly client-bundled `apps/web` modules (`terminal/api-client.ts`, `terminal/browser-ports.ts`, `terminal/ndjson.ts`, `components/TerminalScreen.tsx`, `demo/load-bundle.ts`), banning `@necro/github`, `@necro/config`, the bare `@necro/oracle` entry and `node:*`, plus a `no-restricted-syntax` block banning `eval`, `new Function`, `postMessage`, `dangerouslySetInnerHTML` and any non-literal dynamic `import`. The server-only trees (`server/**`, `app/api/**`, `demo/build-demo.ts`) are deliberately not matched, so they keep their legitimate `@necro/github` and `node:*` imports. The `boundary.guard.test.ts` files in both `packages/ui-crt/src` and `apps/web/src` back the lint rules with a grep-level test so a violation fails the suite even if lint is skipped.

### API contracts

Both routes are `POST`-only, run on the Node.js runtime (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 50` — a serverless backstop above the 40 s overall budget), and share the guard pipeline in `server/handlers/guard.ts`: method check → rate limit (before any GitHub work) → body read → strict zod parse. Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; a JSON success adds `Content-Type: application/json`.

**Request bodies** (strict zod objects in `protocol/schemas.ts`; body capped at 2048 bytes, `Content-Type` must be `application/json`):

- `POST /api/summon` — `{ repo: string }` (1..200 chars).
- `POST /api/readings` — `{ ref: string, spread: "fates" | "necropsy" }`. The ref must match `owner/name@<40-hex-lowercase-sha>`; `celtic` and any uppercase/short sha are rejected pre-stream (the server plays only `fates`/`necropsy`).

**Responses:**

- Summon returns a `SummonSummary`: `{ ref, stars, hasWorkflowsDir, degradedFields, cache, fileCount, truncated }` — public metadata only, never snapshot file contents, never a file list. `toSummonSummary` builds it field-by-field from the `SummonResult`; the body is run through `redactDeep` and re-validated against `SummonSummarySchema` before it leaves.
- Readings streams NDJSON (see below); the final result line wraps a `ReadingResponse` (`{ summary, reading }`), validated by `ReadingResponseSchema` before writing.
- Every failing route returns the error envelope `{ error: { code, userMessage } }` (`ErrorEnvelopeSchema`). The `code` is a `NecroErrorCode`; the `cause` is never serialised.

**Status-code table** (`server/error-map.ts` `statusFor`):

| Code | Status |
| --- | --- |
| `INVALID_REPO_URL`, `VALIDATION_FAILED` | 400 |
| `REPO_PRIVATE` | 403 |
| `REPO_NOT_FOUND`, `REF_NOT_FOUND` | 404 |
| `DOWNLOAD_TOO_LARGE` | 413 |
| `RATE_LIMITED` | 429 |
| `AUTH_INVALID`, `UPSTREAM_UNAVAILABLE` | 502 |
| `NETWORK_TIMEOUT` | 504 |
| any other | 500 |
| non-NecroError throwable | 500 + `UPSTREAM_UNAVAILABLE`, fixed message, no thrown text |

**Headers:** every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. A non-POST method returns `405` with `Allow: POST` (HEAD carries no body). A `RATE_LIMITED` denial adds `Retry-After` (integer seconds). A JSON success adds `Content-Type: application/json`; the reading stream sets `Content-Type: application/x-ndjson`.

**NDJSON stream** (`protocol/stream.ts`, one JSON object per `\n`-terminated line; `StreamLineSchema` validates every line both server-side before writing and client-side before rendering):

- Phase lines `{ phase }` for each of `SUMMON`, `DOWNLOAD`, `EXTERNAL`, `READING`, emitted in order, each at most once (`DOWNLOAD` is emitted even on a cache hit).
- An optional skip-note line `{ skip: true, note }` when external enrichment is skipped.
- Exactly one final line: `{ result }` (a validated `ReadingResponse`) on success, or `{ error }` (the envelope's error object) on any mid-stream failure or budget expiry. Because the handler commits to a `200` stream once the request schema passes, a post-stream failure is carried as the final `{ error }` line rather than an HTTP error status.

The reading handler schedules two budgets synchronously at entry: a 40 s overall budget (on expiry it writes a final `{ error: NETWORK_TIMEOUT }` line and closes) and a 10 s external sub-budget that races `github.externalData`. On a timeout — or when external data reports per-dependency skips — `decideExternalSkip` emits the skip-note and calls `runReading` with `registryData`/`osvData` omitted entirely, never fabricating data. The whole `ReadingResponse` is token-redacted (`redactDeep`) before validation so a token echoed inside `reading.errors[].userMessage` cannot reach the wire.

### Rate limit and fallback behaviour

The limiter is a primary/fallback chain (`server/limiter/chain.ts`) checked once per request, before any GitHub call. Per-IP-per-hour limits are 20 summon / 10 readings (`LIMITS`), plus a shared daily ceiling from `NECRO_DAILY_REQUEST_CEILING` (default 1000). The per-IP identity is a privacy-preserving hash: `client-ip.ts` reads the configured proxy header (`NECRO_CLIENT_IP_HEADER`, default `x-real-ip`), validates the value as an IPv4/IPv6 literal, and returns `sha256(ip).slice(0, 32)` — the raw IP is never stored or returned, and a missing/invalid header hashes the fixed string `"anonymous"`.

The primary is an Upstash Redis limiter (`server/limiter/upstash.ts`), built only when both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present; otherwise the chain's primary is `null` and every request is served by the fallback. The Upstash adapter wraps each call in its own timeout race and never uses the library's fail-open `timeout` option: a timeout or any thrown error becomes a `RateLimitUnavailableError`. On that error the chain answers the request from the in-memory `FallbackLimiter` (fixed windows aligned to the injected clock, bounded by `maxKeys` eviction) and opens a 30 s circuit — measured only with the clock port — during which it skips the primary entirely. A limiter outage is therefore never converted into an upstream error: the chain always resolves, the demo stays alive on the fallback, and a limited request makes no GitHub request.

### CSP

`src/middleware.ts` mints a fresh per-request nonce (base64 of 16 Web Crypto random bytes) and sets a Content-Security-Policy on both the forwarded request headers (so Next stamps its own bootstrap scripts) and the response. The policy disallows inline script entirely: `script-src` carries only `'self'`, `'nonce-<n>'` and `'strict-dynamic'` — never `'unsafe-inline'`; `'unsafe-eval'` is added only in development. The directive set is `default-src 'self'`, `script-src …`, `style-src 'self' 'nonce-<n>'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`. The nonce is forwarded as `x-nonce`. The matcher runs on HTML routes only, excluding `/_next/static`, `/_next/image`, `/favicon.ico` and `/api` (the API routes send their own `no-store` + `nosniff` and serve no HTML).

### Demo bundle workflow

`demo/build-demo.ts` drives the real oracle (`runReading` via `@necro/oracle/node`) over the on-disk `fixtures/graveyard/*` fixtures to produce a `DemoBundle`: a record keyed by demo name, each entry a `{ fates, necropsy }` pair of validated `ReadingResponse`s. The clock is fixed to `DEMO_NOW` and each reading's minted id is replaced with a deterministic UUID-shaped `demoId`, so the output is byte-stable. `scripts/demo-bundle/generate.ts` (the `demo:bundle` script) serialises it with sorted keys to `apps/web/src/demo/bundle.generated.json`; it requires the oracle to be built first.

At runtime the browser loads the bundle through `demo/load-bundle.ts`: a literal-path dynamic `import("./bundle.generated.json")` keeps the (large) JSON out of the initial route and in its own lazily-loaded chunk, validated against `DemoBundleSchema` (every entry must be a demo-flagged pair over exactly the catalog names) and memoised, with the memo cleared on any failure so a later retry re-attempts. A chunk/import failure rejects with `demoUnavailableError()` (`NETWORK_TIMEOUT`); a schema failure rejects with `invalidResponseError()` (`VALIDATION_FAILED`). Every demo reading carries `summary.demo === true`, so the terminal prefixes the `DEMO_LABEL` banner — `DEMO REPLAY · a recorded reading, no live summon.` — and renders demo paths as `fixture:` references with no live link, keeping a replay clearly distinct from a fresh summon.

### Bundle budget

`scripts/check-web-budget.mjs` runs after the web build and enforces three things on `apps/web/.next`. First, the gzipped size of the terminal's initial-route JavaScript — the deduped union of the app-build-manifest `pages["/page"]` + `pages["/layout"]`, the build-manifest `rootMainFiles` and `polyfillFiles`, `.js` only — must be at most `BUDGET_BYTES = 250_000` (the strict decimal-KB reading of the ≤ 250 KB budget); the last measured value was about 174 KB gzipped, so there is roughly 76 KB of headroom. Second, a forbidden-marker scan over every `.next/static/**/*.js` chunk fails on `api.github.com`, `codeload.github.com`, `GITHUB_TOKEN`, `tree-sitter-python.wasm` or `tar-stream`, catching any server-only leak into the client. Third, the demo bundle and the sound engine must each exist as a separate dynamic chunk, distinct from one another and from the initial route — Next lists neither in the initial-route manifests, and the gate confirms both are present (by chunk name, falling back to a content scan). The script's pure helpers are exported with no side effects so `apps/web/src/budget.test.ts` exercises them offline against synthetic manifests.

### Arcana_Visions — the pixel-art presentation layer (Spec 06)

Arcana_Visions is an **additive skin over the Spec 05 Visual_Layer**: the twelve diagnosis arcana (plus the Seer portrait and the open/closed Necronomicon) now render as integer-scaled pixel sprites with bounded motion zones and a Necronomicon resurrection ritual, while the ASCII card faces stay as the no-JS / image-failure fallback. Like the Visual_Layer it decorates, it never decides a draw and never rewrites the authoritative `role="log"` text — the cards still cannot lie, and the screen reader still hears each card once. Everything new is pure and barrelled through `packages/ui-crt/src/index.ts`; the only side effect (the background theme) lives behind a lazily-loaded engine port exactly like the sound engine.

#### Pure arcana modules (`packages/ui-crt/src/arcana`)

Each module is pure (no clock, DOM, network, audio or unseeded randomness) and ships with its own `*.pbt.test.ts`.

- **`integer-scale.ts`** — `integerScale(available, logical): number` returns the largest whole-number factor that fits both axes, clamped to `>= 1`; a region smaller than the logical size on either axis, or a `NaN`/`<= 0` input, clamps to `1`. Exports the `Size` interface. This is the single sizing primitive every pixel view uses, so sprites are always drawn at a whole-number scale and never blurred by fractional sampling (R1.2–R1.4).
- **`manifest.ts`** — the boundary loader for the committed `apps/web/public/arcana/manifest.json`. zod `ManifestBandsSchema` / `ManifestImageSchema` / `ManifestSchema` (all `.passthrough()` to tolerate but discard the generator's `png`/`preview`/`box`/workspace bookkeeping); `loadManifest(raw): ReadonlyMap<string, ArcanaAsset>` validates at the boundary and throws a typed `NecroError` (`VALIDATION_FAILED`, oracle-voice message) on an invalid shape, keeping only each asset's `id`, `logical` pixel size and header/footer `bands`. `DIAGNOSIS_CARD_IDS` (the 12 diagnosis `CardId`s in deck order) is derived from the oracle `CardIdSchema` so it never drifts from the deck registry. Exports the `ArcanaAsset` and `ManifestImage` types.
- **`motion-zones.ts`** — the authored `MOTION_ZONES` table (tower flicker, star shimmer, moon pulse, hermit flicker, judgement rays, seer glow), `luminanceChangesPerSecond(z) = z.steps / (z.periodMs / 1000)`, and the pure `validateMotionZone(z, logical, bands): MotionZoneIssue[]` the PixelCard runtime guard and the property test share. The validator rejects any zone whose rect leaves `[0,w]×[0,h]`, overlaps the header/footer Text_Bands, or breaches the Flash_Limit (`> 2` luminance changes/sec). Exports `Bands`, `MotionEffect`, `MotionZone`, `MotionZoneIssue`, `Rect` (R4.1–R4.8, Flash_Limit R13.2/R13.3).
- **`ritual-timeline.ts`** — the pure Resurrection_Ritual schedule. `ritualTimeline(opts): RitualStep[]` returns `[]` iff motion is reduced, images are not ready, or `((playwright || bootSkip) && !ritualForce)`; otherwise it returns the four ordered phases `closed-glitch → tremble → crossfade → rising-diff` with non-decreasing `startMs` and a summed duration `<= RITUAL_TOTAL_MS` (`<= 3000` ms, from `tokens.ts`). Deterministic in its `seed`. Exports `RitualOpts`, `RitualPhase`, `RitualStep` (R6.1–R6.10, R13.4).
- **`pixel-card-model.ts`** — `pixelCardModel(card: VisualCard): PixelCardModel` derives the numeral, title, a `<= 72`-column oracle-voice caption (reusing `VOICE_TABLE`) and the alt text from the card registry; `cardAltText(card, orientation)` builds the screen-reader string `"<Name>, <upright|reversed> — <meaning ≤ 120 chars>"`. Severity flows through unchanged so the Spec 05 glitch contract still applies (R1.6/R1.7, R2.9, R5.1/R5.2, R10.1).

#### Background theme subsystem (`packages/ui-crt/src/sound`)

A second lazy-chunk subsystem that mirrors the Spec 05 sound engine split exactly.

- **`background-theme.ts`** (pure) — `composeTheme(seed): ThemeScore` procedurally composes an ORIGINAL, seeded chiptune loop (square lead + triangle bass over a fixed A-minor scale, 90–110 BPM, 4-bar gapless loop) with NO audio, DOM or clock access; it is deterministic in the seed and reproduces no existing melody. `peakGain(score)` is the summed-gain measure the property test pins at `<= 0.2` (R8.1), and the loop is gapless by construction (R8.2). `backgroundThemeActive(state, env): boolean` mirrors `soundCueAllowed` (sound on + user gesture + document visible) and adds the one extra rule `!env.isTest`, so the theme is also silent in a test/CI run (R8.4–R8.6, R8.10). Exports `ThemeScore`, `ThemeVoice`.
- **`background-theme-engine.ts`** (lazy engine) — `BackgroundThemeEngine` builds the Web Audio oscillators for a `ThemeScore` with a gapless loop and a peak gain capped at `MAX_THEME_GAIN`, stops within 1 s, and resolves to a no-op engine when `AudioContext` is unavailable so the route stays usable. Only the `BackgroundThemeEngine` / `BackgroundThemeLoaderPort` types and the `MAX_THEME_GAIN` constant are barrelled; the implementation (`createBackgroundThemeEngine`) is deliberately **not** re-exported, so a static re-export can never pull the synthesis engine into the first-render graph. `load-background-theme.ts` is the production `BackgroundThemeLoaderPort`, whose string-literal dynamic `import("./background-theme-engine.js")` keeps the engine in its own lazy chunk, outside the initial Terminal_Route (R8.9, R11.2).

#### Arcana React components (`packages/ui-crt/src/components`)

All screen-only, driven by the pure modules above; styled by the new `arcana/arcana.css` (`image-rendering: pixelated`, no colour-altering filter, `--arcana-scale` sizing, `steps()` motion-zone keyframes, reversed-image 180° with counter-upright text, one-shot glitch reusing the Spec 05 selector, ritual keyframes mirroring `tokens.ts`).

- **`PixelCard`** — a single `<img>` drawn at `logical × integerScale`, no blur filter, `alt={model.altText}`; phosphor DOM header band (`[0,19]`, numeral + title) and footer band (`[147,160]`, position · orientation) with the caption below the image, all outside the bands. Carries `data-motion` and (full motion, severity 1..3) `data-glitch-intensity = glitchProfile(severity).intensity`, reusing the Spec 05 CSS glitch contract. Reversed = image rotated 180° with upright text. `onError` swaps to `AsciiCardView` in place with no broken-image indicator (R1.9). Per-card motion-zone overlays render only when `validateMotionZone` returns no issues and motion is `full`; otherwise the card is static with a dev-time `console.warn` and no terminal message (R4.9).
- **`SpreadPixelView`** — a left-to-right `.crt-spread-pixel` row of `PixelCard`s in the reading's exact spread order (none reordered, duplicated or omitted; a fates reading renders exactly 3 slots), each computing its own `integerScale(available/slots, logical)`. Server-rendered markup falls back to `AsciiCardView` content per position, so a no-JS reader sees the ASCII spread in order, and a per-slot image failure falls back to the ASCII card in that slot (R3.1–R3.5).
- **`FullscreenCardView`** — `role="dialog" aria-modal="true"` with focus moved inside on open and a Tab/Shift+Tab trap, opening within 500 ms; Arrow Right/Down → next, Left/Up → previous with wrap; single-card readings make navigation a no-op; Escape closes and restores focus to the opener via the deferred-focus technique; shows one large `PixelCard` with a visible `CRT_FOCUS` ring (R2.1–R2.9, R10.3/R10.5/R10.6).
- **`NecronomiconRitual`** — driven by `ritualTimeline` through the Spec 05 `FramePort` (no wall-clock `setTimeout`): closed + glitch → tremble → crossfade to open → diff lines rising, then renders its unchanged Spec 05 diff/patch `children`. `steps === []` renders `children` immediately; Escape calls `onComplete` within 100 ms; a frame decode failure skips to `children`; the diff/patch content is never altered by the ritual (R6.1–R6.10).
- **`SeerPortrait`** — renders the Seer at `integerScale(available, {w:256,h:144})` with `image-rendering: pixelated`, preserving the native 16:9 (no distortion/crop); `onError` renders the provided text-landing `fallback` with no broken-image indicator (R7.1–R7.4).

#### Hook and the `apps/web` wiring

- **`useBackgroundTheme`** (`hooks/use-background-theme.ts`) — the imperative bridge mirroring `useSound`: it watches the pure `backgroundThemeActive(state, { isTest })` gate and, on the rise, lazily imports the engine chunk and calls `start(composeTheme(seed))` within the gesture chain; on the fall it calls `stop()`. It never starts before a gesture or in a test/CI run (the gate returns `false`), and it swallows every load/start failure so the route stays usable and silent (R8.4/R8.5/R8.7/R8.8/R8.10).
- **Manifest threading** — `@necro/ui-crt` never imports the app's `public/` files (dependency rules). `apps/web/src/terminal/arcana-manifest.ts` imports the committed `public/arcana/manifest.json` as static build-time data, runs the pure `loadManifest` once at module evaluation, and exports the trusted `id -> ArcanaAsset` map as `ARCANA_MANIFEST`; an invalid manifest degrades to an empty map (a dev-time console warning, never a terminal message) so the Terminal falls back to the Spec 05 ASCII spread. `TerminalScreen.tsx` threads it down through the `<Terminal manifest=...>` prop — with the manifest present the Terminal renders the pixel Spread_View and Fullscreen_Card_View; without it the ASCII spread is the default.
- **`?ritual=force` flag** — `TerminalScreen.tsx` reads a `?ritual=force` query flag (SSR-guarded, defaulting to `false`) into the Terminal's `ritualForce` prop, mirroring the `?boot=skip` read. When set it forces the Necronomicon ritual to play in full before the diff even during a Playwright run or a `?boot=skip` load (R6.6); a normal load leaves the ritual gated by Motion_Mode / Playwright detection the usual way.
- **Background-theme lazy chunk & budget** — only the 3 visible Spread_View card images load eagerly; all other card images carry `loading="lazy"`. The Motion_Zone_Table and the background-theme synthesis stay in separate lazy chunks excluded from the first Terminal_Route render. `scripts/check-web-budget.mjs` `findSeparateChunks` locates the background-theme chunk alongside the demo/sound/resurrection chunks, and `collectInitialRouteJs` keeps the motion-zone and theme-synthesis code out of the initial route, so the Terminal_Route stays at or below `BUDGET_BYTES = 250_000` gzipped (R8.9, R11.1–R11.4).

### Landing_State — the DMG idle menu (Oracle_Landing_Polish)

Oracle_Landing_Polish adds a Game Boy DMG-styled **Landing region** that fills the empty idle terminal, plus four grounded Part B fixes. Like the Visual_Layer and Arcana_Visions it sits beside, it is a **single additive layer**: it renders only in a new idle state inside the existing `<Terminal>` shell, never replaces the command line, button row or `role="log"` output, and keeps every prior-spec behaviour byte-for-byte. The pure core reads no clock, DOM, network or audio; only the one new side-effecting seam (the resurrection-view dynamic import) lives in `apps/web`.

#### Pure landing modules (`packages/ui-crt/src/landing`)

Each module is pure and barrelled through `packages/ui-crt/src/index.ts`, with its own `*.pbt.test.ts`.

- **`repos.ts`** — the `LEGACY_REPOS` table: the zod `LegacyRepoSchema` (`.strict()`, `oracleSays` capped at 72 cols), the three concrete rows (`tomaes/pytarl` DUNGEON · 4 FILES; `ArmstrongJ/robotadventure` NOIR MYSTERY · 21 FILES; `neubig/test-repo` PY2 SPECIMEN · 240 FILES) each with their ORACLE SAYS line, `ENTER_ANY_LABEL`, the `LandingRow` union and `LANDING_ROWS` (the repos followed by the ENTER row). Each row is validated against the schema at module load.
- **`selection.ts`** — the pure selection model: `SelectionState`, `move(state, dir, rowCount)` (clamp, no wrap), `selectedRow(state, rows)`, and `activate(row)` returning `summon-read` for a concrete repo or `focus-input` for the ENTER row.
- **`key-binding.ts`** — `landingKeyAction(ev)`, the pure DMG key map (`ArrowUp/Down` → move, `Enter`/`a` → activate, `b`/`d` → demo, `h` → help), case-insensitive on letters, returning `none` for any Alt/Ctrl/Meta-modified or unmapped key so browser shortcuts and the input's own editing keys are never stolen.
- **`landing-model.ts`** — the one predicate that gates the whole region, `landingVisible(state)` (`!landingDismissed && boot.phase === "done" && the log holds only the boot banner && summary === null`), plus `hudModel(state)` (label `NECRO-ORACLE`, SOUL hearts, `PY2 CURSE: ACTIVE`) and `previewModel(state, selected, manifest)` (showSeer from `manifest.has("seer")`, three card backs, the selected row's oracleSays).
- **`oracle-copy.ts`** — the in-world DMG error / empty-state copy (Part B bug 4): a short mystical line then the plain technical fact for the 404 / rate-limit / network / no-Python cases and the empty-list state, each ≤ 16 words, ≤ 72 cols, ASCII-only. All failures route through the typed `NecroError` → `mapError` → oracle-voice path; the restyle is CSS only and the `role="log"` live-region text stays the authoritative plain fact.
- **`palette`** — `DMG_PALETTE` (`#001a00 / #0b4f1a / #2fa84a / #8cff9e`), the strict 4-shade asset palette (G5) exported as a `const` tuple for test enforcement; `landing.css` binds every DMG colour to a `--dmg-0..3` custom property and a property test scans computed styles for any off-palette value.

#### Landing state machine (additive)

A single additive boolean `landingDismissed` on `SessionState` (seeded `false`), plus the existing `summary`, drives the region — no new timers, all transitions reducer-pure. It is set `true` on the first accepted command that produces output, and reset `false` by the new **`home` command**. `parseCommand` gains `case "home"` (only with zero args; otherwise the existing unknown result) and the `Command` union gains `{ kind: "home" }`; every other command name parses byte-identically (G6). The reducer's `home` transition empties the log and nulls `summary`/`readings`/`lastRitual` — a superset of `clear` plus the landing restore — while `clear` is left unchanged, so existing parser and `clear` tests stay green.

#### Screen-only landing components (`packages/ui-crt/src/components`)

Screen-only, composed inside the `Landing` region and styled by `landing/landing.css` (DMG panel chrome, inverted-row = two palette shades at ≥ 4.5:1, `image-rendering: pixelated` with no `filter` on images, a single bitmap pixel font token, an integer `--px` grid, `text-overflow: ellipsis` single-line clipping; candle-flicker + cursor-blink are the only animations and run only inside `.crt[data-motion="full"]` motion zones, off under reduced motion).

- **`Landing`** — returns `null` when `!landingVisible(state)`; owns a local `SelectionState`, attaches a `keydown` handler calling `landingKeyAction`, and dispatches move → local state, activate → `submit("summon <ref>")` then `submit("read fates")` for a concrete repo (ENTER row → `focusInput()`), demo → `submit("demo")`, help → `submit("help")`; a mouse click selects + activates. It composes HudBar, LegacyRepoList, PreviewWindow and HintBar, and is mounted inside `<Terminal>` as a sibling above `OutputLog`, gated by `landingVisible(state)` — the boot/seer region, command line, button chips and `NECRO>` input stay mounted and operable (it is a presentational overlay, not a focus trap).
- **`HudBar`** / **`HintBar`** — plain-DOM `NECRO-ORACLE` · SOUL hearts (one accessible text label, decorative glyphs) · `PY2 CURSE: ACTIVE`, and the hint line `▲▼ SELECT  A:SUMMON  B:DEMO  START:HELP` (the arrows/letters decorative; the real bindings live in `landingKeyAction`).
- **`LegacyRepoList`** — `role="listbox"` with `role="option"` rows, `aria-selected="true"` and the inverted class on the selected row, and a `▶` cursor marked `aria-hidden` so the option's accessible name is the label + tag + file count with the cursor char excluded.
- **`PreviewWindow`** — renders the reused `SeerPortrait` whenever `model.showSeer` (the Part B Seer fix, below), three face-down **eye/moon** card backs (NO pentagram, per tarot-ux), integer-scaled and pixelated with no filter, and the ORACLE SAYS line as plain DOM text ≤ 72 cols with ellipsis; a missing seer or card-back degrades to a text/phosphor box with no broken-image indicator.

#### Part B — Seer visible on the idle landing

The Seer previously rendered **only** while `seerAsset !== undefined && boot.phase === "playing"` (G1), so on the common idle screen — and immediately on a `?boot=skip` load — it was unmounted. The remedy keeps the boot-region Seer branch unchanged and additionally renders `<SeerPortrait>` inside `PreviewWindow` whenever the landing is visible and the manifest has the seer asset, using the same `integerScale` measurement and text fallback. The Seer now appears on the idle screen where the mockups show it, with no boot regression.

#### Part B — resurrection result as its own chunk

The resurrection diff/vitality view was rendered inline by `Terminal.tsx`; the dedicated `ResurrectionResult` component was reached only through `load-resurrection-view.ts`, which no runtime module imported, so the bundler tree-shook it and emitted no `ResurrectionResult` chunk — and `scripts/check-web-budget.mjs`, which requires that chunk to exist and be separate, failed. The remedy wires the lazy seam live rather than loosening the budget, mirroring the demo / sound / background-theme / patch-download seams (G8):

- `apps/web/src/terminal/resurrect-view-port.ts` defines `ResurrectViewPort` and `createResurrectViewPort()` = `() => loadResurrectionView()` (a literal-path dynamic import of `ResurrectionResult`). `TerminalPorts` in `packages/ui-crt/src/ports.ts` gains the additive optional `resurrectView?: ResurrectViewPort`, so port-less hosts still type-check.
- `createBrowserPorts` adds `resurrectView: createResurrectViewPort()`, threaded through `TerminalScreen.tsx` and consumed by the ui-crt `ResurrectResultView` through the optional port so a settled `resurrect` mounts the view through it. That single live reference keeps `load-resurrection-view.ts` in the module graph, so the bundler emits a distinct `ResurrectionResult` chunk containing `renderFileResults` / `renderResurrectVitality` / `Residual_List`, which `check-web-budget`'s `findSeparateChunks` now locates alongside the demo / sound / background-theme chunks. `BUDGET_BYTES` stays `250_000` (unchanged).

## The Resurrection Engine

The Resurrection Engine turns `resurrect <card-or-file>` in the CRT terminal into a two-pass, evidence-driven code-modernization Ritual. It is the project's first grimoire system: a pluggable `Grimoire` (first pair: Python 2 → Python 3) executed by a `CovenRunner` inside `@necro/coven`, with every side-effecting capability injected as a port (`LlmPort`, `SandboxPort`, `LedgerPort`, `ClockPort`). The engine reuses the completed, unmodified `@necro/oracle` (`runReading`, `computeVitality`, `computeVitalityDelta`, the tree-sitter parser, `maskSecret`, `NecroError`) for candidate selection, validation, and re-diagnosis, and reuses the existing web NDJSON protocol, limiter, redaction, and error-map from `apps/web` for the HTTP surface.

### Dependency direction (enforced)

The engine obeys and extends the project rule `oracle ← grimoires ← coven ← apps/web`.

- `@necro/oracle` imports nothing from the engine and is unchanged.
- `@necro/grimoires-py2to3` imports `@necro/oracle` (parser + snapshot/draw types) and `@necro/coven` (the `Grimoire`/`Fixer`/`LlmStep` contracts and the shared zod models) — but **no adapters**. A static import-ban test mirrors the oracle client-guard: fixers never import `@necro/llm` or `@necro/sandbox`.
- `@necro/coven` depends on `grimoires` and defines the ports; the adapters (`@necro/llm`, `@necro/sandbox`) are injected into the runner, never imported by fixers. A grimoire arrives through the injected `LanguagePairRegistry`, so the runner source names no grimoire package.
- `apps/web` depends on `coven`. Cross-package imports go only through each package's `src/index.ts` (plus the `@necro/coven/node` subpath for the Node-only demo fixture loader).

### Package map

| Package | Role | Barrel |
| --- | --- | --- |
| `@necro/oracle` | Reused pure core. **Unchanged.** | `src/index.ts`, `src/client.ts`, `src/node.ts` |
| `@necro/grimoires-py2to3` | The py2→3 grimoire: pure fixers, declarative LLM step, `validate`, fixtures. | `src/index.ts` (`py2to3Grimoire`) |
| `@necro/coven` | Ports, the `Grimoire` contract, zod models, registry, selection, diff/patch, re-diagnosis, cross-sink masking, the local + optional Inngest runners, demo wiring. | `src/index.ts` (browser-safe) + `src/node.ts` (Node-only demo loader) |
| `@necro/llm` | `LlmPort` and the required deterministic Mock provider, completion cache, per-construct budget. | `src/index.ts` |
| `@necro/sandbox` | `SandboxPort`, the command allowlist, the optional E2B parse-only provider. | `src/index.ts` |
| `@necro/config` | Adds the server-only `NECRO_LLM_API_KEY` env key. | `src/index.ts` |
| `apps/web` | `Resurrection_Route`, the resurrection NDJSON stream schema, demo wiring. | — |

### Ports (`@necro/coven/src/ports.ts`)

Ports are the only side-effecting surface the runner touches. Fixers receive them only as injected parameters; they never import them.

| Port | Shape | Notes |
| --- | --- | --- |
| `LlmPort` | `complete(req: LlmRequest) => Promise<LlmResult>` | `providerId` is `"mock" \| "bedrock" \| "anthropic" \| "openai"`. Throws a typed `NecroError` on timeout/unavailable. The Mock provider is deterministic and network-free. An absent `LlmPort` ⇒ Degraded_Mode (the LLM_PASS is skipped). |
| `SandboxPort` | `parseCheckPython3(source, { timeoutMs })`, `dispose()` | Optional, parse-only (compile-only) E2B check. Never executes repository code; the micro-VM is disposed in every terminal state. Absent ⇒ `Target_Parser` only. |
| `LedgerPort` | `append(event: LedgerEvent)` | Append-only, strictly increasing `seq`; ritual state is derivable by folding events. |
| `ClockPort` | `nowMs()` | Deterministic time; budgets and detectors never read the ambient clock. |

`RitualPorts` bundles `{ clock, ledger, llm?, sandbox? }`. The absence of an optional port is read as an absent key (not an explicit `undefined`), so the runner degrades gracefully.

### Grimoire contract and the py2to3 grimoire

A `Grimoire` is adapter-free and declarative: `{ id, pair, inputSchema, outputSchema, fixers, llm, validate, divergenceAllowlist }`. `fixers` are pure `(source, ctx) => FixResult` functions run in a fixed order (Pre_Pass); `llm` is an `LlmStep<T>` (output zod schema + `buildRequest` + `apply` + a deterministic `mockFixture`) that the **runner** — not the grimoire — executes through the injected `LlmPort`; `validate(after)` runs the tree-sitter `Target_Parser` and treats zero error nodes as valid Python 3.

`@necro/grimoires-py2to3` exports `py2to3Grimoire` (id `"py2to3"`, pair `python2->python3`). Its six deterministic Pre_Pass fixers — `print_statement`, `except_comma`, `dict_iter`, `unicode_str`, `long_literal`, `ne_operator` — parse once with the injected `parsePython`, rewrite spans right-to-left, and never touch string-literal or comment contents, which makes them idempotent and deterministic. A file tree-sitter cannot parse is left unchanged with a `parse_failed` residual.

### Coven runner and the ritual pipeline

`@necro/coven` exports `LocalCovenRunner` (the default) and the optional `InngestCovenRunner` (`createInngestCovenRunner` returns `undefined` unless the Inngest env is configured). `run(input, ports, emit)` drives one Ritual through a fixed phase order, emitting each phase through the monotonic reporter `emit`:

`SELECT → PRE_PASS → LLM_PASS → VALIDATE → REDIAGNOSE → DIFF`

- **SELECT** (`selectCandidates`, pure) derives the ascending-by-path `CandidateFile`s from the completed reading's Python-2-classified evidence, scoped by the target (bare ⇒ all py2 paths; card ⇒ that card's evidence paths; file ⇒ the single exact path), capped at `MAX_CANDIDATES` (50), excluding files over 1 MB with an oracle-voice skip-note.
- **PRE_PASS** runs the grimoire's deterministic fixers.
- **LLM_PASS** builds one request per residual through `LlmStep.buildRequest` — masking secrets first, then wrapping the code in fixed untrusted-data delimiters — validates the result with the step's zod schema (one retry on failure), and is skipped entirely in Degraded_Mode.
- **VALIDATE** runs the `Target_Parser` (and the optional sandbox parse-check where a `SandboxPort` is injected, falling back with a skip-note on timeout/unavailability). Unparseable produced content is excluded and recorded as a residual, never presented as converted.
- **REDIAGNOSE** (`rediagnose`, pure, oracle-only) overlays the validated `After_Content` into a copy of the summoned `RepoSnapshot`, re-runs `runReading` with the **same spread**, and reports `beforeVitality`/`afterVitality`, the signed `vitalityDelta`, and the changed-card set. A post-reading failure yields a typed `REDIAGNOSIS_FAILED` with after/delta nulled, preserving the produced files.
- **DIFF** (`lineDiff`, `buildPatch`, pure) produces a per-file `DiffLine[]` and a single round-tripping unified-diff `Patch` over the validated, changed files only.

The runner isolates failures into typed `NecroError`s, disposes any sandbox in every terminal state, routes every file's content, residual text, skip-note, and ledger entry through `maskSecretsInText`/`maskContentItem` before any sink, and enforces a 45 s wall-clock budget that ends the Ritual with partial `FileResult`s and a `BUDGET_EXHAUSTED` error rather than silently dropping work.

The engine's coven-only error codes are `BUDGET_EXHAUSTED`, `PAIR_UNKNOWN`, `PAIR_DUPLICATE`, `REDIAGNOSIS_FAILED`, and `DEMO_FIXTURE_MISSING`.

### Language_Pair_Registry

`LanguagePairRegistry` (`@necro/coven/src/registry.ts`) is a pure in-memory `pair → grimoire` map. `register` throws a `VALIDATION_FAILED` `NecroError` on a duplicate id (leaving the existing binding untouched); `resolve` throws `PAIR_UNKNOWN` for an unknown id before any sandbox/LLM work. `createDefaultRegistry({ py2to3: py2to3Grimoire })` registers the shipped `PYTHON2_TO_PYTHON3` grimoire; adding a new pair means calling `register` with a new grimoire — no engine-core source change.

### Resurrection_Route and NDJSON protocol

`apps/web/src/server/handlers/resurrect.ts` (`handleResurrect`, bound at `app/api/resurrect`) mirrors `handleReading`: method guard → `checkLimit` → body guard → strict `ResurrectRequestSchema` parse (pre-stream `400` on failure) → commit to a `200 application/x-ndjson` stream → drive the local runner → write the single terminal line. `ResurrectRequestSchema` is `{ ref, target?, spread: "fates" | "necropsy", demo?: true }` with `ref` matching `owner/name@<40-hex-lowercase-sha>`.

The stream (`apps/web/src/protocol/resurrect-stream.ts`, `ResurrectStreamLineSchema`, validated server-side before writing and client-side before rendering) reuses `SkipNoteLineSchema` and `ErrorLineSchema` verbatim and adds the resurrection phase enum and a result line:

- Phase lines `{ phase }` for each of `SELECT`, `PRE_PASS`, `LLM_PASS`, `VALIDATE`, `REDIAGNOSE`, `DIFF`, in order.
- Optional skip-note lines `{ skip: true, note }`.
- Exactly one terminal line: `{ result }` wrapping a redaction-safe `RitualResult` (every leaf a string/number/boolean/enum — no `cause` or stack) on success, or `{ error: { code, userMessage } }` on any mid-stream failure or budget expiry. Because the handler commits to a `200` stream once the request schema passes, a post-stream failure is carried as the final `{ error }` line.

Every outgoing line is run through `redactDeep` with both the GitHub token and the LLM key. A coven-only error code is translated onto the closest oracle `NecroErrorCode` by `mapEngineError` before `mapError`, so the emitted `{ error }` line always validates against the reused `ErrorLineSchema`. An Overall_Budget (48 s, below the route's `maxDuration = 50` and above the runner's 45 s budget) backstops a hung runner.

Spend breakers decide port injection: an open LLM breaker runs the Ritual without an `LlmPort` (Degraded_Mode skip-note); an open sandbox breaker omits the `SandboxPort` and the route emits its own breaker skip-note.

### Adapters

- **`@necro/llm`** exports `createMockLlmPort` (required, deterministic, network-free; guarded by a no-network test), `createLlmCache`/`withCache` (keyed by `LlmRequest.cacheKey`), and `DEFAULT_LLM_BUDGET`/`makeBudget`/`withinBudget` for the per-construct token/timeout budget. Real providers (Bedrock/Anthropic/OpenAI) are optional.
- **`@necro/sandbox`** exports the `SANDBOX_ALLOWLIST` (the only sanctioned commands — `py_compile`-style parse-only argv), `allowlistedArgv`/`isAllowlisted`, and the optional `createE2bSandboxPort`/`isE2bConfigured` built only where E2B is configured. The provider is parse-only and never executes repository code.

### Config and Degraded_Mode

`@necro/config` adds the server-only `NECRO_LLM_API_KEY` (optional; blank/whitespace treated as unset). It is read only in the composition root, never sent to the client, and never logged (it is in the redaction secret set). Absent/empty keeps startup alive in Degraded_Mode: the runner skips the LLM_PASS and emits exactly one oracle-voice skip-note, and `RitualResult.degraded` makes the state observable.

### Demo mode

`demo: true` loads the `lich-py2` graveyard fixtures through the Node-only `@necro/coven/node` loader (`loadDemoRitualInput`, `LICH_PY2_FIXTURE`), wires the Mock `LlmPort` with the sandbox omitted (`createDemoPorts`), and blocks outbound network for the run (`installNetworkBlockGuard`, which throws rather than reaching the wire). Every emitted line carries a single `[DEMO]` prefix applied at the one serialization choke point (`prefixDemoLine`/`DEMO_PREFIX`, `demoEmit`). A missing/unreadable fixture yields a `DEMO_FIXTURE_MISSING` error line. Because the Pre_Pass is deterministic and the Mock provider is fixed, repeated demo runs are byte-identical; the `lich-py2` fixtures are authored so the deterministic pass alone (no key) removes the legacy constructs driving the Judgement draw, producing `vitalityDelta > 0` and at least one improved card on every run.
