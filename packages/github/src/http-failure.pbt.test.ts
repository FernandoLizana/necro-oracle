// Task 11.2: property tests for the @necro/github failure model.
// P29 and P30 are added to this file in tasks 15.2 and 15.3.
// Test-first: fails until src/errors.ts exists (task 11.3).
import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arbEndpoint,
  arbErrorCase,
  arbNoRateLimitHeaders,
  arbOwnerOrName,
  arbPlainRef,
  arbRedirectStatus,
  arbRestEndpoint,
  arbSecret,
  arbUnexpectedStatus,
} from "../test/arbitraries.js";
import { SummonerError, summonerError } from "./errors.js";
import { classifyFailure } from "./http-failure.js";
import { FetchTransportError } from "./ports.js";

describe("P28 (R7.1, R7.7, R7.8, R7.10, R7.11): every error is a typed, in-voice NecroError", () => {
  // Feature: 02-github-summoner, Property 28: Every error is a typed, in-voice NecroError
  // **Validates: Requirements R7.1, R7.7, R7.8, R7.10, R7.11**
  it("builds a typed error with a two-line in-voice ASCII message and a sanitized cause", () => {
    fc.assert(
      fc.property(arbErrorCase, (c) => {
        const cause = c.cause
          ? Object.assign(
              new Error(
                `${c.cause.prefix}${c.secrets[c.cause.secretIndex % c.secrets.length]}${c.cause.suffix}`,
              ),
              { name: c.cause.name },
            )
          : undefined;
        const err = summonerError(c.code, { ...c.ctx, secrets: c.secrets }, cause);

        // Typed (R7.1, R7.10)
        expect(err).toBeInstanceOf(NecroError);
        expect(err).toBeInstanceOf(SummonerError);
        expect(err.code).toBe(c.code);

        // In voice: ASCII, exactly one line break, mystical line <= 16 words (R7.10)
        const msg = err.userMessage;
        expect(msg.length).toBeGreaterThan(0);
        expect(msg).toMatch(/^[\x20-\x7E\n]+$/);
        const lines = msg.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]!.trim().split(/\s+/).length).toBeLessThanOrEqual(16);
        expect(lines[0]!.trim().length).toBeGreaterThan(0);
        expect(lines[1]!.trim().length).toBeGreaterThan(0);

        // No secret echo anywhere in the message or details (R7.8)
        for (const s of c.secrets) {
          expect(msg).not.toContain(s);
          expect(JSON.stringify(err.details)).not.toContain(s);
        }
        if (c.code === "AUTH_INVALID") expect(msg).toContain("GITHUB_TOKEN");

        // Named ref for REF_NOT_FOUND (R7.7); other codes echo no ref
        if (c.code === "REF_NOT_FOUND") {
          expect(msg).toContain(`Ref "${String(c.ctx["ref"])}"`);
        }

        // Sanitized cause retains name, redacts secrets (R7.11)
        if (cause) {
          expect(err.cause).toBeInstanceOf(Error);
          expect(err.cause).not.toBe(cause);
          const clean = err.cause as Error;
          expect(clean.name).toBe(cause.name);
          for (const s of c.secrets) {
            expect(clean.message).not.toContain(s);
            expect(clean.stack ?? "").not.toContain(s);
          }
        } else {
          expect(err.cause).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("REF_NOT_FOUND masks a secret-shaped ref instead of echoing it (R7.7, R7.8)", () => {
    fc.assert(
      fc.property(arbOwnerOrName, arbOwnerOrName, arbSecret, arbPlainRef, (owner, name, secret, tail) => {
        const ref = `${secret}/${tail}`;
        const err = summonerError("REF_NOT_FOUND", { owner, name, ref, secrets: [secret] });
        expect(err.userMessage).not.toContain(secret);
        expect(err.userMessage).toContain("[REDACTED]");
        expect(String(err.details.ref ?? "")).not.toContain(secret);
      }),
      { numRuns: 200 },
    );
  });
});

// Task 15.2. Test-first: fails until src/http-failure.ts exists (task 15.4).
type Ctx29 = Parameters<typeof classifyFailure>[1];
type Failure29 = Parameters<typeof classifyFailure>[0];

const NOW_29 = 1_700_000_000_000;

function ctx29(endpoint: string, authenticated: boolean, extra: Record<string, unknown> = {}): Ctx29 {
  return {
    endpoint,
    repo: { owner: "octocat", name: "Hello-World" },
    repoProven: endpoint !== "repo",
    optional: endpoint === "pulls" || endpoint === "release",
    allowRepoRedirect: false,
    authenticated,
    ...extra,
  } as unknown as Ctx29;
}

function httpFailure(status: number, headers: Record<string, string> = {}): Failure29 {
  return { kind: "http", status, headers } as Failure29;
}

function expectCode(result: unknown, code: string): void {
  expect(result).toBeInstanceOf(SummonerError);
  expect(result).toBeInstanceOf(NecroError);
  expect((result as SummonerError).code).toBe(code);
}

describe("P29 (R2.9, R7.3, R7.6, R9.6): HTTP and transport failure classification", () => {
  // Feature: 02-github-summoner, Property 29: HTTP and transport failure classification
  // **Validates: Requirements R2.9, R7.3, R7.6, R9.6**
  it("404 on the repo endpoint is REPO_NOT_FOUND when authenticated, REPO_PRIVATE otherwise", () => {
    fc.assert(
      fc.property(fc.boolean(), arbNoRateLimitHeaders, (authenticated, headers) => {
        const out = classifyFailure(httpFailure(404, headers), ctx29("repo", authenticated), NOW_29);
        expectCode(out, authenticated ? "REPO_NOT_FOUND" : "REPO_PRIVATE");
      }),
      { numRuns: 200 },
    );
  });

  it("a repo payload with private: true is REPO_PRIVATE", () => {
    fc.assert(
      fc.property(fc.boolean(), (authenticated) => {
        const out = classifyFailure(
          { kind: "private-payload" } as Failure29,
          ctx29("repo", authenticated),
          NOW_29,
        );
        expectCode(out, "REPO_PRIVATE");
      }),
      { numRuns: 200 },
    );
  });

  it("transport errors: NETWORK_TIMEOUT on repo/commit/tarball, degraded outcome on pulls/release", () => {
    fc.assert(
      fc.property(
        arbEndpoint,
        fc.constantFrom("timeout" as const, "network" as const),
        fc.boolean(),
        (endpoint, kind, authenticated) => {
          const failure = {
            kind: "transport",
            error: new FetchTransportError(kind, `${kind} happened`),
          } as Failure29;
          const out = classifyFailure(failure, ctx29(endpoint, authenticated), NOW_29);
          if (endpoint === "pulls" || endpoint === "release") {
            expect(out).not.toBeInstanceOf(Error);
            expect(out).toMatchObject({ status: "degraded", field: endpoint, cause: kind });
          } else {
            expectCode(out, "NETWORK_TIMEOUT");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("403 without rate-limit signals on the repo endpoint is REPO_PRIVATE", () => {
    fc.assert(
      fc.property(arbNoRateLimitHeaders, fc.boolean(), (headers, authenticated) => {
        const out = classifyFailure(httpFailure(403, headers), ctx29("repo", authenticated), NOW_29);
        expectCode(out, "REPO_PRIVATE");
      }),
      { numRuns: 200 },
    );
  });

  it("a 3xx on any REST endpoint outside the permitted rename redirect is VALIDATION_FAILED", () => {
    fc.assert(
      fc.property(
        arbRestEndpoint,
        arbRedirectStatus,
        fc.boolean(),
        (endpoint, status, authenticated) => {
          const out = classifyFailure(
            httpFailure(status, { location: "https://api.github.com/repositories/1" }),
            ctx29(endpoint, authenticated, { allowRepoRedirect: false }),
            NOW_29,
          );
          expectCode(out, "VALIDATION_FAILED");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("any other unexpected status is VALIDATION_FAILED", () => {
    fc.assert(
      fc.property(arbEndpoint, arbUnexpectedStatus, fc.boolean(), (endpoint, status, authenticated) => {
        const out = classifyFailure(httpFailure(status), ctx29(endpoint, authenticated), NOW_29);
        expectCode(out, "VALIDATION_FAILED");
      }),
      { numRuns: 200 },
    );
  });

  it("the mapping never throws a non-NecroError", () => {
    fc.assert(
      fc.property(
        arbEndpoint,
        fc.integer({ min: 100, max: 599 }),
        arbNoRateLimitHeaders,
        fc.boolean(),
        (endpoint, status, headers, authenticated) => {
          try {
            classifyFailure(httpFailure(status, headers), ctx29(endpoint, authenticated), NOW_29);
          } catch (e) {
            expect(e).toBeInstanceOf(NecroError);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Task 15.3. Test-first: fails until src/http-failure.ts exists (task 15.4).
type RetryAfter30 =
  | { kind: "absent" }
  | { kind: "malformed"; value: string }
  | { kind: "seconds"; seconds: number }
  | { kind: "date"; deltaSec: number };

type Case30 = {
  status: number;
  endpoint: string;
  authenticated: boolean;
  nowMs: number;
  retryAfter: RetryAfter30;
  remainingZero: boolean;
  resetOffsetSec: number | null; // null: header absent; otherwise epoch second relative to now
  resetMalformed: boolean;
  hint: boolean;
};

const arbRetryAfter30: fc.Arbitrary<RetryAfter30> = fc.oneof(
  fc.constant<RetryAfter30>({ kind: "absent" }),
  fc
    .constantFrom("soon", "later", "never", "xyz", "", "   ", "??")
    .map((value): RetryAfter30 => ({ kind: "malformed", value })),
  fc.integer({ min: 0, max: 7 * 24 * 3600 }).map((seconds): RetryAfter30 => ({ kind: "seconds", seconds })),
  fc.integer({ min: 2, max: 7 * 24 * 3600 }).map((deltaSec): RetryAfter30 => ({ kind: "date", deltaSec })),
);

const arbCase30: fc.Arbitrary<Case30> = fc.record({
  status: fc.constantFrom(403, 429),
  endpoint: fc.constantFrom("repo", "commit", "pulls", "release", "tarball"),
  authenticated: fc.boolean(),
  nowMs: fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 }),
  retryAfter: arbRetryAfter30,
  remainingZero: fc.boolean(),
  resetOffsetSec: fc.option(fc.integer({ min: -3600, max: 7 * 24 * 3600 }), { nil: null }),
  resetMalformed: fc.boolean(),
  hint: fc.boolean(),
});

function headers30(c: Case30): Record<string, string> {
  const h: Record<string, string> = {};
  if (c.retryAfter.kind === "malformed") h["retry-after"] = c.retryAfter.value;
  if (c.retryAfter.kind === "seconds") h["retry-after"] = String(c.retryAfter.seconds);
  if (c.retryAfter.kind === "date") {
    const dateMs = c.nowMs + c.retryAfter.deltaSec * 1000;
    h["retry-after"] = new Date(dateMs).toUTCString();
  }
  if (c.remainingZero) h["x-ratelimit-remaining"] = "0";
  if (c.resetMalformed) h["x-ratelimit-reset"] = "not-a-number";
  else if (c.resetOffsetSec !== null) {
    h["x-ratelimit-reset"] = String(Math.floor(c.nowMs / 1000) + c.resetOffsetSec);
  }
  return h;
}

/** Oracle for the expected wait in whole minutes, or null when the case carries no rate-limit signal. */
function expectedMinutes30(c: Case30): number | null {
  const ra = c.retryAfter;
  if (ra.kind === "seconds") return Math.max(1, Math.ceil(ra.seconds / 60));
  if (ra.kind === "date") {
    const dateMs = Math.floor((c.nowMs + ra.deltaSec * 1000) / 1000) * 1000; // HTTP-date has 1 s precision
    return Math.max(1, Math.ceil((dateMs - c.nowMs) / 60_000));
  }
  const hasSignal = c.status === 429 || c.remainingZero || c.hint || ra.kind === "malformed";
  if (!hasSignal) return null;
  if (c.remainingZero && c.resetOffsetSec !== null && !c.resetMalformed) {
    const resetMs = (Math.floor(c.nowMs / 1000) + c.resetOffsetSec) * 1000;
    return Math.max(1, Math.ceil((resetMs - c.nowMs) / 60_000));
  }
  return 1;
}

describe("P30 (R7.4, R7.5): rate-limit wait is computed from the clock", () => {
  // Feature: 02-github-summoner, Property 30: Rate-limit wait is computed from the clock
  // **Validates: Requirements R7.4, R7.5**
  it("RATE_LIMITED states max(1, ceil(wait / 60 s)) taken from Retry-After, else the reset instant, else 1", () => {
    fc.assert(
      fc.property(arbCase30, (c) => {
        const expected = expectedMinutes30(c);
        fc.pre(expected !== null);
        const bodyHint = c.hint ? "You have exceeded a secondary rate limit" : undefined;
        const failure = {
          kind: "http",
          status: c.status,
          headers: headers30(c),
          ...(bodyHint ? { bodyHint } : {}),
        } as Failure29;
        const out = classifyFailure(failure, ctx29(c.endpoint, c.authenticated), c.nowMs);

        expectCode(out, "RATE_LIMITED");
        const err = out as SummonerError;
        expect(err.details.retryAfterMinutes).toBe(expected);
        expect(err.userMessage).toMatch(new RegExp(`\\b${expected} min`));
      }),
      { numRuns: 500 },
    );
  });

  it("429 with no usable header waits exactly one minute, whatever the clock", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 }),
        fc.constantFrom("repo", "commit", "pulls", "release", "tarball"),
        (nowMs, endpoint) => {
          const out = classifyFailure(httpFailure(429), ctx29(endpoint, false), nowMs);
          expectCode(out, "RATE_LIMITED");
          expect((out as SummonerError).details.retryAfterMinutes).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
