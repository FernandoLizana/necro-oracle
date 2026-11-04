// apps/web/src/server/error-map.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 13: error to status mapping
//
// Property-based tests for the server error mapper (task 21.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `server/error-map.ts`
// (task 21.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module `./error-map.js` does not exist yet.
//
// Property 13 (requirements.md §"P13 — error to status mapping (R12.4, R12.5)";
// design.md §"Error mapper"): for every NecroErrorCode the mapper produces the
// documented HTTP status; a thrown NecroError maps to that status plus an
// Error_Envelope of exactly { error: { code, userMessage } } with no `cause`;
// any non-NecroError throwable maps to 500 with code UPSTREAM_UNAVAILABLE and a
// fixed Oracle-voice message that contains none of the thrown exception's
// message or stack text (R12.5, R12.7).
//
// Contract under test (design.md §"Error mapper"):
//   interface MappedError {
//     readonly status: number;
//     readonly body: ErrorEnvelope;                       // { error: { code, userMessage } }
//     readonly headers: Readonly<Record<string, string>>;
//   }
//   statusFor(code: NecroErrorCode): number;              // the full table below
//   mapError(err: unknown, token?: string): MappedError;  // envelope after redactString, no cause
//
// Code -> status table (R12.4 / Q2 / Q10):
//   INVALID_REPO_URL, VALIDATION_FAILED        -> 400
//   REPO_PRIVATE                               -> 403
//   REPO_NOT_FOUND, REF_NOT_FOUND              -> 404
//   DOWNLOAD_TOO_LARGE                         -> 413
//   RATE_LIMITED                               -> 429
//   AUTH_INVALID, UPSTREAM_UNAVAILABLE         -> 502
//   NETWORK_TIMEOUT                            -> 504
//   every other code                           -> 500
//   non-NecroError throwable                    -> 500 + UPSTREAM_UNAVAILABLE
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R12.4, R12.5, R12.7**
import {
  NecroError,
  NecroErrorCodeSchema,
  type NecroErrorCode,
} from "@necro/oracle/client";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 21.2 adds this module.
import { mapError, rateLimitedError, statusFor } from "./error-map.js";

/** P13 runs the default property budget. */
const NUM_RUNS = 200;

/**
 * The expected status for each code, kept independently of the SUT so the test
 * is an oracle rather than a mirror. Every code not listed here maps to 500.
 */
const EXPECTED_STATUS: Partial<Record<NecroErrorCode, number>> = {
  INVALID_REPO_URL: 400,
  VALIDATION_FAILED: 400,
  REPO_PRIVATE: 403,
  REPO_NOT_FOUND: 404,
  REF_NOT_FOUND: 404,
  DOWNLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AUTH_INVALID: 502,
  UPSTREAM_UNAVAILABLE: 502,
  NETWORK_TIMEOUT: 504,
};

/** The full, enumerated set of NecroError codes (totality source). */
const ALL_CODES: readonly NecroErrorCode[] = NecroErrorCodeSchema.options;

/** Every code arbitrary draws from the exhaustive enum. */
const arbCode: fc.Arbitrary<NecroErrorCode> = fc.constantFrom(...ALL_CODES);

/** A NecroError arbitrary over all codes with arbitrary oracle-voice text. */
const arbNecroError: fc.Arbitrary<NecroError> = fc
  .record({
    code: arbCode,
    userMessage: fc.string({ minLength: 1, maxLength: 80 }),
  })
  .map(({ code, userMessage }) => new NecroError(code, userMessage));

/**
 * Non-NecroError throwables: plain strings, Errors with stacks, bare objects,
 * numbers and null/undefined. Each carries a recognisable marker so the test
 * can assert the mapped body leaks none of it.
 */
const SECRET_MARKER = "LEAK_MARKER_7f3a";
const arbThrowable: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ maxLength: 40 }).map((s) => `${s}${SECRET_MARKER}`),
  fc
    .string({ maxLength: 40 })
    .map((s) => new Error(`${s} ${SECRET_MARKER} boom`)),
  fc.record({ message: fc.constant(`${SECRET_MARKER} detail`) }),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(new TypeError(`type ${SECRET_MARKER}`)),
);

describe("P13 (R12.4, R12.5): error to status mapping", () => {
  it("statusFor returns the documented status for every NecroErrorCode", () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        const expected = EXPECTED_STATUS[code] ?? 500;
        expect(statusFor(code)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is total: every code in the enum has a positive integer status", () => {
    for (const code of ALL_CODES) {
      const status = statusFor(code);
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("maps a thrown NecroError to { status, body:{error:{code,userMessage}} } with no cause", () => {
    fc.assert(
      fc.property(arbNecroError, (err) => {
        const mapped = mapError(err);
        expect(mapped.status).toBe(statusFor(err.code));
        // Envelope is exactly { error: { code, userMessage } } — no cause/stack.
        expect(mapped.body.error.code).toBe(err.code);
        expect(typeof mapped.body.error.userMessage).toBe("string");
        expect(Object.keys(mapped.body.error).sort()).toEqual([
          "code",
          "userMessage",
        ]);
        expect(Object.keys(mapped.body)).toEqual(["error"]);
        // `cause` is never read or serialised anywhere in the mapped value.
        expect(JSON.stringify(mapped)).not.toContain("cause");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps any non-NecroError throwable to 500 + UPSTREAM_UNAVAILABLE with no exception text", () => {
    fc.assert(
      fc.property(arbThrowable, (thrown) => {
        const mapped = mapError(thrown);
        expect(mapped.status).toBe(500);
        expect(mapped.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
        // The fixed oracle-voice message must be non-empty and leak nothing of
        // the thrown value's message or stack (R12.5, R12.7).
        expect(mapped.body.error.userMessage.length).toBeGreaterThan(0);
        const serialised = JSON.stringify(mapped);
        expect(serialised).not.toContain(SECRET_MARKER);
        expect(serialised).not.toContain("cause");
        expect(serialised).not.toContain("stack");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("uses one fixed message for every non-NecroError (independent of the throwable)", () => {
    const messages = new Set<string>();
    fc.assert(
      fc.property(arbThrowable, (thrown) => {
        messages.add(mapError(thrown).body.error.userMessage);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(messages.size).toBe(1);
  });
});

describe("rateLimitedError / Retry-After arithmetic (R12.4)", () => {
  it("rounds seconds up to whole minutes (minutes = max(1, ceil(sec/60)))", () => {
    const cases: readonly (readonly [number, number])[] = [
      [0, 1],
      [1, 1],
      [59, 1],
      [60, 1],
      [61, 2],
      [120, 2],
      [121, 3],
    ];
    for (const [seconds, minutes] of cases) {
      const err = rateLimitedError(seconds);
      expect(err).toBeInstanceOf(NecroError);
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.userMessage).toBe(
        `The oracle must rest.\nToo many readings from this address. Retry in ${minutes} min.`,
      );
    }
  });

  it("holds for arbitrary non-negative seconds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 86_400 }), (seconds) => {
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        const err = rateLimitedError(seconds);
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.userMessage).toBe(
          `The oracle must rest.\nToo many readings from this address. Retry in ${minutes} min.`,
        );
        // A rate-limited error maps to 429 and never serialises a cause.
        const mapped = mapError(err);
        expect(mapped.status).toBe(429);
        expect(JSON.stringify(mapped)).not.toContain("cause");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
