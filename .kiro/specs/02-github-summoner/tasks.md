# Implementation Plan: GitHub Summoner (`packages/github`)

## Overview

This plan builds the `@necro/github` adapter test-first, in dependency order. It starts with a spike that characterizes `tar-stream@3.2.2` before anything depends on it, then prerequisites in other packages (error codes, config schema, lint policy), testing helpers, pure modules, the GitHub client, ref resolution, tar extraction, the cache, registries/OSV/external data, the summoner, system adapters, the public API with a boundary test, a golden offline end-to-end test through `runReading`, docs, and checkpoints.

## Implementation Plan

Conventions that apply to every task:

- **Test-first (red, then green).** For each implementation unit, the test task (examples and/or fast-check property) comes before the implementation task. Run the new tests first and confirm they fail for the expected reason (missing module or behaviour), then implement until they pass.
- **No optional tests.** No task or sub-task carries the `*` marker. Every test task is required.
- **Offline only.** No unit or property test makes a network, LLM, or sandbox call. Tests use the fixture-backed `FetchPort`, the fixed `ClockPort`, a fixture `EnvPort`, and in-memory tar builders. `vitest.setup.ts` makes global `fetch` throw.
- **Property tests** live in `*.pbt.test.ts` files, each with a `describe` title like `P3 (R1.8, R1.9): malformed references are rejected` and a `// Feature: 02-github-summoner, Property N: <title>` tag. Each of P1..P34 is owned by exactly one test task below. Use `numRuns: 200` by default and `1000` for normalizers and parsers (P1-P4, P21, P22). Print the seed on failure and add any counterexample as a permanent example test.
- **Shared arbitraries** go in `packages/github/test/arbitraries.ts` (for example `arbGithubUrl`, `arbOwnerName`, `arbRef`, `arbTarEntries`, `arbToken`, `arbDependencyList`). Each property task adds the arbitraries it needs.
- Source and tests live in `packages/github/src`; tests sit next to the code. Cross-package imports go through each package's `src/index.ts` only.

## Tasks

- [x] 1. Spike: characterize `tar-stream@3.2.2` before anything depends on it
  - [x] 1.1 Pin the tar dependencies exactly
    - In `packages/github/package.json` add `tar-stream` at exactly `3.2.2` and dev dependency `@types/tar-stream` at exactly `3.1.5` (no `^` or `~`), then run `pnpm install` so `pnpm-lock.yaml` updates.
    - Dependency note: `tar-stream@3.2.2` declares `bare-fs` (plus `b4a`, `streamx`, `fast-fifo`) among its dependencies. The package never calls any `fs` code path, but `bare-fs` enlarges the install footprint. Record this in the spike test header and in the docs task (33.3).
    - _Requirements: R3.1, R3.2_
  - [x] 1.2 Write committed characterization tests in `src/tar-extract.spike.test.ts`
    - Create minimal in-memory builders in `src/testing/raw-tar.ts` (hand-rolled ustar header writer that can emit pax global headers typeflag `g`, pax extended headers typeflag `x`, and arbitrary typeflags) and `src/testing/make-tar-gz.ts` (gzip of a tar built from an entry list). Task 7 extends them with their own tests.
    - (a) Pax handling: build a tarball shaped like `git archive`/GitHub output, with a pax global header (typeflag `g`) carrying `comment=<40-hex sha>` followed by a root directory entry and files. Feed it through `Readable.fromWeb(...)` into `tar.extract()` and assert the global header never appears as an entry, the sha comment does not break path handling, and file paths come out intact. Add a pax extended header (typeflag `x`, `path=<very long path over 100 chars>`) and assert the entry's `header.name` is the resolved long path. Also assert a GNU long-name entry resolves.
    - (b) Cancellation: wrap a lazily generated web `ReadableStream` that records `cancel()` calls and the number of chunks pulled. Pipe it through `Readable.fromWeb` into `tar.extract()`, consume a few entries, then `destroy()` the extract stream and the bridge mid-archive. Assert the upstream reader is cancelled (or released), that no further chunks are pulled after a short settle, and that a byte-counting guard error placed before the bridge also stops the pull.
    - Also assert that an entry that is not consumed blocks the next entry, and that `entry.resume()` drains it (documents the sequential-delivery behaviour the design relies on).
    - _Requirements: R3.1, R3.3, R3.9, R3.13_
  - [x] 1.3 Run the spike and record the findings
    - Run `pnpm --filter @necro/github test` for the spike file. These are characterization tests, so they pass when the design's assumptions hold.
    - Write a short findings block at the top of the spike test file (versions, observed behaviour for (a) and (b)).
    - If either finding contradicts the design (for example a pax global header surfaces as an entry, long paths are not resolved, or destroying the stream does not release the upstream reader), STOP: record the finding in `docs/KIRO_USAGE.md` and adjust `.kiro/specs/02-github-summoner/design.md` (Tarball extraction and Tar library choice sections) before starting task 2. Do not proceed on an assumption the spike disproved.
    - _Requirements: R3.1, R3.9_

- [x] 2. Scaffold the `@necro/github` package
  - [x] 2.1 Write the scaffolding smoke test
    - Add `src/setup.test.ts`: global `fetch` throws when called (proves `vitest.setup.ts` is active); `@necro/oracle` resolves under Vitest and exposes `buildSnapshotFromFileMap`, `parseAllManifests`, `NecroError`; `GitHubSnapshotBuilder` type is importable.
    - _Requirements: R9.1, R9.5, R10.7_
  - [x] 2.2 Implement the scaffolding
    - `packages/github/package.json`: add `@necro/oracle` (`workspace:*`), `zod` (`^3.25.76`), dev `fast-check` (`^3.23.1`), dev `@types/node` (`^22.20.5`), and `test` / `test:pbt` scripts consistent with other packages; keep the tar pins from 1.1.
    - `tsconfig.json`: add `"references": [{ "path": "../oracle" }]`.
    - Create `vitest.setup.ts` (stub `globalThis.fetch` with a function that throws) and register it in `vitest.config.ts` via `setupFiles`; if `@necro/oracle` does not resolve, add `resolve.conditions: ["development"]`.
    - Create `src/index.ts` placeholder that keeps the package compiling.
    - _Requirements: R9.1, R9.5, R10.1, R10.7_

- [x] 3. Add the ten error codes to `@necro/oracle`
  - [x] 3.1 Write the failing test in `packages/oracle/src/util/errors.test.ts`
    - Assert `NecroErrorCodeSchema.options` includes exactly the ten new codes (`INVALID_REPO_URL`, `REPO_NOT_FOUND`, `REPO_PRIVATE`, `RATE_LIMITED`, `NETWORK_TIMEOUT`, `DOWNLOAD_TOO_LARGE`, `VALIDATION_FAILED`, `REF_NOT_FOUND`, `AUTH_INVALID`, `UPSTREAM_UNAVAILABLE`) in addition to the eight existing ones, and that `new NecroError(code, ...)` constructs for each.
    - _Requirements: R7.1_
  - [x] 3.2 Add the codes to `NecroErrorCodeSchema` in `packages/oracle/src/util/errors.ts`
    - Additive only: ten string literals, no logic change, no new import (Decision D1).
    - _Requirements: R7.1, R10.7_

- [x] 4. Add the `GITHUB_TOKEN` env schema to `@necro/config`
  - [x] 4.1 Write the failing tests in `packages/config/test`
    - `loadEnv` treats missing, empty, and whitespace-only `GITHUB_TOKEN` as unset; accepts a valid token; rejects a token with whitespace or control characters with an error that lists the key name only, never the value.
    - _Requirements: R6.1, R6.5_
  - [x] 4.2 Implement `EnvSchema` and `loadEnv` in `packages/config/src/index.ts`
    - Add `zod` dependency (`^3.25.76`); preprocess blank to `undefined`; export `Env` type.
    - _Requirements: R6.1, R6.5_

- [x] 5. Add the lint policy for `packages/github/src`
  - [x] 5.1 Write the failing lint-policy test in `packages/github/src/lint-policy.test.ts`
    - Using the ESLint Node API and the root `eslint.config.js`, lint code snippets with a `filePath` under `packages/github/src/`: `Date.now()`, zero-argument `new Date()`, bare `Date()`, global `fetch(...)`, `process.env.X`, `eval`, `new Function`, and imports of `node:fs`, `node:child_process`, `node:vm` are reported; `new Date(ms).toISOString()` and `import { Readable } from "node:stream"` are not. The same banned snippets under `packages/github/src/adapters/`, `src/testing/`, and in `*.test.ts` files are not reported.
    - _Requirements: R9.1, R9.2, R9.3, R3.2, R6.1_
  - [x] 5.2 Add the restricted block to the root `eslint.config.js`
    - `no-restricted-globals` (`fetch`), `no-restricted-syntax` selectors (`CallExpression[callee.object.name='Date'][callee.property.name='now']`, `NewExpression[callee.name='Date'][arguments.length=0]`, bare `Date()` call, `MemberExpression[object.name='process'][property.name='env']`), `no-restricted-imports` for `node:fs`, `node:child_process`, `node:vm`; scope to `packages/github/src/**` and exempt `adapters/**`, `testing/**`, and test files.
    - _Requirements: R9.1, R9.2, R9.3, R3.2, R6.1_

- [-] 6. Checkpoint - prerequisites in place
  - Ensure all tests pass (`pnpm test`), `pnpm lint` and `pnpm typecheck` are clean for oracle, config, and github; ask the user if questions arise.

- [ ] 7. Build the testing helpers
  - [~] 7.1 Write the helper self-tests
    - `src/testing/fixed-clock.test.ts`: `nowMs()` returns the fixed value and can be advanced explicitly.
    - `src/testing/fixture-fetch.test.ts`: answers from registered fixtures by method and URL, records every request (url, method, headers, `timeoutMs`, `redirect`), supports scripted status/headers/body, `Location` redirects, `FetchTransportError("timeout" | "network")`, streamed bodies that record `cancel()`, and fails the test loudly on an unregistered URL.
    - `src/testing/make-tar-gz.test.ts` and `raw-tar.test.ts`: archives built from entry lists round-trip through `tar-stream` extract; hostile entries (`..`, absolute path, backslash traversal, symlink, hard link, device, FIFO), pax `g`/`x` headers, and lazily generated large archives are produced byte-correctly.
    - _Requirements: R9.4, R9.5, R9.6_
  - [~] 7.2 Implement the helpers in `src/testing/`
    - `fixed-clock.ts`, `fixture-fetch.ts` (not exported from `index.ts`), extend `make-tar-gz.ts` and `raw-tar.ts` from the spike, and create `packages/github/test/arbitraries.ts` with the first arbitraries.
    - _Requirements: R9.4, R9.5, R9.6_

- [ ] 8. Constants and ports
  - [~] 8.1 Write the failing tests
    - `src/constants.test.ts`: smoke test pins the default literals (`52_428_800`, `209_715_200`, `100_000`, `604_800_000`, `DEGRADED_TTL_MS = 600_000`, `20`, `REST_CALL_BUDGET = 5`, `BINARY_SNIFF_BYTES = 8000`, timeouts, concurrency, host sets, `VENDORED_SEGMENTS` exactly the six names).
    - `src/ports.test.ts`: `FetchTransportError` carries `kind` and `cause`, is not a `NecroError`.
    - _Requirements: R3.5, R3.9, R3.10, R3.11, R4.8, R5.4, R8.5, R8.7, R8.11_
  - [~] 8.2 Implement `src/constants.ts` and `src/ports.ts`
    - `FetchPort`, `FetchRequest`, `FetchResponse`, `ClockPort`, `EnvPort`, `SummonerDeps`, `FetchTransportError`, and all constants from the design.
    - _Requirements: R3.5, R3.9, R3.10, R3.11, R4.8, R5.4, R8.5, R8.7, R8.11, R9.1, R9.2, R9.3_

- [ ] 9. Time helpers
  - [~] 9.1 Write the failing tests in `src/time.test.ts`
    - `parseIsoMs` accepts ISO 8601 with offsets and rejects invalid strings; `isoFromMs(ms)` returns UTC ISO ending in `Z`; `daysBetween` floors, never below zero; module performs no clock read (no `Date.now()`).
    - _Requirements: R4.3, R4.5, R9.2_
  - [~] 9.2 Implement `src/time.ts`
    - `parseIsoMs`, `isoFromMs` (uses `new Date(ms)` only), `daysBetween`.
    - _Requirements: R4.3, R4.5, R9.2_

- [ ] 10. Schemas and recorded fixtures
  - [~] 10.1 Write the failing schema tests
    - `src/schemas/schemas.test.ts`: `Sha40Schema`, `ResolvedRepoRefSchema`, `OwnerOrNameSchema`, `GithubTokenSchema`, `GhRepoSchema` (including the `full_name` refinement and license transform), `GhCommitSchema`, `GhPullsSchema`, `GhReleaseSchema`, `GhErrorBodySchema`, `PypiDocSchema`, `NpmDocSchema`, `NpmVersionSchema`, `OsvBatchResponseSchema`, `OsvVulnSchema` accept valid examples and reject violations; unknown keys are stripped.
    - _Requirements: R2.4, R2.5, R2.6, R5.8, R6.5_
  - [~] 10.2 Implement `src/schemas/github.ts`, `pypi.ts`, `npm.ts`, `osv.ts`
    - _Requirements: R2.4, R2.5, R2.6, R5.8_
  - [~] 10.3 Write the fixture validation test
    - `src/schemas/fixtures.test.ts`: every JSON file under `fixtures/api/<case>/` and `fixtures/registry/{pypi,npm,osv}/` parses against its schema; the set of cases covers: success, archived, no license, `NOASSERTION`, no releases (404), rename redirect target, private repo, empty repository, pypi py2-only, npm deprecated, OSV batch and detail with aliases.
    - _Requirements: R2.5, R4.1, R5.8, R9.4_
  - [~] 10.4 Author the recorded fixtures
    - Create `packages/github/fixtures/api/<case>/{repo,commit,pulls,release}.json` and `fixtures/registry/{pypi,npm,osv}/<case>.json` so 10.3 passes. No real tokens or network capture; hand-authored shapes only.
    - _Requirements: R4.1, R5.8, R9.4_

- [ ] 11. Typed errors, message catalog, and redaction
  - [~] 11.1 Write the failing unit tests in `src/errors.test.ts`
    - `summonerError` builds each of the ten codes as a `SummonerError` and `NecroError`; catalog wording matches the design table; `REF_NOT_FOUND` names the ref; `RATE_LIMITED` states whole minutes; `AUTH_INVALID` names `GITHUB_TOKEN` and never a value; `redactSecrets` replaces known secrets, `Bearer ...`, and `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_` prefixes with `[REDACTED]`; the sanitized `cause` keeps name, code, status; repository content is never passed through redaction.
    - _Requirements: R6.5, R7.1, R7.10, R7.11_
  - [~] 11.2 Write property test P28 in `src/http-failure.pbt.test.ts`
    - **Property 28: Every error is a typed, in-voice NecroError** (`describe("P28 (R7.1, R7.7, R7.8, R7.10, R7.11): ...")`). The file is created here; P29 and P30 are added to it in tasks 15.2 and 15.3.
    - **Validates: Requirements R7.1, R7.7, R7.8, R7.10, R7.11**
  - [~] 11.3 Implement `src/errors.ts`
    - `SummonerError`, `SummonerErrorCode`, `SummonerErrorDetails`, `summonerError` factory, message catalog (mystical line of at most 16 words, one line break, technical line), `redactSecrets`, sanitized-cause builder.
    - _Requirements: R6.5, R7.1, R7.7, R7.8, R7.10, R7.11_

- [ ] 12. Entry path normalization and binary sniff
  - [~] 12.1 Write the failing unit tests in `src/entry-path.test.ts`
    - `normalizeEntryPath`: strips the top-level `<owner>-<repo>-<sha>/` prefix, drops empty and `.` segments, rejects `..`, absolute, `C:` drive, NUL, and backslash traversal, returns nothing for the root directory entry; `isVendoredPath` for all six names at any depth; `isBinarySample` boundary at byte 7999 vs 8000.
    - _Requirements: R3.3, R3.5, R3.6, R3.13_
  - [~] 12.2 Write property test P22 in `src/entry-path.pbt.test.ts`
    - **Property 22: Binary classification** (`describe("P22 (R3.6): ...")`, `numRuns: 1000`).
    - **Validates: Requirements R3.6**
  - [~] 12.3 Implement `src/entry-path.ts`
    - `normalizeEntryPath`, `isVendoredPath`, `isBinarySample`.
    - _Requirements: R3.3, R3.5, R3.6, R3.13_

- [ ] 13. Repository reference parsing
  - [~] 13.1 Write the failing example tests in `src/intake.test.ts`
    - Examples from the design: `octocat/Hello-World`, `https://github.com/octocat/Hello-World/tree/feature/x`, `https://www.github.com/o/r.git/`, `o/r@<40 hex>`, `o/r#ref`; rejections: `git@github.com:o/r.git`, `https://user:pw@github.com/o/r` (message never echoes the input), `https://gitlab.com/o/r`, `https://github.com/o/r/issues`, over-long input, bad ref characters; uppercase 40-hex ref is lower-cased.
    - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8, R1.9_
  - [~] 13.2 Write property test P1 in `src/intake.pbt.test.ts`
    - **Property 1: Reference parse round-trip** (`describe("P1 (R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R10.2): ...")`, `numRuns: 1000`, uses `arbGithubUrl`).
    - **Validates: Requirements R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R10.2**
  - [~] 13.3 Write property test P2 in `src/intake.pbt.test.ts`
    - **Property 2: Foreign hosts are rejected** (`describe("P2 (R1.7, R7.2): ...")`).
    - **Validates: Requirements R1.7, R7.2**
  - [~] 13.4 Write property test P3 in `src/intake.pbt.test.ts`
    - **Property 3: Malformed references are rejected** (`describe("P3 (R1.8, R1.9, R7.2): ...")`).
    - **Validates: Requirements R1.8, R1.9, R7.2**
  - [~] 13.5 Write property test P4 in `src/intake.pbt.test.ts`
    - **Property 4: Parsing is idempotent** (`describe("P4 (R1.11): ...")`).
    - **Validates: Requirements R1.11**
  - [~] 13.6 Implement `parseRepoRef` and `ParsedRepoRefSchema` in `src/intake.ts`
    - Follow the nine-step grammar from the design; reason codes in `INVALID_REPO_URL` errors; pure, no network, clock, or env access. `resolveRef` is added in task 19.
    - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8, R1.9, R1.10, R1.11, R7.2_

- [~] 14. Checkpoint - pure foundations
  - Ensure all tests pass for tasks 7-13, `pnpm --filter @necro/github typecheck` is clean; ask the user if questions arise.

- [ ] 15. HTTP and transport failure classifier
  - [~] 15.1 Write the failing unit tests in `src/http-failure.test.ts`
    - Every row of the mapping table: repo 404 authenticated vs not, `private: true`, 403 without rate-limit signals and 451 to `REPO_PRIVATE`, commit 404/422/409 to `REF_NOT_FOUND`, tarball 404 to `REPO_NOT_FOUND`, 401 to `AUTH_INVALID`, 5xx and transport on required calls, optional pulls/release returning `DegradedOutcome` (cause `http-5xx`, `timeout`, `network`), 429/401 on optional calls still fatal, 404 and zod failures on optional calls absent, 3xx and unexpected statuses to `VALIDATION_FAILED`.
    - _Requirements: R2.9, R2.11, R4.9, R7.3, R7.6, R7.7, R7.8, R7.9_
  - [~] 15.2 Write property test P29 in `src/http-failure.pbt.test.ts`
    - **Property 29: HTTP and transport failure classification** (`describe("P29 (R2.9, R7.3, R7.6, R9.6): ...")`).
    - **Validates: Requirements R2.9, R7.3, R7.6, R9.6**
  - [~] 15.3 Write property test P30 in `src/http-failure.pbt.test.ts`
    - **Property 30: Rate-limit wait is computed from the clock** (`describe("P30 (R7.4, R7.5): ...")`).
    - **Validates: Requirements R7.4, R7.5**
  - [~] 15.4 Implement `src/http-failure.ts`
    - `classifyFailure`, `DegradedOutcome`, `DegradedField`, `DegradedCause`, `Retry-After` parsing (integer seconds and HTTP-date), reset-instant arithmetic with the injected `nowMs`.
    - _Requirements: R2.9, R2.11, R4.9, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8, R7.9_

- [ ] 16. Repository metadata mapper
  - [~] 16.1 Write the failing unit tests in `src/repo-meta.test.ts`
    - Archived repo, no license, `NOASSERTION`, release 404 (absent, not listed), zero open PRs, `Link: rel="last"` count parsing and single PR without `Link`, pulls degraded (`openIssueCount` equals raw count), release degraded, both degraded gives `["pulls", "release"]`, output passes `RepoMetaSchema`.
    - _Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.7, R4.9_
  - [~] 16.2 Write property test P23 in `src/repo-meta.pbt.test.ts`
    - **Property 23: Metadata mapping** (`describe("P23 (R4.1, R4.2, R4.3, R4.4, R4.5, R4.7): ...")`).
    - **Validates: Requirements R4.1, R4.2, R4.3, R4.4, R4.5, R4.7**
  - [~] 16.3 Implement `src/repo-meta.ts`
    - `mapRepoMeta`, `MetaInputs`, `MappedMeta`, `OptionalOutcome`, `SummonExtras` type.
    - _Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.9_

- [ ] 17. GitHub client, part A: headers, JSON reads, rename redirect, REST budget
  - [~] 17.1 Write the failing unit tests in `src/github-client.test.ts`
    - `headersFor` table (Bearer only for `github.com` and `api.github.com` over https on the default port; never for codeload, PyPI, npm, OSV, look-alike hosts); malformed token raises `AUTH_INVALID` before any request; `getJson` validates with zod, caps body size, cancels unread bodies; first repo call follows one `301/307/308` to `https://api.github.com` and counts it; `302`, other host, other scheme, second redirect, and redirect on any other call raise `VALIDATION_FAILED` with no further request; non-allow-listed host or `http:` refused; 6th request throws `rest-budget-exceeded` before sending; a degraded request still counts.
    - _Requirements: R2.5, R2.6, R2.8, R2.9, R2.10, R4.8, R6.2, R6.3, R6.4, R6.5, R7.8_
  - [~] 17.2 Write property test P27 in `src/github-client.pbt.test.ts`
    - **Property 27: Authorization header policy** (`describe("P27 (R6.2, R6.3, R6.4): ...")`).
    - **Validates: Requirements R6.2, R6.3, R6.4**
  - [~] 17.3 Write property test P32 in `src/github-client.pbt.test.ts`
    - **Property 32: Hard REST budget guard** (`describe("P32 (R2.7, R2.10, R4.8): ...")`).
    - **Validates: Requirements R2.7, R2.10, R4.8**
  - [~] 17.4 Write property test P14 in `src/rename-redirect.pbt.test.ts`
    - **Property 14: Rename-redirect policy** (`describe("P14 (R2.8, R2.9): ...")`).
    - **Validates: Requirements R2.8, R2.9**
  - [~] 17.5 Implement `src/github-client.ts` part A
    - `GitHubClient` (one instance per operation), `headersFor`, `RequestContext`, required-mode `getJson`, `restCallCount`, `REST_CALL_BUDGET` guard, rename-redirect policy (`allowRepoRedirect`), token validation per request, sanitized causes via `errors.ts` and `http-failure.ts`.
    - _Requirements: R2.5, R2.6, R2.8, R2.9, R2.10, R4.8, R6.2, R6.3, R6.4, R6.5, R7.8_

- [ ] 18. GitHub client, part B: optional calls, tarball path, external requests
  - [~] 18.1 Write the failing unit tests in `src/github-client.test.ts`
    - Optional-mode `getJson` returns `ok`, `absent` (404, zod failure, body cap), or `degraded` (5xx, timeout, network) and still throws for 401, 403 rate limit, 429, refused redirect, malformed token; degraded body is cancelled and not retried. `openTarball`: no token goes straight to `https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}` with no Authorization and zero REST calls, any 3xx refused; token goes to `api.github.com/repos/{o}/{r}/tarball/{sha}` with Bearer, follows exactly one redirect to `codeload.github.com` without Authorization, refuses other hosts and a second redirect, cancels the first body; `externalRequest` allows only `pypi.org`, `registry.npmjs.org`, `api.osv.dev` and never sets Authorization.
    - _Requirements: R3.1, R3.12, R3.15, R3.16, R4.9, R5.4, R6.3, R7.4, R7.5, R7.8_
  - [~] 18.2 Write property test P12 in `src/github-client.pbt.test.ts`
    - **Property 12: Authorization is never sent to codeload or to non-GitHub-API hosts** (`describe("P12 (R3.1, R3.12, R3.16, R6.3): ...")`).
    - **Validates: Requirements R3.1, R3.12, R3.16, R6.3**
  - [~] 18.3 Write property test P15 in `src/github-client.pbt.test.ts`
    - **Property 15: Direct codeload path is unauthenticated and REST-free** (`describe("P15 (R3.15, R3.12, R6.4): ...")`).
    - **Validates: Requirements R3.15, R3.12, R6.4**
  - [~] 18.4 Write property test P33 in `src/github-client.pbt.test.ts`
    - **Property 33: Tarball path is selected by token presence** (`describe("P33 (R3.1, R3.12, R3.15, R3.16): ...")`).
    - **Validates: Requirements R3.1, R3.12, R3.15, R3.16**
  - [~] 18.5 Implement `src/github-client.ts` part B
    - Optional-mode `getJson` and `OptionalJsonResult`, `openTarball` with token-based path selection, `externalRequest` helper, host allow-list.
    - _Requirements: R3.1, R3.12, R3.15, R3.16, R4.9, R5.4, R6.3, R7.4, R7.5, R7.8_

- [ ] 19. Ref resolution
  - [~] 19.1 Write the failing unit tests in `src/intake.test.ts`
    - `resolveRef` / `resolveRefDetailed`: default branch path, explicit branch and tag, full SHA verified, partial SHA expanded, SHA mismatch to `VALIDATION_FAILED`, missing ref in an existing repo to `REF_NOT_FOUND`, empty repository (409) to `REF_NOT_FOUND`, rename redirect on call 1 (canonical owner and name from the body, 5 REST calls total for `summon`), case-variant spelling normalized to the canonical pair, `defaultBranch` always from the repo payload, `private: true` to `REPO_PRIVATE`.
    - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.8, R2.11, R7.3, R7.7, R10.3_
  - [~] 19.2 Write property test P19 in `src/resolve-ref.pbt.test.ts`
    - **Property 19: Resolved references are fully populated and immutable** (`describe("P19 (R2.1, R2.2, R2.3, R2.4, R10.3): ...")`).
    - **Validates: Requirements R2.1, R2.2, R2.3, R2.4, R10.3**
  - [~] 19.3 Write property test P20 in `src/resolve-ref.pbt.test.ts`
    - **Property 20: Invalid payloads are rejected without partial results** (`describe("P20 (R2.5, R2.6): ...")`).
    - **Validates: Requirements R2.5, R2.6**
  - [~] 19.4 Implement `resolveRef` and `resolveRefDetailed` in `src/intake.ts`
    - Use `GitHubClient` with `allowRepoRedirect: true` on call 1; build `RepoRef` from the canonical payload; calls 2 uses the canonical pair; `REF_NOT_FOUND` vs `REPO_*` mapping through `http-failure.ts`.
    - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R2.11, R10.3_

- [~] 20. Checkpoint - client and resolution
  - Ensure all tests pass for tasks 15-19; ask the user if questions arise.

- [ ] 21. Capped tarball extraction
  - [~] 21.1 Write the failing unit tests in `src/tar-extract.test.ts`
    - Realistic GitHub layout (pax global header, root directory entry, nested paths) yields repository-relative paths; a skipped entry is still drained with `stream.resume()` and `next()` is called so the next entry is reached; a dedicated test builds an archive whose bulk sits entirely in skipped entries (traversal, symlink payload, vendored, binary, oversize) and asserts the compressed, uncompressed, and entry-count caps still fire, proving the byte-count guards sit upstream of `tar-stream` and count every skipped-entry byte (P11, R3.10, R3.11); `.github/workflows/ci.yml` sets `hasWorkflowsDir`; binary and vendored exclusions; symlink, hard link, device, FIFO, traversal skipped with matching `stats`; a file named `__proto__` is an ordinary key; a 1 MiB file is kept and a 1 MiB + 1 file is stored as the oversize sentinel; repeated path overwrites; `Content-Length` over the compressed cap fails before reading; corrupt gzip and corrupt tar map to `VALIDATION_FAILED`; guard error wins over the secondary stream-destroy error; when a guard trip destroys `extract` mid-entry, no unhandled error or rejection escapes (assert with process-level `unhandledRejection`/`uncaughtException` listeners installed for the test, or by Vitest's unhandled-error reporting staying clean) and the extractor rejects with the guard error; failures cancel the upstream body; `DEFAULT_LIMITS` pins the literals. An example test (skipped from the default run unless a slow-test environment flag is set) streams a lazily generated 200 MB zero-filled archive at the real default to confirm the guard fires at scale.
    - _Requirements: R3.2, R3.3, R3.4, R3.5, R3.6, R3.9, R3.10, R3.11, R3.13, R4.6_
  - [~] 21.2 Write property test P21 in `src/tar-extract.pbt.test.ts`
    - **Property 21: Archive entry paths are safe and repository-relative** (`describe("P21 (R3.3, R3.4, R3.5, R3.13, R4.6): ...")`, `numRuns: 1000`, uses `arbTarEntries` with the raw-tar builder).
    - **Validates: Requirements R3.3, R3.4, R3.5, R3.13, R4.6**
  - [~] 21.3 Write property test P6 in `src/tar-extract.pbt.test.ts`
    - **Property 6: Compressed download cap** (`describe("P6 (R3.9, R3.15, R3.16): ...")`); exercises both download paths through `GitHubClient.openTarball` and the real `Readable.fromWeb` + `tar-stream` bridge with small injected limits, and asserts the upstream body is cancelled.
    - **Validates: Requirements R3.9, R3.15, R3.16**
  - [~] 21.4 Write property test P11 in `src/tar-extract.pbt.test.ts`
    - **Property 11: Uncompressed and entry-count caps** (`describe("P11 (R3.10, R3.11): ...")`); counts skipped-entry bytes and tar framing, small injected limits.
    - **Validates: Requirements R3.10, R3.11**
  - [~] 21.5 Implement `src/tar-extract.ts`
    - `capStream` guards, gunzip via `DecompressionStream`, `Readable.fromWeb` bridge into `tar.extract()`, consumed with the EVENT form `extract.on("entry", (header, stream, next) => ...)` and an explicit `next()` (not `for await`, per the task 1 spike: the iterator form auto-drains the previous entry). Each entry handler first attaches `stream.on("error", ...)` (routing into the settle-once rejection path; secondary errors after the first are ignored), because destroying `extract` also makes the in-flight entry stream emit `error` and an unlistened one is an uncaught exception (spike finding). Then each handler either reads the body (kept text file) or drains it with `stream.resume()` (skipped), then calls `next()`; errors and cap violations call `extract.destroy(err)`, destroy the bridge, and cancel upstream. One settle-once promise resolves on `'finish'` and rejects on the first error, so a guard error wins over secondary stream-destroy errors. Also the eight per-entry rules, oversize sentinel (D4), null-prototype file map, `ExtractionLimits`, `DEFAULT_LIMITS`, `extractTarball`. The only `node:` import is `node:stream`.
    - _Requirements: R3.2, R3.3, R3.4, R3.5, R3.6, R3.9, R3.10, R3.11, R3.13, R4.6_

- [ ] 22. Snapshot cache
  - [~] 22.1 Write the failing unit tests in `src/snapshot-cache.test.ts`
    - Default TTL and capacity constants, age equal to TTL is a miss, expired entry removed, hit marks most-recently-used, replace keeps one entry per key, LRU eviction at capacity, exact-case keys, injected `ClockPort` only; `set(key, value, { ttlMs })` stores a per-entry TTL that `get` honors instead of the configured TTL, and an omitted `ttlMs` falls back to the configured TTL; `effectiveTtlMs(configuredTtlMs, degradedFields)` returns `min(configuredTtlMs, 600_000)` for a non-empty list and `configuredTtlMs` for an empty list, including when `configuredTtlMs` is itself below 600,000.
    - _Requirements: R8.1, R8.2, R8.3, R8.5, R8.6, R8.7, R8.8, R8.9, R8.11, R8.12, R8.13_
  - [~] 22.2 Write property test P8 in `src/snapshot-cache.pbt.test.ts`
    - **Property 8: Cache key determinism and injectivity** (`describe("P8 (R8.1, R8.4): ...")`).
    - **Validates: Requirements R8.1, R8.4**
  - [~] 22.3 Write property tests P31 and P34 in `src/snapshot-cache.pbt.test.ts`
    - **Property 31: Snapshot cache behaves like a TTL + LRU model** and **Property 34: Degraded-entry TTL** (requirements P34, realized by the same cache-model test; `describe("P31 + P34 (R8.1, R8.2, R8.3, R8.6, R8.8, R8.9, R8.11, R8.12, R8.13, R8.14): ...")`, with `// Feature: 02-github-summoner, Property 31` and `Property 34` tags), against a reference model whose entries carry `(key, setTime, entryTtl)` with `entryTtl = min(configured ttlMs, option ttlMs ?? configured ttlMs)`, so the per-entry TTL that `effectiveTtlMs` would assign a degraded result is exercised directly through `set`'s `{ ttlMs }` option. The "fresh key leaves the FetchPort call count unchanged" half is asserted at build level in the summoner example tests (tasks 27.1 and 28.1).
    - **Validates: Requirements R8.1, R8.2, R8.3, R8.6, R8.8, R8.9, R8.11, R8.12, R8.13, R8.14**
  - [~] 22.4 Implement `src/snapshot-cache.ts`
    - `cacheKey`, `effectiveTtlMs` (pure: `degradedFields.length > 0 ? Math.min(configuredTtlMs, DEGRADED_TTL_MS) : configuredTtlMs`), `SnapshotCache<V>` with `Map`-based LRU, a per-entry `ttlMs` recorded by `set`, and `ClockPort`-driven freshness checked against each entry's own `ttlMs`.
    - _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7, R8.8, R8.9, R8.10, R8.11, R8.12, R8.13_

- [ ] 23. PyPI and npm registries
  - [~] 23.1 Write the failing unit tests in `src/registries.test.ts`
    - PEP 503 normalized URL for `Flask_Cors`, scoped npm name encoding (`@scope%2Fname`), strict name patterns (`invalid-name` never reaches a URL), PyPI and npm mapping tables (yanked, deprecated, `py2Only` classifier rules, `publishedAt`, `no-published-files`), 404 means omitted not skipped, timeout, network, http-error, rate-limited, invalid-response, response-too-large mapped to skip reasons, no Authorization header.
    - _Requirements: R5.2, R5.4, R5.5, R5.6, R5.8, R5.9, R6.3_
  - [~] 23.2 Implement `src/registries.ts`
    - PyPI and npm fetch and map to `RegistryEntry` through `externalRequest` and the zod schemas.
    - _Requirements: R5.2, R5.4, R5.5, R5.6, R5.8, R5.9, R6.3_

- [ ] 24. OSV
  - [~] 24.1 Write the failing unit tests in `src/osv.test.ts`
    - Only exactly-pinned dependencies queried (`==1.2.3` PyPI, `1.2.3`/`=1.2.3` npm), `version-not-pinned` otherwise, batches of 1000, batch result count mismatch skips the batch as `invalid-response`, `next_page_token` recorded as skipped, detail fetch cap, severity mapping (`MODERATE` and `MEDIUM` to `MEDIUM`, unknown to `UNKNOWN`), `affectedVersionRange` rendering, alias collapse preferring `GHSA-`, output sorted by (`affectedPackage`, `id`).
    - _Requirements: R5.3, R5.5, R5.8, R5.9_
  - [~] 24.2 Implement `src/osv.ts`
    - `querybatch` plus vuln detail round trip mapped to `OsvVulnerability`.
    - _Requirements: R5.3, R5.5, R5.8, R5.9_

- [ ] 25. External data orchestrator
  - [~] 25.1 Write the failing unit tests in `src/external-data.test.ts`
    - Dedupe by lowercased name per ecosystem, ecosystem from manifest kind, `MAX_REGISTRY_QUERIES` overflow as `limit-exceeded`, cross-ecosystem collision gives one entry with npm winning (R5.11), result shape `{ registryData, osvData, skipped }`, accepts a snapshot or pre-parsed manifests, concurrency pool respected.
    - _Requirements: R5.1, R5.2, R5.10, R5.11_
  - [~] 25.2 Write property test P24 in `src/external-data.pbt.test.ts`
    - **Property 24: Registry data is keyed, deduplicated, and well-formed** (`describe("P24 (R5.1, R5.2, R5.4, R5.9, R5.11, R6.3): ...")`).
    - **Validates: Requirements R5.1, R5.2, R5.4, R5.9, R5.11, R6.3**
  - [~] 25.3 Write property test P25 in `src/external-data.pbt.test.ts`
    - **Property 25: OSV data is honest and well-formed** (`describe("P25 (R5.3, R5.9): ...")`).
    - **Validates: Requirements R5.3, R5.9**
  - [~] 25.4 Write property test P26 in `src/external-data.pbt.test.ts`
    - **Property 26: Per-dependency failures are isolated** (`describe("P26 (R5.5, R5.6, R5.7, R5.8, R7.6, R7.9): ...")`).
    - **Validates: Requirements R5.5, R5.6, R5.7, R5.8, R7.6, R7.9**
  - [~] 25.5 Implement `src/external-data.ts`
    - `fetchExternalData`, `ExternalDataResult`, `SkippedDependency`, `SkipReason`; dependency collection with `parseAllManifests`, promise pool, registries then npm, OSV, deterministic ordering; never throws for per-dependency failures.
    - _Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8, R5.9, R5.10, R5.11_

- [~] 26. Checkpoint - extraction, cache, external data
  - Ensure all tests pass for tasks 21-25 (including `pnpm test:pbt` for the package); ask the user if questions arise.

- [ ] 27. GitHubSummoner: build path
  - [~] 27.1 Write the failing unit tests in `src/snapshot.test.ts`
    - `buildDetailed` / `build`: strict `RepoRef` validation; fresh cache hit makes zero network requests (FetchPort call count unchanged); expired entry rebuilt and replaced; in-flight deduplication of concurrent builds; failures are not cached; returned snapshot is a shallow copy (mutating `manifests` does not change the next hit); `private: true` refused before any download; canonical pair used for later URLs and the cache key; `createdAt` from the single `ClockPort` reading; `hasWorkflowsDir` from tarball entries with no extra request; a failing branch aborts siblings, while `degraded` and `absent` do not; `build` is 3 REST calls; compile-time `GitHubSnapshotBuilder` conformance check; file contents stored byte-for-byte unaltered.
    - _Requirements: R3.1, R3.7, R3.14, R4.6, R4.8, R8.1, R8.2, R8.3, R8.6, R8.10, R10.4_
  - [~] 27.2 Write property test P5 in `src/snapshot.pbt.test.ts`
    - **Property 5: Per-file cap is preserved, not reimplemented** (`describe("P5 (R3.7, R3.8): ...")`).
    - **Validates: Requirements R3.7, R3.8**
  - [~] 27.3 Write property test P7 in `src/snapshot.pbt.test.ts`
    - **Property 7: File-count cap is preserved** (`describe("P7 (R3.7, R3.8): ...")`).
    - **Validates: Requirements R3.7, R3.8**
  - [~] 27.4 Write property test P18 in `src/optional-degradation.pbt.test.ts`
    - **Property 18: Optional-call degradation** (`describe("P18 (R4.7, R4.8, R4.9, R7.6, R7.9): ...")`), whole `build` with scripted pulls/release failures and scripted repo/tarball failures.
    - **Validates: Requirements R4.7, R4.8, R4.9, R7.6, R7.9**
  - [~] 27.5 Write the failing degraded-result cache TTL tests in `src/degraded-cache.test.ts`
    - Using the fixed `ClockPort` and a fixture `FetchPort`, assert the resolved Q16 behaviour (a degraded result is cached for 10 minutes, not the full TTL). Because 27.6 is not written yet, these tests fail first (red), then pass once 27.6 stores the per-entry TTL:
      - Degraded hit: build with `pulls` degraded (5xx), advance the clock to 9 min 59.999 s (599,999 ms), rebuild, and assert a cache hit with zero new requests and the same neutral meta and `degradedFields`.
      - Degraded miss at the boundary: advance to exactly 10 min (600,000 ms) and assert a miss (strictly-less-than rule) with a full rebuild.
      - Retry on next summon: after expiry, the rebuild repeats the `pulls` and `release` calls (assert both requests are recorded again); when the retried calls succeed, `degradedFields` is `[]`, the real `openPRCount` and `latestReleaseAt` replace the neutral values, and the replacement entry now earns the normal TTL (a hit at 7 days minus 1 ms, a miss at 7 days).
      - Non-degraded unchanged: a result with `degradedFields` `[]` stays a hit at 10 min and at 7 days minus 1 ms, and is a miss at exactly 7 days (default TTL).
      - Configured TTL wins when shorter: with a configured TTL of 5 min, a degraded result expires at 5 min (not 10) and a non-degraded one also at 5 min; with a configured TTL of 1 hour, a degraded result still expires at 10 min while a non-degraded one lives 1 hour.
      - Mixed degradation: `release` degraded alone and both `pulls` and `release` degraded each use the 10-minute TTL.
      - Name the tests after R8.11 to R8.14 so a future change to the policy shows up as an intentional diff.
    - _Requirements: R4.7, R4.9, R8.1, R8.2, R8.3, R8.5, R8.11, R8.12, R8.13, R8.14_
  - [~] 27.6 Implement `GitHubSummoner.buildDetailed` and `build` in `src/snapshot.ts`
    - Fresh `GitHubClient` per operation; cache lookup first; in-flight map; `private` guard; parallel `pulls`, `release`, and tarball under one `AbortController`; `mapRepoMeta`; `buildSnapshotFromFileMap(ref, tree.files, { meta, createdAt })`; cache store and shallow-copy return; `SummonResult` and `SummonExtras` with `degradedFields`.
    - Store the result with a per-entry TTL: `cache.set(key, result, { ttlMs: effectiveTtlMs(cache.configuredTtlMs, extras.degradedFields) })`, so a non-empty `degradedFields` earns `min(configured TTL, DEGRADED_TTL_MS)` (10 minutes by default) and an empty one earns the configured TTL; an expired degraded entry is absent, so the next summon repeats the optional calls and replaces the entry. Makes 27.5 pass.
    - _Requirements: R3.1, R3.7, R3.8, R3.14, R4.1, R4.6, R4.7, R4.8, R4.9, R8.1, R8.2, R8.3, R8.6, R8.10, R8.11, R8.12, R8.13, R8.14, R10.4_

- [ ] 28. GitHubSummoner: summon pipeline and cross-cutting properties
  - [~] 28.1 Write the failing unit tests in `src/summon.test.ts`
    - `summon(string | ParsedRepoRef)`: parse, resolve, build; 4 REST calls on a miss (5 with a rename redirect); a cache hit inside `summon` costs only calls 1 and 2; repo payload from call 1 is reused by build; `createSummoner` wiring; `snapshot.manifests` assignment by a downstream `runReading` does not leak into the cache; `fetchExternalData` consumable with the summoned snapshot.
    - _Requirements: R2.7, R2.10, R4.8, R8.2, R10.4, R10.6_
  - [~] 28.2 Write property test P9 in `src/secrets.pbt.test.ts`
    - **Property 9: Secrets never leak; repository content is untouched** (`describe("P9 (R6.5, R8.10): ...")`).
    - **Validates: Requirements R6.5, R8.10**
  - [~] 28.3 Write property test P10 in `src/determinism.pbt.test.ts`
    - **Property 10: Offline determinism** (`describe("P10 (R3.14, R9.4, R9.5, R9.6): ...")`).
    - **Validates: Requirements R3.14, R9.4, R9.5, R9.6**
  - [~] 28.4 Write property test P13 in `src/call-budget.pbt.test.ts`
    - **Property 13: REST call budget, including the rename redirect** (`describe("P13 (R2.4, R2.7, R2.8, R2.10, R4.6, R4.8): ...")`).
    - **Validates: Requirements R2.4, R2.7, R2.8, R2.10, R4.6, R4.8**
  - [~] 28.5 Write property test P16 in `src/error-mapping.pbt.test.ts`
    - **Property 16: Error-code mapping for ref, auth, and upstream failures** (`describe("P16 (R2.11, R5.5, R7.6, R7.7, R7.8, R7.9): ...")`).
    - **Validates: Requirements R2.11, R5.5, R7.6, R7.7, R7.8, R7.9**
  - [~] 28.6 Write property test P17 in `src/error-mapping.pbt.test.ts`
    - **Property 17: AUTH_INVALID never leaks the token** (`describe("P17 (R6.5, R7.8): ...")`).
    - **Validates: Requirements R6.5, R7.8**
  - [~] 28.7 Implement `summon` and `createSummoner` in `src/snapshot.ts`
    - Wire `parseRepoRef`, `resolveRefDetailed`, and `buildDetailed` so call 1's payload is reused; no re-fetch.
    - _Requirements: R1.10, R2.1, R2.7, R2.10, R4.8, R10.1, R10.3, R10.4, R10.6_

- [ ] 29. System adapters
  - [~] 29.1 Write the failing tests in `src/adapters/adapters.test.ts`
    - With `vi.stubGlobal("fetch", ...)` and fake timers (no real network): `createSystemFetchPort` sends `redirect: "manual"`, uses `AbortSignal.timeout(timeoutMs)`, lower-cases response header names, maps abort/timeout to `FetchTransportError("timeout")` and other failures to `FetchTransportError("network")`, honours the caller `signal`; `systemClock.nowMs()` returns `Date.now()`.
    - _Requirements: R9.1, R9.2, R9.6, R10.6_
  - [~] 29.2 Implement `src/adapters/system-fetch.ts` and `src/adapters/system-clock.ts`
    - The only files allowed to touch global `fetch` and `Date.now()` (lint-exempt).
    - _Requirements: R9.1, R9.2, R10.6_

- [ ] 30. Public API and boundary
  - [~] 30.1 Write the failing tests
    - `src/index.test.ts`: every name listed in the design's Public API section (and in R10) is reachable from `src/index.ts` alone; `testing/` helpers are not exported; compile-time `const _: GitHubSnapshotBuilder = createSummoner(...)`.
    - `src/boundary.test.ts`: scans source files and asserts `packages/oracle` contains no `@necro/github` import, and `packages/github` imports `@necro/oracle` only via its package entry, imports no other `@necro/*` package (including `@necro/config`), and contains no `process.env` or global `fetch` outside `adapters/`.
    - _Requirements: R10.1, R10.2, R10.3, R10.4, R10.5, R10.6, R10.7_
  - [~] 30.2 Implement `src/index.ts`
    - Export the public API exactly as designed: `parseRepoRef`, `resolveRef`, `ParsedRepoRefSchema`, `GitHubSummoner`, `createSummoner`, `fetchExternalData`, `mapRepoMeta`, `cacheKey`, `SnapshotCache`, `GitHubClient`, `SummonerError`, `DEFAULT_LIMITS`, port types, `FetchTransportError`, `createSystemFetchPort`, `systemClock`, and the associated types. Remove the placeholder from 2.2.
    - _Requirements: R10.1, R10.2, R10.3, R10.4, R10.5, R10.6, R10.7_

- [ ] 31. Golden offline end-to-end test
  - [~] 31.1 Write the failing golden test in `src/golden.test.ts`
    - Using only the fixture-backed ports: `summon` a recorded repo + in-memory tarball, `fetchExternalData` with recorded PyPI/npm/OSV fixtures, then call `runReading` from `@necro/oracle` with `{ registryData, osvData, now }` and snapshot-test the draws (Tower and Devil present). Assert the `registryData` key contract (`dep.name.toLowerCase()`, no ecosystem prefix) matches what the Tower looks up, so drift fails the test. Assert the whole result is byte-for-byte equal across two runs. Create `expected-reading.json` next to the test.
    - _Requirements: R5.2, R5.10, R9.4, R10.5_
  - [~] 31.2 Author the golden fixtures and make the test pass
    - Create the recorded repo/commit/pulls/release/registry/OSV fixtures and the in-memory tarball entry list used by the golden test (py2 sources, a pinned vulnerable dependency, `.github/workflows` absent or present as designed). No network capture.
    - _Requirements: R5.2, R5.10, R9.4, R10.5_

- [~] 32. Checkpoint - package complete
  - Run `pnpm test`, `pnpm test:pbt`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`; ensure everything passes with zero network, LLM, or sandbox calls; ask the user if questions arise.

- [ ] 33. Documentation
  - [~] 33.1 Create `docs/ARCHITECTURE.md`
    - New file with a GitHub adapter section: dependency direction, the three ports, the REST call plan (4 normal, 5 with rename), the layered caps (50 MB compressed, 200 MB uncompressed, 100,000 entries, then oracle's 1 MB and 5000), the host and Authorization policy table, the token-aware tarball path, optional-call degradation and `degradedFields`, the cache TTL policy (7 days by default, 10 minutes for results with non-empty `degradedFields`). Structure it so later specs (sandbox, llm, ledger) append their own sections.
    - _Requirements: R3.9, R3.10, R3.11, R3.12, R3.15, R3.16, R4.8, R4.9, R6.2, R6.3, R8.5, R8.11, R8.12, R10.1_
  - [~] 33.2 Append a dated entry to `docs/KIRO_USAGE.md`
    - Record: the requirements-first workflow produced this spec; prework added P19-P33 beside the 19 properties named in the requirements (P1-P18 and P34); the tar-stream spike and the `pnpm view tar-stream versions --json` lookup informed the library choice; the requirements revision (rename redirects, token-aware tarball path, three more error codes, the Q16 optional-call carve-out). Note `docs/DECK.md` needs no change: no card, grimoire, agent, or gate changed.
    - _Requirements: R7.1, R10.1_
  - [~] 33.3 Add a "Known risks" subsection to `docs/ARCHITECTURE.md`
    - List: Q2 (authenticated 404 cannot prove absence); Q6 (quota without a token); Q9 (`tar-stream` pulls in `bare-fs`, unused); Q10 (memory near the 200 MB cap, injectable limits); Q11 (per-process cache); Q12 (exact-pin-only OSV coverage).
    - _Requirements: R3.15, R3.16, R7.3, R8.1_

- [~] 34. Final checkpoint - full verification
  - Run `pnpm test`, `pnpm test:pbt`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`; confirm every property P1..P34 has exactly one passing test (P31 and P34 share the cache-model test in 22.3), and that docs are updated in the same change. Ask the user if questions arise.

## Notes

- All test tasks are required; no task carries the optional `*` marker.
- Every property P1..P34 is owned by exactly one test task: P1-P4 (13.2-13.5), P5 (27.2), P6 (21.3), P7 (27.3), P8 (22.2), P9 (28.2), P10 (28.3), P11 (21.4), P12 (18.2), P13 (28.4), P14 (17.4), P15 (18.3), P16 (28.5), P17 (28.6), P18 (27.4), P19 (19.2), P20 (19.3), P21 (21.2), P22 (12.2), P23 (16.2), P24-P26 (25.2-25.4), P27 (17.2), P28 (11.2), P29 (15.2), P30 (15.3), P31 and P34 (both 22.3), P32 (17.3), P33 (18.4).
- Risky items: tar-stream behaviour (task 1, gate before anything else); oracle enum change (task 3); lint policy that enforces port discipline (task 5); redirect and Authorization policy (17-18); capped streaming and cancellation (21); Q16 degraded-result cache TTL (27.5 tests, 22.4 and 27.6 implement); `registryData` key contract drift (31).
- Tasks that write the same file are placed in different waves of the dependency graph, so property tests sharing a `*.pbt.test.ts` file run sequentially.
- The `pulls`, `release`, and tarball requests never call the network in tests; only `FetchPort` fixtures are used.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 4, "tasks": ["2.2", "3.2", "4.2", "5.2"] },
    { "id": 5, "tasks": ["7.1", "8.1", "9.1", "10.1", "11.1", "11.2", "12.1", "12.2", "13.1", "13.2"] },
    { "id": 6, "tasks": ["8.2", "9.2", "10.2", "11.3", "12.3", "13.3"] },
    { "id": 7, "tasks": ["7.2", "10.3", "13.4"] },
    { "id": 8, "tasks": ["10.4", "13.5"] },
    { "id": 9, "tasks": ["13.6", "15.1", "15.2", "16.1", "16.2", "17.1", "17.2", "17.4", "21.1", "21.2", "22.1", "22.2", "23.1", "24.1", "25.1", "25.2", "29.1"] },
    { "id": 10, "tasks": ["15.3", "17.3", "18.1", "21.3", "22.3", "25.3", "27.1", "27.2", "27.4", "27.5", "28.1", "28.2", "28.3", "28.4", "28.5", "29.2", "30.1"] },
    { "id": 11, "tasks": ["15.4", "18.2", "19.1", "19.2", "21.4", "25.4", "27.3", "28.6", "31.1"] },
    { "id": 12, "tasks": ["16.3", "17.5", "18.3", "19.3", "22.4"] },
    { "id": 13, "tasks": ["18.4", "19.4"] },
    { "id": 14, "tasks": ["18.5"] },
    { "id": 15, "tasks": ["21.5", "23.2", "24.2"] },
    { "id": 16, "tasks": ["25.5", "27.6"] },
    { "id": 17, "tasks": ["28.7"] },
    { "id": 18, "tasks": ["30.2"] },
    { "id": 19, "tasks": ["31.2", "33.1", "33.2"] },
    { "id": 20, "tasks": ["33.3"] }
  ]
}
```
