// Property tests for resolveRef (tasks 19.2, 19.3). Test-first: fails until task 19.4.
// Assumed API (see header of intake.test.ts / design.md):
//   resolveRef(parsed: ParsedRepoRef, deps: { client: GitHubClient }): Promise<RepoRef>
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SummonerError } from "./errors.js";
import { GitHubClient } from "./github-client.js";
import { resolveRef, type ParsedRepoRef } from "./intake.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";

const API = "https://api.github.com";

const nameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("");
const arbIdent = fc
  .array(fc.constantFrom(...nameChars), { minLength: 1, maxLength: 12 })
  .map((cs) => cs.join(""));
const arbSegment = fc
  .array(fc.constantFrom(...nameChars, "."), { minLength: 1, maxLength: 10 })
  .map((cs) => cs.join(""))
  .filter((s) => s !== "." && s !== ".." && !s.endsWith(".") && !s.startsWith("."));
const arbBranchLike = fc.array(arbSegment, { minLength: 1, maxLength: 3 }).map((s) => s.join("/"));
const arbHex = (min: number, max: number) =>
  fc
    .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: min, maxLength: max })
    .map((cs) => cs.join(""));
const arbSha = arbHex(40, 40);

type RefForm = "none" | "branch" | "full-sha" | "partial-sha";
const arbScenario = fc
  .record({
    owner: arbIdent,
    name: arbIdent,
    defaultBranch: arbBranchLike,
    form: fc.constantFrom<RefForm>("none", "branch", "full-sha", "partial-sha"),
    branch: arbBranchLike,
    sha: arbSha,
    partialLen: fc.integer({ min: 7, max: 39 }),
    swapCase: fc.boolean(),
  })
  .map((s) => {
    const requested =
      s.form === "none"
        ? null
        : s.form === "branch"
          ? s.branch
          : s.form === "full-sha"
            ? s.sha
            : s.sha.slice(0, s.partialLen);
    return { ...s, requested };
  });

function repoPayload(owner: string, name: string, defaultBranch: string): Record<string, unknown> {
  return {
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    default_branch: defaultBranch,
    private: false,
    archived: false,
    pushed_at: "2024-01-02T03:04:05Z",
    stargazers_count: 1,
    open_issues_count: 0,
    license: null,
  };
}

const encodeRef = (ref: string): string => ref.split("/").map(encodeURIComponent).join("/");

function setup() {
  const fx = createFixtureFetch();
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => undefined },
  });
  return { fx, deps: { client } };
}

// Feature: 02-github-summoner, Property 19: Resolved references are fully populated and immutable
// Validates: Requirements R2.1, R2.2, R2.3, R2.4, R10.3
describe("P19 (R2.1, R2.2, R2.3, R2.4, R10.3): resolved references are fully populated and immutable", () => {
  it("returns non-empty canonical owner/name, 40-hex sha and defaultBranch from the repo payload", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, arbSha, async (s, commitSha) => {
        const { fx, deps } = setup();
        // Full SHA requests must be answered with the same sha; others with any 40-hex sha.
        const sha = s.form === "full-sha" ? s.sha : s.form === "partial-sha" ? s.sha : commitSha;
        const typedOwner = s.swapCase ? s.owner.toUpperCase() : s.owner;
        const typedName = s.swapCase ? s.name.toLowerCase() : s.name;
        fx.register({
          url: `${API}/repos/${typedOwner}/${typedName}`,
          json: repoPayload(s.owner, s.name, s.defaultBranch),
        });
        const target = s.requested ?? s.defaultBranch;
        fx.register({
          url: `${API}/repos/${s.owner}/${s.name}/commits/${encodeRef(target)}`,
          json: { sha },
        });
        const parsed: ParsedRepoRef = { host: "github.com", owner: typedOwner, name: typedName, ref: s.requested };

        const ref = await resolveRef(parsed, deps);

        expect(ref.owner).toBe(s.owner);
        expect(ref.name).toBe(s.name);
        expect(ref.owner.length).toBeGreaterThan(0);
        expect(ref.name.length).toBeGreaterThan(0);
        expect(ref.defaultBranch).toBe(s.defaultBranch);
        expect(ref.defaultBranch.length).toBeGreaterThan(0);
        expect(ref.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(ref.sha).toBe(sha);
        expect(fx.requests).toHaveLength(2);
      }),
      { numRuns: 200 },
    );
  });

  it("a full 40-hex ref resolves only if the commit payload sha equals it", async () => {
    await fc.assert(
      fc.asyncProperty(arbIdent, arbIdent, arbBranchLike, arbSha, arbSha, async (owner, name, branch, requested, returned) => {
        fc.pre(requested !== returned);
        const { fx, deps } = setup();
        fx.register({ url: `${API}/repos/${owner}/${name}`, json: repoPayload(owner, name, branch) });
        fx.register({ url: `${API}/repos/${owner}/${name}/commits/${requested}`, json: { sha: returned } });
        const parsed: ParsedRepoRef = { host: "github.com", owner, name, ref: requested };

        let caught: unknown;
        try {
          await resolveRef(parsed, deps);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(SummonerError);
        expect((caught as SummonerError).code).toBe("VALIDATION_FAILED");
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: 02-github-summoner, Property 20: Invalid payloads are rejected without partial results
// Validates: Requirements R2.5, R2.6
type RepoMutation = "missing" | "wrong-type" | "empty-default-branch" | "full-name-mismatch";
const arbRepoField = fc.constantFrom("name", "full_name", "owner", "default_branch", "private");
const arbRepoMutation = fc.oneof(
  fc.record({ kind: fc.constant<RepoMutation>("missing"), field: arbRepoField }),
  fc.record({ kind: fc.constant<RepoMutation>("wrong-type"), field: arbRepoField }),
  fc.record({ kind: fc.constant<RepoMutation>("empty-default-branch"), field: fc.constant("default_branch") }),
  fc.record({ kind: fc.constant<RepoMutation>("full-name-mismatch"), field: fc.constant("full_name") }),
);

function mutateRepo(
  payload: Record<string, unknown>,
  m: { kind: RepoMutation; field: string },
  other: string,
): Record<string, unknown> {
  const out = { ...payload };
  switch (m.kind) {
    case "missing":
      delete out[m.field];
      break;
    case "wrong-type":
      out[m.field] = m.field === "private" ? "false" : 42;
      break;
    case "empty-default-branch":
      out.default_branch = "";
      break;
    case "full-name-mismatch":
      out.full_name = `${other}/${other}`;
      break;
  }
  return out;
}

async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("P20 (R2.5, R2.6): invalid payloads are rejected without partial results", () => {
  it("an invalid repo payload throws VALIDATION_FAILED and issues no commit request", async () => {
    await fc.assert(
      fc.asyncProperty(arbIdent, arbIdent, arbBranchLike, arbRepoMutation, async (owner, name, branch, m) => {
        const { fx, deps } = setup();
        const bad = mutateRepo(repoPayload(owner, name, branch), m, `${owner}x`);
        fx.register({ url: `${API}/repos/${owner}/${name}`, json: bad });
        // A commit fixture exists, but must never be requested.
        fx.register({ url: `${API}/repos/${owner}/${name}/commits/${encodeRef(branch)}`, json: { sha: "a".repeat(40) } });
        const parsed: ParsedRepoRef = { host: "github.com", owner, name, ref: null };

        const caught = await capture(() => resolveRef(parsed, deps));

        expect(caught).toBeInstanceOf(SummonerError);
        expect((caught as SummonerError).code).toBe("VALIDATION_FAILED");
        expect(fx.requests).toHaveLength(1);
        expect(fx.requests.some((r) => r.url.includes("/commits/"))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("an invalid commit payload throws VALIDATION_FAILED and issues no further request", async () => {
    const arbBadCommit = fc.oneof(
      fc.constant<Record<string, unknown>>({}),
      fc.integer().map((n) => ({ sha: n })),
      fc.constant<Record<string, unknown>>({ sha: null }),
      arbHex(1, 39).map((sha) => ({ sha })),
      arbHex(41, 64).map((sha) => ({ sha })),
      arbHex(39, 39).map((sha) => ({ sha: `${sha}g` })),
      arbHex(40, 40)
        .filter((sha) => /[a-f]/.test(sha))
        .map((sha) => ({ sha: sha.toUpperCase() })),
    );
    await fc.assert(
      fc.asyncProperty(arbIdent, arbIdent, arbBranchLike, arbBadCommit, async (owner, name, branch, badCommit) => {
        const { fx, deps } = setup();
        fx.register({ url: `${API}/repos/${owner}/${name}`, json: repoPayload(owner, name, branch) });
        fx.register({ url: `${API}/repos/${owner}/${name}/commits/${encodeRef(branch)}`, json: badCommit });
        const parsed: ParsedRepoRef = { host: "github.com", owner, name, ref: null };

        const caught = await capture(() => resolveRef(parsed, deps));

        expect(caught).toBeInstanceOf(SummonerError);
        expect((caught as SummonerError).code).toBe("VALIDATION_FAILED");
        expect(fx.requests).toHaveLength(2);
      }),
      { numRuns: 200 },
    );
  });
});
