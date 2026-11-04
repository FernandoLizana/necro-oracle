// Task 27.1: example tests for GitHubSummoner.buildDetailed / build (design.md "Summoner and builder").
// Test-first: fails until src/snapshot.ts exists (task 27.6). Offline: FixtureFetch + FixedClock only.
// Requirements: R3.1, R3.7, R3.14, R4.6, R4.8, R8.1, R8.2, R8.3, R8.6, R8.10, R10.4.
//
// Assumed API (design.md; task 27.6 must match or update this header):
//
//   new GitHubSummoner(deps: SummonerDeps, opts?: SummonerOptions)      // opts.cache = { ttlMs?, maxEntries? }
//   .build(ref: RepoRef): Promise<RepoSnapshot>                          // = (await buildDetailed(ref)).snapshot
//   .buildDetailed(ref: RepoRef): Promise<SummonResult>
//   SummonResult = { snapshot: RepoSnapshot; extras: SummonExtras; cache: "hit" | "miss" }
//   SummonExtras = { stars; defaultBranch; hasWorkflowsDir; degradedFields: ("pulls" | "release")[] }
//
// Behaviour assumed:
//   - A standalone build issues REST call 1 `GET /repos/{owner}/{name}` itself (no commit call, the
//     ref carries the sha), then, in parallel, `pulls` (`?state=open&sort=created&direction=asc&per_page=1`),
//     `releases/latest`, and (no token) `GET https://codeload.github.com/{o}/{n}/tar.gz/{sha}`.
//     So `build` = 3 REST calls on api.github.com + 1 request on codeload.
//   - The ref is validated strictly (owner/name non-empty, sha = 40 lowercase hex, defaultBranch
//     non-empty) before any request; failure is SummonerError VALIDATION_FAILED.
//   - private: true raises REPO_PRIVATE after call 1 and before pulls/release/tarball are sent.
//   - Canonical owner/name from the repo payload (`owner.login`, `name`) are used for later URLs and
//     the cache key `canonOwner/canonName@sha`, and for `snapshot.ref`.
//   - One shared AbortController: a thrown failure in any parallel branch aborts the siblings (their
//     FetchRequest.signal becomes aborted); `degraded` / `absent` optional outcomes abort nothing.
//   - `createdAt` is the ISO string of the first (single) ClockPort reading of the build.
//   - Returned results are shallow copies; the cache stores only the first object.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GitHubSnapshotBuilder, RepoRef } from "@necro/oracle";
import { DEFAULT_TTL_MS } from "./constants.js";
import { SummonerError } from "./errors.js";
import type { ClockPort, SummonerDeps } from "./ports.js";
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

const fixtureJson = (name: string, file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name, file), "utf8"));

const REF: RepoRef = { owner: "graveyard", name: "relic", sha: SHA, defaultBranch: "main" };
const PREFIX = `graveyard-relic-${SHA}/`;

const DEFAULT_ENTRIES: RawTarEntry[] = [
  { name: PREFIX, typeflag: "5" },
  { name: `${PREFIX}README.md`, body: "# relic\n" },
  { name: `${PREFIX}src/main.py`, body: "print 'hi'\n" },
];

interface Setup {
  fx: FixtureFetch;
  deps: SummonerDeps;
  clock: ReturnType<typeof fixedClock>;
  summoner: GitHubSummoner;
}

function urls(owner = "graveyard", name = "relic") {
  const repo = `${API}/repos/${owner}/${name}`;
  return {
    repo,
    pulls: `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`,
    release: `${repo}/releases/latest`,
    tarball: `${CODELOAD}/${owner}/${name}/tar.gz/${SHA}`,
  };
}

function register(
  fx: FixtureFetch,
  over: {
    repo?: unknown;
    entries?: RawTarEntry[];
    pulls?: { status?: number; json?: unknown };
    release?: { status?: number; json?: unknown };
    tarballStatus?: number;
    owner?: string;
    name?: string;
  } = {},
): void {
  const u = urls(over.owner, over.name);
  fx.register({ url: u.repo, json: over.repo ?? fixtureJson("success", "repo.json") });
  fx.register({ url: u.pulls, ...(over.pulls ?? { json: fixtureJson("success", "pulls.json") }) });
  fx.register({ url: u.release, ...(over.release ?? { json: fixtureJson("success", "release.json") }) });
  fx.register({
    url: u.tarball,
    status: over.tarballStatus ?? 200,
    body: makeTarGz(over.entries ?? DEFAULT_ENTRIES),
  });
}

function setup(over: Parameters<typeof register>[1] = {}, opts?: { ttlMs?: number }, clock?: ClockPort): Setup {
  const fx = createFixtureFetch();
  register(fx, over);
  const fc = fixedClock(START);
  const deps: SummonerDeps = { fetch: fx.fetch, clock: clock ?? fc, env: { get: () => undefined } };
  const summoner = new GitHubSummoner(deps, opts?.ttlMs === undefined ? undefined : { cache: { ttlMs: opts.ttlMs } });
  return { fx, deps, clock: fc, summoner };
}

const apiCalls = (fx: FixtureFetch) => fx.requests.filter((r) => new URL(r.url).host === "api.github.com");
const hostCalls = (fx: FixtureFetch, host: string) => fx.requests.filter((r) => new URL(r.url).host === host);

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

describe("compile-time conformance (R10.4)", () => {
  it("GitHubSummoner is assignable to GitHubSnapshotBuilder", () => {
    const { summoner } = setup();
    const builder: GitHubSnapshotBuilder = summoner;
    expect(typeof builder.build).toBe("function");
  });
});

describe("ref validation (R3.1)", () => {
  it.each([
    ["short sha", { ...REF, sha: "abc123" }],
    ["uppercase sha", { ...REF, sha: SHA.toUpperCase() }],
    ["non-hex sha", { ...REF, sha: "z".repeat(40) }],
    ["empty owner", { ...REF, owner: "" }],
    ["empty name", { ...REF, name: "" }],
    ["empty defaultBranch", { ...REF, defaultBranch: "" }],
    ["extra property", { ...REF, extra: 1 }],
  ])("%s raises VALIDATION_FAILED before any request", async (_label, ref) => {
    const { fx, summoner } = setup();
    const err = await rejection(summoner.buildDetailed(ref as RepoRef));
    expect(err).toBeInstanceOf(SummonerError);
    expect((err as SummonerError).code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(0);
  });
});

describe("build path (R3.1, R4.6, R4.8)", () => {
  it("build is 3 REST calls plus one codeload download", async () => {
    const { fx, summoner } = setup();
    const snap = await summoner.build(REF);
    expect(apiCalls(fx)).toHaveLength(3);
    expect(hostCalls(fx, "codeload.github.com")).toHaveLength(1);
    expect(snap.ref.sha).toBe(SHA);
    expect(snap.contents.get("README.md")).toBe("# relic\n");
  });

  it("build returns the same snapshot as buildDetailed", async () => {
    const { summoner } = setup();
    const detailed = await summoner.buildDetailed(REF);
    expect(detailed.cache).toBe("miss");
    expect(detailed.extras.stars).toBe(42);
    expect(detailed.extras.defaultBranch).toBe("main");
    expect(detailed.extras.degradedFields).toEqual([]);
    expect(await summoner.build(REF)).toEqual(detailed.snapshot);
  });

  it("sends no Authorization to codeload and no token without GITHUB_TOKEN", async () => {
    const { fx, summoner } = setup();
    await summoner.build(REF);
    for (const r of fx.requests) {
      expect(Object.keys(r.headers).some((k) => k.toLowerCase() === "authorization")).toBe(false);
    }
  });

  it("derives hasWorkflowsDir from tarball entries with no extra request", async () => {
    const withWf = setup({
      entries: [...DEFAULT_ENTRIES, { name: `${PREFIX}.github/workflows/ci.yml`, body: "on: push\n" }],
    });
    expect((await withWf.summoner.buildDetailed(REF)).extras.hasWorkflowsDir).toBe(true);
    expect(withWf.fx.requests).toHaveLength(4);

    const without = setup();
    expect((await without.summoner.buildDetailed(REF)).extras.hasWorkflowsDir).toBe(false);
  });

  it("stores file contents byte-for-byte unaltered", async () => {
    const tricky = "line1\r\nline2  \r\n\ttabbed\u00e9\u4e2d\u6587 \u{1F480}\nghp_abcdefghijklmnopqrstuvwxyz0123456789\nno newline";
    const { summoner } = setup({ entries: [...DEFAULT_ENTRIES, { name: `${PREFIX}notes.txt`, body: tricky }] });
    const snap = await summoner.build(REF);
    expect(snap.contents.get("notes.txt")).toBe(tricky);
  });

  it("takes createdAt from a single ClockPort reading (R3.14)", async () => {
    const readings: number[] = [];
    let n = 0;
    const clock: ClockPort = {
      nowMs() {
        const v = START + n * 1000;
        n += 1;
        readings.push(v);
        return v;
      },
    };
    const { summoner } = setup({}, undefined, clock);
    const snap = await summoner.build(REF);
    expect(readings.length).toBeGreaterThan(0);
    // the build's createdAt is the first reading, never a later one
    expect(snap.createdAt).toBe(new Date(readings[0]!).toISOString());
  });

  it("uses a fixed clock reading for createdAt", async () => {
    const { summoner } = setup();
    expect((await summoner.build(REF)).createdAt).toBe(new Date(START).toISOString());
  });
});

describe("private repositories (R4.6)", () => {
  it("refuses private: true with REPO_PRIVATE before pulls, release or tarball are requested", async () => {
    const repo = { ...(fixtureJson("success", "repo.json") as object), private: true };
    const { fx, summoner } = setup({ repo });
    const err = await rejection(summoner.buildDetailed(REF));
    expect(err).toBeInstanceOf(SummonerError);
    expect((err as SummonerError).code).toBe("REPO_PRIVATE");
    expect(fx.requests).toHaveLength(1);
    expect(hostCalls(fx, "codeload.github.com")).toHaveLength(0);
  });
});

describe("canonical owner/name (R3.1)", () => {
  it("uses the canonical pair for later URLs, the cache key and snapshot.ref", async () => {
    const fx = createFixtureFetch();
    // The hand-built ref differs in case; the payload names the canonical pair.
    fx.register({ url: urls("Graveyard", "Relic").repo, json: fixtureJson("success", "repo.json") });
    const canon = urls();
    fx.register({ url: canon.pulls, json: fixtureJson("success", "pulls.json") });
    fx.register({ url: canon.release, json: fixtureJson("success", "release.json") });
    fx.register({ url: canon.tarball, body: makeTarGz(DEFAULT_ENTRIES) });
    const summoner = new GitHubSummoner({ fetch: fx.fetch, clock: fixedClock(START), env: { get: () => undefined } });

    const first = await summoner.buildDetailed({ ...REF, owner: "Graveyard", name: "Relic" });
    expect(first.snapshot.ref.owner).toBe("graveyard");
    expect(first.snapshot.ref.name).toBe("relic");
    const urlsSeen = fx.requests.map((r) => r.url);
    expect(urlsSeen).toContain(canon.pulls);
    expect(urlsSeen).toContain(canon.release);
    expect(urlsSeen).toContain(canon.tarball);

    // A later call with the canonical pair is served from the key canonOwner/canonName@sha.
    const before = fx.requests.length;
    const again = await summoner.buildDetailed(REF);
    expect(again.cache).toBe("hit");
    expect(fx.requests.length).toBe(before);
  });
});

describe("snapshot cache integration (R8.1, R8.2, R8.3, R8.6)", () => {
  it("a fresh hit makes zero network requests (R8.2)", async () => {
    const { fx, summoner, clock } = setup();
    await summoner.build(REF);
    const count = fx.requests.length;
    clock.advance(DEFAULT_TTL_MS - 1);
    const hit = await summoner.buildDetailed(REF);
    expect(hit.cache).toBe("hit");
    expect(fx.requests).toHaveLength(count);
  });

  it("an expired entry is rebuilt and replaced (R8.3)", async () => {
    const { fx, summoner, clock } = setup();
    const first = await summoner.buildDetailed(REF);
    const count = fx.requests.length;
    clock.advance(DEFAULT_TTL_MS);
    const second = await summoner.buildDetailed(REF);
    expect(second.cache).toBe("miss");
    expect(fx.requests.length).toBe(count + 4);
    expect(second.snapshot.createdAt).not.toBe(first.snapshot.createdAt);
    // The replacement is what the next hit returns.
    const third = await summoner.buildDetailed(REF);
    expect(third.cache).toBe("hit");
    expect(third.snapshot.createdAt).toBe(second.snapshot.createdAt);
  });

  it("deduplicates concurrent builds of the same key (R8.6)", async () => {
    const { fx, summoner } = setup();
    const [a, b, c] = await Promise.all([summoner.build(REF), summoner.build(REF), summoner.build(REF)]);
    expect(fx.requests).toHaveLength(4);
    expect(a.createdAt).toBe(b.createdAt);
    expect(b.createdAt).toBe(c.createdAt);
  });

  it("does not cache failures (R8.1)", async () => {
    const { fx, summoner } = setup({ tarballStatus: 500 });
    const err = await rejection(summoner.build(REF));
    expect(err).toBeInstanceOf(SummonerError);
    // The upstream recovers: the next call must rebuild rather than replay the failure.
    fx.register({ url: urls().tarball, body: makeTarGz(DEFAULT_ENTRIES) });
    const ok = await summoner.buildDetailed(REF);
    expect(ok.cache).toBe("miss");
    expect(ok.snapshot.contents.get("README.md")).toBe("# relic\n");
  });

  it("returns a shallow copy so mutating manifests does not change the next hit (R8.10)", async () => {
    const { summoner } = setup();
    const first = await summoner.buildDetailed(REF);
    const original = first.snapshot.manifests;
    const originalLength = original.length;
    (first.snapshot.manifests as unknown[]).push({ poisoned: true });
    first.snapshot.manifests = [];
    const next = await summoner.buildDetailed(REF);
    expect(next.cache).toBe("hit");
    expect(next.snapshot).not.toBe(first.snapshot);
    expect(next.snapshot.manifests.some((m) => (m as { poisoned?: boolean }).poisoned === true)).toBe(false);
    expect(next.snapshot.manifests.length).toBe(originalLength);
  });
});

describe("parallel branches and abort (R4.8)", () => {
  it("a failing tarball aborts the pulls and release requests", async () => {
    const { fx, summoner } = setup({ tarballStatus: 500 });
    const err = await rejection(summoner.build(REF));
    expect(err).toBeInstanceOf(SummonerError);
    const siblings = fx.requests.filter((r) => /\/(pulls|releases\/latest)/.test(r.url));
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((r) => r.signal?.aborted === true)).toBe(true);
  });

  it("a rate-limited pulls call aborts the tarball request", async () => {
    const { fx, summoner } = setup({
      pulls: { status: 429, json: { message: "rate limited" } },
    });
    const err = await rejection(summoner.build(REF));
    expect(err).toBeInstanceOf(SummonerError);
    expect((err as SummonerError).code).toBe("RATE_LIMITED");
    const tar = fx.requests.filter((r) => r.url.startsWith(CODELOAD));
    expect(tar.every((r) => r.signal?.aborted === true)).toBe(true);
  });

  it("a degraded pulls call aborts nothing and is listed in degradedFields", async () => {
    const { fx, summoner } = setup({ pulls: { status: 503, json: { message: "down" } } });
    const result = await summoner.buildDetailed(REF);
    expect(result.extras.degradedFields).toEqual(["pulls"]);
    expect(result.snapshot.meta.openPRCount).toBe(0);
    expect(fx.requests.every((r) => r.signal?.aborted !== true)).toBe(true);
    expect(result.snapshot.contents.get("README.md")).toBe("# relic\n");
  });

  it("an absent release (404) aborts nothing and is not listed as degraded", async () => {
    const { fx, summoner } = setup({ release: { status: 404, json: { message: "Not Found" } } });
    const result = await summoner.buildDetailed(REF);
    expect(result.extras.degradedFields).toEqual([]);
    expect(result.snapshot.meta.latestReleaseAt).toBeNull();
    expect(fx.requests.every((r) => r.signal?.aborted !== true)).toBe(true);
  });
});
