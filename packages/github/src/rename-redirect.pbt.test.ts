// Task 17.4: property P14 (rename-redirect policy). Test-first: fails until src/github-client.ts
// exists (task 17.5) and intake wires `allowRepoRedirect` (task 19.4).
// Design D2: only the first `GET /repos/{owner}/{repo}` of an operation may follow ONE 301/307/308 whose
// target is https://api.github.com (default port). Anything else is VALIDATION_FAILED, with no further request.
// Arbitraries are inline (small, specific to this property).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SummonerError } from "./errors.js";
import { GitHubClient, type RequestContext } from "./github-client.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";
import { arbOwnerOrName } from "../test/arbitraries.js";

const API = "https://api.github.com";
const Schema = z.object({ id: z.number() });

const arbFollowStatus = fc.constantFrom(301, 307, 308);
/** Redirect statuses outside the followed set (300-399 minus 301/307/308). */
const arbRefusedStatus = fc.integer({ min: 300, max: 399 }).filter((s) => ![301, 307, 308].includes(s));

const arbRepoId = fc.integer({ min: 1, max: 999_999_999 });
const arbTail = fc.constantFrom("", "/", "?x=1");

/** Acceptable Location: https://api.github.com on the default port. */
const arbGoodTarget: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(
      arbRepoId.map((n) => `/repositories/${n}`),
      fc.tuple(arbOwnerOrName, arbOwnerOrName).map(([o, n]) => `/repos/${o}/${n}`),
    ),
    arbTail,
  )
  .map(([p, t]) => `${API}${p}${t}`)
  .filter((u) => !u.endsWith("/") || u.length > API.length);

/** Unacceptable Location: other host, look-alike, codeload, http scheme, non-default port. */
const arbBadTarget: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(
      fc.constantFrom(
        "https://evil.test",
        "https://github.com",
        "https://codeload.github.com",
        "https://api.github.com.evil.test",
        "https://evilapi.github.com",
        "https://pypi.org",
        "http://api.github.com",
      ),
      fc.integer({ min: 1, max: 65535 }).filter((n) => n !== 443).map((n) => `https://api.github.com:${n}`),
    ),
    arbRepoId,
  )
  .map(([origin, n]) => `${origin}/repositories/${n}`);

interface Setup {
  readonly fx: ReturnType<typeof createFixtureFetch>;
  readonly client: GitHubClient;
}

function setup(): Setup {
  const fx = createFixtureFetch();
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => undefined },
  });
  return { fx, client };
}

const repoCtx = (over: Partial<RequestContext> = {}): RequestContext & { optional: false } => ({
  endpoint: "repo",
  repo: { owner: "o", name: "r" },
  repoProven: false,
  allowRepoRedirect: true,
  ...over,
  optional: false,
});

async function failure(p: Promise<unknown>): Promise<SummonerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  throw new Error("expected rejection");
}

const NUM_RUNS = 200;

// Feature: 02-github-summoner, Property 14: Rename-redirect policy
// Validates: Requirements R2.8, R2.9
describe("P14 (R2.8, R2.9): rename-redirect policy", () => {
  it("follows exactly one 301/307/308 to api.github.com on the flagged first repo call and counts both hops", async () => {
    await fc.assert(
      fc.asyncProperty(arbFollowStatus, arbGoodTarget, arbRepoId, async (status, target, id) => {
        const { fx, client } = setup();
        fx.register({ url: `${API}/repos/o/r`, status, redirectTo: target });
        fx.register({ url: target, json: { id } });
        const res = await client.getJson("/repos/o/r", Schema, repoCtx());
        expect(res.data).toEqual({ id });
        expect(fx.requests.map((r) => r.url)).toEqual([`${API}/repos/o/r`, target]);
        expect(client.restCallCount).toBe(2);
        for (const r of fx.requests) expect(r.redirect).toBe("manual");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("refuses a non-followed redirect status (any 3xx but 301/307/308) with one request only", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefusedStatus, arbGoodTarget, async (status, target) => {
        const { fx, client } = setup();
        fx.register({ url: `${API}/repos/o/r`, status, redirectTo: target });
        fx.register({ url: target, json: { id: 1 } });
        const err = await failure(client.getJson("/repos/o/r", Schema, repoCtx()));
        expect(err.code).toBe("VALIDATION_FAILED");
        expect(fx.requests).toHaveLength(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("refuses a target on another host, scheme or port with one request only", async () => {
    await fc.assert(
      fc.asyncProperty(arbFollowStatus, arbBadTarget, async (status, target) => {
        const { fx, client } = setup();
        fx.register({ url: `${API}/repos/o/r`, status, redirectTo: target });
        fx.register({ url: target, json: { id: 1 } });
        const err = await failure(client.getJson("/repos/o/r", Schema, repoCtx()));
        expect(err.code).toBe("VALIDATION_FAILED");
        expect(fx.requests).toHaveLength(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("refuses a second redirect and sends no third request", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFollowStatus,
        arbFollowStatus,
        arbGoodTarget,
        arbGoodTarget,
        async (s1, s2, t1, t2) => {
          fc.pre(t1 !== t2 && t1 !== `${API}/repos/o/r` && t2 !== `${API}/repos/o/r`);
          const { fx, client } = setup();
          fx.register({ url: `${API}/repos/o/r`, status: s1, redirectTo: t1 });
          fx.register({ url: t1, status: s2, redirectTo: t2 });
          fx.register({ url: t2, json: { id: 1 } });
          const err = await failure(client.getJson("/repos/o/r", Schema, repoCtx()));
          expect(err.code).toBe("VALIDATION_FAILED");
          expect(fx.requests).toHaveLength(2);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("refuses any redirect on a call not flagged allowRepoRedirect, required or optional", async () => {
    const arbOther = fc.constantFrom(
      { endpoint: "commit", path: "/repos/o/r/commits/x", optional: false },
      { endpoint: "pulls", path: "/repos/o/r/pulls", optional: true },
      { endpoint: "release", path: "/repos/o/r/releases/latest", optional: true },
      // the repo endpoint itself, once the flag is off (e.g. not the first call)
      { endpoint: "repo", path: "/repos/o/r", optional: false },
    );
    await fc.assert(
      fc.asyncProperty(arbOther, arbFollowStatus, arbGoodTarget, async (c, status, target) => {
        const { fx, client } = setup();
        fx.register({ url: `${API}${c.path}`, status, redirectTo: target });
        fx.register({ url: target, json: { id: 1 } });
        const ctx = {
          endpoint: c.endpoint,
          repo: { owner: "o", name: "r" },
          repoProven: c.endpoint !== "repo",
          allowRepoRedirect: false,
          optional: c.optional,
        } as RequestContext & { optional: boolean };
        const p = client.getJson(c.path, Schema, ctx as never) as Promise<unknown>;
        const err = await failure(p);
        expect(err.code).toBe("VALIDATION_FAILED");
        expect(fx.requests).toHaveLength(1);
        expect(client.restCallCount).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
