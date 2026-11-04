// Task 27.4: property test P18 (optional-call degradation) over the whole build path.
// Test-first: fails until src/snapshot.ts exists (task 27.6).
//
// API assumed from design.md ("Summoner and builder"):
//   createSummoner(deps: { fetch, clock, env }, opts?) -> GitHubSummoner
//   summoner.buildDetailed(ref: RepoRef) -> Promise<{ snapshot, extras, cache }>
//     extras.degradedFields: readonly ("pulls" | "release")[]
//     snapshot.meta: RepoMeta (openPRCount, oldestOpenPRAgeDays, latestReleaseAt, openIssueCount)
//   summoner.build(ref) -> Promise<RepoSnapshot> (same pipeline, snapshot only).
// A fresh summoner (so a fresh cache) is created per generated case. Only a scripted
// FetchPort answers; no network is touched. The commit/ref-resolution request belongs to
// resolveRef, not build, so the 5xx-on-commit half of R7.9 is covered by the resolveRef tests.
import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FetchTransportError, type FetchPort, type FetchResponse } from "./ports.js";
import { createSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { makeTarGz } from "./testing/make-tar-gz.js";

const OWNER = "graveyard";
const NAME = "relic";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const REF = { owner: OWNER, name: NAME, sha: SHA, defaultBranch: "main" };
const TOKEN = "ghp_P18AbcdefghijklmnopqrstuvwxyzABCDEF0123";

type Failure =
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "transport"; readonly transport: "timeout" | "network" };

type Script = { readonly kind: "ok" } | Failure;

const arbTransientFailure: fc.Arbitrary<Failure> = fc.oneof(
  fc.integer({ min: 500, max: 599 }).map((status): Failure => ({ kind: "status", status })),
  fc.constantFrom<"timeout" | "network">("timeout", "network").map(
    (transport): Failure => ({ kind: "transport", transport }),
  ),
);

const arbScript: fc.Arbitrary<Script> = fc.oneof(
  fc.constant<Script>({ kind: "ok" }),
  arbTransientFailure,
);

// At least one of the two optional calls fails transiently.
const arbOptionalScripts = fc
  .tuple(arbScript, arbScript)
  .filter(([p, r]) => p.kind !== "ok" || r.kind !== "ok");

const arbOpenIssues = fc.integer({ min: 0, max: 5000 });

interface World {
  readonly pulls: Script;
  readonly release: Script;
  readonly repo?: Script;
  readonly tarball?: Script;
  readonly openIssues: number;
}

interface Scripted {
  readonly fetch: FetchPort;
  readonly urls: string[];
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  };
}

function emptyResponse(status: number, headers: Record<string, string> = {}): FetchResponse {
  return { status, headers, body: null };
}

function tarResponse(): FetchResponse {
  const gz = makeTarGz([
    { name: `${OWNER}-${NAME}-0123456/`, typeflag: "5" },
    { name: `${OWNER}-${NAME}-0123456/README.md`, body: "# relic\n" },
  ]);
  return {
    status: 200,
    headers: { "content-type": "application/x-gzip" },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(gz.slice());
        c.close();
      },
    }),
  };
}

function answer(script: Script, ok: () => FetchResponse): FetchResponse {
  if (script.kind === "ok") return ok();
  if (script.kind === "transport") {
    throw new FetchTransportError(script.transport, `scripted ${script.transport}`);
  }
  return emptyResponse(script.status);
}

/** Routes by URL; unknown URLs reject so an unexpected request fails the property loudly. */
function scriptedFetch(world: World): Scripted {
  const urls: string[] = [];
  const fetch: FetchPort = (req) => {
    urls.push(req.url);
    try {
      const url = new URL(req.url);
      if (url.hostname === "api.github.com") {
        if (url.pathname === `/repos/${OWNER}/${NAME}`) {
          return Promise.resolve(
            answer(world.repo ?? { kind: "ok" }, () =>
              jsonResponse(200, {
                name: NAME,
                full_name: `${OWNER}/${NAME}`,
                owner: { login: OWNER },
                default_branch: "main",
                private: false,
                archived: false,
                pushed_at: "2019-03-14T09:26:53Z",
                stargazers_count: 42,
                open_issues_count: world.openIssues,
                license: { spdx_id: "MIT" },
              }),
            ),
          );
        }
        if (url.pathname === `/repos/${OWNER}/${NAME}/pulls`) {
          return Promise.resolve(answer(world.pulls, () => jsonResponse(200, [])));
        }
        if (url.pathname === `/repos/${OWNER}/${NAME}/releases/latest`) {
          return Promise.resolve(
            answer(world.release, () => jsonResponse(200, { published_at: "2018-12-25T00:00:00Z" })),
          );
        }
        if (url.pathname === `/repos/${OWNER}/${NAME}/tarball/${SHA}`) {
          if ((world.tarball ?? { kind: "ok" }).kind !== "ok") {
            return Promise.resolve(answer(world.tarball as Script, tarResponse));
          }
          return Promise.resolve(
            emptyResponse(302, { location: `https://codeload.github.com/${OWNER}/${NAME}/legacy.tar.gz/${SHA}` }),
          );
        }
      }
      if (url.hostname === "codeload.github.com") {
        return Promise.resolve(answer(world.tarball ?? { kind: "ok" }, tarResponse));
      }
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.reject(new Error(`P18 scripted fetch: unexpected request ${req.method} ${req.url}`));
  };
  return { fetch, urls };
}

function summonerFor(world: World, token: string | undefined) {
  const scripted = scriptedFetch(world);
  const summoner = createSummoner({
    fetch: scripted.fetch,
    clock: fixedClock(Date.parse("2024-01-01T00:00:00Z")),
    env: { get: () => token },
  });
  return { summoner, scripted };
}

async function settle(run: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("P18 (R4.7, R4.8, R4.9, R7.6, R7.9): optional-call degradation", () => {
  // Feature: 02-github-summoner, Property 18: Optional-call degradation
  // **Validates: Requirements R4.7, R4.8, R4.9, R7.6, R7.9**
  it("5xx, timeout, or network failure on pulls and/or release degrades to neutral meta and names exactly the failed calls", async () => {
    await fc.assert(
      fc.asyncProperty(arbOptionalScripts, arbOpenIssues, fc.boolean(), async ([pulls, release], openIssues, withToken) => {
        const { summoner, scripted } = summonerFor({ pulls, release, openIssues }, withToken ? TOKEN : undefined);
        const result = await summoner.buildDetailed(REF);

        const failed: string[] = [];
        if (pulls.kind !== "ok") failed.push("pulls");
        if (release.kind !== "ok") failed.push("release");
        expect([...result.extras.degradedFields].sort()).toEqual(failed.sort());

        const meta = result.snapshot.meta;
        if (pulls.kind !== "ok") {
          expect(meta.openPRCount).toBe(0);
          expect(meta.oldestOpenPRAgeDays).toBeNull();
          expect(meta.openIssueCount).toBe(openIssues);
        }
        if (release.kind !== "ok") expect(meta.latestReleaseAt).toBeNull();
        else expect(meta.latestReleaseAt).not.toBeNull();

        // A degraded call is still one REST call (R4.8): never retried, within budget.
        const rest = scripted.urls.filter((u) => u.startsWith("https://api.github.com/") && !u.includes("/tarball/"));
        expect(rest.filter((u) => u.includes("/pulls")).length).toBe(1);
        expect(rest.filter((u) => u.includes("/releases/latest")).length).toBe(1);
        expect(rest.length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 200 },
    );
  });

  it("build() degrades identically to buildDetailed() (snapshot-only entry point)", async () => {
    await fc.assert(
      fc.asyncProperty(arbOptionalScripts, arbOpenIssues, async ([pulls, release], openIssues) => {
        const { summoner } = summonerFor({ pulls, release, openIssues }, undefined);
        const snapshot = await summoner.build(REF);
        if (pulls.kind !== "ok") {
          expect(snapshot.meta.openPRCount).toBe(0);
          expect(snapshot.meta.oldestOpenPRAgeDays).toBeNull();
          expect(snapshot.meta.openIssueCount).toBe(openIssues);
        }
        if (release.kind !== "ok") expect(snapshot.meta.latestReleaseAt).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("a 429 or 401 on either optional call is still fatal (RATE_LIMITED / AUTH_INVALID)", async () => {
    const arbFatal = fc.constantFrom(
      { status: 429, code: "RATE_LIMITED" },
      { status: 401, code: "AUTH_INVALID" },
    );
    await fc.assert(
      fc.asyncProperty(
        arbFatal,
        fc.constantFrom("pulls", "release", "both"),
        arbScript,
        arbOpenIssues,
        async (fatal, where, other, openIssues) => {
          const bad: Script = { kind: "status", status: fatal.status };
          const world: World = {
            pulls: where === "release" ? other : bad,
            release: where === "pulls" ? other : bad,
            openIssues,
          };
          const { summoner } = summonerFor(world, TOKEN);
          const outcome = await settle(() => summoner.buildDetailed(REF));
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.error).toBeInstanceOf(NecroError);
            expect((outcome.error as NecroError).code).toBe(fatal.code);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a 5xx on the repository metadata or tarball request is still fatal (UPSTREAM_UNAVAILABLE)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("repo", "tarball"),
        fc.integer({ min: 500, max: 599 }),
        arbScript,
        arbScript,
        arbOpenIssues,
        async (target, status, pulls, release, openIssues) => {
          const bad: Script = { kind: "status", status };
          const world: World = {
            pulls,
            release,
            openIssues,
            ...(target === "repo" ? { repo: bad } : { tarball: bad }),
          };
          const { summoner } = summonerFor(world, undefined);
          const outcome = await settle(() => summoner.buildDetailed(REF));
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.error).toBeInstanceOf(NecroError);
            expect((outcome.error as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
