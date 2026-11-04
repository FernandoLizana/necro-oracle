// Task 28.5: property test P16 (error-code mapping for ref, auth, and upstream failures).
// Task 28.6 appends P17 to this file.
// Test-first: fails until `summon` exists in src/snapshot.ts (task 28.7).
// API as documented in the headers of src/summon.test.ts (summon, FixtureFetch, FixedClock)
// and src/external-data.test.ts (fetchExternalData, registry/OSV skips).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SummonerError } from "./errors.js";
import { fetchExternalData } from "./external-data.js";
import type { SummonerDeps } from "./ports.js";
import { GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch, type FixtureFetch, type FixtureSpec } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const START = Date.parse("2024-01-31T00:00:00Z");
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api");
const OWNER = "graveyard";
const NAME = "relic";

const fixtureJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, "success", file), "utf8"));

const tarEntries = (): RawTarEntry[] => {
  const prefix = `${OWNER}-${NAME}-${SHA}/`;
  return [
    { name: prefix, typeflag: "5" },
    { name: `${prefix}README.md`, body: "# relic\n" },
  ];
};

type Endpoint = "repo" | "commit" | "pulls" | "release" | "tarball";

function urlOf(endpoint: Endpoint, ref: string): string {
  const repo = `${API}/repos/${OWNER}/${NAME}`;
  switch (endpoint) {
    case "repo":
      return repo;
    case "commit":
      return `${repo}/commits/${ref}`;
    case "pulls":
      return `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`;
    case "release":
      return `${repo}/releases/latest`;
    case "tarball":
      return `${CODELOAD}/${OWNER}/${NAME}/tar.gz/${SHA}`;
  }
}

/** Registers a healthy repository, then replaces one endpoint with the scripted failure. */
function scenario(ref: string, failing: Endpoint, failure: Omit<FixtureSpec, "url">, token?: string) {
  const fx: FixtureFetch = createFixtureFetch();
  fx.register({ url: urlOf("repo", ref), json: fixtureJson("repo.json") });
  fx.register({ url: urlOf("commit", ref), json: fixtureJson("commit.json") });
  fx.register({ url: urlOf("pulls", ref), json: fixtureJson("pulls.json") });
  fx.register({ url: urlOf("release", ref), json: fixtureJson("release.json") });
  fx.register({ url: urlOf("tarball", ref), body: makeTarGz(tarEntries()) });
  fx.register({ url: urlOf(failing, ref), ...failure });
  const deps: SummonerDeps = { fetch: fx.fetch, clock: fixedClock(START), env: { get: () => token } };
  return { fx, summoner: new GitHubSummoner(deps) };
}

async function rejection(p: Promise<unknown>): Promise<SummonerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  throw new Error("expected rejection");
}

// ---- arbitraries (inline) ----

/** Simple branch-like refs: never 40-hex, no slashes or special characters. */
const arbRef: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.stringMatching(/^[a-z0-9]{0,8}$/),
  )
  .map(([h, t]) => `${h}${t}`);

const arbRefMissingStatus = fc.constantFrom(404, 422);
const arbServerStatus = fc.integer({ min: 500, max: 599 });
const arbTransportKind = fc.constantFrom<"timeout" | "network">("timeout", "network");
const arbRestEndpoint = fc.constantFrom<Endpoint>("repo", "commit", "pulls", "release");
const arbFatalEndpoint = fc.constantFrom<Endpoint>("repo", "commit", "tarball");

const arbPkgNames: fc.Arbitrary<string[]> = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/), {
  minLength: 1,
  maxLength: 6,
});

const manifestOf = (names: readonly string[], pinned: boolean): Manifest => ({
  path: "requirements.txt",
  kind: "requirements_txt",
  parsed: true,
  dependencies: names.map((name) => ({ name, versionSpec: pinned ? "==1.0.0" : "", extras: [] })),
});

describe("P16 (R2.11, R5.5, R7.6, R7.7, R7.8, R7.9): error-code mapping for ref, auth, and upstream failures", () => {
  // Feature: 02-github-summoner, Property 16: Error-code mapping for ref, auth, and upstream failures
  // **Validates: Requirements R2.11, R5.5, R7.6, R7.7, R7.8, R7.9**
  it("a nonexistent ref in an existing repository yields REF_NOT_FOUND, never INVALID_REPO_URL", async () => {
    await fc.assert(
      fc.asyncProperty(arbRef, arbRefMissingStatus, async (ref, status) => {
        const { summoner } = scenario(ref, "commit", { status, json: { message: "No commit found" } });
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}#${ref}`));
        expect(err.code).toBe("REF_NOT_FOUND");
        expect(err.code).not.toBe("INVALID_REPO_URL");
        expect(err.userMessage).toContain(ref);
      }),
      { numRuns: 100 },
    );
  });

  it("a 401 on any REST call yields AUTH_INVALID", async () => {
    await fc.assert(
      fc.asyncProperty(arbRestEndpoint, async (endpoint) => {
        const { summoner } = scenario("main", endpoint, { status: 401, json: { message: "Bad credentials" } });
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}`));
        expect(err.code).toBe("AUTH_INVALID");
      }),
      { numRuns: 100 },
    );
  });

  it("a 5xx on the repo, commit, or tarball request yields UPSTREAM_UNAVAILABLE", async () => {
    await fc.assert(
      fc.asyncProperty(arbFatalEndpoint, arbServerStatus, async (endpoint, status) => {
        const { summoner } = scenario("main", endpoint, { status, json: {} });
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}`));
        expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
      }),
      { numRuns: 100 },
    );
  });

  it("a timeout or network error on the repo, commit, or tarball request yields NETWORK_TIMEOUT", async () => {
    await fc.assert(
      fc.asyncProperty(arbFatalEndpoint, arbTransportKind, async (endpoint, kind) => {
        const { summoner } = scenario("main", endpoint, { transportError: kind });
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}`));
        expect(err.code).toBe("NETWORK_TIMEOUT");
      }),
      { numRuns: 100 },
    );
  });

  it("a registry 5xx yields no NecroError and is recorded in skipped", async () => {
    await fc.assert(
      fc.asyncProperty(arbPkgNames, arbServerStatus, async (names, status) => {
        const fx = createFixtureFetch();
        for (const n of names) fx.register({ url: `https://pypi.org/pypi/${n}/json`, status, json: {} });
        const out = await fetchExternalData([manifestOf(names, false)], {
          fetch: fx.fetch,
          clock: fixedClock(START),
        });
        const skipped = out.skipped.filter((s) => s.source === "registry");
        expect(skipped.map((s) => s.name).sort()).toEqual([...names].sort());
        for (const s of skipped) {
          expect(s.ecosystem).toBe("pypi");
          expect(s.reason).toBe("http-error");
        }
        expect(out.registryData.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("an OSV 5xx yields no NecroError and is recorded in skipped", async () => {
    await fc.assert(
      fc.asyncProperty(arbPkgNames, arbServerStatus, async (names, status) => {
        const fx = createFixtureFetch();
        for (const n of names) {
          fx.register({
            url: `https://pypi.org/pypi/${n}/json`,
            json: {
              info: { name: n, version: "1.0.0", classifiers: [] },
              urls: [{ upload_time_iso_8601: "2020-01-01T00:00:00.000000Z" }],
            },
          });
        }
        fx.register({ method: "POST", url: "https://api.osv.dev/v1/querybatch", status, json: {} });
        const out = await fetchExternalData([manifestOf(names, true)], { fetch: fx.fetch, clock: fixedClock(START) });
        const osvSkips = out.skipped.filter((s) => s.source === "osv");
        expect(osvSkips.length).toBeGreaterThan(0);
        expect(out.osvData).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

// ---- P17 arbitraries (inline) ----

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split("");
const arbTokenBody = fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength: 24, maxLength: 60 });

/** Well-formed tokens (GitHub-style prefixes or bare) plus malformed ones (inner whitespace or control chars). */
const arbToken: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom("ghp_", "gho_", "ghs_", "github_pat_", ""), arbTokenBody).map(([p, b]) => `${p}${b}`),
  fc
    .tuple(arbTokenBody, fc.constantFrom(" ", "\t", "\n", "\x00"), arbTokenBody)
    .map(([a, sep, b]) => `${a}${sep}${b}`),
);

const MIN_LEAK_WINDOW = 8;

/** Serializes every NecroError field, including the cause chain. */
function everyField(err: SummonerError): string {
  const parts: string[] = [err.code, err.userMessage, err.message, err.name, err.stack ?? "", JSON.stringify(err.details)];
  let cause: unknown = (err as { cause?: unknown }).cause;
  for (let depth = 0; cause !== undefined && depth < 5; depth++) {
    if (cause instanceof Error) {
      parts.push(cause.name, cause.message, cause.stack ?? "", JSON.stringify(Object.entries(cause)));
      cause = (cause as { cause?: unknown }).cause;
    } else {
      parts.push(String(cause));
      break;
    }
  }
  return parts.join("\n");
}

function leaks(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  for (let i = 0; i + MIN_LEAK_WINDOW <= token.length; i++) {
    const w = token.slice(i, i + MIN_LEAK_WINDOW);
    if (w.trim().length === MIN_LEAK_WINDOW && haystack.includes(w)) return true;
  }
  return false;
}

describe("P17 (R6.5, R7.8): AUTH_INVALID never leaks the token", () => {
  // Feature: 02-github-summoner, Property 17: AUTH_INVALID never leaks the token
  // **Validates: Requirements R6.5, R7.8**
  it("a 401 on any REST call raises AUTH_INVALID with no token text in any error field", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbRestEndpoint, async (token, endpoint) => {
        const { summoner } = scenario(
          "main",
          endpoint,
          // The upstream body echoes the token, as a hostile or sloppy server might.
          { status: 401, json: { message: `Bad credentials for ${token}` } },
          token,
        );
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}`));
        expect(err.code).toBe("AUTH_INVALID");
        expect(err.userMessage).toContain("GITHUB_TOKEN");
        expect(leaks(everyField(err), token)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("a 401 on the tarball download raises AUTH_INVALID with no token text in any error field", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, async (token) => {
        const { fx, summoner } = scenario("main", "tarball", { status: 401, json: { message: token } }, token);
        // With a token the archive is requested from api.github.com first (design "GitHub client").
        fx.register({ url: `${API}/repos/${OWNER}/${NAME}/tarball/${SHA}`, status: 401, json: { message: token } });
        const err = await rejection(summoner.summon(`${OWNER}/${NAME}`));
        expect(err.code).toBe("AUTH_INVALID");
        expect(leaks(everyField(err), token)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
