# Requirements Document

## Introduction

The GitHub Summoner is the `@necro/github` adapter package. It turns a public
GitHub repository reference (a URL string or `owner/repo` shorthand) into a
`RepoSnapshot` that `runReading` from `@necro/oracle` can consume, together with
the injectable external data (`RegistryData` and `OsvData`) that the Oracle's
detectors read from `ReadingOpts`.

The package implements the `GitHubSnapshotBuilder` interface already defined in
`@necro/oracle`. Because `build()` accepts an already-resolved `RepoRef`, the
package exposes the full pipeline: a pure parser (URL string → `RepoRef` minus
the resolved SHA), a ref resolver (default branch + exact commit SHA via the
GitHub REST API), the builder (single-tarball download → in-memory extraction →
`buildSnapshotFromFileMap`), a `RepoMeta` mapper, and an external-data fetcher
for PyPI/npm freshness and OSV vulnerabilities.

`@necro/github` is an adapter. Per the dependency-direction rule it MUST NOT be
imported by `@necro/oracle`; it depends only on `@necro/oracle` types. All side
effects (HTTP, clock, environment access) are injected through ports so that
every unit and property test runs offline against recorded fixtures with zero
real network. The caps that `@necro/oracle` already enforces (1 MB per file,
5000 files) are reused from `buildSnapshotFromFileMap`, never reimplemented.

This document specifies requirements only. Design and implementation are out of
scope here.

## Glossary

- **GitHub_Summoner**: The `@necro/github` package and its public API surface
  (the URL parser, the ref resolver, the `GitHubSnapshotBuilder` implementation,
  and the external-data fetcher).
- **Repo_Reference_String**: The caller-supplied input identifying a repository,
  either `owner/repo` shorthand or a `https://github.com/owner/repo` URL,
  optionally with a branch, ref name, or commit SHA.
- **RepoRef**: The `@necro/oracle` type `{ owner, name, sha, defaultBranch }`
  identifying a repository at an exact resolved commit.
- **RepoMeta**: The `@necro/oracle` type carrying repository metadata
  (`pushedAt`, `isArchived`, `openIssueCount`, `openPRCount`,
  `oldestOpenPRAgeDays`, `latestReleaseAt`, `licenseKey`).
- **RepoSnapshot**: The `@necro/oracle` in-memory representation of a repository
  at a commit (`ref`, `files`, `meta`, `manifests`, `contents`, `oversizeFiles`,
  `truncated`, `createdAt`).
- **Tarball_Snapshot**: A repository downloaded as a single gzip-compressed tar
  archive in one HTTP request and extracted entirely in memory, never written to
  disk, and never executed. Two independent caps guard against decompression
  bombs: a 50 MB cap on the COMPRESSED bytes downloaded, and a 200 MB cap on the
  cumulative UNCOMPRESSED bytes extracted plus a maximum extracted-entry count
  (default 100,000). A small compressed archive can expand into a far larger
  uncompressed stream, so the uncompressed and entry-count caps are necessary in
  addition to the download cap.
- **FetchPort**: The injected HTTP dependency. All network access inside the
  package goes through `FetchPort`; no global `fetch` is called inside package
  logic. Tests supply a `FetchPort` backed by recorded fixtures.
- **ClockPort**: The injected time dependency supplying the current instant,
  used for `createdAt`, cache TTL, and rate-limit arithmetic, so time-dependent
  behavior is deterministic in tests.
- **EnvPort**: The injected, validated environment accessor (backed by the
  `@necro/config` zod env schema) through which the optional `GITHUB_TOKEN` is
  read; the token is never logged, printed, or returned.
- **RegistryData**: The `@necro/oracle` type `Map<string, RegistryEntry>`
  carrying PyPI/npm freshness per dependency, consumed by the Tower detector.
- **OsvData**: The `@necro/oracle` type `OsvVulnerability[]` carrying
  vulnerability records, consumed by the Devil detector.
- **Skipped_Dependencies**: The list returned alongside RegistryData and OsvData
  that records each dependency whose registry or OSV query timed out or failed,
  together with a reason, so that isolated per-dependency failures are reported
  without failing the external-data fetch or the reading.
- **ParsedDependency**: The `@necro/oracle` type `{ name, versionSpec, extras }`
  produced by manifest parsing; the set of packages queried against PyPI/npm/OSV.
- **Ref_Resolution**: Converting a branch, ref name, or partial SHA into the
  repository's default branch plus the exact 40-character commit SHA via the
  GitHub REST API.
- **Vendored_Folder**: A directory excluded before building the file map because
  it holds third-party or VCS data rather than first-party source, specifically
  `node_modules`, `.git`, and recognized vendored paths.
- **Oracle_Voice**: The narration persona defined in the `oracle-voice`
  steering: a short mystical line followed by an actionable technical line;
  used for every `NecroError.userMessage` surfaced by this package.
- **NecroError**: The `@necro/oracle` typed error `{ code, userMessage, cause }`
  used for every failure in this package.
- **Snapshot_Cache**: The in-memory cache keyed by `owner/repo@sha`, returning a
  previously built `RepoSnapshot` without re-downloading. Entries are bounded
  both by a TTL (default 7 days) and by a maximum entry count (default 20) with
  least-recently-used eviction.

## Requirements

### Requirement 1: Parse and validate the repository reference

**User Story:** As a caller of the GitHub Summoner, I want repository references to be parsed and validated by a pure function, so that only well-formed github.com references proceed and parsing is fully testable offline.

#### Acceptance Criteria

1. WHEN a Repo_Reference_String in `owner/repo` shorthand is provided, THE GitHub_Summoner SHALL return a parsed reference with the owner and the repository name as separate fields, each preserving the original character case.
2. WHEN a Repo_Reference_String in the form `https://github.com/owner/repo` is provided, THE GitHub_Summoner SHALL return a parsed reference with the owner and the repository name as separate fields, each preserving the original character case.
3. WHERE a Repo_Reference_String includes a branch name, ref name, or commit SHA in any of the forms `owner/repo#ref`, `owner/repo@sha`, or a URL path segment `/tree/<ref>`, THE GitHub_Summoner SHALL include that ref value in the parsed reference.
4. WHERE a Repo_Reference_String includes no branch name, ref name, or commit SHA, THE GitHub_Summoner SHALL return a parsed reference whose ref field is absent or null.
5. WHEN a Repo_Reference_String uses the host `github.com` or `www.github.com` over either the `http` or `https` scheme, THE GitHub_Summoner SHALL accept it and return a parsed reference with the host normalized to `github.com`.
6. WHEN a Repo_Reference_String contains a trailing `.git` suffix on the repository name, a trailing `/` after the repository or ref segment, or leading or trailing whitespace, THE GitHub_Summoner SHALL strip these before validation and exclude them from the parsed owner, repository name, and ref fields.
7. IF a Repo_Reference_String names a host other than `github.com` or `www.github.com`, THEN THE GitHub_Summoner SHALL raise a NecroError with code `INVALID_REPO_URL` and an Oracle_Voice userMessage, and SHALL return no parsed reference.
8. IF the owner or the repository name, after normalization, is empty or contains any character outside the set of ASCII letters, ASCII digits, hyphen, underscore, or period, THEN THE GitHub_Summoner SHALL raise a NecroError with code `INVALID_REPO_URL` and an Oracle_Voice userMessage, and SHALL return no parsed reference.
9. IF a Repo_Reference_String is empty, is composed solely of whitespace, omits the owner, or omits the repository name, THEN THE GitHub_Summoner SHALL raise a NecroError with code `INVALID_REPO_URL` and an Oracle_Voice userMessage, and SHALL return no parsed reference.
10. THE GitHub_Summoner SHALL implement reference parsing as a pure function that performs no network access, no clock access, and no environment access.
11. WHEN the same Repo_Reference_String is parsed more than once, THE GitHub_Summoner SHALL return parsed references whose owner, repository name, host, and ref fields are equal on every invocation.

### Requirement 2: Resolve the exact ref

**User Story:** As a caller, I want the Summoner to resolve the default branch and the exact commit SHA, so that every snapshot is anchored to one immutable commit.

#### Acceptance Criteria

1. WHEN a parsed reference without an explicit ref is resolved, THE GitHub_Summoner SHALL query the GitHub REST API through the FetchPort for the repository's default branch and SHALL produce a RepoRef whose `defaultBranch` equals the repository's reported default branch name and whose `sha` equals that branch's head commit SHA expressed as exactly 40 lowercase hexadecimal characters.
2. WHEN a parsed reference includes an explicit branch name or ref name, THE GitHub_Summoner SHALL resolve that ref through the FetchPort to a commit SHA of exactly 40 lowercase hexadecimal characters and SHALL set it as the RepoRef `sha`.
3. WHEN a parsed reference includes a commit SHA that is already exactly 40 lowercase hexadecimal characters, THE GitHub_Summoner SHALL verify that the commit exists through the FetchPort and SHALL set the verified 40-character SHA as the RepoRef `sha`; WHEN the included commit SHA is a partial SHA shorter than 40 characters, THE GitHub_Summoner SHALL resolve it through the FetchPort to its full 40-character form.
4. THE GitHub_Summoner SHALL populate the resulting RepoRef so that `owner`, `name`, and `defaultBranch` are non-empty strings of length at least 1 and `sha` matches exactly 40 lowercase hexadecimal characters, and SHALL set `defaultBranch` to the repository's reported default branch name regardless of which ref was requested.
5. THE GitHub_Summoner SHALL validate every GitHub REST API response with a zod schema before reading any field from that response.
6. IF a GitHub REST API response fails zod validation, THEN THE GitHub_Summoner SHALL raise a NecroError with code `VALIDATION_FAILED` and an Oracle_Voice userMessage, SHALL NOT read any field from the unvalidated response, and SHALL NOT return a partially populated RepoRef.
7. THE GitHub_Summoner SHALL resolve the ref within the overall GitHub REST API call budget defined in Requirement 4 criterion 8 (at most 5 REST calls per summon, excluding the tarball download).

### Requirement 3: Download and build the snapshot from a single tarball

**User Story:** As a caller, I want the repository fetched as one tarball and shaped into a RepoSnapshot, so that a reading starts quickly and reuses the Oracle's existing caps.

#### Acceptance Criteria

1. WHEN a RepoRef is built, THE GitHub_Summoner SHALL download the repository at that SHA as a single Tarball_Snapshot in one logical request through the FetchPort, following at most one redirect to `codeload.github.com`, rather than fetching files individually.
2. THE GitHub_Summoner SHALL extract the Tarball_Snapshot entirely in memory and SHALL NOT execute, import, evaluate, or spawn any extracted file as code.
3. IF a tar entry resolves to a path outside the extraction root (a path-traversal entry containing `..` segments or an absolute path), THEN THE GitHub_Summoner SHALL skip that entry and SHALL exclude it from the file map.
4. IF a tar entry is a symbolic link or hard link, THEN THE GitHub_Summoner SHALL skip that entry and SHALL exclude it from the file map.
5. BEFORE building the file map, THE GitHub_Summoner SHALL exclude Vendored_Folder paths (`node_modules`, `.git`, and recognized vendored directories).
6. BEFORE building the file map, THE GitHub_Summoner SHALL exclude any entry classified as binary, where binary is determined by the presence of a NUL byte within the first 8000 bytes of the entry content.
7. THE GitHub_Summoner SHALL construct the RepoSnapshot by calling `buildSnapshotFromFileMap` from `@necro/oracle` with the extracted text file map, and SHALL rely on that function for the 1 MB per-file cap and the 5000-file lexicographic cap.
8. THE GitHub_Summoner SHALL NOT reimplement the 1 MB per-file cap or the 5000-file lexicographic cap, and SHALL delegate both caps exclusively to `buildSnapshotFromFileMap`.
9. WHILE accumulating the Tarball_Snapshot, IF the cumulative downloaded size exceeds 50 MB (52,428,800 bytes), THEN THE GitHub_Summoner SHALL stop downloading, SHALL retain no partial snapshot, and SHALL raise a NecroError with code `DOWNLOAD_TOO_LARGE` and an Oracle_Voice userMessage indicating the download exceeded the size limit.
10. WHILE extracting the Tarball_Snapshot, IF the cumulative UNCOMPRESSED size of extracted entries exceeds 200 MB (209,715,200 bytes), THEN THE GitHub_Summoner SHALL stop extracting, SHALL retain no partial snapshot, and SHALL raise a NecroError with code `DOWNLOAD_TOO_LARGE` and an Oracle_Voice userMessage.
11. WHILE extracting the Tarball_Snapshot, IF the number of entries exceeds a configured maximum entry count (default 100,000), THEN THE GitHub_Summoner SHALL stop extracting and SHALL raise a NecroError with code `DOWNLOAD_TOO_LARGE`.
12. THE GitHub_Summoner SHALL NOT forward the Authorization header to `codeload.github.com` or to any redirect target host other than `github.com` or `api.github.com`.
13. THE GitHub_Summoner SHALL strip the tarball's top-level `<owner>-<repo>-<sha>/` directory prefix from every entry path before building the file map, so snapshot paths are repository-root-relative.
14. WHEN constructing the RepoSnapshot, THE GitHub_Summoner SHALL set the RepoSnapshot `createdAt` from the injected ClockPort rather than from the system clock.

### Requirement 4: Map repository metadata

**User Story:** As a caller, I want repository metadata mapped into the Oracle's `RepoMeta` shape, so that metadata-driven detectors have accurate inputs.

#### Acceptance Criteria

1. WHEN a snapshot is built, THE GitHub_Summoner SHALL populate RepoMeta `isArchived`, `pushedAt`, `openIssueCount`, `openPRCount`, `oldestOpenPRAgeDays`, `latestReleaseAt`, and `licenseKey` from GitHub REST API data validated through a zod schema.
2. THE GitHub_Summoner SHALL set RepoMeta `licenseKey` to the repository's SPDX identifier, to `NOASSERTION` when GitHub reports a license without an SPDX identifier, or to `null` when no license is present.
3. THE GitHub_Summoner SHALL represent RepoMeta `pushedAt` and `latestReleaseAt` as ISO 8601 UTC strings or `null`.
4. THE GitHub_Summoner SHALL set RepoMeta `openPRCount` to the count of open pull requests and SHALL set RepoMeta `openIssueCount` to GitHub's reported open-issues count minus `openPRCount`, floored at `0`, so that pull requests are not double-counted as issues.
5. THE GitHub_Summoner SHALL set RepoMeta `oldestOpenPRAgeDays` to the whole number of days (elapsed seconds divided by 86,400, rounded down, minimum `0`) from the oldest open pull request's creation time to the snapshot time, or to `null` when no open pull request exists.
6. WHERE GitHub repository attributes exist that are not fields of RepoMeta — specifically star count (an integer of at least `0`), the default branch name (a non-empty string), and the presence of a `.github/workflows` directory (a boolean) — THE GitHub_Summoner SHALL expose those attributes through its own public result type separate from RepoMeta, and SHALL derive the presence of a `.github/workflows` directory from the downloaded Tarball_Snapshot entries rather than from a separate GitHub REST API call.
7. IF a RepoMeta field cannot be derived from validated GitHub data, whether because the data is absent or because it fails zod validation, THEN THE GitHub_Summoner SHALL use the neutral default for that field (counts `0`, booleans `false`, and `pushedAt`, `oldestOpenPRAgeDays`, `latestReleaseAt`, and `licenseKey` set to `null`).
8. THE GitHub_Summoner SHALL complete a full summon using at most 5 GitHub REST API calls, excluding the single tarball download, so that an unauthenticated summon stays within GitHub's 60-requests-per-hour unauthenticated budget.

### Requirement 5: Provide injectable external data for detectors

**User Story:** As a caller, I want PyPI/npm freshness and OSV vulnerabilities fetched for the repository's dependencies, so that the Tower and Devil detectors receive the `RegistryData` and `OsvData` that `runReading` expects.

#### Acceptance Criteria

1. THE GitHub_Summoner SHALL parse the downloaded manifests into ParsedDependency values and SHALL deduplicate dependency names by their lowercased form before fetching external data so that each distinct dependency is queried at most once.
2. WHEN external data is fetched, THE GitHub_Summoner SHALL query PyPI for Python dependencies and npm for JavaScript dependencies through the FetchPort and SHALL return a RegistryData map keyed by the lowercased package name matching the `@necro/oracle` Tower detector's lookup (`registryData.get(dep.name.toLowerCase())`), with no ecosystem prefix.
3. WHEN external data is fetched, THE GitHub_Summoner SHALL query OSV for the parsed dependencies through the FetchPort in batch and SHALL return an OsvData array.
4. THE GitHub_Summoner SHALL apply a timeout of at most 10 seconds to each outbound registry or OSV request made through the FetchPort.
5. IF an outbound registry or OSV query for a dependency times out or fails, THEN THE GitHub_Summoner SHALL skip that dependency's query, SHALL record it in a returned list of skipped dependencies with a reason, and SHALL NOT fail the external-data fetch or the reading.
6. IF a dependency is absent from its registry (for example a 404 response validated as a not-found result), THEN THE GitHub_Summoner SHALL omit that dependency from RegistryData rather than inventing an entry.
7. IF one registry or OSV endpoint fails for a dependency while others succeed, THEN THE GitHub_Summoner SHALL return the external data gathered from the successful queries rather than aborting the entire fetch.
8. THE GitHub_Summoner SHALL validate every PyPI, npm, and OSV response with a zod schema before mapping it into RegistryData or OsvData.
9. THE GitHub_Summoner SHALL produce RegistryData entries conforming to the `RegistryEntry` shape and OsvData entries conforming to the `OsvVulnerability` shape defined in `@necro/oracle`.
10. WHEN external data is fetched, THE GitHub_Summoner SHALL return the RegistryData map, the OsvData array, and the list of skipped dependencies together as the external-data result.
11. WHERE a PyPI package and an npm package share the same lowercased name, THE GitHub_Summoner SHALL produce a single RegistryData entry under that key with last-writer-wins semantics, and this cross-ecosystem collision is a known limitation to be resolved if and when `@necro/oracle` adopts ecosystem-aware registry keys.

### Requirement 6: Optional, protected authentication

**User Story:** As an operator, I want an optional GitHub token read only from the validated environment, so that public repositories work unauthenticated and tokens are never exposed.

#### Acceptance Criteria

1. THE GitHub_Summoner SHALL read the optional `GITHUB_TOKEN` only through the injected EnvPort backed by the `@necro/config` zod env schema.
2. WHERE a `GITHUB_TOKEN` is present AND the request target host is `github.com` or `api.github.com`, THE GitHub_Summoner SHALL attach the token as an Authorization header to GitHub REST API requests made through the FetchPort.
3. IF a `GITHUB_TOKEN` is present AND the request target host is any host other than `github.com` or `api.github.com` (including PyPI, npm, and OSV hosts), THEN THE GitHub_Summoner SHALL omit the Authorization header from that request.
4. WHERE no `GITHUB_TOKEN` is present, THE GitHub_Summoner SHALL operate against public repositories without authentication and SHALL send no Authorization header.
5. THE GitHub_Summoner SHALL exclude the `GITHUB_TOKEN` value and any Authorization header value from log output, error messages, NecroError fields, and returned results, replacing any such value with a fixed redaction marker so no character of the token is observable; and SHALL NOT alter repository file contents, which are preserved byte-for-byte for the detectors to inspect.

### Requirement 7: Typed error handling with new error codes

**User Story:** As a caller, I want all failures surfaced as typed NecroError values with Oracle_Voice messages, so that error handling is consistent and actionable.

#### Acceptance Criteria

1. THE GitHub_Summoner SHALL introduce the error codes `INVALID_REPO_URL`, `REPO_NOT_FOUND`, `REPO_PRIVATE`, `RATE_LIMITED`, `NETWORK_TIMEOUT`, `DOWNLOAD_TOO_LARGE`, and `VALIDATION_FAILED` consistent with the typed-error rule, either by extending the `@necro/oracle` NecroError code enum or through a declared package-local extension of that enum, such that each raised error is an instance of NecroError whose `code` equals the listed string and whose `userMessage` is non-empty.
2. IF a Repo_Reference_String is invalid, THEN THE GitHub_Summoner SHALL raise a NecroError with code `INVALID_REPO_URL` and an Oracle_Voice userMessage.
3. IF the GitHub REST API confirms, for an authenticated request, that a repository is absent, THEN THE GitHub_Summoner SHALL raise a NecroError with code `REPO_NOT_FOUND` and an Oracle_Voice userMessage; IF a repository exists but is private, or an unauthenticated request reports not-found in a way that cannot be proven to mean absence, THEN THE GitHub_Summoner SHALL raise a NecroError with code `REPO_PRIVATE` and an Oracle_Voice userMessage.
4. IF the GitHub REST API reports that the request is rate limited, THEN THE GitHub_Summoner SHALL raise a NecroError with code `RATE_LIMITED` and an Oracle_Voice userMessage that states the wait duration, computed as the rate-limit reset instant minus the current ClockPort time, expressed in whole minutes rounded up with a minimum of one minute.
5. IF the GitHub REST API responds with a secondary rate limit, indicated by a `403` or `429` response carrying a `Retry-After` value, THEN THE GitHub_Summoner SHALL raise a NecroError with code `RATE_LIMITED` whose userMessage states the wait duration taken from the `Retry-After` value when present, otherwise falling back to the reset-instant computation specified in criterion 4.
6. IF a GitHub REST API or tarball-download request exceeds its timeout or fails with a connection-level network error, THEN THE GitHub_Summoner SHALL raise a NecroError with code `NETWORK_TIMEOUT` and an Oracle_Voice userMessage; a per-dependency registry or OSV timeout or failure is isolated per Requirement 5 criterion 5 and SHALL NOT raise `NETWORK_TIMEOUT`.
7. THE GitHub_Summoner SHALL attach the originating error as the `cause` of each raised NecroError and SHALL NOT suppress, discard, or replace an error without rethrowing it as a NecroError whose `cause` preserves the original.
8. THE GitHub_Summoner SHALL phrase every NecroError userMessage in the Oracle_Voice as a short mystical line followed by a technical line that states what happened and what to do next.

### Requirement 8: Snapshot caching

**User Story:** As a caller, I want built snapshots cached by commit, so that repeated readings of the same commit avoid re-downloading.

#### Acceptance Criteria

1. WHEN a snapshot is built for a RepoRef, THE GitHub_Summoner SHALL store it in the in-memory Snapshot_Cache keyed by `owner/repo@sha`, recording the entry's creation time from the injected ClockPort.
2. WHEN a snapshot is requested for a RepoRef whose cache key is present and whose age (current ClockPort time minus recorded creation time) is strictly less than the configured TTL, THE GitHub_Summoner SHALL return the cached RepoSnapshot without issuing a tarball download.
3. WHILE a cached entry's age, measured against the injected ClockPort, is greater than or equal to the configured TTL, THE GitHub_Summoner SHALL treat the entry as absent, rebuild the snapshot, and overwrite the expired entry with the rebuilt snapshot and a new creation time.
4. THE GitHub_Summoner SHALL derive the identical cache key for the same `owner`, `name`, and `sha` on every invocation.
5. WHERE no TTL is supplied by the caller, THE GitHub_Summoner SHALL apply a default TTL of 7 days (604800 seconds).
6. WHEN a snapshot is rebuilt for a RepoRef whose cache key is already present, THE GitHub_Summoner SHALL evict the existing entry and replace it with the rebuilt snapshot so that at most one entry exists per cache key.
7. WHERE no maximum entry count is supplied, THE GitHub_Summoner SHALL bound the Snapshot_Cache to a default maximum of 20 entries.
8. WHEN storing a new entry would exceed the maximum entry count, THE GitHub_Summoner SHALL evict the least-recently-used entry before storing the new one.
9. WHEN a cache hit returns a cached RepoSnapshot, THE GitHub_Summoner SHALL mark that entry as the most-recently-used entry.
10. WHEN a snapshot is stored in the Snapshot_Cache, THE GitHub_Summoner SHALL store repository file contents byte-for-byte unaltered and SHALL NOT persist the `GITHUB_TOKEN` or any Authorization header value in the cache.

### Requirement 9: Injected ports and offline determinism

**User Story:** As a maintainer, I want HTTP, clock, and environment access injected, so that every unit and property test runs offline and deterministically.

#### Acceptance Criteria

1. THE GitHub_Summoner SHALL perform all HTTP access through an injected FetchPort and SHALL NOT call a global `fetch` or any other non-injected network client from within package logic.
2. THE GitHub_Summoner SHALL obtain the current time only through an injected ClockPort and SHALL NOT call `Date.now()`, `new Date()`, or any other system clock source from within package logic.
3. THE GitHub_Summoner SHALL read environment values only through an injected EnvPort and SHALL NOT read `process.env` or any other non-injected environment source from within package logic.
4. WHEN a FetchPort backed by recorded fixtures, a fixed ClockPort, and a fixed EnvPort are supplied, THE GitHub_Summoner SHALL produce RepoSnapshot, RegistryData, and OsvData results that are byte-for-byte equal across repeated runs of the same operation.
5. WHEN tests run against fixture-backed ports, THE GitHub_Summoner SHALL make no real network request.
6. WHEN a fixture-backed FetchPort returns an error or transport failure, THEN THE GitHub_Summoner SHALL surface it as a NecroError without falling back to any real network, clock, or environment source.

### Requirement 10: Public API surface

**User Story:** As a consumer of the package, I want a clear public API exported from the package entry point, so that callers can run the full pipeline and inject dependencies.

#### Acceptance Criteria

1. THE GitHub_Summoner SHALL export its entire public API through the package `src/index.ts` entry point and SHALL NOT require consumers to import any path other than the package entry point to reach the reference parser, the ref resolver, the `GitHubSnapshotBuilder` implementation, or the external-data function.
2. THE GitHub_Summoner SHALL export a pure reference-parsing function that maps a Repo_Reference_String to a parsed reference and that performs no network access, no clock access, and no environment access.
3. THE GitHub_Summoner SHALL export a ref-resolution function that produces a RepoRef with every field (`owner`, `name`, `sha`, `defaultBranch`) populated with non-empty values from a parsed reference.
4. THE GitHub_Summoner SHALL export an implementation of the `@necro/oracle` `GitHubSnapshotBuilder` interface whose `build(ref: RepoRef)` returns a `Promise<RepoSnapshot>`.
5. THE GitHub_Summoner SHALL export an external-data function that returns the RegistryData map, the OsvData array, and the list of skipped dependencies together, where the RegistryData and OsvData shapes are consumable by `runReading`'s `ReadingOpts`, RegistryData entries conform to the `@necro/oracle` `RegistryEntry` shape, and OsvData entries conform to the `@necro/oracle` `OsvVulnerability` shape.
6. THE GitHub_Summoner SHALL accept a FetchPort, a ClockPort, and an EnvPort as injected dependencies on its public API and SHALL use only those injected dependencies for HTTP, clock, and environment access.
7. THE GitHub_Summoner SHALL depend only on `@necro/oracle` types and SHALL NOT be imported by `@necro/oracle`.

## Correctness Properties

These properties are amenable to fast-check property-based testing. Each names
the requirements it covers; each property test's `describe` title names its
property id and covered requirements.

- **P1 — URL parse round-trip (R1.1, R1.2, R1.3, R10.2):** For all valid
  `owner/repo` and `https://github.com/owner/repo` inputs (with and without a
  ref), parsing yields a reference whose owner, name, and requested ref
  reproduce the input's components.
- **P2 — Non-`github.com` rejection (R1.7):** For all host strings other
  than `github.com`, parsing raises a NecroError with code `INVALID_REPO_URL`.
  Note that `www.github.com` normalizes to `github.com` and is accepted; only
  other hosts are rejected.
- **P3 — Malformed rejection (R1.8, R1.9):** For all inputs missing an owner or a
  repository name, parsing raises a NecroError with code `INVALID_REPO_URL`.
- **P4 — Parsing idempotence (R1.11):** For all valid inputs, parsing twice yields
  equal parsed references.
- **P5 — Per-file cap preserved (R3.7, R3.8):** For all generated file maps, no
  file in the resulting snapshot exceeds 1 MB, and the set of retained files
  matches what `buildSnapshotFromFileMap` retains (caps are not duplicated).
- **P6 — Total download cap (R3.9):** For all simulated download streams whose
  cumulative size crosses 50 MB, the builder raises a NecroError with code
  `DOWNLOAD_TOO_LARGE` and never yields a snapshot.
- **P7 — 5000-file cap (R3.7, R3.8):** For all generated file maps larger than
  5000 files, the resulting snapshot retains exactly the first 5000 paths in
  lexicographic order and reports `truncated` as true.
- **P8 — Cache key determinism (R8.1, R8.4):** For all `owner`, `name`, and `sha`
  triples, the derived cache key is equal across repeated derivations and equal
  only when all three components are equal.
- **P9 — Secret masking never leaks tokens (R6.5):** For all generated
  `GITHUB_TOKEN` and Authorization header values supplied through the EnvPort, no
  raised NecroError, returned result, or captured log line contains the token
  value, while repository file contents remain byte-for-byte unaltered.
- **P10 — Offline determinism (R9.4, R9.5, R9.6):** For all fixture-backed FetchPort,
  ClockPort, and EnvPort inputs, repeated runs produce identical results with no
  real network access.
- **P11 — Uncompressed extraction cap (R3.10, R3.11):** For all simulated
  archives whose cumulative UNCOMPRESSED size crosses 200 MB, or whose entry
  count crosses the configured maximum, extraction raises a NecroError with code
  `DOWNLOAD_TOO_LARGE` and never yields a snapshot.
- **P12 — Authorization header stripped on redirect (R6.3, R3.12):** For all token
  values and all redirect targets other than `github.com`/`api.github.com`
  (including `codeload.github.com`), no request to the redirect target carries an
  Authorization header.
