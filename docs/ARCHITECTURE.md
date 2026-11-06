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
| Render | `render/{blocks,evidence-link,reading,summary,help,explain,demo-label,errors}.ts` | The block/line/segment output model, the single `buildEvidenceLink` builder, the renderers, and the four terminal-raised error builders (`networkError`, `upstreamError`, `invalidResponseError`, `demoUnavailableError`). |
| Motion and prefs | `motion/{reveal,motion-mode}.ts`, `prefs/prefs.ts` | Pure reveal schedule, effective-motion resolution, and the persisted-preference parsers plus their storage-key constants. |
| Session | `session/{state,reducer,history,log,pinned-ref}.ts` | `initialState`, the pure `step(state, action) => { state, effects }` reducer, bounded command history (`HISTORY_MAX`) and output log (`LOG_MAX_LINES`), and `formatPinnedRef`. |
| Sound | `sound/{sound-reducer,engine-types,load-engine,engine}.ts` | The pure sound state machine (`soundReducer`, `soundActivity`) and the lazy Web Audio engine. `load-engine.ts` is the production `SoundLoaderPort`; `engine.ts` is never barrelled — it is reached only through a literal-path dynamic import so it ships as a separate chunk. |
| Components and hooks | `components/*.tsx`, `hooks/*.ts` | `Screen`, `Terminal`, `OutputLog`, `OutputBlockView`, `Card`, `Spread`, `EvidenceScroll`, `CommandLine`, `ButtonRow`, and the `use-terminal`/`use-reveal`/`use-motion`/`use-sound` hooks that wire the pure reducer to the browser. |
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
