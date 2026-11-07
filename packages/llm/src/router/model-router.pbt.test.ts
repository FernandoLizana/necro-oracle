// packages/llm/src/router/model-router.pbt.test.ts
//
// Feature: lovers-binding (task 2.2). Property-based tests for the pure
// Model_Router (`routeModel`, `routeGenerate`) and the pure `resolveModel`
// precedence resolver — all exported from `@necro/llm` (A.3).
//
// Everything under test is a pure, total function of its arguments: no model
// call, no network, no clock, no I/O. These properties therefore use only
// fast-check generators over plain data plus the pure functions themselves —
// no Mock provider is even required, in keeping with the testing steering
// (no network / LLM / sandbox in property tests).
//
// Properties (named per project convention, each tagging its requirement IDs):
//   P1  (R3.1–R3.7): Model_Router is a pure, total function of its signals.
//   P29 (R35.2):     resolveModel precedence — YOURS-only override, else tier env.
//
// The decision rule is re-derived INDEPENDENTLY below (`expectedTier`) so the
// test is an oracle rather than a mirror of the implementation.
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 23.3, 35.2**
import {
  FAST_DIAGNOSTIC_LIMIT,
  FAST_TOKEN_LIMIT,
  resolveModel,
  routeGenerate,
  routeModel,
  type ModelTier,
} from "./model-router.js";
import type { DifficultyFlags, RouterSignals } from "./signals.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** Standard property budget (testing steering default). */
const NUM_RUNS = 1000;

// --- Arbitraries ------------------------------------------------------------

/**
 * Difficulty flags over the full boolean cube (16 combinations). Kept exhaustive
 * rather than biased so the "any hard flag forces STRONG" property is exercised
 * across every subset of set flags.
 */
const arbDifficulty: fc.Arbitrary<DifficultyFlags> = fc.record({
  metaclass: fc.boolean(),
  unicodeBytes: fc.boolean(),
  dynamicImport: fc.boolean(),
  crossLangTypeMapping: fc.boolean(),
});

/**
 * Counts centred on the pinned limits so the strict-`>` boundary (exactly ON a
 * limit stays FAST, one over escalates) is hit densely, while still covering the
 * wider range including 0 and large values.
 */
const arbAroundDiagnostics: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: FAST_DIAGNOSTIC_LIMIT - 2, max: FAST_DIAGNOSTIC_LIMIT + 2 }),
  fc.integer({ min: 0, max: 50 }),
);
const arbAroundTokens: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: FAST_TOKEN_LIMIT - 2, max: FAST_TOKEN_LIMIT + 2 }),
  fc.integer({ min: 0, max: 5000 }),
);

const arbSignals: fc.Arbitrary<RouterSignals> = fc.record({
  tokenEstimate: arbAroundTokens,
  unresolvedDiagnostics: arbAroundDiagnostics,
  difficulty: arbDifficulty,
});

/**
 * Independent re-derivation of the pinned decision rule (design A.3). Any hard
 * difficulty flag OR over-limit diagnostics OR over-limit tokens => STRONG,
 * else FAST, with STRICT `>` thresholds.
 */
function expectedTier(s: RouterSignals): ModelTier {
  const d = s.difficulty;
  const hard =
    d.metaclass || d.unicodeBytes || d.dynamicImport || d.crossLangTypeMapping;
  if (hard) return "STRONG";
  if (s.unresolvedDiagnostics > FAST_DIAGNOSTIC_LIMIT) return "STRONG";
  if (s.tokenEstimate > FAST_TOKEN_LIMIT) return "STRONG";
  return "FAST";
}

// --- P1: Model_Router is a pure, total function of its signals --------------

describe("P1 (R3.1-R3.7): Model_Router is a pure, total function of its signals", () => {
  it("returns exactly one of the two tiers for every signal (total)", () => {
    fc.assert(
      fc.property(arbSignals, (s) => {
        const tier = routeModel(s);
        expect(tier === "FAST" || tier === "STRONG").toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("matches the pinned decision rule, with STRICT > thresholds (R3.2-R3.5)", () => {
    fc.assert(
      fc.property(arbSignals, (s) => {
        expect(routeModel(s)).toBe(expectedTier(s));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("escalates to STRONG whenever any hard difficulty flag is set (R3.2)", () => {
    const anyHard = arbDifficulty.filter(
      (d) =>
        d.metaclass || d.unicodeBytes || d.dynamicImport || d.crossLangTypeMapping,
    );
    fc.assert(
      fc.property(arbAroundTokens, arbAroundDiagnostics, anyHard, (t, u, difficulty) => {
        expect(routeModel({ tokenEstimate: t, unresolvedDiagnostics: u, difficulty })).toBe(
          "STRONG",
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("routes FAST when no hard flag and both signals sit AT or under their limits (R3.5)", () => {
    const noHard: DifficultyFlags = {
      metaclass: false,
      unicodeBytes: false,
      dynamicImport: false,
      crossLangTypeMapping: false,
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FAST_TOKEN_LIMIT }),
        fc.integer({ min: 0, max: FAST_DIAGNOSTIC_LIMIT }),
        (t, u) => {
          expect(
            routeModel({ tokenEstimate: t, unresolvedDiagnostics: u, difficulty: noHard }),
          ).toBe("FAST");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is deterministic and idempotent for identical inputs (R3.6)", () => {
    fc.assert(
      fc.property(arbSignals, (s) => {
        // Re-route a structurally independent clone to rule out accidental
        // reliance on object identity; results must be stable.
        const clone: RouterSignals = {
          tokenEstimate: s.tokenEstimate,
          unresolvedDiagnostics: s.unresolvedDiagnostics,
          difficulty: { ...s.difficulty },
        };
        const first = routeModel(s);
        expect(routeModel(s)).toBe(first);
        expect(routeModel(clone)).toBe(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("does not mutate the signals it is given (purity / no side effects R3.6)", () => {
    fc.assert(
      fc.property(arbSignals, (s) => {
        const snapshot = JSON.stringify(s);
        routeModel(s);
        expect(JSON.stringify(s)).toBe(snapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("routes GENERATE by function count and token estimate only (R3.7)", () => {
    fc.assert(
      fc.property(arbAroundDiagnostics, arbAroundTokens, (functionCount, tokenEstimate) => {
        const tier = routeGenerate({ functionCount, tokenEstimate });
        const overLimit =
          functionCount > FAST_DIAGNOSTIC_LIMIT || tokenEstimate > FAST_TOKEN_LIMIT;
        expect(tier).toBe(overLimit ? "STRONG" : "FAST");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("GENERATE ignores crossLangTypeMapping — a small binding may route FAST (R3.7)", () => {
    // A two-function, small-context GENERATE must NOT be forced to STRONG, even
    // though the same shape with crossLangTypeMapping=true would via routeModel.
    const tier = routeGenerate({ functionCount: 2, tokenEstimate: 200 });
    expect(tier).toBe("FAST");
    // Contrast: routeModel with the cross-lang flag set DOES escalate.
    expect(
      routeModel({
        unresolvedDiagnostics: 2,
        tokenEstimate: 200,
        difficulty: {
          metaclass: false,
          unicodeBytes: false,
          dynamicImport: false,
          crossLangTypeMapping: true,
        },
      }),
    ).toBe("STRONG");
  });
});

// --- Regression examples (permanent, from reasoning about the boundaries) ---

describe("P1 regression: pinned-limit boundaries (R3.3, R3.4)", () => {
  const noHard: DifficultyFlags = {
    metaclass: false,
    unicodeBytes: false,
    dynamicImport: false,
    crossLangTypeMapping: false,
  };

  it("exactly ON the diagnostic limit stays FAST; one over is STRONG", () => {
    expect(
      routeModel({
        tokenEstimate: 0,
        unresolvedDiagnostics: FAST_DIAGNOSTIC_LIMIT,
        difficulty: noHard,
      }),
    ).toBe("FAST");
    expect(
      routeModel({
        tokenEstimate: 0,
        unresolvedDiagnostics: FAST_DIAGNOSTIC_LIMIT + 1,
        difficulty: noHard,
      }),
    ).toBe("STRONG");
  });

  it("exactly ON the token limit stays FAST; one over is STRONG", () => {
    expect(
      routeModel({
        tokenEstimate: FAST_TOKEN_LIMIT,
        unresolvedDiagnostics: 0,
        difficulty: noHard,
      }),
    ).toBe("FAST");
    expect(
      routeModel({
        tokenEstimate: FAST_TOKEN_LIMIT + 1,
        unresolvedDiagnostics: 0,
        difficulty: noHard,
      }),
    ).toBe("STRONG");
  });
});

// --- P29: resolveModel precedence -------------------------------------------

describe("P29 (R35.2): resolveModel precedence — YOURS-only override, else tier env", () => {
  const arbTier: fc.Arbitrary<ModelTier> = fc.constantFrom("FAST", "STRONG");
  /** A concrete, short, distinct model id. */
  const arbId: fc.Arbitrary<string> = fc
    .string({ minLength: 1, maxLength: 8 })
    .map((s) => `m:${s}`);
  /**
   * A tier-keyed record where each key is INDEPENDENTLY present or absent.
   * `requiredKeys: []` omits absent keys entirely (never sets them to
   * `undefined`), matching the `{ fast?: string; strong?: string }` shape under
   * `exactOptionalPropertyTypes`.
   */
  const arbTierKeyed: fc.Arbitrary<{ fast?: string; strong?: string }> = fc.record(
    { fast: arbId, strong: arbId },
    { requiredKeys: [] },
  );
  const arbEnv = arbTierKeyed;
  const arbOverride = fc.option(arbTierKeyed, { nil: undefined });

  it("returns the override for the requested tier when present, else the tier env", () => {
    fc.assert(
      fc.property(arbTier, arbEnv, arbOverride, (tier, env, override) => {
        const got = resolveModel(tier, env, override);
        const overrideForTier = tier === "FAST" ? override?.fast : override?.strong;
        const envForTier = tier === "FAST" ? env.fast : env.strong;
        const expected = overrideForTier ?? envForTier;
        expect(got).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never reads the OTHER tier's models (tier isolation)", () => {
    fc.assert(
      fc.property(arbTier, arbEnv, arbOverride, (tier, env, override) => {
        const got = resolveModel(tier, env, override);
        const otherOverride = tier === "FAST" ? override?.strong : override?.fast;
        const otherEnv = tier === "FAST" ? env.strong : env.fast;
        const thisOverride = tier === "FAST" ? override?.fast : override?.strong;
        const thisEnv = tier === "FAST" ? env.fast : env.strong;
        // If the result is defined, it must equal one of THIS tier's two sources.
        if (got !== undefined) {
          expect(got === thisOverride || got === thisEnv).toBe(true);
        }
        // And it must never coincidentally equal only an other-tier source when
        // this tier has nothing set.
        if (thisOverride === undefined && thisEnv === undefined) {
          expect(got).toBeUndefined();
          void otherOverride;
          void otherEnv;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns undefined when neither override nor env is set for the tier (never throws/guesses)", () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        expect(resolveModel(tier, {})).toBeUndefined();
        expect(resolveModel(tier, {}, {})).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is deterministic for identical inputs", () => {
    fc.assert(
      fc.property(arbTier, arbEnv, arbOverride, (tier, env, override) => {
        const first = resolveModel(tier, env, override);
        expect(resolveModel(tier, env, override)).toBe(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- P29 regression: explicit precedence example ----------------------------

describe("P29 regression: override beats env, by tier (R35.2)", () => {
  const env = { fast: "env-fast", strong: "env-strong" };
  const override = { fast: "yours-fast", strong: "yours-strong" };

  it("honours the YOURS override per tier", () => {
    expect(resolveModel("FAST", env, override)).toBe("yours-fast");
    expect(resolveModel("STRONG", env, override)).toBe("yours-strong");
  });

  it("falls back to the tier env when no override is passed (ORACLE path)", () => {
    expect(resolveModel("FAST", env)).toBe("env-fast");
    expect(resolveModel("STRONG", env)).toBe("env-strong");
  });

  it("falls back to env when the override lacks the requested tier", () => {
    expect(resolveModel("FAST", env, { strong: "yours-strong" })).toBe("env-fast");
    expect(resolveModel("STRONG", env, { fast: "yours-fast" })).toBe("env-strong");
  });
});
