/**
 * @necro/oracle — property tests for `maskSecret` (task 5.3).
 *
 * Property 9: Secret masking length invariant.
 *   For any string s with s.length >= 4, maskSecret(s) is exactly 8 chars and
 *   equals s.slice(0, 4) + "****". For any s with s.length < 4, it is "****".
 *
 * Property 8 (masking side): No raw secrets survive masking.
 *   For any string — and specifically AWS-access-key-shaped and private-key-
 *   header-shaped inputs — maskSecret(s) never matches /AKIA[0-9A-Z]{16}/ and
 *   never contains "BEGIN RSA PRIVATE KEY" / "BEGIN PRIVATE KEY". The
 *   evidence-side of P8 (no Evidence.detail leaks a secret) is re-checked in the
 *   runReading PBT (task 33).
 *
 * These are pure, synchronous, no-network properties (R21.5, R21.6). fast-check
 * prints the shrunk counterexample and seed on failure by default.
 *
 * Validates: Requirements R20.1, R20.2, R20.3, R20.4 / Properties: P8, P9
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { maskSecret } from "./mask.js";

const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;
const RSA_PRIVATE_KEY_HEADER = "BEGIN RSA PRIVATE KEY";
const PKCS8_PRIVATE_KEY_HEADER = "BEGIN PRIVATE KEY";

/**
 * Generates AWS-access-key-id-shaped strings: literal "AKIA" followed by 16
 * uppercase-alphanumeric characters, i.e. values that match the exact pattern
 * the safety net (R20.3) must neutralise.
 */
const arbAwsKey: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9A-Z]{16}$/)
  .map((tail) => `AKIA${tail}`);

/** Generates private-key-header-shaped strings around the two header variants. */
const arbPrivateKeyHeader: fc.Arbitrary<string> = fc
  .constantFrom(
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
  )
  .chain((header) =>
    fc.string().map((noise) => `${header}\n${noise}`),
  );

describe("P9 (R20.1, R20.4): secret masking length invariant", () => {
  // Property 9 — Validates: Requirements R20.1, R20.4 / Properties: P9
  it("len >= 4 ⇒ exactly 8 chars = first 4 + '****'; len < 4 ⇒ '****'", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const masked = maskSecret(s);
        if (s.length >= 4) {
          expect(masked).toHaveLength(8);
          expect(masked).toBe(s.slice(0, 4) + "****");
        } else {
          expect(masked).toBe("****");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("holds for arbitrarily long strings (length >= 4 branch)", () => {
    const arbLong = fc
      .tuple(fc.string({ minLength: 4 }), fc.string({ minLength: 100 }))
      .map(([a, b]) => a + b);
    fc.assert(
      fc.property(arbLong, (s) => {
        const masked = maskSecret(s);
        expect(masked).toHaveLength(8);
        expect(masked).toBe(s.slice(0, 4) + "****");
      }),
      { numRuns: 200 },
    );
  });
});

describe("P8 (R20.2, R20.3): no raw secrets survive masking", () => {
  // Property 8 (masking side) — Validates: Requirements R20.2, R20.3 / P8
  it("output never matches the AWS key pattern or private-key headers for any string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const masked = maskSecret(s);
        expect(masked).not.toMatch(AWS_KEY_PATTERN);
        expect(masked).not.toContain(RSA_PRIVATE_KEY_HEADER);
        expect(masked).not.toContain(PKCS8_PRIVATE_KEY_HEADER);
      }),
      { numRuns: 200 },
    );
  });

  it("neutralises AWS-access-key-shaped inputs (AKIA + 16 uppercase-alnum)", () => {
    fc.assert(
      fc.property(arbAwsKey, (s) => {
        // Precondition: the generated input really is a raw AWS key id.
        expect(s).toMatch(AWS_KEY_PATTERN);
        const masked = maskSecret(s);
        expect(masked).toBe("AKIA****");
        expect(masked).not.toMatch(AWS_KEY_PATTERN);
      }),
      { numRuns: 200 },
    );
  });

  it("neutralises private-key-header-shaped inputs", () => {
    fc.assert(
      fc.property(arbPrivateKeyHeader, (s) => {
        const masked = maskSecret(s);
        expect(masked).toBe("----****");
        expect(masked).not.toContain(RSA_PRIVATE_KEY_HEADER);
        expect(masked).not.toContain(PKCS8_PRIVATE_KEY_HEADER);
      }),
      { numRuns: 200 },
    );
  });

  // --- Regression examples (permanent counterexamples) -------------------
  //
  // When a counterexample is found by a property above, record it here as a
  // named example test so it is checked forever after. None found yet.
});
