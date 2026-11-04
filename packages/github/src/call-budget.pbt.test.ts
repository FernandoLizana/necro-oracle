// Task 28.4: property P13 (REST call budget, including the rename redirect).
// Test-first: fails until `GitHubSummoner.summon` exists in src/snapshot.ts (task 28.7).
// Uses the summon API documented in the header of src/summon.test.ts: 4 REST calls on a miss,
// 5 when call 1 follows one rename redirect, 2 (3 with the redirect hop) on a cache hit; the codeload
// tarball is not a REST call. RepoRef owner/name come from the validated response (R2.4).
// Offline: FixtureFetch + FixedClock only. Arbitraries are inline.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const START = Date.parse("2024-01-31T00:00:00Z");
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api/success");
const fixture = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8")) as Record<string, unknown>;

const NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const arbName = fc.array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 12 }).map((cs) => cs.join(""));

interface Scenario {
  readonly reqOwner: string;
  readonly reqName: string;
  readonly canOwner: string;
  readonly canName: string;
  readonly redirect: boolean;
  readonly repoId: number;
}

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    reqOwner: arbName,
    reqName: arbName,
    canOwner: arbName,
    canName: arbName,
    redirect: fc.boolean(),
    repoId: fc.integer({ min: 1, max: 999_999_999 }),
  })
  .map((s) =>
    // Without a redirect the canonical pair is the requested pair.
    s.redirect ? s : { ...s, canOwner: s.reqOwner, canName: s.reqName },
  );

function build(s: Scenario) {
  const fx = createFixtureFetch();
  const requestedRepo = `${API}/repos/${s.reqOwner}/${s.reqName}`;
  const canonRepo = `${API}/repos/${s.canOwner}/${s.canName}`;
  const target = `${API}/repositories/${s.repoId}`;
  const repoBody = {
    ...fixture("repo.json"),
    name: s.canName,
    full_name: `${s.canOwner}/${s.canName}`,
    owner: { login: s.canOwner },
  };
  if (s.redirect) {
    fx.register({ url: requestedRepo, redirectTo: target, status: 301 });
    fx.register({ url: target, json: repoBody });
  } else {
    fx.register({ url: requestedRepo, json: repoBody });
  }
  fx.register({ url: `${canonRepo}/commits/main`, json: fixture("commit.json") });
  fx.register({
    url: `${canonRepo}/pulls?state=open&sort=created&direction=asc&per_page=1`,
    json: JSON.parse(readFileSync(path.join(FIXTURES, "pulls.json"), "utf8")) as unknown,
  });
  fx.register({ url: `${canonRepo}/releases/latest`, json: fixture("release.json") });
  const prefix = `${s.canOwner}-${s.canName}-${SHA}/`;
  fx.register({
    url: `${CODELOAD}/${s.canOwner}/${s.canName}/tar.gz/${SHA}`,
    body: makeTarGz([
      { name: prefix, typeflag: "5" },
      { name: `${prefix}README.md`, body: "# relic\n" },
    ]),
  });
  const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
  return { fx, summoner };
}

const apiCount = (fx: ReturnType<typeof createFixtureFetch>): number =>
  fx.requests.filter((r) => new URL(r.url).host === "api.github.com").length;

describe("P13 (R2.4, R2.7, R2.8, R2.10, R4.6, R4.8): REST call budget, including the rename redirect", () => {
  it("every summon makes at most 5 REST calls and returns the canonical owner/name", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (s) => {
        const { fx, summoner } = build(s);

        const miss = await summoner.summon(`${s.reqOwner}/${s.reqName}`);
        const missCalls = apiCount(fx);
        expect(miss.cache).toBe("miss");
        expect(missCalls).toBeLessThanOrEqual(5);
        expect(missCalls).toBe(s.redirect ? 5 : 4);
        expect(miss.snapshot.ref.owner).toBe(s.canOwner);
        expect(miss.snapshot.ref.name).toBe(s.canName);
        expect(fx.requests.filter((r) => new URL(r.url).host === "codeload.github.com")).toHaveLength(1);

        // A cache hit is cheaper still and keeps the canonical identity.
        const hit = await summoner.summon(`${s.reqOwner}/${s.reqName}`);
        const hitCalls = apiCount(fx) - missCalls;
        expect(hit.cache).toBe("hit");
        expect(hitCalls).toBe(s.redirect ? 3 : 2);
        expect(hit.snapshot.ref.owner).toBe(s.canOwner);
        expect(hit.snapshot.ref.name).toBe(s.canName);
      }),
      { numRuns: 200 },
    );
  });
});
