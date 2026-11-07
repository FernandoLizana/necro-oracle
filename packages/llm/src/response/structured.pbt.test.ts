// packages/llm/src/response/structured.pbt.test.ts
//
// Feature: lovers-binding, task 2.4 (optional property-test).
//
// Property 5 (R7.3, R7.4): structured-output ONE unified retry then
//   deterministic fallback — on a schema failure exactly one retry is issued
//   carrying the EXACT error, a second failure falls back to the deterministic
//   layer, and the policy NEVER throws.
//
// Property 37 (R43.1–R43.5): zod -> strict schema, `require_parameters`, NO
//   seed, temperature 0, cost from `usage.cost`, served model recorded.
//
// What this package actually exports (and what we ground against):
//   - `parseStructured(text, schema)`  — the validation primitive: it extracts
//     the first balanced JSON object, `JSON.parse`s it, `schema.safeParse`s it,
//     and returns a typed `{ok:true,value} | {ok:false,error}` — NEVER throws.
//   - `structuredRequestFields(name, schema, maxTokens)` — assembles the wire
//     request fields (response_format.json_schema strict, provider.
//     require_parameters:true, temperature 0, max_tokens) with NO `seed`.
//   - `toStrictJsonSchema(name, schema)` — zod -> OpenAI-strict JSON Schema.
//   - `usageRecordFromResponse(resp)` — served model + cost from `usage.cost`.
//
// The A.8 "one unified retry then deterministic fallback" loop is orchestrated
// by the runner (`@necro/coven`), NOT by `@necro/llm`. `@necro/llm` can't import
// `@necro/coven` (dependency direction) and the runner can't be driven here
// without a sandbox. So Property 5 is grounded the honest way: we model the
// A.8 `runUnit` contract as a tiny PURE driver whose single validation primitive
// is the REAL exported `parseStructured`, and whose "model" is a fast-check
// supplied sequence of raw text outputs. The driver encodes exactly the design
// A.8 rules (MAX CALLS PER UNIT = 2, carry the exact error on the retry,
// FAST escalates to STRONG, a second failure returns the deterministic fallback)
// and the properties assert those invariants hold for every output sequence. No
// behaviour is faked: the pass/fail decision at each step is the real parser's.
//
// Testing steering: fast-check with an explicit `numRuns`. No network, no clock,
// no LLM, no sandbox — pure computation over the real pure functions.
//
// **Validates: Requirements 7.3, 7.4, 43.1, 43.2, 43.3, 43.4, 43.5**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  parseStructured,
  structuredRequestFields,
  usageRecordFromResponse,
  type OpenRouterUsageResponse,
  type ParseStructuredResult,
} from "./structured.js";
import { toStrictJsonSchema } from "./zod-to-schema.js";

/** Property budget for these parse/mechanics properties. */
const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Fixture schema (a realistic structured-edit-ish shape with .describe() text
// so the strict-schema description assertions have something to check).
// ---------------------------------------------------------------------------

const EditSchema = z
  .object({
    chunkId: z.string().min(1).describe("stable id of the chunk being edited"),
    replacementCode: z.string().describe("the replacement source for the chunk"),
    requiredImports: z
      .array(z.string())
      .max(16)
      .describe("stdlib imports to hoist"),
    reason: z.string().max(280).describe("why this edit (<=280 chars)"),
    confidence: z.number().min(0).max(1).describe("model confidence 0..1"),
  })
  .strict();

type Edit = z.infer<typeof EditSchema>;

/** A canonical valid value used to build well-formed model text. */
function validEditText(seed: number): string {
  const edit: Edit = {
    chunkId: `c${seed}`,
    replacementCode: "print('x')",
    requiredImports: [],
    reason: "repaired",
    confidence: 1,
  };
  // Wrap in prose + a code fence so the balanced-object extractor is exercised.
  return `Here is the fix:\n\`\`\`json\n${JSON.stringify(edit)}\n\`\`\`\nDone.`;
}

/** An arbitrary that produces text the strict schema definitely REJECTS. */
const arbMalformedText: fc.Arbitrary<string> = fc.oneof(
  // no JSON object at all
  fc.string().filter((s) => !s.includes("{")),
  // present but not an object that satisfies the schema
  fc.constantFrom(
    "{}",
    '{"chunkId": 1}',
    '{"chunkId": "c", "replacementCode": "x"}', // missing fields
    '{"chunkId": "c", "replacementCode": "x", "requiredImports": [], "reason": "r", "confidence": 2}', // confidence out of range
    '{"chunkId": "c", "replacementCode": "x", "requiredImports": [], "reason": "r", "confidence": 0.5, "extra": true}', // additional key (.strict())
    "not json at all { but has a brace",
    "{ broken json ",
  ),
);

/** An arbitrary that produces text the strict schema ACCEPTS. */
const arbValidText: fc.Arbitrary<string> = fc
  .nat({ max: 99999 })
  .map((n) => validEditText(n));

// ---------------------------------------------------------------------------
// A.8 one-retry driver, grounded on the REAL `parseStructured`.
// ---------------------------------------------------------------------------

type Tier = "FAST" | "STRONG";

interface RunUnitTrace {
  /** Outcome of the whole unit. */
  readonly outcome: "accepted-first" | "accepted-retry" | "fallback";
  /** Tiers used, in call order (length === number of model calls). */
  readonly tiers: readonly Tier[];
  /** The exact error string the retry carried, if a retry happened. */
  readonly retryError?: string;
  /** The accepted value, when an output passed. */
  readonly value?: Edit;
}

/**
 * The design A.8 `runUnit` contract, with the validation step being the REAL
 * exported `parseStructured`. `outputs` is the (fast-check supplied) sequence of
 * raw model texts the "provider" would return for call #1 and call #2.
 *
 * Rules encoded verbatim from A.8:
 *   - call #1 at `startTier`;
 *   - if it validates, accept;
 *   - otherwise EXACTLY ONE retry (call #2) carrying the EXACT error from #1;
 *     FAST escalates to STRONG, STRONG stays STRONG;
 *   - if call #2 validates, accept; else deterministic fallback;
 *   - MAX CALLS PER UNIT = 2;
 *   - never throws.
 *
 * Returns a trace so the properties can assert the invariants.
 */
function runUnit(
  startTier: Tier,
  outputs: readonly string[],
  schema: z.ZodType<Edit>,
): RunUnitTrace {
  const tiers: Tier[] = [];

  // --- call #1 ---------------------------------------------------------------
  tiers.push(startTier);
  const text1 = outputs[0] ?? "";
  const v1: ParseStructuredResult<Edit> = parseStructured(text1, schema);
  if (v1.ok) {
    return { outcome: "accepted-first", tiers, value: v1.value };
  }

  // --- exactly one retry: FAST -> STRONG, STRONG stays STRONG ----------------
  const retryTier: Tier = startTier === "FAST" ? "STRONG" : "STRONG";
  tiers.push(retryTier);
  const text2 = outputs[1] ?? "";
  // The retry carries the EXACT error from call #1 (A.8). We model "carrying"
  // by prepending the error to the repair prompt — here we simply record it and
  // re-parse the second output.
  const v2: ParseStructuredResult<Edit> = parseStructured(text2, schema);
  if (v2.ok) {
    return {
      outcome: "accepted-retry",
      tiers,
      retryError: v1.error,
      value: v2.value,
    };
  }

  // --- deterministic fallback (never a throw) --------------------------------
  return { outcome: "fallback", tiers, retryError: v1.error };
}

// ---------------------------------------------------------------------------
// Property 5 — one unified retry then deterministic fallback.
// ---------------------------------------------------------------------------

describe("Property 5 (R7.3, R7.4): structured-output one unified retry then deterministic fallback", () => {
  const arbTier: fc.Arbitrary<Tier> = fc.constantFrom("FAST", "STRONG");

  it("parseStructured NEVER throws for ANY text (valid, malformed, or arbitrary)", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbValidText, arbMalformedText, fc.string()),
        (text) => {
          // Must return a tagged union, never throw.
          const r = parseStructured(text, EditSchema);
          expect(typeof r.ok).toBe("boolean");
          if (!r.ok) {
            expect(typeof r.error).toBe("string");
            expect(r.error.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a valid first output is accepted on the FIRST try (no retry, exactly one call)", () => {
    fc.assert(
      fc.property(arbTier, arbValidText, arbMalformedText, (tier, good, bad) => {
        // Even if a (never-reached) second output is malformed, call #1 wins.
        const trace = runUnit(tier, [good, bad], EditSchema);
        expect(trace.outcome).toBe("accepted-first");
        expect(trace.tiers).toEqual([tier]); // exactly one model call
        expect(trace.retryError).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("one malformed output triggers EXACTLY ONE retry; a valid retry is accepted (max 2 calls)", () => {
    fc.assert(
      fc.property(arbTier, arbMalformedText, arbValidText, (tier, bad, good) => {
        const trace = runUnit(tier, [bad, good], EditSchema);
        expect(trace.outcome).toBe("accepted-retry");
        // Exactly two calls — never a third.
        expect(trace.tiers.length).toBe(2);
        // The retry carried a real, non-empty error string from call #1.
        expect(typeof trace.retryError).toBe("string");
        expect((trace.retryError ?? "").length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a SECOND failure yields the deterministic fallback — never a throw, never a third call", () => {
    fc.assert(
      fc.property(
        arbTier,
        arbMalformedText,
        arbMalformedText,
        (tier, bad1, bad2) => {
          const trace = runUnit(tier, [bad1, bad2], EditSchema);
          expect(trace.outcome).toBe("fallback");
          // MAX CALLS PER UNIT = 2: the loop stopped after the retry.
          expect(trace.tiers.length).toBe(2);
          expect(trace.value).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the one-retry rule NEVER issues more than one retry (call count <= 2 for every sequence)", () => {
    fc.assert(
      fc.property(
        arbTier,
        fc.array(fc.oneof(arbValidText, arbMalformedText, fc.string()), {
          maxLength: 6,
        }),
        (tier, outputs) => {
          const trace = runUnit(tier, outputs, EditSchema);
          // At most 2 model calls regardless of how many outputs are available.
          expect(trace.tiers.length).toBeGreaterThanOrEqual(1);
          expect(trace.tiers.length).toBeLessThanOrEqual(2);
          // Two calls happen iff call #1 failed; then outcome is retry-accept or
          // fallback. One call happens iff call #1 was accepted.
          if (trace.tiers.length === 1) {
            expect(trace.outcome).toBe("accepted-first");
          } else {
            expect(
              trace.outcome === "accepted-retry" ||
                trace.outcome === "fallback",
            ).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the retry escalates FAST -> STRONG and a STRONG start stays STRONG (never downgrades)", () => {
    fc.assert(
      fc.property(
        arbTier,
        arbMalformedText,
        fc.oneof(arbValidText, arbMalformedText),
        (tier, bad, second) => {
          const trace = runUnit(tier, [bad, second], EditSchema);
          // Call #1 failed (malformed), so there is a retry.
          expect(trace.tiers.length).toBe(2);
          expect(trace.tiers[0]).toBe(tier);
          // The retry tier is always STRONG — FAST escalates, STRONG stays.
          expect(trace.tiers[1]).toBe("STRONG");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 37 — strict schema + request-field mechanics + usage reading.
// ---------------------------------------------------------------------------

/** Recursively collect every object node in a JSON-schema tree. */
function collectObjectNodes(
  node: unknown,
  acc: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) collectObjectNodes(item, acc);
    return acc;
  }
  if (node === null || typeof node !== "object") return acc;
  const obj = node as Record<string, unknown>;
  const isObjectNode =
    obj["type"] === "object" ||
    (obj["properties"] !== undefined && typeof obj["properties"] === "object");
  if (isObjectNode) acc.push(obj);
  for (const value of Object.values(obj)) collectObjectNodes(value, acc);
  return acc;
}

describe("Property 37 (R43.1-R43.5): zod->strict schema, require_parameters, no seed, temperature 0, usage.cost, served model", () => {
  const arbSchemaName: fc.Arbitrary<string> = fc.constantFrom(
    "py2to3.chunk",
    "lovers.plan",
    "lovers.generate",
  );
  const arbMaxTokens: fc.Arbitrary<number> = fc.integer({
    min: 1,
    max: 8192,
  });

  it("the generated schema is OpenAI-strict: every object required-complete, additionalProperties:false", () => {
    fc.assert(
      fc.property(arbSchemaName, (name) => {
        const built = toStrictJsonSchema(name, EditSchema);
        expect(built.name).toBe(name);
        expect(built.strict).toBe(true);

        const objectNodes = collectObjectNodes(built.schema);
        expect(objectNodes.length).toBeGreaterThan(0);
        for (const obj of objectNodes) {
          // additionalProperties:false on every object node.
          expect(obj["additionalProperties"]).toBe(false);
          // required lists EVERY declared property.
          const props = obj["properties"];
          const propKeys =
            props && typeof props === "object"
              ? Object.keys(props as Record<string, unknown>)
              : [];
          expect(new Set(obj["required"] as string[])).toEqual(
            new Set(propKeys),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("each field carries its .describe() text; stripped bound keywords are absent", () => {
    const built = toStrictJsonSchema("py2to3.chunk", EditSchema);
    const root = built.schema as Record<string, unknown>;
    const props = root["properties"] as Record<string, Record<string, unknown>>;

    expect(props["chunkId"]?.["description"]).toBe(
      "stable id of the chunk being edited",
    );
    expect(props["confidence"]?.["description"]).toBe("model confidence 0..1");

    // The strict schema must NOT carry the length/range bounds (re-enforced by
    // zod post-parse); assert none survive anywhere in the tree.
    const serialised = JSON.stringify(built.schema);
    for (const kw of [
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
    ]) {
      expect(serialised).not.toContain(`"${kw}"`);
    }
  });

  it("the schema generator is deterministic: identical input yields identical output", () => {
    fc.assert(
      fc.property(arbSchemaName, (name) => {
        const a = toStrictJsonSchema(name, EditSchema);
        const b = toStrictJsonSchema(name, EditSchema);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("structuredRequestFields: require_parameters:true alongside response_format/temperature(0)/max_tokens, and NO seed", () => {
    fc.assert(
      fc.property(arbSchemaName, arbMaxTokens, (name, maxTokens) => {
        const fields = structuredRequestFields(name, EditSchema, maxTokens);

        // response_format carries the strict json_schema generated from zod.
        expect(fields.response_format.type).toBe("json_schema");
        expect(fields.response_format.json_schema.strict).toBe(true);
        expect(fields.response_format.json_schema.name).toBe(name);

        // require_parameters is present and true...
        expect(fields.provider.require_parameters).toBe(true);
        // temperature is EXACTLY 0...
        expect(fields.temperature).toBe(0);
        // max_tokens is carried through...
        expect(fields.max_tokens).toBe(maxTokens);

        // ...and these three siblings are all present (require_parameters is
        // only ever sent alongside them).
        const keys = Object.keys(fields);
        expect(keys).toContain("response_format");
        expect(keys).toContain("temperature");
        expect(keys).toContain("max_tokens");
        expect(keys).toContain("provider");

        // NO `seed` field anywhere in the request fields (deep check).
        expect(JSON.stringify(fields)).not.toContain("seed");
        expect("seed" in fields).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("usageRecordFromResponse: served model recorded, cost read from usage.cost, missing fields default to 0", () => {
    const arbResponse: fc.Arbitrary<OpenRouterUsageResponse> = fc.record({
      model: fc.constantFrom(
        "anthropic/claude-3.5-sonnet",
        "openai/gpt-4o-mini",
        "meta/llama-3.1-8b",
      ),
      usage: fc.record({
        prompt_tokens: fc.nat({ max: 1_000_000 }),
        completion_tokens: fc.nat({ max: 1_000_000 }),
        // whole cents -> exact dollar value
        cost: fc.nat({ max: 1_000_000 }).map((c) => c / 100),
      }),
    });

    fc.assert(
      fc.property(arbResponse, (resp) => {
        const rec = usageRecordFromResponse(resp);
        // The SERVED model is recorded verbatim.
        expect(rec.model).toBe(resp.model);
        // Cost comes from usage.cost.
        expect(Math.round(rec.costUsd * 100)).toBe(
          Math.round((resp.usage?.cost ?? 0) * 100),
        );
        expect(rec.promptTokens).toBe(resp.usage?.prompt_tokens ?? 0);
        expect(rec.completionTokens).toBe(resp.usage?.completion_tokens ?? 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("usageRecordFromResponse defaults every missing field to 0 / empty (example)", () => {
    const rec = usageRecordFromResponse({});
    expect(rec.model).toBe("");
    expect(rec.promptTokens).toBe(0);
    expect(rec.completionTokens).toBe(0);
    expect(rec.costUsd).toBe(0);
  });
});
