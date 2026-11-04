// Task 28.1: example tests for GitHubSummoner.summon / createSummoner (design.md "Summon sequence",
// "Summoner and builder", "Budget accounting"). Offline: FixtureFetch + FixedClock only.
// Test-first: fails until `summon` and `createSummoner` exist in src/snapshot.ts (task 28.7).
// Requirements: R2.7, R2.10, R4.8, R8.2, R10.4, R10.6.
//
// Assumed API (design.md; task 28.7 must match or update this header). Constructor, `build`,
// `buildDetailed`, `SummonResult` and `SummonExtras` are exactly as in the header of src/snapshot.test.ts.
//
//   summoner.summon(input: string | ParsedRepoRef): Promise<SummonResult>
//     = parseRepoRef (strings only; a ParsedRepoRef object is validated with ParsedRepoRefSchema)
//       -> resolveRefDetailed (REST calls 1 and 2) -> cache lookup on `canonOwner/canonName@sha`
//       -> on a miss, build REUSING the call-1 repo payload (no second GET /repos/{o}/{n}):
//          calls 3 (pulls) and 4 (releases/latest) plus the codeload tarball.
//     REST calls on api.github.com (no token): 4 on a miss, 5 when call 1 follows ONE rename
//     redirect (301 -> https://api.github.com/repositories/{id}), 2 on a cache hit.
//     result.cache is "hit" | "miss".
//   createSummoner(deps, opts?) returns `new GitHubSummoner(deps, opts)`; opts are passed through
//     (opts.cache.ttlMs is honoured).
//   Errors are SummonerError instances (code on `.code`):
//     unparsable string          -> INVALID_REPO_URL, zero requests
//     call 1 404 (with token)    -> REPO_NOT_FOUND; without a token -> REPO_PRIVATE (R7.3)
//     call 1 private: true       -> REPO_PRIVATE, no commit/pulls/release/tarball request
//     call 2 404                 -> REF_NOT_FOUND
//   Shallow copies: summon returns a fresh top-level snapshot each time, so assigning
//     `snapshot.manifests` (as runReading does) never reaches the cache.
//   fetchExternalData(summoned.snapshot, { fetch, clock }) is consumable as-is.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TTL_MS } from "./constants.js";
import { SummonerError } from "./errors.js";
import { fetchExternalData } from "./external-data.js";
import { parseRepoRef } from "./intake.js";
import type { SummonerDeps } from "./ports.js";
import { createSummoner, GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch, type FixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const START = Date.parse("2024-01-31T00:00:00Z");
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api");

const fixtureJson = (name: string, file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name, file), "utf8"));

const entriesFor = (owner: string, name: string): RawTarEntry[] => {
  const prefix = `${owner}-${name}-${SHA}/`;
  return [
    { name: prefix, typeflag: "5" },
    { name: `${prefix}README.md`, body: "# relic\n" },
    { name: `${prefix}requirements.txt`, body: "flask\n" },
  ];
};

function urls(owner = "graveyard", name = "relic") {
  const repo = `${API}/repos/${owner}/${name}`;
  return {
    repo,
    commit: (ref: string) => `${repo}/commits/${ref}`,
    pulls: `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`,
    release: `${repo}/releases/latest`,
    tarball: `${CODELOAD}/${owner}/${name}/tar.gz/${SHA}`,
  };
}

/** Registers the fixture set for one (canonical) repository. */
function registerRepo(
  fx: FixtureFetch,
  fixture: string,
  owner: string,
  name: string,
  opts: { repoUrl?: string; ref?: string } = {},
): void {
  const u = urls(owner, name);
  fx.register({ url: opts.repoUrl ?? u.repo, json: fixtureJson(fixture, "repo.json") });
  fx.register({ url: u.commit(opts.ref ?? "main"), json: fixtureJson(fixture, "commit.json") });
  fx.register({ url: u.pulls, json: fixtureJson(fixture, "pulls.json") });
  fx.register({ url: u.release, json: fixtureJson(fixture, "release.json") });
  fx.register({ url: u.tarball, body: makeTarGz(entriesFor(owner, name)) });
}

function setup(opts: { ttlMs?: number } = {}) {
  const fx = createFixtureFetch();
  registerRepo(fx, "success", "graveyard", "relic");
  const clock = fixedClock(START);
  const deps: SummonerDeps = { fetch: fx.fetch, clock, env: { get: () => undefined } };
  const summoner = new GitHubSummoner(deps, opts.ttlMs === undefined ? undefined : { cache: { ttlMs: opts.ttlMs } });
  return { fx, clock, deps, summoner };
}

const apiCalls = (fx: FixtureFetch) => fx.requests.filter((r) => new URL(r.url).host === "api.github.com");
const countUrl = (fx: FixtureFetch, url: string) => fx.requests.filter((r) => r.url === url).length;

async function rejection(p: Promise<unknown>): Promise<SummonerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  throw new Error("expected rejection");
}

describe("summon: REST call budget (R2.7, R4.8)", () => {
  it("a miss costs 4 REST calls plus one codeload download", async () => {
    const { fx, summoner } = setup();
    const result = await summoner.summon("graveyard/relic");
    expect(result.cache).toBe("miss");
    expect(apiCalls(fx)).toHaveLength(4);
    expect(fx.requests.filter((r) => new URL(r.url).host === "codeload.github.com")).toHaveLength(1);
    expect(result.snapshot.ref).toEqual({ owner: "graveyard", name: "relic", sha: SHA, defaultBranch: "main" });
    expect(result.snapshot.contents.get("README.md")).toBe("# relic\n");
  });

  it("reuses the call-1 repo payload: GET /repos/{o}/{n} is sent exactly once", async () => {
    const { fx, summoner } = setup();
    await summoner.summon("graveyard/relic");
    expect(countUrl(fx, urls().repo)).toBe(1);
    expect(result_extras_stars(await summoner.summon("graveyard/relic"))).toBe(42);
  });

  it("a cache hit inside summon costs only REST calls 1 and 2 (R8.2)", async () => {
    const { fx, summoner, clock } = setup();
    const first = await summoner.summon("graveyard/relic");
    const before = fx.requests.length;
    clock.advance(DEFAULT_TTL_MS - 1);
    const second = await summoner.summon("graveyard/relic");
    expect(second.cache).toBe("hit");
    expect(second.snapshot.createdAt).toBe(first.snapshot.createdAt);
    const added = fx.requests.slice(before);
    expect(added.map((r) => r.url)).toEqual([urls().repo, urls().commit("main")]);
  });

  it("a rename redirect on call 1 makes 5 REST calls and uses the canonical pair afterwards (R2.10)", async () => {
    const fx = createFixtureFetch();
    const target = `${API}/repositories/1296269`;
    // Old name redirects once; the followed hop serves the canonical body (relic-renamed).
    fx.register({ url: urls("graveyard", "relic").repo, redirectTo: target, status: 301 });
    registerRepo(fx, "rename-redirect", "graveyard", "relic-renamed", { repoUrl: target });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });

    const result = await summoner.summon("graveyard/relic");
    expect(apiCalls(fx)).toHaveLength(5);
    expect(result.snapshot.ref.name).toBe("relic-renamed");
    expect(result.snapshot.ref.owner).toBe("graveyard");
    const seen = fx.requests.map((r) => r.url);
    expect(seen).toContain(urls("graveyard", "relic-renamed").commit("main"));
    expect(seen).toContain(urls("graveyard", "relic-renamed").tarball);
    expect(seen).not.toContain(urls("graveyard", "relic").commit("main"));
  });

  it("a rename-redirected summon that hits the cache costs calls 1, hop and 2 only", async () => {
    const fx = createFixtureFetch();
    const target = `${API}/repositories/1296269`;
    fx.register({ url: urls("graveyard", "relic").repo, redirectTo: target, status: 301 });
    registerRepo(fx, "rename-redirect", "graveyard", "relic-renamed", { repoUrl: target });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
    await summoner.summon("graveyard/relic");
    const before = fx.requests.length;
    const hit = await summoner.summon("graveyard/relic");
    expect(hit.cache).toBe("hit");
    expect(fx.requests.length - before).toBe(3);
  });
});

function result_extras_stars(r: { extras: { stars: number } }): number {
  return r.extras.stars;
}

describe("summon: input forms and refs", () => {
  it("accepts a ParsedRepoRef object as well as a string", async () => {
    const a = setup();
    const b = setup();
    const fromString = await a.summoner.summon("graveyard/relic");
    const fromParsed = await b.summoner.summon(parseRepoRef("graveyard/relic"));
    expect(fromParsed.snapshot).toEqual(fromString.snapshot);
    expect(fromParsed.extras).toEqual(fromString.extras);
  });

  it("an explicit ref in the string is resolved through commits/{ref}", async () => {
    const fx = createFixtureFetch();
    registerRepo(fx, "success", "graveyard", "relic", { ref: "v1.0" });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
    const result = await summoner.summon("graveyard/relic#v1.0");
    expect(fx.requests.map((r) => r.url)).toContain(urls().commit("v1.0"));
    // defaultBranch always comes from the repo payload, not from the requested ref (R2.4)
    expect(result.snapshot.ref.defaultBranch).toBe("main");
    expect(result.snapshot.ref.sha).toBe(SHA);
  });

  it("shares the cache with build(ref): summon after build of the resolved ref is a hit", async () => {
    const { fx, summoner } = setup();
    await summoner.build({ owner: "graveyard", name: "relic", sha: SHA, defaultBranch: "main" });
    const before = fx.requests.length;
    const hit = await summoner.summon("graveyard/relic");
    expect(hit.cache).toBe("hit");
    expect(fx.requests.length - before).toBe(2);
  });
});

describe("summon: error mapping (R2.11, R7)", () => {
  it("INVALID_REPO_URL for an unparsable string, before any request", async () => {
    const { fx, summoner } = setup();
    const err = await rejection(summoner.summon("https://gitlab.com/o/r"));
    expect(err.code).toBe("INVALID_REPO_URL");
    expect(fx.requests).toHaveLength(0);
  });

  it("REPO_NOT_FOUND when call 1 is a 404", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: urls().repo, status: 404, json: { message: "Not Found" } });
    // R7.3: only an AUTHENTICATED 404 proves absence; unauthenticated 404 is REPO_PRIVATE.
    const token = `ghp_${"A".repeat(36)}`;
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => token } });
    expect((await rejection(summoner.summon("graveyard/relic"))).code).toBe("REPO_NOT_FOUND");
    expect(fx.requests).toHaveLength(1);
  });

  it("REPO_PRIVATE when an unauthenticated call 1 is a 404 (absence cannot be proven)", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: urls().repo, status: 404, json: { message: "Not Found" } });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
    expect((await rejection(summoner.summon("graveyard/relic"))).code).toBe("REPO_PRIVATE");
    expect(fx.requests).toHaveLength(1);
  });

  it("REPO_PRIVATE for private: true, with no commit, pulls, release or tarball request", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: urls().repo, json: { ...(fixtureJson("success", "repo.json") as object), private: true } });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
    expect((await rejection(summoner.summon("graveyard/relic"))).code).toBe("REPO_PRIVATE");
    expect(fx.requests).toHaveLength(1);
  });

  it("REF_NOT_FOUND when call 2 is a 404, and nothing is downloaded", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: urls().repo, json: fixtureJson("success", "repo.json") });
    fx.register({ url: urls().commit("nope"), status: 404, json: { message: "Not Found" } });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });
    expect((await rejection(summoner.summon("graveyard/relic#nope"))).code).toBe("REF_NOT_FOUND");
    expect(fx.requests).toHaveLength(2);
  });
});

describe("createSummoner wiring (R10.4)", () => {
  it("returns a GitHubSummoner built from deps", async () => {
    const { deps } = setup();
    const summoner = createSummoner(deps);
    expect(summoner).toBeInstanceOf(GitHubSummoner);
    expect((await summoner.summon("graveyard/relic")).snapshot.ref.sha).toBe(SHA);
  });

  it("passes options through: a short cache TTL expires the entry", async () => {
    const { deps, clock, fx } = setup();
    const summoner = createSummoner(deps, { cache: { ttlMs: 1000 } });
    await summoner.summon("graveyard/relic");
    clock.advance(999);
    expect((await summoner.summon("graveyard/relic")).cache).toBe("hit");
    clock.advance(1);
    const before = fx.requests.length;
    expect((await summoner.summon("graveyard/relic")).cache).toBe("miss");
    expect(fx.requests.length - before).toBe(5); // 4 REST calls + 1 codeload download
  });

  it("two summoners do not share a cache", async () => {
    const { deps, fx } = setup();
    await createSummoner(deps).summon("graveyard/relic");
    const before = fx.requests.length;
    expect((await createSummoner(deps).summon("graveyard/relic")).cache).toBe("miss");
    expect(fx.requests.length - before).toBe(5); // 4 REST calls + 1 codeload download
  });
});

describe("downstream consumers (R8.10, R10.6)", () => {
  it("assigning snapshot.manifests, as runReading does, does not leak into the cache", async () => {
    const { summoner } = setup();
    const first = await summoner.summon("graveyard/relic");
    const originalLength = first.snapshot.manifests.length;
    first.snapshot.manifests = [];
    (first.snapshot as { manifests: unknown[] }).manifests.push({ poisoned: true });

    const second = await summoner.summon("graveyard/relic");
    expect(second.cache).toBe("hit");
    expect(second.snapshot).not.toBe(first.snapshot);
    expect(second.snapshot.manifests).toHaveLength(originalLength);
    expect(second.snapshot.manifests.some((m) => (m as { poisoned?: boolean }).poisoned === true)).toBe(false);
  });

  it("fetchExternalData consumes the summoned snapshot", async () => {
    const { summoner, deps, clock } = setup();
    const { snapshot } = await summoner.summon("graveyard/relic");
    const ext = createFixtureFetch();
    ext.register({
      url: "https://pypi.org/pypi/flask/json",
      json: {
        info: { name: "Flask", version: "3.0.0", classifiers: [] },
        urls: [{ upload_time_iso_8601: "2023-09-30T00:00:00.000000Z" }],
      },
    });
    const out = await fetchExternalData(snapshot, { fetch: ext.fetch, clock });
    expect(out.registryData.get("flask")?.name).toBe("Flask");
    // requirements.txt has an unpinned "flask": registry is queried, OSV is skipped (no version).
    expect(out.skipped).toEqual([{ ecosystem: "pypi", name: "flask", reason: "version-not-pinned", source: "osv" }]);
    // the GitHub-side fetch port is untouched by external-data calls
    expect(deps.fetch).toBeDefined();
  });
});
