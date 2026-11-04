// Feature: 03-crt-terminal, Property 22
// Test-first (task 3.1): P22 for the daily request ceiling config, plus example
// tests for the two new deployment keys. These are EXPECTED TO FAIL now because
// NECRO_DAILY_REQUEST_CEILING / NECRO_CLIENT_IP_HEADER / the Upstash keys and
// EnvValidationError do not exist in packages/config/src/index.ts yet (task 3.2).
// The pre-existing env.test.ts must stay green and unchanged.
//
// API assumed from design.md "@necro/config":
//   class EnvValidationError extends Error { readonly keys: readonly string[] }
//   EnvSchema adds NECRO_DAILY_REQUEST_CEILING (default 1000, positive safe int),
//     NECRO_CLIENT_IP_HEADER (default "x-real-ip"),
//     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (optional).
//   loadEnv(source) throws EnvValidationError on failure.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "../src/index.js";

const KEY = "NECRO_DAILY_REQUEST_CEILING";
const NUM_RUNS = 100;

/** Run loadEnv and return the thrown error, or fail if it did not throw. */
function caught(source: Record<string, string | undefined>): unknown {
  try {
    loadEnv(source);
  } catch (err) {
    return err;
  }
  throw new Error("expected loadEnv to throw");
}

describe("P22 (R13.4): daily ceiling config", () => {
  it("accepts exactly the positive integers as that positive integer", () => {
    fc.assert(
      fc.property(
        // Positive safe integers rendered in canonical decimal (no leading zero,
        // no sign, no decimal point, no exponent).
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        (n) => {
          const env = loadEnv({ GITHUB_TOKEN: undefined, [KEY]: String(n) });
          expect(env.NECRO_DAILY_REQUEST_CEILING).toBe(n);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("defaults to 1000 when the key is absent or blank", () => {
    fc.assert(
      fc.property(
        // Absent, or present-but-blank (empty / whitespace-only -> treated as unset).
        fc.oneof(
          fc.constant(undefined),
          fc.constant(""),
          fc
            .array(fc.constantFrom(" ", "\t", "\r", "\n"), { minLength: 1, maxLength: 6 })
            .map((parts) => parts.join("")),
        ),
        (raw) => {
          const env = loadEnv({ GITHUB_TOKEN: undefined, [KEY]: raw });
          expect(env.NECRO_DAILY_REQUEST_CEILING).toBe(1000);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects every non-positive-integer value with a typed error that names the key but not the value", () => {
    // Representatives of the rejected space from R13.4 / design.md, plus a
    // generated tail of malformed strings. None is a canonical positive integer.
    const fixedRejects = ["0", "-3", "1.5", "1e3", " 7", "abc"];
    const arbReject = fc.oneof(
      fc.constantFrom(...fixedRejects),
      fc.constantFrom("00", "007", "+7", "-0", "0.0", "1_000", "1,000", "0x10", "Infinity", "NaN", "  42  ", "4\t2"),
      // Any non-blank string that is not one-or-more digits without a leading
      // zero. The `s.trim().length > 0` guard excludes blank / whitespace-only
      // strings, which `blankToUndefined` treats as UNSET (they default to
      // 1000 and are NOT rejections).
      fc
        .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 12 })
        .filter((s) => !/^[1-9][0-9]*$/.test(s) && s.trim().length > 0),
    );

    fc.assert(
      fc.property(arbReject, (value) => {
        const err = caught({ GITHUB_TOKEN: undefined, [KEY]: value });
        expect(err).toBeInstanceOf(EnvValidationError);
        const typed = err as EnvValidationError;
        expect(typed.keys).toContain(KEY);
        expect(typed.message).toContain(KEY);
        // The offending value is never echoed back. The message is a fixed
        // template that names the key (e.g. "... NECRO_DAILY_REQUEST_CEILING is
        // malformed (value withheld)."), so a short value can coincidentally be
        // a substring of that template — e.g. "C" occurs inside the key name,
        // "a" inside "malformed". Those cases prove nothing about echoing, so we
        // assert non-containment only for values that are NOT already part of
        // the fixed template (built here with a sentinel key).
        const templateText = new EnvValidationError(["\u0000SENTINEL\u0000"]).message.replace(
          "\u0000SENTINEL\u0000",
          "",
        );
        const trimmed = value.trim();
        const incidental = templateText.includes(value) || templateText.includes(trimmed) || KEY.includes(value) || KEY.includes(trimmed);
        if (trimmed.length > 0 && !incidental) {
          expect(typed.message).not.toContain(value);
          expect(typed.message).not.toContain(trimmed);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Regression example (fast-check seed 591446375 once surfaced " " here).
  // A whitespace-only value is blank == unset per blankToUndefined, so it
  // DEFAULTS to 1000 and must NOT throw — it is not a rejection.
  it("treats a whitespace-only value as unset and defaults to 1000", () => {
    const env = loadEnv({ GITHUB_TOKEN: undefined, [KEY]: " " });
    expect(env.NECRO_DAILY_REQUEST_CEILING).toBe(1000);
  });
});

describe("loadEnv deployment keys (R13.9) — examples", () => {
  it("NECRO_CLIENT_IP_HEADER defaults to x-real-ip when absent or blank", () => {
    expect(loadEnv({ GITHUB_TOKEN: undefined }).NECRO_CLIENT_IP_HEADER).toBe("x-real-ip");
    expect(loadEnv({ GITHUB_TOKEN: undefined, NECRO_CLIENT_IP_HEADER: "" }).NECRO_CLIENT_IP_HEADER).toBe("x-real-ip");
    expect(loadEnv({ GITHUB_TOKEN: undefined, NECRO_CLIENT_IP_HEADER: "   " }).NECRO_CLIENT_IP_HEADER).toBe("x-real-ip");
  });

  it("NECRO_CLIENT_IP_HEADER accepts a configured lowercase header name", () => {
    expect(
      loadEnv({ GITHUB_TOKEN: undefined, NECRO_CLIENT_IP_HEADER: "cf-connecting-ip" }).NECRO_CLIENT_IP_HEADER,
    ).toBe("cf-connecting-ip");
  });

  it("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are optional and absent by default", () => {
    const env = loadEnv({ GITHUB_TOKEN: undefined });
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBeUndefined();
  });

  it("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are kept when present", () => {
    const env = loadEnv({
      GITHUB_TOKEN: undefined,
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "a-token-value",
    });
    expect(env.UPSTASH_REDIS_REST_URL).toBe("https://example.upstash.io");
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBe("a-token-value");
  });
});
