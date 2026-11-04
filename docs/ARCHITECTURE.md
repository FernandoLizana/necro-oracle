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
