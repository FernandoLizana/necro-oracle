// Task 27.5: degraded-result cache TTL tests (resolved Q16; design D5; R8.11 to R8.14).
// Test-first: fails until src/snapshot.ts exists and stores a per-entry TTL (task 27.6, which calls
// cache.set(key, result, { ttlMs: effectiveTtlMs(cache.configuredTtlMs, extras.degradedFields) })).
// Offline: FixtureFetch + FixedClock only. API as in the headers of snapshot.test.ts and snapshot-cache.test.ts.
// Requirements: R4.7, R4.9, R8.1, R8.2, R8.3, R8.5, R8.11, R8.12, R8.13, R8.14.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RepoRef } from "@necro/oracle";
import { DEFAULT_TTL_MS, DEGRADED_TTL_MS } from "./constants.js";
import type { SummonerDeps } from "./ports.js";
import { GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch, type FixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const START = Date.parse("2024-01-31T00:00:00Z");
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api");
const REF: RepoRef = { owner: "graveyard", name: "relic", sha: SHA, defaultBranch: "main" };
const PREFIX = `graveyard-relic-${SHA}/`;
const ENTRIES: RawTarEntry[] = [
  { name: PREFIX, typeflag: "5" },
  { name: `${PREFIX}README.md`, body: "# relic\n" },
];

const MIN = 60_000;
const TEN_MIN = 10 * MIN;
const fixtureJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, "success", file), "utf8"));

const REPO = `${API}/repos/graveyard/relic`;
const PULLS = `${REPO}/pulls?state=open&sort=created&direction=asc&per_page=1`;
const RELEASE = `${REPO}/releases/latest`;

type Optional = { status?: number; json?: unknown };
const OK_PULLS: Optional = { json: fixtureJson("pulls.json") };
const OK_RELEASE: Optional = { json: fixtureJson("release.json") };
const DOWN: Optional = { status: 503, json: { message: "down" } };

function registerAll(fx: FixtureFetch, pulls: Optional, release: Optional): void {
  fx.register({ url: REPO, json: fixtureJson("repo.json") });
  fx.register({ url: PULLS, ...pulls });
  fx.register({ url: RELEASE, ...release });
  fx.register({ url: `${CODELOAD}/graveyard/relic/tar.gz/${SHA}`, body: makeTarGz(ENTRIES) });
}

function setup(pulls: Optional, release: Optional, ttlMs?: number) {
  const fx = createFixtureFetch();
  registerAll(fx, pulls, release);
  const clock = fixedClock(START);
  const deps: SummonerDeps = { fetch: fx.fetch, clock, env: { get: () => undefined } };
  const summoner = new GitHubSummoner(deps, ttlMs === undefined ? undefined : { cache: { ttlMs } });
  return { fx, clock, summoner };
}

const countOf = (fx: FixtureFetch, url: string) => fx.requests.filter((r) => r.url === url).length;

/** Builds, advances to `ageMs`, rebuilds, and reports whether the second call was a cache hit with no requests. */
async function rebuildAt(
  s: ReturnType<typeof setup>,
  ageMs: number,
): Promise<{ cache: "hit" | "miss"; newRequests: number }> {
  await s.summoner.buildDetailed(REF);
  const before = s.fx.requests.length;
  s.clock.advance(ageMs);
  const again = await s.summoner.buildDetailed(REF);
  return { cache: again.cache, newRequests: s.fx.requests.length - before };
}

describe("R8.11: a degraded result is cached for 10 minutes", () => {
  it("is a hit at 599,999 ms with zero new requests and the same neutral meta and degradedFields", async () => {
    expect(DEGRADED_TTL_MS).toBe(TEN_MIN);
    const s = setup(DOWN, OK_RELEASE);
    const first = await s.summoner.buildDetailed(REF);
    expect(first.extras.degradedFields).toEqual(["pulls"]);
    const count = s.fx.requests.length;
    s.clock.advance(TEN_MIN - 1);
    const hit = await s.summoner.buildDetailed(REF);
    expect(hit.cache).toBe("hit");
    expect(s.fx.requests).toHaveLength(count);
    expect(hit.snapshot.meta).toEqual(first.snapshot.meta);
    expect(hit.snapshot.meta.openPRCount).toBe(0);
    expect(hit.snapshot.meta.oldestOpenPRAgeDays).toBeNull();
    expect(hit.extras.degradedFields).toEqual(["pulls"]);
  });
});

describe("R8.12: the 10-minute boundary uses the strictly-less-than rule", () => {
  it("is a miss at exactly 600,000 ms with a full rebuild", async () => {
    const s = setup(DOWN, OK_RELEASE);
    await s.summoner.buildDetailed(REF);
    const before = s.fx.requests.length;
    s.clock.advance(TEN_MIN);
    const again = await s.summoner.buildDetailed(REF);
    expect(again.cache).toBe("miss");
    expect(s.fx.requests.length - before).toBe(before);
    expect(countOf(s.fx, `${CODELOAD}/graveyard/relic/tar.gz/${SHA}`)).toBe(2);
  });
});

describe("R8.13: after expiry the next summon retries pulls and release", () => {
  it("repeats both calls, clears degradedFields, replaces neutral meta, and earns the normal TTL", async () => {
    const s = setup(DOWN, DOWN);
    const first = await s.summoner.buildDetailed(REF);
    expect([...first.extras.degradedFields].sort()).toEqual(["pulls", "release"]);
    expect(first.snapshot.meta.latestReleaseAt).toBeNull();
    expect(countOf(s.fx, PULLS)).toBe(1);
    expect(countOf(s.fx, RELEASE)).toBe(1);

    registerAll(s.fx, OK_PULLS, OK_RELEASE); // upstream recovered
    s.clock.advance(TEN_MIN);
    const retried = await s.summoner.buildDetailed(REF);
    expect(retried.cache).toBe("miss");
    expect(countOf(s.fx, PULLS)).toBe(2);
    expect(countOf(s.fx, RELEASE)).toBe(2);
    expect(retried.extras.degradedFields).toEqual([]);
    expect(retried.snapshot.meta.oldestOpenPRAgeDays).not.toBeNull();
    expect(retried.snapshot.meta.latestReleaseAt).not.toBeNull();

    // The replacement entry now lives the full default TTL, counted from the retry.
    const count = s.fx.requests.length;
    s.clock.advance(DEFAULT_TTL_MS - 1);
    expect((await s.summoner.buildDetailed(REF)).cache).toBe("hit");
    expect(s.fx.requests).toHaveLength(count);
    s.clock.advance(1);
    expect((await s.summoner.buildDetailed(REF)).cache).toBe("miss");
  });
});

describe("R8.14: non-degraded results keep the configured TTL", () => {
  it("stays a hit at 10 min and at 7 days minus 1 ms, and misses at exactly 7 days", async () => {
    const atTen = await rebuildAt(setup(OK_PULLS, OK_RELEASE), TEN_MIN);
    expect(atTen).toEqual({ cache: "hit", newRequests: 0 });
    const justUnder = await rebuildAt(setup(OK_PULLS, OK_RELEASE), DEFAULT_TTL_MS - 1);
    expect(justUnder).toEqual({ cache: "hit", newRequests: 0 });
    const atTtl = await rebuildAt(setup(OK_PULLS, OK_RELEASE), DEFAULT_TTL_MS);
    expect(atTtl.cache).toBe("miss");
    expect(atTtl.newRequests).toBeGreaterThan(0);
  });

  it("an absent release (404) is not degraded and keeps the full TTL", async () => {
    const s = setup(OK_PULLS, { status: 404, json: { message: "Not Found" } });
    expect(await rebuildAt(s, TEN_MIN)).toEqual({ cache: "hit", newRequests: 0 });
  });
});

describe("R8.5, R8.11: the shorter of the configured and degraded TTL wins", () => {
  it("with a 5 min configured TTL both degraded and non-degraded results expire at 5 min", async () => {
    const FIVE = 5 * MIN;
    for (const [pulls, release] of [[DOWN, OK_RELEASE], [OK_PULLS, OK_RELEASE]] as const) {
      const under = await rebuildAt(setup(pulls, release, FIVE), FIVE - 1);
      expect(under).toEqual({ cache: "hit", newRequests: 0 });
      const at = await rebuildAt(setup(pulls, release, FIVE), FIVE);
      expect(at.cache).toBe("miss");
    }
  });

  it("with a 1 hour configured TTL a degraded result still expires at 10 min while a non-degraded one lives 1 hour", async () => {
    const HOUR = 60 * MIN;
    expect((await rebuildAt(setup(DOWN, OK_RELEASE, HOUR), TEN_MIN - 1)).cache).toBe("hit");
    expect((await rebuildAt(setup(DOWN, OK_RELEASE, HOUR), TEN_MIN)).cache).toBe("miss");
    expect((await rebuildAt(setup(OK_PULLS, OK_RELEASE, HOUR), HOUR - 1)).cache).toBe("hit");
    expect((await rebuildAt(setup(OK_PULLS, OK_RELEASE, HOUR), HOUR)).cache).toBe("miss");
  });
});

describe("R4.7, R4.9, R8.11: mixed degradation uses the 10-minute TTL", () => {
  it.each([
    ["release only", OK_PULLS, DOWN],
    ["pulls and release", DOWN, DOWN],
  ] as const)("%s: hit at 599,999 ms, miss at 600,000 ms", async (_label, pulls, release) => {
    const hit = await rebuildAt(setup(pulls, release), TEN_MIN - 1);
    expect(hit).toEqual({ cache: "hit", newRequests: 0 });
    const miss = await rebuildAt(setup(pulls, release), TEN_MIN);
    expect(miss.cache).toBe("miss");
    expect(miss.newRequests).toBeGreaterThan(0);
  });
});
