// Example tests for parseRepoRef (task 13.1). Requirements: R1.1-R1.9.
// Test-first: fails until src/intake.ts is implemented (task 13.6).
import { describe, expect, it } from "vitest";
import { SummonerError } from "./errors.js";
import { GitHubClient } from "./github-client.js";
import { parseRepoRef, resolveRef, resolveRefDetailed, type ParsedRepoRef } from "./intake.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function rejection(input: string): { code: unknown; userMessage: string } {
  try {
    parseRepoRef(input);
  } catch (e) {
    const err = e as { code?: unknown; userMessage?: unknown };
    return { code: err.code, userMessage: String(err.userMessage ?? "") };
  }
  throw new Error(`expected parseRepoRef to reject: ${input.slice(0, 40)}`);
}

describe("parseRepoRef accepts (R1.1-R1.6)", () => {
  it("R1.1: owner/repo shorthand preserves case, ref is null (R1.4)", () => {
    expect(parseRepoRef("octocat/Hello-World")).toEqual({
      host: "github.com",
      owner: "octocat",
      name: "Hello-World",
      ref: null,
    });
    expect(parseRepoRef("OctoCat/HELLO")).toMatchObject({ owner: "OctoCat", name: "HELLO" });
  });

  it("R1.2: https URL form", () => {
    expect(parseRepoRef("https://github.com/octocat/Hello-World")).toEqual({
      host: "github.com",
      owner: "octocat",
      name: "Hello-World",
      ref: null,
    });
  });

  it("R1.3: /tree/<ref> keeps slashes in branch names", () => {
    expect(parseRepoRef("https://github.com/octocat/Hello-World/tree/feature/x")).toEqual({
      host: "github.com",
      owner: "octocat",
      name: "Hello-World",
      ref: "feature/x",
    });
  });

  it("R1.3: #ref and @sha shorthand", () => {
    expect(parseRepoRef("o/r#ref")).toMatchObject({ owner: "o", name: "r", ref: "ref" });
    expect(parseRepoRef(`o/r@${SHA}`)).toMatchObject({ owner: "o", name: "r", ref: SHA });
  });

  it("R1.3: ref is everything after the first delimiter", () => {
    expect(parseRepoRef("o/r#feature/x@y")).toMatchObject({ ref: "feature/x@y" });
  });

  it("R1.5: www host and http scheme normalize to github.com", () => {
    expect(parseRepoRef("http://www.github.com/o/r").host).toBe("github.com");
    expect(parseRepoRef("https://WWW.GitHub.com/o/r").host).toBe("github.com");
  });

  it("R1.6: strips .git, trailing slash and whitespace", () => {
    expect(parseRepoRef("https://www.github.com/o/r.git/")).toEqual({
      host: "github.com",
      owner: "o",
      name: "r",
      ref: null,
    });
    expect(parseRepoRef("  o/r.git  ")).toMatchObject({ owner: "o", name: "r" });
    expect(parseRepoRef("o/r/")).toMatchObject({ owner: "o", name: "r" });
    expect(parseRepoRef("https://github.com/o/r/tree/main/")).toMatchObject({ ref: "main" });
  });

  it("R1.4/R1.6: query string and fragment on URL form are ignored", () => {
    expect(parseRepoRef("https://github.com/o/r?tab=readme#top")).toMatchObject({
      name: "r",
      ref: null,
    });
  });

  it("R1.3: uppercase 40-hex ref is lower-cased", () => {
    expect(parseRepoRef(`o/r@${SHA.toUpperCase()}`).ref).toBe(SHA);
    expect(parseRepoRef(`o/r#${SHA.toUpperCase()}`).ref).toBe(SHA);
  });

  it("accepts the allowed owner/name character set", () => {
    expect(parseRepoRef("a-b_c.d/e.f-g_h")).toMatchObject({ owner: "a-b_c.d", name: "e.f-g_h" });
  });
});

describe("parseRepoRef rejects (R1.7-R1.9)", () => {
  it("R1.7: foreign host", () => {
    const r = rejection("https://gitlab.com/o/r");
    expect(r.code).toBe("INVALID_REPO_URL");
    expect(r.userMessage).not.toBe("");
    expect(rejection("https://github.com.evil.example/o/r").code).toBe("INVALID_REPO_URL");
  });

  it("R1.7: scp-style git@ form", () => {
    expect(rejection("git@github.com:o/r.git").code).toBe("INVALID_REPO_URL");
  });

  it("R1.7: non-http(s) scheme", () => {
    expect(rejection("ftp://github.com/o/r").code).toBe("INVALID_REPO_URL");
    expect(rejection("ssh://github.com/o/r").code).toBe("INVALID_REPO_URL");
  });

  it("credentials are rejected and the message never echoes the input", () => {
    const input = "https://user:pw@github.com/o/r";
    const r = rejection(input);
    expect(r.code).toBe("INVALID_REPO_URL");
    expect(r.userMessage).not.toContain("pw");
    expect(r.userMessage).not.toContain("user:");
    expect(r.userMessage).not.toContain(input);
    const token = rejection("https://ghp_SECRETTOKEN123@github.com/o/r");
    expect(token.userMessage).not.toContain("ghp_SECRETTOKEN123");
  });

  it("explicit port is rejected", () => {
    expect(rejection("https://github.com:8080/o/r").code).toBe("INVALID_REPO_URL");
  });

  it("unsupported URL path shapes", () => {
    expect(rejection("https://github.com/o/r/issues").code).toBe("INVALID_REPO_URL");
    expect(rejection("https://github.com/o/r/tree").code).toBe("INVALID_REPO_URL");
    expect(rejection("https://github.com/o").code).toBe("INVALID_REPO_URL");
  });

  it("R1.9: empty or whitespace-only", () => {
    expect(rejection("").code).toBe("INVALID_REPO_URL");
    expect(rejection("   \t\n").code).toBe("INVALID_REPO_URL");
  });

  it("R1.9: missing owner or name", () => {
    for (const s of ["/r", "o/", "o", "/", "#ref", "o//r", "o/r/extra", "https://github.com/"]) {
      expect(rejection(s).code, s).toBe("INVALID_REPO_URL");
    }
  });

  it("R1.8: characters outside [A-Za-z0-9_.-] in owner or name", () => {
    for (const s of ["o w/r", "o/r$", "ö/r", "o/r!", "o%20/r", "o/r name"]) {
      expect(rejection(s).code, s).toBe("INVALID_REPO_URL");
    }
  });

  it("R1.8: dot segments", () => {
    expect(rejection("./r").code).toBe("INVALID_REPO_URL");
    expect(rejection("o/..").code).toBe("INVALID_REPO_URL");
    expect(rejection("../r").code).toBe("INVALID_REPO_URL");
  });

  it("over-long input (> 2048 chars)", () => {
    expect(rejection(`o/${"r".repeat(2100)}`).code).toBe("INVALID_REPO_URL");
  });

  it("bad ref characters", () => {
    const bad = [
      "o/r#",
      "o/r#a b",
      "o/r#a..b",
      "o/r#-x",
      "o/r#a\\b",
      "o/r#a?b",
      "o/r#a*b",
      "o/r#a[b",
      "o/r#a~b",
      "o/r#a^b",
      "o/r#a:b",
      "o/r#a\u0000b",
      `o/r#${"a".repeat(256)}`,
    ];
    for (const s of bad) {
      expect(rejection(s).code, JSON.stringify(s.slice(0, 20))).toBe("INVALID_REPO_URL");
    }
  });

  it("non-string input is rejected", () => {
    expect(() => parseRepoRef(undefined as unknown as string)).toThrow();
    expect(() => parseRepoRef(42 as unknown as string)).toThrow();
  });
});

describe("parseRepoRef purity (R1.10, R1.11)", () => {
  it("returns equal results on repeated calls", () => {
    const a = parseRepoRef("https://github.com/o/r/tree/feature/x");
    const b = parseRepoRef("https://github.com/o/r/tree/feature/x");
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 19.1: example tests for resolveRef / resolveRefDetailed.
// Test-first: fails until resolveRef and resolveRefDetailed exist in src/intake.ts (task 19.4).
// Requirements: R2.1, R2.2, R2.3, R2.4, R2.8, R2.11, R7.3, R7.7, R10.3.
//
// Assumed API (design.md, "Reference parsing and resolution"):
//
//   interface IntakeDeps { readonly client: GitHubClient }
//   resolveRef(parsed: ParsedRepoRef, deps: IntakeDeps): Promise<RepoRef>
//   resolveRefDetailed(parsed, deps): Promise<{ ref: RepoRef; repo: GhRepo }>
//
//   RepoRef = { owner, name, sha (40 lowercase hex), defaultBranch }
//   Call 1: GET /repos/{parsed.owner}/{parsed.name}  (allowRepoRedirect: true)
//   Call 2: GET /repos/{canonical owner}/{canonical name}/commits/{ref ?? default_branch}
//           (path segments encodeURIComponent-encoded, "/" preserved)
//   owner/name come from the validated repo payload (owner.login, name), never the user's spelling.
//   defaultBranch always equals repo.default_branch. Failures are SummonerError instances.
// ---------------------------------------------------------------------------------------------

const API = "https://api.github.com";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function repoPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Hello-World",
    full_name: "octocat/Hello-World",
    owner: { login: "octocat" },
    default_branch: "main",
    private: false,
    archived: false,
    pushed_at: "2024-01-02T03:04:05Z",
    stargazers_count: 1,
    open_issues_count: 0,
    license: null,
    ...over,
  };
}

function parsed(over: Partial<ParsedRepoRef> = {}): ParsedRepoRef {
  return { host: "github.com", owner: "octocat", name: "Hello-World", ref: null, ...over };
}

function setupResolve() {
  const fx = createFixtureFetch();
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => undefined },
  });
  return { fx, client, deps: { client } };
}

async function failure(p: Promise<unknown>): Promise<SummonerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  throw new Error("expected rejection");
}

describe("resolveRef success paths (R2.1, R2.2, R2.3, R2.4, R10.3)", () => {
  it("R2.1: no ref uses the default branch; defaultBranch from the repo payload", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload({ default_branch: "trunk" }) });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/trunk`, json: { sha: SHA_A } });
    const ref = await resolveRef(parsed(), deps);
    expect(ref).toEqual({ owner: "octocat", name: "Hello-World", sha: SHA_A, defaultBranch: "trunk" });
    expect(fx.requests.map((r) => r.url)).toEqual([
      `${API}/repos/octocat/Hello-World`,
      `${API}/repos/octocat/Hello-World/commits/trunk`,
    ]);
  });

  it("R2.2: explicit branch and tag are resolved through commits/{ref}; defaultBranch unchanged", async () => {
    for (const requested of ["develop", "v1.2.3"]) {
      const { fx, deps } = setupResolve();
      fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
      fx.register({ url: `${API}/repos/octocat/Hello-World/commits/${requested}`, json: { sha: SHA_B } });
      const ref = await resolveRef(parsed({ ref: requested }), deps);
      expect(ref.sha).toBe(SHA_B);
      expect(ref.defaultBranch).toBe("main");
    }
  });

  it("R2.2: slashes in a ref are preserved and other characters encoded per segment", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/feature/x%23y`, json: { sha: SHA_A } });
    const ref = await resolveRef(parsed({ ref: "feature/x#y" }), deps);
    expect(ref.sha).toBe(SHA_A);
  });

  it("R2.3: a full 40-hex SHA is verified against the response", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/${SHA_A}`, json: { sha: SHA_A } });
    expect((await resolveRef(parsed({ ref: SHA_A }), deps)).sha).toBe(SHA_A);
  });

  it("R2.3: a partial SHA is expanded to 40 hex characters", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/aaaaaaa`, json: { sha: SHA_A } });
    const ref = await resolveRef(parsed({ ref: "aaaaaaa" }), deps);
    expect(ref.sha).toBe(SHA_A);
    expect(ref.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("R10.3: resolveRefDetailed returns the validated repo payload alongside the RepoRef", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/main`, json: { sha: SHA_A } });
    const { ref, repo } = await resolveRefDetailed(parsed(), deps);
    expect(ref).toEqual(await resolveRef(parsed(), setupResolveWith(fx).deps));
    expect(repo.default_branch).toBe("main");
    expect(repo.owner.login).toBe("octocat");
    expect(repo.private).toBe(false);
  });
});

function setupResolveWith(fx: ReturnType<typeof createFixtureFetch>) {
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => undefined },
  });
  return { client, deps: { client } };
}

describe("resolveRef canonical identity (R2.4, R2.8)", () => {
  it("R2.4: case-variant spelling is normalized to the canonical owner/name; call 2 uses the canonical pair", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/OctoCat/hello-world`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/main`, json: { sha: SHA_A } });
    const ref = await resolveRef(parsed({ owner: "OctoCat", name: "hello-world" }), deps);
    expect(ref.owner).toBe("octocat");
    expect(ref.name).toBe("Hello-World");
    expect(fx.requests[1]!.url).toBe(`${API}/repos/octocat/Hello-World/commits/main`);
  });

  it("R2.8: rename redirect on call 1 yields the canonical pair from the body; 3 REST calls total", async () => {
    const { fx, client, deps } = setupResolve();
    fx.register({ url: `${API}/repos/old/name`, status: 301, redirectTo: `${API}/repositories/123` });
    fx.register({
      url: `${API}/repositories/123`,
      json: repoPayload({ name: "fresh", full_name: "newowner/fresh", owner: { login: "newowner" } }),
    });
    fx.register({ url: `${API}/repos/newowner/fresh/commits/main`, json: { sha: SHA_A } });
    const ref = await resolveRef(parsed({ owner: "old", name: "name" }), deps);
    expect(ref).toEqual({ owner: "newowner", name: "fresh", sha: SHA_A, defaultBranch: "main" });
    expect(fx.requests.map((r) => r.url)).toEqual([
      `${API}/repos/old/name`,
      `${API}/repositories/123`,
      `${API}/repos/newowner/fresh/commits/main`,
    ]);
    expect(client.restCallCount).toBe(3);
  });
});

describe("resolveRef failures (R2.3, R2.11, R7.3, R7.7)", () => {
  it("R2.3: a full-SHA response whose sha differs from the request raises VALIDATION_FAILED", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/${SHA_A}`, json: { sha: SHA_B } });
    const err = await failure(resolveRef(parsed({ ref: SHA_A }), deps));
    expect(err.code).toBe("VALIDATION_FAILED");
  });

  it.each([404, 422])("R2.11/R7.7: %i on commits/{ref} in an existing repo raises REF_NOT_FOUND naming the ref", async (status) => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({ url: `${API}/repos/octocat/Hello-World/commits/nope`, status, json: { message: "No commit found" } });
    const err = await failure(resolveRef(parsed({ ref: "nope" }), deps));
    expect(err.code).toBe("REF_NOT_FOUND");
    expect(err.code).not.toBe("REPO_NOT_FOUND");
    expect(err.code).not.toBe("INVALID_REPO_URL");
    expect(JSON.stringify([err.message, err.userMessage, err.details])).toContain("nope");
  });

  it("R2.11: an empty repository (409 on commits) raises REF_NOT_FOUND", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload() });
    fx.register({
      url: `${API}/repos/octocat/Hello-World/commits/main`,
      status: 409,
      json: { message: "Git Repository is empty." },
    });
    const err = await failure(resolveRef(parsed(), deps));
    expect(err.code).toBe("REF_NOT_FOUND");
  });

  it("R7.3: an authenticated 404 on call 1 raises REPO_NOT_FOUND and issues no commit call", async () => {
    const fx = createFixtureFetch();
    const client = new GitHubClient({
      fetch: fx.fetch,
      clock: fixedClock(1_700_000_000_000),
      env: { get: () => "ghp_" + "a".repeat(36) },
    });
    fx.register({ url: `${API}/repos/octocat/Hello-World`, status: 404, json: { message: "Not Found" } });
    const err = await failure(resolveRef(parsed(), { client }));
    expect(err.code).toBe("REPO_NOT_FOUND");
    expect(fx.requests).toHaveLength(1);
  });

  it("R7.3: an unauthenticated 404 on call 1 raises REPO_PRIVATE and issues no commit call", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, status: 404, json: { message: "Not Found" } });
    const err = await failure(resolveRef(parsed(), deps));
    expect(err.code).toBe("REPO_PRIVATE");
    expect(fx.requests).toHaveLength(1);
  });

  it("R7.3: private: true raises REPO_PRIVATE and issues no commit call", async () => {
    const { fx, deps } = setupResolve();
    fx.register({ url: `${API}/repos/octocat/Hello-World`, json: repoPayload({ private: true }) });
    const err = await failure(resolveRef(parsed(), deps));
    expect(err.code).toBe("REPO_PRIVATE");
    expect(fx.requests).toHaveLength(1);
  });
});
