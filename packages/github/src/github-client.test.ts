// Task 17.1: example tests for GitHubClient part A (headers, JSON reads, rename redirect, REST budget).
// Test-first: fails until src/github-client.ts exists (task 17.5). Task 18.1 appends part B tests later.
// Requirements: R2.5, R2.6, R2.8, R2.9, R2.10, R4.8, R6.2, R6.3, R6.4, R6.5, R7.8.
//
// Assumed API (design.md, "GitHub client"):
//
//   headersFor(url: string, token: string | undefined): Record<string, string>
//     Pure. Includes `Authorization: Bearer <token>` iff a token exists, scheme is https, port is
//     default and host is exactly github.com or api.github.com. codeload.github.com, pypi.org,
//     registry.npmjs.org and api.osv.dev get headers WITHOUT Authorization. Any other host,
//     any http: URL or non-default port throws SummonerError VALIDATION_FAILED (SSRF guard).
//     Header names are looked up case-insensitively in these tests.
//
//   new GitHubClient(deps: SummonerDeps, opts?)    one instance per operation
//     .restCallCount: number                        requests sent to api.github.com (REST_Calls)
//     .getJson(path, schema, ctx)                   path is relative to https://api.github.com
//       required ctx (optional: false): resolves { data, headers }; every failure is a SummonerError
//       optional ctx (optional: true): resolves OptionalJsonResult ({status: "ok" | "absent" | "degraded"})
//     The token is read from deps.env.get("GITHUB_TOKEN") on every request. A malformed token
//     (empty-after-trim is "no token"; whitespace or control characters inside) raises AUTH_INVALID
//     before any request and the message never contains the token.
//     Body cap: MAX_REST_JSON_BYTES; exceeding it cancels the stream and (required) raises VALIDATION_FAILED.
//     Refusals carry details.reason: "rest-budget-exceeded" for the 6th request.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_REST_JSON_BYTES, REST_CALL_BUDGET } from "./constants.js";
import { SummonerError } from "./errors.js";
import { externalRequest, GitHubClient, headersFor, type RequestContext } from "./github-client.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const API = "https://api.github.com";
const Schema = z.object({ id: z.number() });

function auth(h: Readonly<Record<string, string>>): string | undefined {
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === "authorization") return v;
  return undefined;
}

function setup(token?: string) {
  const fx = createFixtureFetch();
  const client = new GitHubClient({
    fetch: fx.fetch,
    clock: fixedClock(1_700_000_000_000),
    env: { get: () => token },
  });
  return { fx, client };
}

function ctx(over: Partial<RequestContext> = {}): RequestContext & { optional: false } {
  return {
    endpoint: "commit",
    repo: { owner: "o", name: "r" },
    repoProven: true,
    allowRepoRedirect: false,
    ...over,
    optional: false,
  };
}

function optCtx(over: Partial<RequestContext> = {}): RequestContext & { optional: true } {
  return { ...ctx({ endpoint: "pulls", ...over }), optional: true };
}

async function code(p: Promise<unknown>): Promise<SummonerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SummonerError);
    return e as SummonerError;
  }
  throw new Error("expected rejection");
}

describe("headersFor (R6.2, R6.3, R6.4)", () => {
  it.each([
    "https://github.com/o/r",
    "https://api.github.com/repos/o/r",
  ])("sends Bearer to %s", (url) => {
    expect(auth(headersFor(url, TOKEN))).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    "https://api.github.com/repos/o/r",
    "https://codeload.github.com/o/r/tar.gz/abc",
    "https://pypi.org/pypi/x/json",
  ])("sends no Authorization without a token: %s", (url) => {
    expect(auth(headersFor(url, undefined))).toBeUndefined();
  });

  it.each([
    "https://codeload.github.com/o/r/tar.gz/abc",
    "https://pypi.org/pypi/x/json",
    "https://registry.npmjs.org/x",
    "https://api.osv.dev/v1/vulns/X",
  ])("never sends Authorization to %s", (url) => {
    expect(auth(headersFor(url, TOKEN))).toBeUndefined();
  });

  it.each([
    "https://api.github.com.evil.test/repos/o/r",
    "https://evilgithub.com/o/r",
    "https://api.github.com:444/repos/o/r",
    "http://api.github.com/repos/o/r",
    "https://example.com/",
  ])("refuses %s with VALIDATION_FAILED", (url) => {
    try {
      headersFor(url, TOKEN);
    } catch (e) {
      expect(e).toBeInstanceOf(SummonerError);
      expect((e as SummonerError).code).toBe("VALIDATION_FAILED");
      expect((e as SummonerError).message).not.toContain(TOKEN);
      return;
    }
    throw new Error("expected refusal");
  });

  it("sets the REST Accept and API version on api.github.com only", () => {
    const h = headersFor("https://api.github.com/repos/o/r", undefined);
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    expect(lower["x-github-api-version"]).toBe("2022-11-28");
    expect(lower["user-agent"]).toBeTruthy();
  });
});

describe("GitHubClient token validation (R7.8)", () => {
  it.each(["bad token", "tok\nen", "tok\ten"])("malformed token %j raises AUTH_INVALID before any request", async (t) => {
    const { fx, client } = setup(t);
    fx.register({ url: `${API}/repos/o/r/commits/x`, json: { id: 1 } });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("AUTH_INVALID");
    expect(err.message).not.toContain(t);
    expect(fx.requests).toHaveLength(0);
    expect(client.restCallCount).toBe(0);
  });
});

describe("GitHubClient.getJson (R2.5, R2.6, R6.2)", () => {
  it("returns validated data and lower-cased headers, with Bearer when a token exists", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: `${API}/repos/o/r/commits/x`, json: { id: 7 }, headers: { "X-Test": "1" } });
    const res = await client.getJson("/repos/o/r/commits/x", Schema, ctx());
    expect(res.data).toEqual({ id: 7 });
    expect(res.headers["x-test"]).toBe("1");
    expect(auth(fx.requests[0]!.headers)).toBe(`Bearer ${TOKEN}`);
    expect(fx.requests[0]!.redirect).toBe("manual");
    expect(client.restCallCount).toBe(1);
  });

  it("sends no Authorization without a token", async () => {
    const { fx, client } = setup(undefined);
    fx.register({ url: `${API}/repos/o/r/commits/x`, json: { id: 7 } });
    await client.getJson("/repos/o/r/commits/x", Schema, ctx());
    expect(auth(fx.requests[0]!.headers)).toBeUndefined();
  });

  it("raises VALIDATION_FAILED when the body fails the zod schema", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/commits/x`, json: { id: "nope" } });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("VALIDATION_FAILED");
  });

  it("caps the body size and cancels the unread stream", async () => {
    const { fx, client } = setup();
    const chunk = new Uint8Array(MAX_REST_JSON_BYTES / 2 + 1).fill(0x20);
    const handle = fx.register({
      url: `${API}/repos/o/r/commits/x`,
      stream: [chunk, chunk, chunk, chunk],
    });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(handle.cancelCalls).toBe(1);
    expect(handle.chunksPulled).toBeLessThan(4);
  });

  it("cancels the unread body of an error response", async () => {
    const { fx, client } = setup();
    const handle = fx.register({
      url: `${API}/repos/o/r/commits/x`,
      status: 500,
      stream: [new Uint8Array(10), new Uint8Array(10)],
    });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(handle.cancelCalls).toBe(1);
  });
});

describe("rename redirect on the first repo call (R2.8, R2.9)", () => {
  const repoCtx = () => ctx({ endpoint: "repo", repoProven: false, allowRepoRedirect: true });
  const FROM = `${API}/repos/o/r`;

  it.each([301, 307, 308])("follows one %i to api.github.com and counts it", async (status) => {
    const { fx, client } = setup(TOKEN);
    const h = fx.register({ url: FROM, status, redirectTo: `${API}/repositories/123`, stream: [new Uint8Array(4)] });
    fx.register({ url: `${API}/repositories/123`, json: { id: 123 } });
    const res = await client.getJson("/repos/o/r", Schema, repoCtx());
    expect(res.data).toEqual({ id: 123 });
    expect(fx.requests.map((r) => r.url)).toEqual([FROM, `${API}/repositories/123`]);
    expect(auth(fx.requests[1]!.headers)).toBe(`Bearer ${TOKEN}`);
    expect(client.restCallCount).toBe(2);
    expect(h.cancelCalls).toBe(1);
  });

  it.each([
    ["302", 302, `${API}/repositories/123`],
    ["303", 303, `${API}/repositories/123`],
    ["other host", 301, "https://evil.test/repositories/123"],
    ["codeload host", 301, "https://codeload.github.com/o/r"],
    ["look-alike host", 301, "https://api.github.com.evil.test/x"],
    ["http scheme", 301, "http://api.github.com/repositories/123"],
    ["other port", 301, "https://api.github.com:8443/repositories/123"],
  ])("refuses %s with VALIDATION_FAILED and sends nothing further", async (_n, status, to) => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: FROM, status, redirectTo: to });
    const err = await code(client.getJson("/repos/o/r", Schema, repoCtx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
  });

  it("refuses a second redirect with no third request", async () => {
    const { fx, client } = setup();
    fx.register({ url: FROM, status: 301, redirectTo: `${API}/repositories/123` });
    fx.register({ url: `${API}/repositories/123`, status: 301, redirectTo: `${API}/repositories/456` });
    const err = await code(client.getJson("/repos/o/r", Schema, repoCtx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(2);
  });

  it("refuses a redirect on any call not flagged allowRepoRedirect", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/commits/x`, status: 301, redirectTo: `${API}/repositories/123/commits/x` });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
  });

  it("refuses a redirect on an optional call", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/pulls`, status: 301, redirectTo: `${API}/repositories/1/pulls` });
    const err = await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
  });
});

describe("REST budget guard (R2.10, R4.8)", () => {
  function registerMany(fx: ReturnType<typeof createFixtureFetch>, n: number): void {
    for (let i = 0; i < n; i += 1) fx.register({ url: `${API}/repos/o/r/commits/c${i}`, json: { id: i } });
  }

  it("allows five requests and throws rest-budget-exceeded on the sixth before sending", async () => {
    expect(REST_CALL_BUDGET).toBe(5);
    const { fx, client } = setup();
    registerMany(fx, 6);
    for (let i = 0; i < 5; i += 1) await client.getJson(`/repos/o/r/commits/c${i}`, Schema, ctx());
    expect(client.restCallCount).toBe(5);
    const err = await code(client.getJson("/repos/o/r/commits/c5", Schema, ctx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details.reason).toBe("rest-budget-exceeded");
    expect(fx.requests).toHaveLength(5);
    expect(client.restCallCount).toBe(5);
  });

  it("counts a followed redirect hop toward the budget", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r`, status: 301, redirectTo: `${API}/repositories/1` });
    fx.register({ url: `${API}/repositories/1`, json: { id: 1 } });
    registerMany(fx, 4);
    await client.getJson("/repos/o/r", Schema, ctx({ endpoint: "repo", repoProven: false, allowRepoRedirect: true }));
    for (let i = 0; i < 3; i += 1) await client.getJson(`/repos/o/r/commits/c${i}`, Schema, ctx());
    expect(client.restCallCount).toBe(5);
    const err = await code(client.getJson("/repos/o/r/commits/c3", Schema, ctx()));
    expect(err.details.reason).toBe("rest-budget-exceeded");
    expect(fx.requests).toHaveLength(5);
  });

  it("counts a degraded request", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/pulls`, status: 503 });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx());
    expect(res.status).toBe("degraded");
    expect(client.restCallCount).toBe(1);
  });

  it("counts a request that fails with a transport error", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/commits/x`, transportError: "timeout" });
    const err = await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(err.code).toBe("NETWORK_TIMEOUT");
    expect(client.restCallCount).toBe(1);
  });

  it("does not count a request refused before sending (malformed token)", async () => {
    const { client } = setup("bad token");
    await code(client.getJson("/repos/o/r/commits/x", Schema, ctx()));
    expect(client.restCallCount).toBe(0);
  });
});

describe("host allow-list in getJson (R6.3)", () => {
  it.each([
    "https://evil.test/repos/o/r",
    "http://api.github.com/repos/o/r",
    "//evil.test/repos/o/r",
  ])("refuses an absolute or foreign path %s without sending", async (path) => {
    const { fx, client } = setup(TOKEN);
    const err = await code(client.getJson(path, Schema, ctx()));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(0);
    expect(err.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 18.1: part B tests (optional calls, tarball path selection, external requests).
// Test-first: fails until task 18.5 lands. Requirements: R3.1, R3.12, R3.15, R3.16, R4.9, R5.4,
// R6.3, R7.4, R7.5, R7.8.
//
// Assumed API (design.md, "Tarball path selection", "Optional calls"):
//
//   client.openTarball(ref: RepoRef, signal?: AbortSignal)
//       -> Promise<{ body: ReadableStream<Uint8Array>; contentLength: number | null }>
//     (same shape as the assumption in tar-extract.pbt.test.ts). `ref` is { owner, name, sha }.
//     contentLength is the numeric `content-length` header of the final response, else null.
//     Not a REST_Call: restCallCount stays 0 on the no-token path AND the token path.
//     Every request uses redirect: "manual". Refusals are SummonerError VALIDATION_FAILED, thrown
//     before any further request; the refused response body is cancelled.
//     Non-2xx final responses are mapped by the same failure table as getJson (e.g. 404 -> not
//     asserted here, only the host policy is).
//
//   externalRequest(deps: { fetch: FetchPort }, url: string, opts?: { timeoutMs?: number; signal?: AbortSignal })
//       -> Promise<FetchResponse>
//     Allow-list: pypi.org, registry.npmjs.org, api.osv.dev (https, default port). Anything else
//     rejects with SummonerError VALIDATION_FAILED without calling fetch. Never sets Authorization
//     (the token is not even read), always redirect: "manual", always a User-Agent. Returns the raw
//     FetchResponse; status interpretation is left to registries/osv.
//
//   Optional-mode getJson: OptionalJsonResult<T> =
//     { status: "ok", data, headers } | { status: "absent" } |
//     { status: "degraded", field, cause: "http-5xx" | "timeout" | "network", httpStatus? }
//     field comes from ctx.endpoint. 401/403-rate-limit/429, refused redirects, malformed tokens
//     and the budget guard are thrown. A degraded response body is cancelled; no retry.
// ---------------------------------------------------------------------------------------------

const SHA = "a".repeat(40);
const REF = { owner: "o", name: "r", sha: SHA };
const CODELOAD = `https://codeload.github.com/o/r/tar.gz/${SHA}`;
const API_TARBALL = `${API}/repos/o/r/tarball/${SHA}`;
const PULLS = `${API}/repos/o/r/pulls`;

describe("optional-mode getJson: ok and absent (R4.9, R4.7)", () => {
  it("returns ok with data and headers", async () => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, json: { id: 3 }, headers: { "X-Test": "1" } });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx());
    expect(res).toMatchObject({ status: "ok", data: { id: 3 } });
    if (res.status === "ok") expect(res.headers["x-test"]).toBe("1");
  });

  it("returns absent for 404 (not degraded)", async () => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, status: 404, json: { message: "Not Found" } });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx({ endpoint: "release" }));
    expect(res).toEqual({ status: "absent" });
  });

  it("returns absent when a 2xx body fails zod", async () => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, json: { id: "nope" } });
    expect(await client.getJson("/repos/o/r/pulls", Schema, optCtx())).toEqual({ status: "absent" });
  });

  it("returns absent when the body exceeds the cap and cancels the stream", async () => {
    const { fx, client } = setup();
    const chunk = new Uint8Array(MAX_REST_JSON_BYTES / 2 + 1).fill(0x20);
    const handle = fx.register({ url: PULLS, stream: [chunk, chunk, chunk, chunk] });
    expect(await client.getJson("/repos/o/r/pulls", Schema, optCtx())).toEqual({ status: "absent" });
    expect(handle.cancelCalls).toBe(1);
    expect(handle.chunksPulled).toBeLessThan(4);
  });
});

describe("optional-mode getJson: degraded (R4.9)", () => {
  it.each([500, 502, 503, 599])("returns degraded http-5xx for %i, cancels the body, does not retry", async (status) => {
    const { fx, client } = setup();
    const handle = fx.register({ url: PULLS, status, stream: [new Uint8Array(8), new Uint8Array(8)] });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx());
    expect(res).toMatchObject({ status: "degraded", field: "pulls", cause: "http-5xx", httpStatus: status });
    expect(handle.cancelCalls).toBe(1);
    expect(fx.requests).toHaveLength(1);
  });

  it.each(["timeout", "network"] as const)("returns degraded %s for a transport error, no retry", async (kind) => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, transportError: kind });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx());
    expect(res).toMatchObject({ status: "degraded", field: "pulls", cause: kind });
    expect(fx.requests).toHaveLength(1);
  });

  it("reports the release field for the release endpoint", async () => {
    const { fx, client } = setup();
    fx.register({ url: `${API}/repos/o/r/releases/latest`, status: 503 });
    const res = await client.getJson("/repos/o/r/releases/latest", Schema, optCtx({ endpoint: "release" }));
    expect(res).toMatchObject({ status: "degraded", field: "release" });
  });

  it("never leaks the token into the degraded outcome", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: PULLS, status: 503 });
    const res = await client.getJson("/repos/o/r/pulls", Schema, optCtx());
    expect(JSON.stringify(res, Object.getOwnPropertyNames(res))).not.toContain(TOKEN);
  });
});

describe("optional-mode getJson: still throws fatal failures (R5.4, R7.4, R7.5, R7.8)", () => {
  it("throws AUTH_INVALID for 401", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: PULLS, status: 401 });
    expect((await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()))).code).toBe("AUTH_INVALID");
  });

  it("throws RATE_LIMITED for a 403 with x-ratelimit-remaining: 0", async () => {
    const { fx, client } = setup();
    fx.register({
      url: PULLS,
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700003600" },
    });
    expect((await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()))).code).toBe("RATE_LIMITED");
  });

  it("throws RATE_LIMITED for 429", async () => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, status: 429, headers: { "retry-after": "30" } });
    expect((await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()))).code).toBe("RATE_LIMITED");
  });

  it("throws VALIDATION_FAILED for a refused redirect", async () => {
    const { fx, client } = setup();
    fx.register({ url: PULLS, status: 307, redirectTo: "https://evil.test/pulls" });
    expect((await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()))).code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
  });

  it("throws AUTH_INVALID for a malformed token before any request", async () => {
    const { fx, client } = setup("bad token");
    const err = await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()));
    expect(err.code).toBe("AUTH_INVALID");
    expect(fx.requests).toHaveLength(0);
  });

  it("throws rest-budget-exceeded on the sixth request instead of degrading", async () => {
    const { fx, client } = setup();
    for (let i = 0; i < 5; i += 1) fx.register({ url: `${API}/repos/o/r/commits/c${i}`, json: { id: i } });
    for (let i = 0; i < 5; i += 1) await client.getJson(`/repos/o/r/commits/c${i}`, Schema, ctx());
    const err = await code(client.getJson("/repos/o/r/pulls", Schema, optCtx()));
    expect(err.details.reason).toBe("rest-budget-exceeded");
    expect(fx.requests).toHaveLength(5);
  });
});

describe("openTarball without a token (R3.15)", () => {
  it("goes straight to codeload with no Authorization and zero REST calls", async () => {
    const { fx, client } = setup(undefined);
    fx.register({ url: CODELOAD, body: new Uint8Array([1, 2, 3]), headers: { "content-length": "3" } });
    const res = await client.openTarball(REF);
    expect(fx.requests.map((r) => r.url)).toEqual([CODELOAD]);
    expect(fx.requests[0]!.method).toBe("GET");
    expect(fx.requests[0]!.redirect).toBe("manual");
    expect(auth(fx.requests[0]!.headers)).toBeUndefined();
    expect(client.restCallCount).toBe(0);
    expect(res.contentLength).toBe(3);
    const reader = res.body.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reports contentLength null when the header is absent", async () => {
    const { fx, client } = setup(undefined);
    fx.register({ url: CODELOAD, body: new Uint8Array([1]) });
    expect((await client.openTarball(REF)).contentLength).toBeNull();
  });

  it("treats an empty-after-trim token as no token", async () => {
    const { fx, client } = setup("   ");
    fx.register({ url: CODELOAD, body: new Uint8Array([1]) });
    await client.openTarball(REF);
    expect(fx.requests.map((r) => r.url)).toEqual([CODELOAD]);
  });

  it.each([301, 302, 307, 308])("refuses a %i with VALIDATION_FAILED, cancels the body, sends nothing further", async (status) => {
    const { fx, client } = setup(undefined);
    const handle = fx.register({
      url: CODELOAD,
      status,
      redirectTo: "https://codeload.github.com/elsewhere",
      stream: [new Uint8Array(4)],
    });
    const err = await code(client.openTarball(REF));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
    expect(handle.cancelCalls).toBe(1);
  });

  it("rejects an unsafe ref segment before sending", async () => {
    const { fx, client } = setup(undefined);
    const err = await code(client.openTarball({ owner: "o/../x", name: "r", sha: SHA }));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(0);
    const err2 = await code(client.openTarball({ owner: "o", name: "r", sha: "HEAD" }));
    expect(err2.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(0);
  });
});

describe("openTarball with a token (R3.12, R3.16)", () => {
  const CL = "https://codeload.github.com/o/r/legacy.tar.gz/refs/heads/main";

  it("sends Bearer to api.github.com, follows one redirect to codeload without Authorization, cancels the first body", async () => {
    const { fx, client } = setup(TOKEN);
    const first = fx.register({ url: API_TARBALL, status: 302, redirectTo: CL, stream: [new Uint8Array(4)] });
    fx.register({ url: CL, body: new Uint8Array([9]), headers: { "content-length": "1" } });
    const res = await client.openTarball(REF);
    expect(fx.requests.map((r) => r.url)).toEqual([API_TARBALL, CL]);
    expect(auth(fx.requests[0]!.headers)).toBe(`Bearer ${TOKEN}`);
    expect(auth(fx.requests[1]!.headers)).toBeUndefined();
    expect(fx.requests.every((r) => r.redirect === "manual")).toBe(true);
    expect(first.cancelCalls).toBe(1);
    expect(client.restCallCount).toBe(0);
    expect(res.contentLength).toBe(1);
  });

  it.each([301, 302, 307, 308])("accepts a %i first hop", async (status) => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: API_TARBALL, status, redirectTo: CL });
    fx.register({ url: CL, body: new Uint8Array([9]) });
    await client.openTarball(REF);
    expect(fx.requests).toHaveLength(2);
  });

  it.each([
    ["other host", "https://evil.test/o/r.tar.gz"],
    ["look-alike host", "https://codeload.github.com.evil.test/x"],
    ["api host", `${API}/repos/o/r/tarball/${SHA}`],
    ["http scheme", "http://codeload.github.com/x"],
    ["other port", "https://codeload.github.com:8443/x"],
    ["relative-less garbage", "not a url"],
  ])("refuses a redirect to %s without sending the second request", async (_n, to) => {
    const { fx, client } = setup(TOKEN);
    const first = fx.register({ url: API_TARBALL, status: 302, redirectTo: to, stream: [new Uint8Array(4)] });
    const err = await code(client.openTarball(REF));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).not.toContain(TOKEN);
    expect(fx.requests).toHaveLength(1);
    expect(first.cancelCalls).toBe(1);
  });

  it("refuses a first hop that redirects with no Location header", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: API_TARBALL, status: 302 });
    expect((await code(client.openTarball(REF))).code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(1);
  });

  it("refuses a second redirect and cancels its body", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: API_TARBALL, status: 302, redirectTo: CL });
    const second = fx.register({
      url: CL,
      status: 302,
      redirectTo: "https://codeload.github.com/again",
      stream: [new Uint8Array(4)],
    });
    const err = await code(client.openTarball(REF));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(2);
    expect(second.cancelCalls).toBe(1);
  });

  it("raises AUTH_INVALID for a malformed token before any request", async () => {
    const { fx, client } = setup("bad token");
    const err = await code(client.openTarball(REF));
    expect(err.code).toBe("AUTH_INVALID");
    expect(err.message).not.toContain("bad token");
    expect(fx.requests).toHaveLength(0);
  });

  it("passes the abort signal to every request", async () => {
    const { fx, client } = setup(TOKEN);
    fx.register({ url: API_TARBALL, status: 302, redirectTo: CL });
    fx.register({ url: CL, body: new Uint8Array([9]) });
    const ac = new AbortController();
    await client.openTarball(REF, ac.signal);
    expect(fx.requests.every((r) => r.signal === ac.signal)).toBe(true);
  });
});

describe("externalRequest (R6.3)", () => {
  function ext() {
    const fx = createFixtureFetch();
    return { fx, deps: { fetch: fx.fetch } };
  }

  it.each([
    "https://pypi.org/pypi/requests/json",
    "https://registry.npmjs.org/left-pad",
    "https://api.osv.dev/v1/query",
  ])("allows %s and never sets Authorization", async (url) => {
    const { fx, deps } = ext();
    fx.register({ url, json: { ok: true } });
    const res = await externalRequest(deps, url);
    expect(res.status).toBe(200);
    expect(fx.requests).toHaveLength(1);
    expect(auth(fx.requests[0]!.headers)).toBeUndefined();
    expect(fx.requests[0]!.redirect).toBe("manual");
    const lower = Object.keys(fx.requests[0]!.headers).map((k) => k.toLowerCase());
    expect(lower).toContain("user-agent");
  });

  it.each([
    "https://api.github.com/repos/o/r",
    "https://github.com/o/r",
    "https://codeload.github.com/o/r/tar.gz/abc",
    "https://pypi.org.evil.test/pypi/x/json",
    "https://evil.test/",
    "http://pypi.org/pypi/x/json",
    "https://pypi.org:8443/pypi/x/json",
    "https://user:pw@pypi.org/pypi/x/json",
  ])("refuses %s with VALIDATION_FAILED and never calls fetch", async (url) => {
    const { fx, deps } = ext();
    const err = await code(externalRequest(deps, url));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(fx.requests).toHaveLength(0);
  });

  it("returns a 3xx as-is without following it", async () => {
    const { fx, deps } = ext();
    const url = "https://pypi.org/pypi/x/json";
    fx.register({ url, status: 301, redirectTo: "https://evil.test/" });
    const res = await externalRequest(deps, url);
    expect(res.status).toBe(301);
    expect(fx.requests).toHaveLength(1);
  });
});
