// apps/web/src/server/handlers/summon.test.ts
//
// Feature: 03-crt-terminal, task 25.1 (TEST-FIRST).
//
// Example tests for the Summon_Route handler `handleSummon` and the shared
// guard pipeline (design.md §"Handler pipeline" steps 1-7, §"Deps and
// composition"; R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8,
// R12.11, R13.1, R14.7).
//
// TEST-FIRST (red). This file is written before `server/handlers/guard.ts` and
// `server/handlers/summon.ts` (task 25.2), so the import of `./summon.js`
// below fails to resolve and the whole suite is red for the expected reason:
// the module does not exist yet. Nothing here is implementation.
//
// Contract pinned by this file (recorded for task 25.2):
//   summon.ts  →  handleSummon(req: Request, deps: RouteDeps): Promise<Response>
//   summon.ts  →  (optional) toSummonSummary(result: SummonResult): SummonSummary
//                 Exporting it lets a future test assert the mapping directly;
//                 here the field-by-field mapping is asserted THROUGH the 200
//                 response body (parsed with SummonSummarySchema), so the
//                 handler contract alone is enough.
//
// The pipeline order both handlers share (design.md §"Handler pipeline"):
//   1. clientIp(req, env)
//   2. limiter.check(...)                         — BEFORE any GitHub call (R13.1)
//   3. readJsonBody(req): application/json only (else 400), <= 2048 bytes
//      (else 413), valid JSON (else 400)
//   4. zod parse (SummonRequestSchema)            — 400 on failure
//   5. parseRepoRef(body.repo) -> github.summon(parsed) -> toSummonSummary(result)
//   6. redactDeep(summary, token) -> SummonSummarySchema.parse
//   7. any throw -> mapError(err, token) -> status + Error_Envelope
//   A non-POST method -> 405 + Allow: POST + no-store + Error_Envelope.
//   Every response carries Cache-Control: no-store and X-Content-Type-Options:
//   nosniff; success is 200 application/json.
//
// No network / LLM / sandbox — a fully fake RouteDeps drives the handler and
// real `Request` objects drive the HTTP surface.
//
// _Requirements: R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8, R12.11, R13.1, R14.7_
import type {
  ClockPort,
  ExternalDataResult,
  FetchPort,
  ParsedRepoRef,
  SummonExtras,
  SummonResult,
} from "@necro/github";
import { NecroError } from "@necro/oracle/client";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import { describe, expect, it, vi } from "vitest";

import { SummonSummarySchema } from "../../protocol/schemas.js";
import type { GithubGateway, RouteDeps, RouteEnvPort } from "../deps.js";

// Not yet implemented — task 25.2 adds this module. The import is what makes
// this suite red until then.
import { handleSummon } from "./summon.js";

// --- constants -------------------------------------------------------------

/** A fake GitHub token the fake env hands out; it must NEVER appear in any
 *  response body or header the handler produces (R12.6, R14.7). */
const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";

/** A plausible 40-hex commit sha for the summoned snapshot. */
const SHA = "a".repeat(40);

/** The repo the client asks about; `parseRepoRef` accepts this verbatim. */
const REPO_INPUT = "octo/legacy";

// --- fakes (no real adapters, no I/O) --------------------------------------

function fakeClock(nowMs = 1_700_000_000_000): ClockPort {
  return { nowMs: () => nowMs };
}

/** A fake RouteEnvPort. `GITHUB_TOKEN` returns the fake token so the handler
 *  has something to redact; the other keys return the documented defaults. */
function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

/** A fake FetchPort — never called by the summon handler. */
function fakeFetch(): FetchPort & { calls: number } {
  const port = Object.assign(
    vi.fn(async () => ({ status: 200, headers: {}, body: null })),
    { calls: 0 },
  );
  return port as unknown as FetchPort & { calls: number };
}

/** A fake runReading — never called by the summon handler. */
function fakeRunReading(): RouteDeps["runReading"] {
  return vi.fn(async (_snapshot: RepoSnapshot, _opts: ReadingOpts) => ({}) as Reading);
}

/**
 * A programmable, spyable limiter. `allowed` controls the decision; `calls`
 * records how many times `check` ran so order-vs-GitHub can be asserted.
 */
function fakeLimiter(
  decision:
    | { allowed: true }
    | { allowed: false; scope: "ip" | "global"; retryAfterSeconds: number } = { allowed: true },
): RouteDeps["limiter"] & { check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(async () => decision);
  return { check } as unknown as RouteDeps["limiter"] & { check: ReturnType<typeof vi.fn> };
}

/**
 * A fake GithubGateway. `summon` either resolves with a crafted SummonResult
 * or throws the supplied error; `summon`/`externalData` are vitest spies so we
 * can assert call order and the "no GitHub when limited" rule.
 */
function fakeGithub(opts: {
  result?: SummonResult;
  throws?: unknown;
} = {}): GithubGateway & { summon: ReturnType<typeof vi.fn>; externalData: ReturnType<typeof vi.fn> } {
  const summon = vi.fn(async (_input: ParsedRepoRef) => {
    if (opts.throws !== undefined) throw opts.throws;
    return opts.result ?? makeSummonResult();
  });
  const externalData = vi.fn(async () => ({}) as ExternalDataResult);
  return { summon, externalData } as unknown as GithubGateway & {
    summon: ReturnType<typeof vi.fn>;
    externalData: ReturnType<typeof vi.fn>;
  };
}

/**
 * Build a minimal but schema-valid SummonResult. `fileCount` derives from
 * `snapshot.files.length` and `truncated` from `snapshot.truncated`; the rest
 * of the SummonSummary comes from `snapshot.ref` and `extras`. The snapshot
 * also carries FILE CONTENTS (a Map and a secret-looking file body) so the
 * tests can prove the handler never copies them into the response (R12.11).
 */
function makeSummonResult(over: {
  extras?: Partial<SummonExtras>;
  cache?: "hit" | "miss";
  files?: RepoSnapshot["files"];
  truncated?: boolean;
} = {}): SummonResult {
  const files: RepoSnapshot["files"] = over.files ?? [
    { path: "setup.py", size: 42, lang: "python", sha: "f".repeat(40) },
    { path: "src/app.py", size: 128, lang: "python", sha: "e".repeat(40) },
  ];
  const snapshot: RepoSnapshot = {
    ref: { owner: "octo", name: "legacy", sha: SHA, defaultBranch: "master" },
    files,
    meta: {
      pushedAt: "2014-01-01T00:00:00Z",
      isArchived: false,
      openIssueCount: 3,
      openPRCount: 1,
      oldestOpenPRAgeDays: 400,
      latestReleaseAt: null,
      licenseKey: "mit",
    },
    manifests: [],
    oversizeFiles: [],
    truncated: over.truncated ?? false,
    createdAt: "2024-01-01T00:00:00Z",
    // Runtime-only Map of file CONTENTS — must never leak into the response.
    contents: new Map<string, string>([
      ["setup.py", "SECRET_FILE_BODY = 'do-not-leak'"],
      ["src/app.py", "print 'hello'  # py2 body that must stay server-side"],
    ]),
  };
  return {
    snapshot,
    extras: {
      stars: 1234,
      defaultBranch: "master",
      hasWorkflowsDir: true,
      degradedFields: [],
      ...over.extras,
    },
    cache: over.cache ?? "miss",
  };
}

/** Assemble a full fake RouteDeps from optional parts. */
function makeDeps(
  parts: {
    limiter?: RouteDeps["limiter"];
    github?: GithubGateway;
    env?: RouteEnvPort;
    fetch?: FetchPort;
  } = {},
): RouteDeps {
  return {
    clock: fakeClock(),
    env: parts.env ?? fakeEnv(),
    fetch: parts.fetch ?? fakeFetch(),
    limiter: parts.limiter ?? fakeLimiter(),
    github: parts.github ?? fakeGithub(),
    runReading: fakeRunReading(),
  };
}

// --- Request builders ------------------------------------------------------

/** A POST request to /api/summon with a JSON body (default content type). */
function postJson(
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request("https://necro.test/api/summon", {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.7", ...headers },
    body,
  });
}

/** A request with an arbitrary method (used for the 405 cases). */
function methodReq(method: string): Request {
  // GET/HEAD cannot carry a body, so omit it; the handler rejects on method
  // before ever reading one.
  return new Request("https://necro.test/api/summon", {
    method,
    headers: { "x-real-ip": "203.0.113.7" },
  });
}

/** Stringify everything a Response exposes (status, headers, body) so a single
 *  assertion can prove a secret never appears anywhere. */
async function dumpResponse(res: Response): Promise<string> {
  const headerDump = [...res.headers.entries()]
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const body = await res.clone().text();
  return `${res.status}\n${headerDump}\n${body}`;
}

// --- method guard: 405 on everything but POST (R12.2) ----------------------

describe("handleSummon — method guard (R12.2, R12.8)", () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    it(`${method} -> 405 with Allow: POST, no-store, and an Error_Envelope`, async () => {
      const deps = makeDeps();
      const res = await handleSummon(methodReq(method), deps);

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("cache-control")).toBe("no-store");

      // HEAD responses have no body; the others carry an Error_Envelope.
      if (method !== "HEAD") {
        const json = (await res.json()) as unknown;
        expect(json).toMatchObject({
          error: { code: expect.any(String), userMessage: expect.any(String) },
        });
      }

      // The guard runs before the pipeline: no GitHub, no limiter spend.
      expect((deps.github as ReturnType<typeof fakeGithub>).summon).not.toHaveBeenCalled();
    });
  }
});

// --- body guard: content-type, size, JSON, zod (R12.1, R12.3) --------------

describe("handleSummon — body guard (R12.1, R12.3, R12.8)", () => {
  it("non-application/json content-type -> 400 VALIDATION_FAILED", async () => {
    const deps = makeDeps();
    const req = postJson(JSON.stringify({ repo: REPO_INPUT }), {
      "content-type": "text/plain",
    });
    const res = await handleSummon(req, deps);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("accepts application/json with charset parameter (still reaches the pipeline)", async () => {
    const github = fakeGithub();
    const deps = makeDeps({ github });
    const req = postJson(JSON.stringify({ repo: REPO_INPUT }), {
      "content-type": "application/json; charset=utf-8",
    });
    const res = await handleSummon(req, deps);

    expect(res.status).toBe(200);
    expect(github.summon).toHaveBeenCalledTimes(1);
  });

  it("body larger than 2048 bytes -> 413", async () => {
    const deps = makeDeps();
    // A valid-looking JSON object whose single string value pushes the body
    // well past the 2 KB cap.
    const big = JSON.stringify({ repo: "o/" + "x".repeat(3000) });
    expect(big.length).toBeGreaterThan(2048);
    const res = await handleSummon(postJson(big), deps);

    expect(res.status).toBe(413);
    expect((deps.github as ReturnType<typeof fakeGithub>).summon).not.toHaveBeenCalled();
  });

  it("invalid JSON -> 400", async () => {
    const deps = makeDeps();
    const res = await handleSummon(postJson("{ not json "), deps);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  it("JSON that fails SummonRequestSchema (missing repo) -> 400", async () => {
    const deps = makeDeps();
    const res = await handleSummon(postJson(JSON.stringify({ wrong: "x" })), deps);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
    // Nothing reached GitHub.
    expect((deps.github as ReturnType<typeof fakeGithub>).summon).not.toHaveBeenCalled();
  });

  it("JSON with an unknown extra key fails the strict schema -> 400", async () => {
    const deps = makeDeps();
    const res = await handleSummon(
      postJson(JSON.stringify({ repo: REPO_INPUT, extra: 1 })),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

// --- limiter runs before GitHub (R13.1) ------------------------------------

describe("handleSummon — limiter before GitHub (R13.1)", () => {
  it("limiter denies -> 429 + Retry-After + RATE_LIMITED, and github.summon is NOT called", async () => {
    const limiter = fakeLimiter({ allowed: false, scope: "ip", retryAfterSeconds: 90 });
    const github = fakeGithub();
    const deps = makeDeps({ limiter, github });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);

    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");

    // The whole point of R13.1: a limited request performs NO GitHub work.
    expect(github.summon).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("limiter.check runs and resolves before github.summon on the happy path", async () => {
    const order: string[] = [];
    const limiter = fakeLimiter();
    (limiter.check as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("limiter");
      return { allowed: true } as const;
    });
    const github = fakeGithub();
    github.summon.mockImplementation(async () => {
      order.push("summon");
      return makeSummonResult();
    });
    const deps = makeDeps({ limiter, github });

    await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(order).toEqual(["limiter", "summon"]);
  });
});

// --- happy path: 200 + schema-valid body + no secrets (R5.9, R12.6, R12.8, R12.11, R14.7)

describe("handleSummon — success (R5.9, R12.6, R12.8, R12.11, R14.7)", () => {
  it("200 with application/json, no-store, nosniff, and a schema-valid SummonSummary", async () => {
    const result = makeSummonResult({
      extras: { stars: 1234, defaultBranch: "master", hasWorkflowsDir: true, degradedFields: [] },
      cache: "miss",
      truncated: false,
    });
    const github = fakeGithub({ result });
    const deps = makeDeps({ github });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await res.json()) as unknown;
    // The outgoing body validates against the SAME schema the handler must use
    // to validate it on the way out (design step 6).
    const parsed = SummonSummarySchema.parse(body);

    // Field-by-field mapping from the SummonResult (asserted through the body).
    expect(parsed.ref.owner).toBe("octo");
    expect(parsed.ref.name).toBe("legacy");
    expect(parsed.ref.sha).toBe(SHA);
    expect(parsed.ref.defaultBranch).toBe("master");
    expect(parsed.stars).toBe(1234);
    expect(parsed.hasWorkflowsDir).toBe(true);
    expect(parsed.degradedFields).toEqual([]);
    expect(parsed.cache).toBe("miss");
    expect(parsed.fileCount).toBe(result.snapshot.files.length);
    expect(parsed.truncated).toBe(false);
    // `demo` is a client-only marker; a server summon never sets it.
    expect("demo" in (parsed as Record<string, unknown>)).toBe(false);
  });

  it("carries degradedFields, cache: hit and truncated: true through from the result", async () => {
    const result = makeSummonResult({
      extras: {
        stars: 0,
        defaultBranch: "trunk",
        hasWorkflowsDir: false,
        degradedFields: ["pulls", "release"],
      },
      cache: "hit",
      truncated: true,
    });
    const deps = makeDeps({ github: fakeGithub({ result }) });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);
    const parsed = SummonSummarySchema.parse(await res.json());

    expect(parsed.degradedFields).toEqual(["pulls", "release"]);
    expect(parsed.cache).toBe("hit");
    expect(parsed.truncated).toBe(true);
    expect(parsed.hasWorkflowsDir).toBe(false);
    expect(parsed.ref.defaultBranch).toBe("trunk");
  });

  it("the response contains NO snapshot file contents (R12.11)", async () => {
    const deps = makeDeps({ github: fakeGithub({ result: makeSummonResult() }) });
    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    const dump = await dumpResponse(res);
    // The crafted snapshot carried these file bodies; none may appear anywhere.
    expect(dump).not.toContain("SECRET_FILE_BODY");
    expect(dump).not.toContain("do-not-leak");
    expect(dump).not.toContain("py2 body that must stay server-side");
    // No file path list leaks either (summary carries only a count).
    const body = (await res.json()) as Record<string, unknown>;
    expect("files" in body).toBe(false);
    expect("contents" in body).toBe(false);
  });

  it("the token and any Authorization value appear NOWHERE in the response (R12.6, R14.7)", async () => {
    // Craft a result whose extras accidentally echo the token, to prove the
    // redactor scrubs every string leaf on the way out.
    const result = makeSummonResult({ extras: { defaultBranch: `br-${FAKE_TOKEN}` } });
    const deps = makeDeps({ github: fakeGithub({ result }) });

    const res = await handleSummon(
      postJson(JSON.stringify({ repo: REPO_INPUT }), {
        "content-type": "application/json",
        authorization: `Bearer ${FAKE_TOKEN}`,
      }),
      deps,
    );

    const dump = await dumpResponse(res);
    expect(dump).not.toContain(FAKE_TOKEN);
    expect(dump.toLowerCase()).not.toContain("authorization");
  });

  it("never calls deps.fetch or deps.runReading (R12.11)", async () => {
    const fetch = fakeFetch();
    const runReading = fakeRunReading();
    const deps: RouteDeps = { ...makeDeps({ github: fakeGithub() }), fetch, runReading };

    await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(fetch).not.toHaveBeenCalled();
    expect(runReading).not.toHaveBeenCalled();
  });
});

// --- NecroError from the gateway -> mapped Error_Envelope (R5.10) ----------

describe("handleSummon — NecroError mapping (R5.10)", () => {
  it("github.summon throws REPO_NOT_FOUND -> 404 + Error_Envelope", async () => {
    const err = new NecroError(
      "REPO_NOT_FOUND",
      "The grave is empty.\nNo such repository answers this name.",
    );
    const deps = makeDeps({ github: fakeGithub({ throws: err }) });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string; userMessage: string } };
    expect(json.error.code).toBe("REPO_NOT_FOUND");
    expect(json.error.userMessage.length).toBeGreaterThan(0);
    // No `cause` leaks into the envelope.
    expect(Object.keys(json.error).sort()).toEqual(["code", "userMessage"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a REPO_PRIVATE NecroError -> 403", async () => {
    const err = new NecroError("REPO_PRIVATE", "Sealed.\nThis crypt is private.");
    const deps = makeDeps({ github: fakeGithub({ throws: err }) });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);
    expect(res.status).toBe(403);
  });

  it("a non-NecroError throwable -> 500 UPSTREAM_UNAVAILABLE with no leaked text", async () => {
    const deps = makeDeps({
      github: fakeGithub({ throws: new Error("boom: internal stack with secret path") }),
    });

    const res = await handleSummon(postJson(JSON.stringify({ repo: REPO_INPUT })), deps);

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string; userMessage: string } };
    expect(json.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(json.error.userMessage).not.toContain("boom");
    expect(json.error.userMessage).not.toContain("secret path");
  });
});
