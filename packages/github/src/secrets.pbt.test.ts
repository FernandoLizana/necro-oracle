// Task 28.2: property P9 (secrets never leak; repository content is untouched).
// Test-first: fails until `GitHubSummoner.summon` / `createSummoner` exist in src/snapshot.ts (task 28.7).
// API assumed (design.md "Summoner and builder"; same constructor shape as src/snapshot.test.ts):
//   new GitHubSummoner(deps: SummonerDeps).summon(input: string | ParsedRepoRef): Promise<SummonResult>
// Offline: scripted FetchPort over FixtureFetch + FixedClock. Arbitraries are inline.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchTransportError, type FetchPort, type SummonerDeps } from "./ports.js";
import { GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PREFIX = `graveyard-relic-${SHA}/`;
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api/success");
const fixtureJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8"));

const REPO = `${API}/repos/graveyard/relic`;
const URL_REPO = REPO;
const URL_COMMIT = `${REPO}/commits/main`;
const URL_PULLS = `${REPO}/pulls?state=open&sort=created&direction=asc&per_page=1`;
const URL_RELEASE = `${REPO}/releases/latest`;
const URL_TARBALL = `${REPO}/tarball/${SHA}`;
const URL_CODELOAD = `${CODELOAD}/graveyard/relic/tar.gz/${SHA}`;

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const arbChars = (alphabet: string, len: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...alphabet.split("")), { minLength: len, maxLength: len }).map((a) => a.join(""));

/** Well-formed classic and fine-grained tokens, plus an opaque token with an unusual shape. */
const arbToken: fc.Arbitrary<string> = fc.oneof(
  arbChars(ALNUM, 36).map((s) => `ghp_${s}`),
  arbChars(`${ALNUM}_`, 40).map((s) => `github_pat_${s}`),
  arbChars(ALNUM, 24).map((s) => `tk${s}`),
);

interface Failure {
  readonly label: string;
  readonly url: string;
  /** HTTP status, or a transport kind. */
  readonly fault: number | "timeout" | "network";
}

const FAILURES: readonly Failure[] = [
  { label: "repo 401", url: URL_REPO, fault: 401 },
  { label: "repo 403 rate limit", url: URL_REPO, fault: 403 },
  { label: "repo 500", url: URL_REPO, fault: 500 },
  { label: "repo network", url: URL_REPO, fault: "network" },
  { label: "repo timeout", url: URL_REPO, fault: "timeout" },
  { label: "commit 404", url: URL_COMMIT, fault: 404 },
  { label: "commit 500", url: URL_COMMIT, fault: 500 },
  { label: "commit network", url: URL_COMMIT, fault: "network" },
  { label: "pulls 401", url: URL_PULLS, fault: 401 },
  { label: "release 403 rate limit", url: URL_RELEASE, fault: 403 },
  { label: "tarball 500", url: URL_TARBALL, fault: 500 },
  { label: "tarball timeout", url: URL_TARBALL, fault: "timeout" },
];
const arbFailure = fc.constantFrom(...FAILURES);

/** Secret-like text a repository file may contain; it is data and must survive unchanged. */
const SECRET_LIKE = [
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789",
  "Authorization: Bearer abc.DEF-123_xyz==",
  "AKIAIOSFODNN7EXAMPLE",
  "password = 'hunter2'",
  "[REDACTED]",
];
const arbContent: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      fc.string({ unit: "grapheme-ascii", maxLength: 24 }),
      fc.constantFrom(...SECRET_LIKE),
      fc.constantFrom("\r\n", "\n", "\t", "  ", " \u00e9\u4e2d "),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((parts) => parts.join(""));
const arbFiles = fc.array(arbContent, { minLength: 1, maxLength: 4 });

function entriesFor(files: readonly string[]): RawTarEntry[] {
  return [
    { name: PREFIX, typeflag: "5" },
    ...files.map((body, i): RawTarEntry => ({ name: `${PREFIX}src/f${i}.txt`, body })),
  ];
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        c.close();
      },
    }),
  };
}

function build(token: string, files: readonly string[], failure?: Failure) {
  const fx = createFixtureFetch();
  fx.register({ url: URL_REPO, json: fixtureJson("repo.json") });
  fx.register({ url: URL_COMMIT, json: fixtureJson("commit.json") });
  fx.register({ url: URL_PULLS, json: fixtureJson("pulls.json") });
  fx.register({ url: URL_RELEASE, json: fixtureJson("release.json") });
  fx.register({ url: URL_TARBALL, status: 302, redirectTo: URL_CODELOAD });
  fx.register({ url: URL_CODELOAD, body: makeTarGz(entriesFor(files)) });

  const fetch: FetchPort = (req) => {
    if (failure !== undefined && req.url === failure.url) {
      const echoed = `request failed Authorization: Bearer ${token} token=${token}`;
      if (typeof failure.fault === "string") {
        return Promise.reject(new FetchTransportError(failure.fault, echoed, new Error(echoed)));
      }
      const headers: Record<string, string> =
        failure.fault === 403 ? { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1706659200" } : {};
      return Promise.resolve(json({ message: echoed, authorization: `Bearer ${token}` }, failure.fault, headers));
    }
    return fx.fetch(req);
  };
  const deps: SummonerDeps = {
    fetch,
    clock: fixedClock(Date.parse("2024-01-31T00:00:00Z")),
    env: { get: () => token },
  };
  return { fx, summoner: new GitHubSummoner(deps) };
}

/** Every string reachable from a value: own props, nested objects, Maps, and the cause chain. */
function collectStrings(value: unknown, out: string[] = [], seen = new Set<unknown>(), depth = 0): string[] {
  if (typeof value === "string") out.push(value);
  else if (value !== null && typeof value === "object" && depth < 12 && !seen.has(value)) {
    seen.add(value);
    if (value instanceof Error) out.push(value.name, value.message, value.stack ?? "");
    if (value instanceof Map) {
      for (const [k, v] of value) collectStrings([k, v], out, seen, depth + 1);
    } else {
      for (const key of Object.getOwnPropertyNames(value)) {
        collectStrings((value as Record<string, unknown>)[key], out, seen, depth + 1);
      }
    }
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) collectStrings(cause, out, seen, depth + 1);
  }
  return out;
}

const NUM_RUNS = 100;

describe("P9 (R6.5, R8.10): secrets never leak; repository content is untouched", () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  let logged: string[] = [];

  beforeEach(() => {
    logged = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          logged.push(args.map((a) => collectStrings(a).join(" ")).join(" "));
        }),
      );
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("no error field, cause chain, or log line contains the token or an Authorization value", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbFailure, arbFiles, async (token, failure, files) => {
        logged.length = 0;
        const { summoner } = build(token, files, failure);
        let settled: unknown;
        let threw = false;
        try {
          settled = await summoner.summon("graveyard/relic");
        } catch (e) {
          threw = true;
          settled = e;
        }
        // Optional-call faults may degrade instead of raising; either way nothing may leak.
        const texts = [...collectStrings(settled), ...logged];
        if (threw) {
          expect(settled).toBeInstanceOf(Error);
          const err = settled as { userMessage?: unknown; details?: unknown };
          texts.push(String(err.userMessage ?? ""), JSON.stringify(err.details ?? {}));
        }
        for (const t of texts) {
          expect(t).not.toContain(token);
          expect(t).not.toMatch(/Bearer\s+\S{6,}/);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("successful summon: result, repeat (cache) result, and logs carry no token; file content is byte-identical", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbFiles, async (token, files) => {
        logged.length = 0;
        const { fx, summoner } = build(token, files);
        const first = await summoner.summon("graveyard/relic");
        const second = await summoner.summon("graveyard/relic"); // served from the cache entry
        expect(second.cache).toBe("hit");

        for (const result of [first, second]) {
          files.forEach((body, i) => expect(result.snapshot.contents.get(`src/f${i}.txt`)).toBe(body));
          for (const t of collectStrings(result)) {
            // Repo content may legitimately look secret-like, but never equals the live token.
            expect(t).not.toContain(token);
          }
        }
        for (const line of logged) expect(line).not.toContain(token);
        expect(first.snapshot.contents).toEqual(second.snapshot.contents);
        // The token reaches only the allowed hosts, via the Authorization header and nowhere else.
        for (const r of fx.requests) {
          expect(r.url).not.toContain(token);
          expect(r.body ?? "").not.toContain(token);
          if (new URL(r.url).host === "codeload.github.com") {
            expect(Object.keys(r.headers).some((k) => k.toLowerCase() === "authorization")).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("repository files that look like secrets are neither masked nor altered", async () => {
    const token = `ghp_${"A".repeat(36)}`;
    const files = SECRET_LIKE.map((s) => `x ${s}\r\n y `);
    const { summoner } = build(token, files);
    const res = await summoner.summon("graveyard/relic");
    files.forEach((body, i) => expect(res.snapshot.contents.get(`src/f${i}.txt`)).toBe(body));
  });
});
