// Task 15.1: example tests for the HTTP and transport failure classifier.
// Test-first: fails until src/http-failure.ts exists (task 15.4).
// Requirements: R2.9, R2.11, R4.9, R7.3, R7.6, R7.7, R7.8, R7.9.
//
// Assumed API (design.md, "Optional calls" and "HTTP and transport failure mapping"):
//
//   classifyFailure(failure, ctx, nowMs): SummonerError | DegradedOutcome | AbsentOutcome
//
//   failure:
//     | { kind: "http"; status: number; headers: Record<string, string>; bodyHint?: string }
//     | { kind: "transport"; error: FetchTransportError }
//     | { kind: "private-payload" }  // repo payload parsed with `private: true`   (ASSUMED)
//     | { kind: "invalid-body" }     // 2xx body failed zod or the body cap        (ASSUMED)
//
//   ctx (RequestContext from github-client.ts, plus the fields below):
//     endpoint: "repo" | "commit" | "pulls" | "release" | "tarball"   ("tarball" ASSUMED)
//     repo, repoProven, optional, allowRepoRedirect                    (as in the design)
//     authenticated: boolean   whether the request carried a token     (ASSUMED; P29 input)
//     ref?: string             requested ref, echoed in REF_NOT_FOUND  (ASSUMED)
//
//   DegradedOutcome: { status: "degraded"; field: "pulls" | "release";
//                      cause: "http-5xx" | "timeout" | "network"; httpStatus?: number;
//                      sanitizedCause: Error }   (as in the design)
//   AbsentOutcome:   { status: "absent" }         (ASSUMED: 404 or zod failure on optional calls
//                      is neutral, not a Degraded_Field, not an error)
//
//   Result discrimination: SummonerError instances are errors; everything else carries `status`.
//   Rate limit: 403/429 with retry-after, x-ratelimit-remaining "0", or a rate-limit hint.
//   Header names are lower-case. Wait minutes = max(1, ceil(seconds / 60)) in the message.
import { NecroError } from "@necro/oracle";
import { describe, expect, it } from "vitest";
import { SummonerError } from "./errors.js";
import { classifyFailure } from "./http-failure.js";
import { FetchTransportError } from "./ports.js";

type Ctx = Parameters<typeof classifyFailure>[1];
type Failure = Parameters<typeof classifyFailure>[0];

const NOW = 1_700_000_000_000;
const REPO = { owner: "octocat", name: "Hello-World" };

function ctx(over: Record<string, unknown> & { endpoint: string }): Ctx {
  const optional = over.endpoint === "pulls" || over.endpoint === "release";
  return {
    repo: REPO,
    repoProven: over.endpoint !== "repo",
    optional,
    allowRepoRedirect: false,
    authenticated: false,
    ...over,
  } as unknown as Ctx;
}

function http(status: number, headers: Record<string, string> = {}, bodyHint?: string): Failure {
  return { kind: "http", status, headers, ...(bodyHint ? { bodyHint } : {}) } as Failure;
}

function transport(kind: "timeout" | "network"): Failure {
  return { kind: "transport", error: new FetchTransportError(kind, `${kind} happened`) } as Failure;
}

function expectError(result: unknown, code: string): SummonerError {
  expect(result).toBeInstanceOf(SummonerError);
  expect(result).toBeInstanceOf(NecroError);
  const err = result as SummonerError;
  expect(err.code).toBe(code);
  expect(err.userMessage.length).toBeGreaterThan(0);
  return err;
}

describe("classifyFailure: repository endpoint (R7.3)", () => {
  it("maps an unauthenticated 404 to REPO_PRIVATE (absence cannot be proven)", () => {
    expectError(
      classifyFailure(http(404), ctx({ endpoint: "repo", authenticated: false }), NOW),
      "REPO_PRIVATE",
    );
  });

  it("maps an authenticated 404 to REPO_NOT_FOUND", () => {
    expectError(
      classifyFailure(http(404), ctx({ endpoint: "repo", authenticated: true }), NOW),
      "REPO_NOT_FOUND",
    );
  });

  it("maps a payload with private: true to REPO_PRIVATE", () => {
    expectError(
      classifyFailure(
        { kind: "private-payload" } as Failure,
        ctx({ endpoint: "repo", authenticated: true }),
        NOW,
      ),
      "REPO_PRIVATE",
    );
  });

  it.each([403, 451])("maps %i without rate-limit signals to REPO_PRIVATE", (status) => {
    expectError(classifyFailure(http(status), ctx({ endpoint: "repo" }), NOW), "REPO_PRIVATE");
  });

  it("does not treat a 403 with an unrelated hint as rate limited", () => {
    expectError(
      classifyFailure(
        http(403, { "x-ratelimit-remaining": "42" }, "Repository access blocked"),
        ctx({ endpoint: "repo" }),
        NOW,
      ),
      "REPO_PRIVATE",
    );
  });
});

describe("classifyFailure: commit endpoint (R2.11, R7.7)", () => {
  it.each([404, 422, 409])("maps %i to REF_NOT_FOUND and names the ref", (status) => {
    const err = expectError(
      classifyFailure(http(status), ctx({ endpoint: "commit", ref: "v9.9.9" }), NOW),
      "REF_NOT_FOUND",
    );
    expect(err.userMessage).toContain("v9.9.9");
    expect(err.details.ref).toBe("v9.9.9");
  });

  it("never maps a missing ref to INVALID_REPO_URL or REPO_NOT_FOUND", () => {
    const err = classifyFailure(http(404), ctx({ endpoint: "commit", ref: "nope" }), NOW);
    expect((err as SummonerError).code).not.toBe("INVALID_REPO_URL");
    expect((err as SummonerError).code).not.toBe("REPO_NOT_FOUND");
  });
});

describe("classifyFailure: tarball endpoint", () => {
  it("maps 404 to REPO_NOT_FOUND once the repository is proven", () => {
    expectError(
      classifyFailure(http(404), ctx({ endpoint: "tarball", repoProven: true }), NOW),
      "REPO_NOT_FOUND",
    );
  });
});

describe("classifyFailure: 401 (R7.8)", () => {
  it.each(["repo", "commit", "tarball", "pulls", "release"])(
    "maps 401 on %s to AUTH_INVALID without echoing a token",
    (endpoint) => {
      const err = expectError(
        classifyFailure(http(401, {}, "Bad credentials ghp_abcdef123456"), ctx({ endpoint }), NOW),
        "AUTH_INVALID",
      );
      expect(err.userMessage).toContain("GITHUB_TOKEN");
      expect(err.userMessage).not.toContain("ghp_abcdef123456");
    },
  );
});

describe("classifyFailure: required calls, server and transport failures (R7.6, R7.9)", () => {
  it.each(["repo", "commit", "tarball"])("maps 5xx on %s to UPSTREAM_UNAVAILABLE", (endpoint) => {
    for (const status of [500, 502, 503, 599]) {
      const err = expectError(
        classifyFailure(http(status), ctx({ endpoint }), NOW),
        "UPSTREAM_UNAVAILABLE",
      );
      expect(err.details.httpStatus).toBe(status);
    }
  });

  it.each(["repo", "commit", "tarball"])(
    "maps timeout and network errors on %s to NETWORK_TIMEOUT",
    (endpoint) => {
      expectError(classifyFailure(transport("timeout"), ctx({ endpoint }), NOW), "NETWORK_TIMEOUT");
      expectError(classifyFailure(transport("network"), ctx({ endpoint }), NOW), "NETWORK_TIMEOUT");
    },
  );
});

describe("classifyFailure: optional pulls/release degrade (R4.9, R7.6, R7.9)", () => {
  it.each(["pulls", "release"] as const)("returns a DegradedOutcome for 5xx on %s", (field) => {
    const out = classifyFailure(http(503), ctx({ endpoint: field }), NOW);
    expect(out).not.toBeInstanceOf(Error);
    expect(out).toMatchObject({
      status: "degraded",
      field,
      cause: "http-5xx",
      httpStatus: 503,
    });
    expect((out as { sanitizedCause: unknown }).sanitizedCause).toBeInstanceOf(Error);
  });

  it.each(["pulls", "release"] as const)("degrades with cause timeout on %s", (field) => {
    const out = classifyFailure(transport("timeout"), ctx({ endpoint: field }), NOW);
    expect(out).toMatchObject({ status: "degraded", field, cause: "timeout" });
    expect(out).not.toHaveProperty("httpStatus");
  });

  it.each(["pulls", "release"] as const)("degrades with cause network on %s", (field) => {
    const out = classifyFailure(transport("network"), ctx({ endpoint: field }), NOW);
    expect(out).toMatchObject({ status: "degraded", field, cause: "network" });
  });
});

describe("classifyFailure: optional calls stay fatal for 429, 401 and rate-limited 403 (R4.9)", () => {
  it.each(["pulls", "release"])("429 on %s is RATE_LIMITED", (endpoint) => {
    expectError(classifyFailure(http(429), ctx({ endpoint }), NOW), "RATE_LIMITED");
  });

  it.each(["pulls", "release"])("rate-limited 403 on %s is RATE_LIMITED", (endpoint) => {
    expectError(
      classifyFailure(http(403, { "retry-after": "30" }), ctx({ endpoint }), NOW),
      "RATE_LIMITED",
    );
  });

  it.each(["pulls", "release"])("401 on %s is AUTH_INVALID", (endpoint) => {
    expectError(classifyFailure(http(401), ctx({ endpoint }), NOW), "AUTH_INVALID");
  });
});

describe("classifyFailure: optional calls treat 404 and zod failures as absent (R4.7)", () => {
  it.each(["pulls", "release"])("404 on %s is absent, not degraded and not an error", (endpoint) => {
    const out = classifyFailure(http(404), ctx({ endpoint }), NOW);
    expect(out).toEqual({ status: "absent" });
  });

  it.each(["pulls", "release"])("a zod failure on %s is absent", (endpoint) => {
    const out = classifyFailure({ kind: "invalid-body" } as Failure, ctx({ endpoint }), NOW);
    expect(out).toEqual({ status: "absent" });
  });

  it("a zod failure on a required call is VALIDATION_FAILED", () => {
    expectError(
      classifyFailure({ kind: "invalid-body" } as Failure, ctx({ endpoint: "repo" }), NOW),
      "VALIDATION_FAILED",
    );
  });
});

describe("classifyFailure: rate limits (R7.4, R7.5)", () => {
  it("429 is always rate limited, minimum one minute", () => {
    const err = expectError(
      classifyFailure(http(429), ctx({ endpoint: "repo" }), NOW),
      "RATE_LIMITED",
    );
    expect(err.details.retryAfterMinutes).toBe(1);
  });

  it("uses Retry-After seconds, rounded up to whole minutes", () => {
    const err = expectError(
      classifyFailure(http(403, { "retry-after": "90" }), ctx({ endpoint: "repo" }), NOW),
      "RATE_LIMITED",
    );
    expect(err.details.retryAfterMinutes).toBe(2);
    expect(err.userMessage).toContain("2 min");
  });

  it("falls back to the reset instant minus the injected clock", () => {
    const resetSec = Math.floor(NOW / 1000) + 61;
    const err = expectError(
      classifyFailure(
        http(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSec) }),
        ctx({ endpoint: "commit" }),
        NOW,
      ),
      "RATE_LIMITED",
    );
    expect(err.details.retryAfterMinutes).toBe(2);
  });

  it("uses one minute when a rate-limit signal has no usable header", () => {
    const err = expectError(
      classifyFailure(http(403, {}, "API rate limit exceeded"), ctx({ endpoint: "repo" }), NOW),
      "RATE_LIMITED",
    );
    expect(err.details.retryAfterMinutes).toBe(1);
  });
});

describe("classifyFailure: redirects and unexpected statuses (R2.9)", () => {
  it.each([301, 302, 307, 308])("refuses %i on a non-first REST call", (status) => {
    for (const endpoint of ["commit", "pulls", "release"]) {
      const err = expectError(
        classifyFailure(http(status, { location: "https://api.github.com/x" }), ctx({ endpoint }), NOW),
        "VALIDATION_FAILED",
      );
      expect(err.details.reason).toBe("redirect-refused");
    }
  });

  it("refuses a 3xx on the repo call when the redirect is not permitted", () => {
    expectError(
      classifyFailure(
        http(302, { location: "https://api.github.com/x" }),
        ctx({ endpoint: "repo", allowRepoRedirect: true }),
        NOW,
      ),
      "VALIDATION_FAILED",
    );
  });

  it("refuses any 3xx from the tarball endpoint when classified as a failure", () => {
    expectError(
      classifyFailure(http(302), ctx({ endpoint: "tarball" }), NOW),
      "VALIDATION_FAILED",
    );
  });

  it.each([400, 405, 418, 206, 204])("maps unexpected status %i to VALIDATION_FAILED", (status) => {
    for (const endpoint of ["repo", "commit", "tarball", "pulls", "release"]) {
      expectError(classifyFailure(http(status), ctx({ endpoint }), NOW), "VALIDATION_FAILED");
    }
  });
});
