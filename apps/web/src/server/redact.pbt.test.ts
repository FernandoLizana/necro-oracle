// apps/web/src/server/redact.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 14: token redaction
//
// Property-based tests for the server redaction helpers (task 21.1,
// TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `server/redact.ts`
// (task 21.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module `./redact.js` does not exist yet.
//
// Property 14 (requirements.md §"P14 — token redaction (R12.6, R14.7)";
// design.md §"Redaction"): for every token value, `redactString` and
// `redactDeep` leave no occurrence of the token in any string leaf of their
// result; an undefined (or empty) token leaves the input unchanged.
//
// Contract under test (design.md §"Redaction"):
//   redactString(s: string, token?: string): string
//   redactDeep(value: unknown, token?: string): unknown
//     - replace every occurrence of a NON-EMPTY token with the fixed marker
//       "[REDACTED]" in every string leaf of a JSON-like value;
//     - an undefined or empty token is a no-op (input returned unchanged).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R12.6, R14.7**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 21.2 adds this module.
import { redactDeep, redactSecrets, redactString } from "./redact.js";

/** P14 runs the default property budget. */
const NUM_RUNS = 200;

/** The fixed marker the redactors must substitute for the token. */
const MARKER = "[REDACTED]";

/**
 * Non-empty token values (secrets) to redact. A token that is itself a
 * substring of the marker is excluded: the redactor inserts the literal
 * {@link MARKER}, so a token drawn from the marker's own characters (e.g. the
 * single letter "R") could never be absent from the result while the marker is
 * present. Such tokens are not realistic secrets, so the generator skips them.
 */
const arbToken: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.constantFrom("ghp_abc123", "github_pat_11A", "secret", "x", "::"),
  )
  .filter((token) => token.length > 0 && !MARKER.includes(token));

/** Collect every string leaf of a JSON-like value. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringLeaves);
  }
  return [];
}

/**
 * A JSON-like arbitrary whose string leaves may embed the given token, so that
 * redaction has something to remove. Leaves are built by interleaving noise
 * with zero-or-more copies of the token.
 */
function arbValueWithToken(token: string): fc.Arbitrary<unknown> {
  const arbLeafString = fc
    .array(fc.string({ maxLength: 6 }), { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join(token));
  const arbPrimitive = fc.oneof(
    arbLeafString,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  );
  return fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      arbPrimitive,
      fc.array(tie("node"), { maxLength: 4 }),
      fc.dictionary(fc.string({ maxLength: 6 }), tie("node"), {
        maxKeys: 4,
      }),
    ),
  })).node;
}

describe("P14 (R12.6, R14.7): token redaction", () => {
  it("redactString leaves no occurrence of a non-empty token", () => {
    fc.assert(
      fc.property(arbToken, fc.string({ maxLength: 30 }), (token, noise) => {
        const input = `${noise}${token}${noise}${token}`;
        const out = redactString(input, token);
        expect(out.includes(token)).toBe(false);
        expect(out.includes(MARKER)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("redactDeep leaves no token in any string leaf of a nested value", () => {
    fc.assert(
      fc.property(
        arbToken.chain((token) =>
          fc.tuple(fc.constant(token), arbValueWithToken(token)),
        ),
        ([token, value]) => {
          const out = redactDeep(value, token);
          for (const leaf of stringLeaves(out)) {
            expect(leaf.includes(token)).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a no-op when the token is undefined (redactString and redactDeep)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        expect(redactString(s, undefined)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
    fc.assert(
      fc.property(
        fc.anything({ maxDepth: 3, maxKeys: 4 }),
        (value) => {
          expect(redactDeep(value, undefined)).toEqual(value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a no-op when the token is the empty string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        expect(redactString(s, "")).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is idempotent: redacting twice equals redacting once", () => {
    fc.assert(
      fc.property(
        arbToken.chain((token) =>
          fc.tuple(fc.constant(token), arbValueWithToken(token)),
        ),
        ([token, value]) => {
          const once = redactDeep(value, token);
          const twice = redactDeep(once, token);
          expect(twice).toEqual(once);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves non-string leaves and structure", () => {
    const value = {
      n: 42,
      b: true,
      nil: null,
      list: ["keepsecretkeep", 7],
      nested: { s: "presecretpost" },
    };
    const out = redactDeep(value, "secret") as typeof value;
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.nil).toBeNull();
    expect(out.list[1]).toBe(7);
    expect(out.list[0]).toBe(`keep${MARKER}keep`);
    expect(out.nested.s).toBe(`pre${MARKER}post`);
  });
});

// ---------------------------------------------------------------------------
// SEC-04: redactSecrets (multi-token string redaction for log lines)
// ---------------------------------------------------------------------------

describe("SEC-04 (R19.4, R27.2): redactSecrets strips EVERY in-scope token", () => {
  it("leaves no supplied token in the result, for any set of tokens", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 4, maxLength: 24 }).filter((t) => !/[\s\[\]]/.test(t) && !MARKER.includes(t) && t.length > 0), { minLength: 1, maxLength: 4 }),
        fc.string(),
        (tokens, filler) => {
          const line = tokens.map((t) => "prefix " + t + " suffix").join(" | ") + " " + filler;
          const out = redactSecrets(line, tokens);
          expect(out).toBeDefined();
          for (const t of tokens) expect(out as string).not.toContain(t);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps undefined input to undefined (an absent stack stays absent)", () => {
    expect(redactSecrets(undefined, ["sk-secret"])).toBeUndefined();
  });

  it("skips undefined/empty tokens and keeps non-secret text", () => {
    const out = redactSecrets("hello sk-LEAK world", [undefined, "", "sk-LEAK"]);
    expect(out).toBe("hello " + MARKER + " world");
  });
});
