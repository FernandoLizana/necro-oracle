// Task 17.2: property P27. Test-first: fails until src/github-client.ts exists (task 17.5).
// Task 17.3 appends P32 to this file later.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SummonerError } from "./errors.js";
import { externalRequest, GitHubClient, headersFor } from "./github-client.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";

function authOf(h: Readonly<Record<string, string>>): string | undefined {
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === "authorization") return v;
  return undefined;
}

const arbToken = fc
  .tuple(
    fc.constantFrom("ghp_", "gho_", "ghs_", "github_pat_"),
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), {
      minLength: 20,
      maxLength: 60,
    }),
  )
  .map(([p, cs]) => p + cs.join(""));

const AUTH_HOSTS = ["github.com", "api.github.com"] as const;
const NO_AUTH_HOSTS = ["codeload.github.com", "pypi.org", "registry.npmjs.org", "api.osv.dev"] as const;

const arbPath = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_."), { minLength: 0, maxLength: 20 })
  .map((cs) => "/" + cs.join(""));

/** Hosts that are never exactly github.com / api.github.com, nor the known unauthenticated ones. */
const arbLookalikeHost = fc.oneof(
  fc.constantFrom(
    "api.github.com.evil.test",
    "evilgithub.com",
    "github.com.evil.test",
    "xapi.github.com",
    "example.com",
    "raw.githubusercontent.com",
  ),
  fc
    .tuple(
      fc.constantFrom("evil", "x", "api", "www", "a-b"),
      fc.constantFrom("github.com", "api.github.com", "example.org", "pypi.org"),
    )
    .map(([p, h]) => `${p}${p === "evil" ? "" : "."}${h}`)
    .filter((h) => !(AUTH_HOSTS as readonly string[]).includes(h) && !(NO_AUTH_HOSTS as readonly string[]).includes(h)),
);

function refusal(url: string, token: string | undefined): SummonerError | undefined {
  try {
    headersFor(url, token);
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  return undefined;
}

// Feature: 02-github-summoner, Property 27: Authorization header policy
// Validates: Requirements R6.2, R6.3, R6.4
describe("P27 (R6.2, R6.3, R6.4): Authorization header policy", () => {
  it("includes Bearer iff a token exists on https, default port, host exactly github.com or api.github.com", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AUTH_HOSTS),
        arbPath,
        fc.option(arbToken, { nil: undefined }),
        (host, path, token) => {
          const a = authOf(headersFor(`https://${host}${path}`, token));
          expect(a).toBe(token === undefined ? undefined : `Bearer ${token}`);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never sends Authorization to codeload, PyPI, npm or OSV, with or without a token", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NO_AUTH_HOSTS),
        arbPath,
        fc.option(arbToken, { nil: undefined }),
        (host, path, token) => {
          expect(authOf(headersFor(`https://${host}${path}`, token))).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("refuses look-alike hosts, non-default ports and http: without leaking the token", () => {
    const arbBad = fc.oneof(
      fc.tuple(arbLookalikeHost, arbPath).map(([h, p]) => `https://${h}${p}`),
      fc
        .tuple(
          fc.constantFrom(...AUTH_HOSTS),
          fc.integer({ min: 1, max: 65535 }).filter((n) => n !== 443),
          arbPath,
        )
        .map(([h, port, p]) => `https://${h}:${port}${p}`),
      fc.tuple(fc.constantFrom(...AUTH_HOSTS), arbPath).map(([h, p]) => `http://${h}${p}`),
    );
    fc.assert(
      fc.property(arbBad, fc.option(arbToken, { nil: undefined }), (url, token) => {
        const err = refusal(url, token);
        expect(err, url).toBeDefined();
        expect(err!.code).toBe("VALIDATION_FAILED");
        if (token !== undefined) expect(err!.message).not.toContain(token);
      }),
      { numRuns: 200 },
    );
  });

  it("with no token, no request sent through the client carries Authorization", async () => {
    await fc.assert(
      fc.asyncProperty(arbPath, async (path) => {
        const fx = createFixtureFetch();
        fx.register({ url: `https://api.github.com/repos/o/r${path}`, json: { id: 1 } });
        const client = new GitHubClient({
          fetch: fx.fetch,
          clock: fixedClock(1_700_000_000_000),
          env: { get: () => undefined },
        });
        await client.getJson(`/repos/o/r${path}`, z.object({ id: z.number() }), {
          endpoint: "commit",
          repo: { owner: "o", name: "r" },
          repoProven: true,
          allowRepoRedirect: false,
          optional: false,
        });
        expect(fx.requests.length).toBeGreaterThan(0);
        for (const r of fx.requests) expect(authOf(r.headers)).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});

// Task 17.3: property P32. Test-first: fails until src/github-client.ts exists (task 17.5).
// Feature: 02-github-summoner, Property 32: Hard REST budget guard
// Validates: Requirements R2.7, R2.10, R4.8
type Outcome = "ok" | "degraded-503" | "absent-404" | "server-500" | "transport-timeout";
const arbOutcome: fc.Arbitrary<Outcome> = fc.constantFrom(
  "ok",
  "degraded-503",
  "absent-404",
  "server-500",
  "transport-timeout",
);
const arbCall = fc.record({ outcome: arbOutcome, optional: fc.boolean() });

describe("P32 (R2.7, R2.10, R4.8): hard REST budget guard", () => {
  it("never sends more than REST_CALL_BUDGET requests; extra calls are refused before sending", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbCall, { minLength: 1, maxLength: 12 }), async (calls) => {
        const fx = createFixtureFetch();
        const client = new GitHubClient({
          fetch: fx.fetch,
          clock: fixedClock(1_700_000_000_000),
          env: { get: () => undefined },
        });
        const Schema = z.object({ id: z.number() });
        calls.forEach((c, i) => {
          const url = `https://api.github.com/repos/o/r/commits/c${i}`;
          if (c.outcome === "ok") fx.register({ url, json: { id: i } });
          else if (c.outcome === "degraded-503") fx.register({ url, status: 503 });
          else if (c.outcome === "absent-404") fx.register({ url, status: 404 });
          else if (c.outcome === "server-500") fx.register({ url, status: 500 });
          else fx.register({ url, transportError: "timeout" });
        });

        for (let i = 0; i < calls.length; i += 1) {
          const c = calls[i]!;
          const before = fx.requests.length;
          const ctx = {
            endpoint: c.optional ? ("pulls" as const) : ("commit" as const),
            repo: { owner: "o", name: "r" },
            repoProven: true,
            allowRepoRedirect: false,
          };
          const path = `/repos/o/r/commits/c${i}`;
          let err: unknown;
          try {
            if (c.optional) await client.getJson(path, Schema, { ...ctx, optional: true });
            else await client.getJson(path, Schema, { ...ctx, optional: false });
          } catch (e) {
            err = e;
          }
          if (i < 5) {
            // Every attempt within the budget is sent and counted, whatever its outcome.
            expect(fx.requests.length, `call ${i}`).toBe(before + 1);
            expect(client.restCallCount).toBe(i + 1);
          } else {
            expect(err, `call ${i}`).toBeInstanceOf(SummonerError);
            expect((err as SummonerError).details.reason).toBe("rest-budget-exceeded");
            expect(fx.requests.length).toBe(before);
            expect(client.restCallCount).toBe(5);
          }
        }
        expect(fx.requests.length).toBeLessThanOrEqual(5);
        expect(client.restCallCount).toBe(Math.min(calls.length, 5));
      }),
      { numRuns: 200 },
    );
  });
});

// Task 18.2: property P12. Test-first: fails until openTarball/externalRequest exist (task 18.5).
// Feature: 02-github-summoner, Property 12: Authorization is never sent to codeload or to non-GitHub-API hosts
// Validates: Requirements R3.1, R3.12, R3.16, R6.3
const P12_SHA = "a".repeat(40);
const P12_REF = { owner: "o", name: "r", sha: P12_SHA };
const P12_API_TARBALL = `https://api.github.com/repos/o/r/tarball/${P12_SHA}`;

const arbRedirectStatus = fc.constantFrom(301, 302, 307, 308);

/** Redirect targets the client must follow (https, default port, exactly codeload.github.com). */
const arbCodeloadTarget = arbPath.map((p) => `https://codeload.github.com/o/r/legacy.tar.gz${p}`);

/** Redirect targets that must be refused with no request sent. */
const arbRefusedTarget = fc.oneof(
  fc.tuple(arbLookalikeHost, arbPath).map(([h, p]) => `https://${h}${p}`),
  fc.tuple(fc.constantFrom(...AUTH_HOSTS, ...NO_AUTH_HOSTS.filter((h) => h !== "codeload.github.com")), arbPath).map(
    ([h, p]) => `https://${h}${p}`,
  ),
  fc.tuple(fc.integer({ min: 1, max: 65535 }).filter((n) => n !== 443), arbPath).map(
    ([port, p]) => `https://codeload.github.com:${port}${p}`,
  ),
  arbPath.map((p) => `http://codeload.github.com${p}`),
);

function p12Client(token: string) {
  const fx = createFixtureFetch();
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => token },
  });
  return { fx, client };
}

function hostOf(url: string): string {
  return new URL(url).host;
}

describe("P12 (R3.1, R3.12, R3.16, R6.3): Authorization is never sent to codeload or non-GitHub-API hosts", () => {
  it("token path: Bearer only on api.github.com; the followed codeload hop carries no Authorization", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbRedirectStatus, arbCodeloadTarget, async (token, status, target) => {
        const { fx, client } = p12Client(token);
        fx.register({ url: P12_API_TARBALL, status, redirectTo: target });
        fx.register({ url: target, body: new Uint8Array([1]) });
        await client.openTarball(P12_REF);
        expect(fx.requests.map((r) => r.url)).toEqual([P12_API_TARBALL, target]);
        for (const r of fx.requests) {
          if (hostOf(r.url) === "api.github.com") expect(authOf(r.headers)).toBe(`Bearer ${token}`);
          else expect(authOf(r.headers), r.url).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("refused redirect targets are never requested and the token never leaks into the error", async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbRedirectStatus, arbRefusedTarget, async (token, status, target) => {
        const { fx, client } = p12Client(token);
        fx.register({ url: P12_API_TARBALL, status, redirectTo: target });
        let err: unknown;
        try {
          await client.openTarball(P12_REF);
        } catch (e) {
          err = e;
        }
        expect(err, target).toBeInstanceOf(SummonerError);
        expect((err as SummonerError).code).toBe("VALIDATION_FAILED");
        expect((err as SummonerError).message).not.toContain(token);
        expect(fx.requests).toHaveLength(1);
        expect(fx.requests.some((r) => r.url === target)).toBe(false);
        for (const r of fx.requests) {
          if (hostOf(r.url) !== "api.github.com") expect(authOf(r.headers)).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("follows at most one redirect: a second hop is refused and never requested", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbToken,
        arbRedirectStatus,
        arbRedirectStatus,
        arbCodeloadTarget,
        arbCodeloadTarget,
        async (token, s1, s2, first, second) => {
          fc.pre(first !== second);
          const { fx, client } = p12Client(token);
          fx.register({ url: P12_API_TARBALL, status: s1, redirectTo: first });
          fx.register({ url: first, status: s2, redirectTo: second });
          let err: unknown;
          try {
            await client.openTarball(P12_REF);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(SummonerError);
          expect((err as SummonerError).code).toBe("VALIDATION_FAILED");
          expect(fx.requests.map((r) => r.url)).toEqual([P12_API_TARBALL, first]);
          expect(authOf(fx.requests[1]!.headers)).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("external registry hosts never receive Authorization, whatever token the environment holds", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbToken,
        fc.constantFrom("pypi.org", "registry.npmjs.org", "api.osv.dev"),
        arbPath,
        async (_token, host, path) => {
          const fx = createFixtureFetch();
          const url = `https://${host}${path}`;
          fx.register({ url, json: { ok: true } });
          await externalRequest({ fetch: fx.fetch }, url);
          expect(fx.requests).toHaveLength(1);
          expect(authOf(fx.requests[0]!.headers)).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Task 18.3: property P15. Test-first: fails until openTarball exists (task 18.5).
// Feature: 02-github-summoner, Property 15: Direct codeload path is unauthenticated and REST-free
// Validates: Requirements R3.15, R3.12, R6.4
const P15_ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Valid owner or repository segment: starts alphanumeric, then [A-Za-z0-9_.-], never "." / ".." / "*.git". */
const arbP15Segment = fc
  .tuple(
    fc.constantFrom(...P15_ALNUM),
    fc.array(fc.constantFrom(...(P15_ALNUM + "-_.")), { minLength: 0, maxLength: 30 }),
  )
  .map(([first, rest]) => first + rest.join(""))
  .filter((s) => !s.toLowerCase().endsWith(".git"));

const arbP15Sha = fc
  .array(fc.constantFrom(..."0123456789abcdef"), { minLength: 40, maxLength: 40 })
  .map((cs) => cs.join(""));

const arbP15Ref = fc.record({ owner: arbP15Segment, name: arbP15Segment, sha: arbP15Sha });

/** "No GITHUB_TOKEN present": unset, empty, or whitespace-only. */
const arbNoToken = fc.constantFrom<string | undefined>(undefined, "", " ", "   ", "\t");

describe("P15 (R3.15, R3.12, R6.4): direct codeload path is unauthenticated and REST-free", () => {
  it("with no token, the only request is the codeload tar.gz URL, without Authorization, and restCallCount stays 0", async () => {
    await fc.assert(
      fc.asyncProperty(arbP15Ref, arbNoToken, async (ref, token) => {
        const fx = createFixtureFetch();
        const url = `https://codeload.github.com/${ref.owner}/${ref.name}/tar.gz/${ref.sha}`;
        fx.register({ url, body: new Uint8Array([1, 2, 3]), headers: { "content-length": "3" } });
        const client = new GitHubClient({
          fetch: fx.fetch,
          clock: fixedClock(1_700_000_000_000),
          env: { get: () => token },
        });
        const res = await client.openTarball(ref);
        expect(res.contentLength).toBe(3);
        expect(fx.requests.map((r) => r.url)).toEqual([url]);
        expect(fx.requests[0]!.method).toBe("GET");
        expect(authOf(fx.requests[0]!.headers)).toBeUndefined();
        expect(fx.requests.some((r) => new URL(r.url).host === "api.github.com")).toBe(false);
        expect(client.restCallCount).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

// Task 18.4: property P33. Test-first: fails until openTarball exists (task 18.5).
// Feature: 02-github-summoner, Property 33: Tarball path is selected by token presence
// Validates: Requirements R3.1, R3.12, R3.15, R3.16
async function drain(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return out;
}

const arbArchiveBytes = fc.uint8Array({ minLength: 1, maxLength: 64 });
const arbMaybeToken = fc.option(arbToken, { nil: undefined });

describe("P33 (R3.1, R3.12, R3.15, R3.16): tarball path is selected by token presence", () => {
  it("token selects api.github.com + one unauthenticated codeload hop; no token goes straight to codeload; same bytes either way", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbP15Ref,
        arbMaybeToken,
        arbRedirectStatus,
        arbPath,
        arbArchiveBytes,
        async (ref, token, status, p, bytes) => {
          const fx = createFixtureFetch();
          const client = new GitHubClient({
            fetch: fx.fetch,
            clock: fixedClock(1_700_000_000_000),
            env: { get: () => token },
          });
          const direct = `https://codeload.github.com/${ref.owner}/${ref.name}/tar.gz/${ref.sha}`;
          const api = `https://api.github.com/repos/${ref.owner}/${ref.name}/tarball/${ref.sha}`;
          const hop = `https://codeload.github.com/${ref.owner}/${ref.name}/legacy.tar.gz${p}`;
          fx.register({ url: direct, body: bytes });
          fx.register({ url: api, status, redirectTo: hop });
          fx.register({ url: hop, body: bytes });

          const res = await client.openTarball(ref);
          if (token === undefined) {
            expect(fx.requests.map((r) => r.url)).toEqual([direct]);
            expect(authOf(fx.requests[0]!.headers)).toBeUndefined();
          } else {
            expect(fx.requests.map((r) => r.url)).toEqual([api, hop]);
            expect(authOf(fx.requests[0]!.headers)).toBe(`Bearer ${token}`);
            expect(authOf(fx.requests[1]!.headers)).toBeUndefined();
          }
          // Neither path is a REST_Call.
          expect(client.restCallCount).toBe(0);
          expect(await drain(res.body)).toEqual([...bytes]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no token: any 3xx from codeload is refused with VALIDATION_FAILED and not followed", async () => {
    await fc.assert(
      fc.asyncProperty(arbP15Ref, arbRedirectStatus, arbCodeloadTarget, async (ref, status, target) => {
        const fx = createFixtureFetch();
        const direct = `https://codeload.github.com/${ref.owner}/${ref.name}/tar.gz/${ref.sha}`;
        fx.register({ url: direct, status, redirectTo: target });
        fx.register({ url: target, body: new Uint8Array([1]) });
        const client = new GitHubClient({
          fetch: fx.fetch,
          clock: fixedClock(1_700_000_000_000),
          env: { get: () => undefined },
        });
        let err: unknown;
        try {
          await client.openTarball(ref);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(SummonerError);
        expect((err as SummonerError).code).toBe("VALIDATION_FAILED");
        expect(fx.requests.map((r) => r.url)).toEqual([direct]);
      }),
      { numRuns: 100 },
    );
  });

  it("token: a second redirect after the codeload hop is refused", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbP15Ref,
        arbToken,
        arbRedirectStatus,
        arbRedirectStatus,
        arbCodeloadTarget,
        async (ref, token, s1, s2, second) => {
          const fx = createFixtureFetch();
          const api = `https://api.github.com/repos/${ref.owner}/${ref.name}/tarball/${ref.sha}`;
          const first = "https://codeload.github.com/o/r/legacy.tar.gz/first";
          fc.pre(first !== second);
          fx.register({ url: api, status: s1, redirectTo: first });
          fx.register({ url: first, status: s2, redirectTo: second });
          const client = new GitHubClient({
            fetch: fx.fetch,
            clock: fixedClock(1_700_000_000_000),
            env: { get: () => token },
          });
          let err: unknown;
          try {
            await client.openTarball(ref);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(SummonerError);
          expect((err as SummonerError).code).toBe("VALIDATION_FAILED");
          expect(fx.requests.map((r) => r.url)).toEqual([api, first]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
