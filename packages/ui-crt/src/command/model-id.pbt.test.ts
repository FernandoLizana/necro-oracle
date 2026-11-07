// Feature: lovers-binding, Property 23 (R25.7): the safe model-id pattern
// accepts only safe model ids.
//
// Validates: Requirements 25.7
//
// `MODEL_ID_RE` (exported from `./parse.js`) is the single source of truth for
// the `model fast|strong <id>` command and the server-side `ModelOverrides`
// schema. It must ACCEPT OpenRouter-style ids — `vendor/model`, optional
// leading `~` routing hint, optional `:tag` — where every segment is a run of
// [a-z0-9] joined by single `.` / `_` / `-`, total length 1..128; and REJECT
// everything unsafe: empty, over-length, whitespace, control chars, path
// traversal (`..`), leading/trailing/doubled separators, a bare vendor with no
// `/`, shell metacharacters and injection-ish payloads.
//
// Two generators mirror the two sides of the regex: a grammar-driven VALID
// generator built to satisfy the pattern, and an adversarial INVALID generator.
// The property asserts the regex accepts every valid id and rejects every
// invalid one, and that the two sets are disjoint under the regex. The test is
// pure and deterministic (no network, LLM, sandbox, clock or DOM); fast-check
// is seeded so a counterexample is reproducible.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MODEL_ID_RE } from "./parse.js";

// --- Valid-id grammar (mirrors MODEL_ID_RE) ---------------------------------
//
// A segment is a run of [A-Za-z0-9] joined by SINGLE `.` / `_` / `-` separators,
// with no leading/trailing/doubled separator. The regex is case-insensitive, so
// upper-case letters are included to exercise the `/i` flag.

const SEP = [".", "_", "-"] as const;

/** One alphanumeric run (no separators), 1..8 chars. */
const arbAlnumRun: fc.Arbitrary<string> = fc.stringMatching(
  /^[A-Za-z0-9]{1,8}$/,
);

/**
 * A grammar segment: `run (sep run)*` — alphanumeric runs joined by single
 * separators, so it never starts/ends with a separator and never doubles one.
 */
const arbSegment: fc.Arbitrary<string> = fc
  .tuple(
    arbAlnumRun,
    fc.array(fc.tuple(fc.constantFrom(...SEP), arbAlnumRun), { maxLength: 3 }),
  )
  .map(([head, rest]) => head + rest.map(([s, r]) => s + r).join(""));

/**
 * A valid OpenRouter-style id: optional leading `~`, `vendor/model`, optional
 * `:tag`, total length capped at 128 (the regex's `(?=.{1,128}$)` bound).
 */
const arbValidModelId: fc.Arbitrary<string> = fc
  .tuple(
    fc.boolean(), // leading `~`
    arbSegment, // vendor
    arbSegment, // model
    fc.option(arbSegment, { nil: undefined }), // `:tag`
  )
  .map(
    ([tilde, vendor, model, tag]) =>
      `${tilde ? "~" : ""}${vendor}/${model}${tag === undefined ? "" : `:${tag}`}`,
  )
  .filter((id) => id.length <= 128);

// --- Invalid-id generators (adversarial) ------------------------------------

/** A string of 129..160 otherwise-valid chars: over the 128 length bound. */
const arbOverLength: fc.Arbitrary<string> = fc
  .integer({ min: 129, max: 160 })
  .chain((len) =>
    fc
      .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
        minLength: len - 5,
        maxLength: len - 5,
      })
      .map((model) => `vendor/${model}`),
  )
  .filter((id) => id.length > 128);

/** Classic bad shapes that must never be accepted. */
const arbMalformedShape: fc.Arbitrary<string> = fc.constantFrom(
  "", // empty
  "vendor", // bare vendor, no slash
  "vendor/", // trailing slash → empty model
  "/model", // leading slash → empty vendor
  "vendor//model", // doubled slash
  "vendor/model/extra", // two slashes
  "../etc/passwd", // path traversal
  "vendor/../model", // traversal mid-path
  "vendor/..", // trailing traversal
  "..", // bare traversal
  ".vendor/model", // leading separator in segment
  "vendor-/model", // trailing separator in segment
  "vendor/model-", // trailing separator in model
  "vendor/-model", // leading separator in model
  "vendor/mo..del", // doubled dot inside segment
  "vendor/mo__del", // doubled underscore inside segment
  "vendor/model:", // empty tag
  "vendor/model:ta:g", // second colon
  "~/model", // tilde then empty vendor
  "~~vendor/model", // doubled tilde
  "vendor/mo~del", // tilde mid-segment
  "ven dor/model", // internal space
  " vendor/model", // leading space
  "vendor/model ", // trailing space
  "vendor/model\t", // tab
  "vendor/model\n", // newline
  "vendor/model;rm -rf /", // shell metachar
  "vendor/model`whoami`", // backticks
  "vendor/model$(id)", // command substitution
  "vendor/model|cat", // pipe
  "vendor/model&bg", // ampersand
  "vendor/model#frag", // hash
  "vendor/model?q=1", // query
  "vendor/mod@el", // at sign
  "vendor/mod el", // space in model
  "http://evil/model", // scheme/colon-slash-slash
  "vendor\\model", // backslash instead of slash
  "vendor/модель", // non-ascii letters
  "vendor/mödel", // accented char
);

/** An id carrying a single injected control character (0x00..0x1F or 0x7F). */
const arbControlCharId: fc.Arbitrary<string> = fc
  .oneof(fc.integer({ min: 0x00, max: 0x1f }), fc.constant(0x7f))
  .map((c) => `vendor/mo${String.fromCodePoint(c)}del`);

/** An id carrying a single injected whitespace character. */
const arbWhitespaceId: fc.Arbitrary<string> = fc
  .constantFrom(" ", "\t", "\n", "\r", "\u000B", "\u000C", "\u00A0", "\u2003")
  .map((ws) => `vendor/mo${ws}del`);

const arbInvalidModelId: fc.Arbitrary<string> = fc.oneof(
  arbMalformedShape,
  arbOverLength,
  arbControlCharId,
  arbWhitespaceId,
);

// Explicit examples from the task/design that MUST be accepted.
const ACCEPTED_EXAMPLES = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-sonnet",
  "meta-llama/llama-3.1-70b-instruct:free",
  "~mistralai/mixtral-8x7b:nitro",
  "a/b", // minimal
  "A/B:C", // upper-case (exercises /i)
] as const;

// Explicit examples that MUST be rejected.
const REJECTED_EXAMPLES = [
  "",
  "openai",
  "openai/",
  "/gpt-4o",
  "../../../etc/passwd",
  "openai/gpt-4o;rm -rf /",
  "openai/gpt 4o",
  "openai//gpt-4o",
  "~/gpt-4o",
  "openai/gpt-4o:",
] as const;

describe("P23 (R25.7): the safe model-id pattern accepts only safe model ids", () => {
  it("accepts every grammar-valid OpenRouter-style id", () => {
    fc.assert(
      fc.property(arbValidModelId, (id) => {
        expect(MODEL_ID_RE.test(id)).toBe(true);
        expect(id.length).toBeGreaterThanOrEqual(1);
        expect(id.length).toBeLessThanOrEqual(128);
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects every adversarially-malformed id", () => {
    fc.assert(
      fc.property(arbInvalidModelId, (id) => {
        expect(MODEL_ID_RE.test(id)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it("the valid and invalid generators are disjoint under the regex", () => {
    fc.assert(
      fc.property(arbValidModelId, arbInvalidModelId, (good, bad) => {
        // A generated-valid id is never a generated-invalid id, and the regex
        // separates the two sets cleanly.
        expect(MODEL_ID_RE.test(good)).toBe(true);
        expect(MODEL_ID_RE.test(bad)).toBe(false);
        expect(good).not.toBe(bad);
      }),
      { numRuns: 1000 },
    );
  });

  it.each(ACCEPTED_EXAMPLES)("accepts the documented id %j", (id) => {
    expect(MODEL_ID_RE.test(id)).toBe(true);
  });

  it.each(REJECTED_EXAMPLES)("rejects the unsafe id %j", (id) => {
    expect(MODEL_ID_RE.test(id)).toBe(false);
  });
});
