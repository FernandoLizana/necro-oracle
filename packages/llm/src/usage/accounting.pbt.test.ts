// packages/llm/src/usage/accounting.pbt.test.ts
//
// Feature: lovers-binding, task 1.3 (optional property-test).
//
// Property 8 (R6.1, R6.2, R6.3): `sumUsage` is a sound non-negative
// associative/commutative fold with a per-model breakdown.
//
// `sumUsage` (packages/llm/src/usage/accounting.ts) folds a list of
// `UsageRecord`s into a reading-level `UsageAggregate`: summed token/cost
// totals, a per-model breakdown, and the carried `soulSource`. Being numeric
// addition over non-negative values, the fold is associative and commutative,
// so the totals do not depend on the order OR the grouping of the records; the
// totals are always non-negative; the per-model subtotals always sum back to
// the aggregate totals; and `soulSource` is carried through unchanged.
//
// Floating-point note: addition of arbitrary IEEE-754 doubles is NOT
// order-independent, so comparing `costUsd` across reorderings under exact
// equality would be flaky. To keep equality EXACT we constrain the cost
// arbitrary to whole cents (a non-negative integer number of cents) and derive
// `costUsd = cents / 100`. Reordering then permutes the SAME multiset of
// cent-denominated values; we compare on the integer-cent totals (and on the
// derived dollar totals, which match because the summation order of identical
// cent integers is irrelevant). No epsilon is needed.
//
// Testing steering: fast-check with an explicit `numRuns` (1000 for folds);
// the seed is printed on failure by fast-check's default reporter. No network,
// no clock, no LLM, no sandbox — pure computation.
//
// **Validates: Requirements 6.1, 6.2, 6.3**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sumUsage, type UsageRecord } from "./accounting.js";

/** Folds/normalisers run the heavier property budget per the testing steering. */
const NUM_RUNS = 1000;

/**
 * A small set of served-model ids so grouping is actually exercised (multiple
 * records collapse into the same `byModel` row). Keeping the alphabet tiny
 * makes collisions — and therefore the per-model subtotal arithmetic — common.
 */
const MODEL_IDS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku",
  "meta/llama-3.1-8b",
] as const;

const arbModel: fc.Arbitrary<string> = fc.constantFrom(...MODEL_IDS);

/**
 * One `UsageRecord` with non-negative integer token counts and a cost pinned to
 * whole cents. We carry `cents` alongside so the test can compute an exact,
 * order-independent expected `costUsd` total (see the floating-point note).
 */
interface RecordWithCents {
  readonly record: UsageRecord;
  readonly cents: number;
}

const arbRecord: fc.Arbitrary<RecordWithCents> = fc
  .record({
    model: arbModel,
    promptTokens: fc.nat({ max: 1_000_000 }),
    completionTokens: fc.nat({ max: 1_000_000 }),
    cents: fc.nat({ max: 1_000_000 }),
  })
  .map(({ model, promptTokens, completionTokens, cents }) => ({
    cents,
    record: {
      model,
      promptTokens,
      completionTokens,
      costUsd: cents / 100,
    },
  }));

const arbRecords: fc.Arbitrary<readonly RecordWithCents[]> = fc.array(
  arbRecord,
  { maxLength: 40 },
);

const arbSoulSource: fc.Arbitrary<"ORACLE" | "YOURS"> = fc.constantFrom(
  "ORACLE",
  "YOURS",
);

/** Sum the integer-cent field across a record list (exact, order-independent). */
function totalCents(recs: readonly RecordWithCents[]): number {
  return recs.reduce((acc, r) => acc + r.cents, 0);
}

/** Sum a non-negative integer token field across a record list. */
function totalTokens(
  recs: readonly RecordWithCents[],
  field: "promptTokens" | "completionTokens",
): number {
  return recs.reduce((acc, r) => acc + r.record[field], 0);
}

describe("Property 8 (R6.1, R6.2, R6.3): sumUsage is a sound non-negative associative/commutative fold with a per-model breakdown", () => {
  it("is commutative/associative: any order or concatenation split yields identical totals", () => {
    fc.assert(
      fc.property(
        arbRecords,
        arbSoulSource,
        // A permutation of the record indices (commutativity) ...
        fc.infiniteStream(fc.double({ min: 0, max: 1, noNaN: true })),
        // ... and a split point for a grouping/concatenation (associativity).
        fc.double({ min: 0, max: 1, noNaN: true }),
        (withCents, soulSource, shuffleStream, splitFraction) => {
          const records = withCents.map((w) => w.record);

          // --- Reorder: a Fisher–Yates shuffle driven by the fc stream. ------
          const shuffled = [...withCents];
          const draws = shuffleStream[Symbol.iterator]();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const next = draws.next();
            const r = next.done ? 0 : next.value;
            const j = Math.floor(r * (i + 1));
            const safeJ = j > i ? i : j;
            const tmp = shuffled[i]!;
            shuffled[i] = shuffled[safeJ]!;
            shuffled[safeJ] = tmp;
          }
          const shuffledRecords = shuffled.map((w) => w.record);

          // --- Split: fold the two halves separately, then add their totals. -
          const cut = Math.min(
            records.length,
            Math.floor(splitFraction * records.length),
          );
          const left = records.slice(0, cut);
          const right = records.slice(cut);
          const aggLeft = sumUsage(left, soulSource);
          const aggRight = sumUsage(right, soulSource);

          const base = sumUsage(records, soulSource);
          const reordered = sumUsage(shuffledRecords, soulSource);

          // Reordering does not change the aggregate totals (commutativity).
          // Token counts are integers, so they compare exactly. `costUsd` is a
          // sum of whole-cent doubles folded in a DIFFERENT order between
          // `base` and `reordered`; IEEE-754 addition is not reassociative, so
          // the derived dollar sums can differ by one ULP (e.g. 15255.94 vs
          // 15255.939999999999). We therefore compare costs on the exact
          // integer-cent total — the quantity the spec's totals actually mean.
          expect(reordered.promptTokens).toBe(base.promptTokens);
          expect(reordered.completionTokens).toBe(base.completionTokens);
          expect(Math.round(reordered.costUsd * 100)).toBe(
            Math.round(base.costUsd * 100),
          );

          // Folding in two groups and adding equals folding the whole
          // (associativity) — exact because costs are whole cents.
          expect(aggLeft.promptTokens + aggRight.promptTokens).toBe(
            base.promptTokens,
          );
          expect(aggLeft.completionTokens + aggRight.completionTokens).toBe(
            base.completionTokens,
          );
          expect(
            Math.round((aggLeft.costUsd + aggRight.costUsd) * 100),
          ).toBe(Math.round(base.costUsd * 100));

          // The totals match the independently computed expected values.
          expect(base.promptTokens).toBe(totalTokens(withCents, "promptTokens"));
          expect(base.completionTokens).toBe(
            totalTokens(withCents, "completionTokens"),
          );
          expect(Math.round(base.costUsd * 100)).toBe(totalCents(withCents));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is non-negative: every aggregate total and every per-model subtotal is >= 0", () => {
    fc.assert(
      fc.property(arbRecords, arbSoulSource, (withCents, soulSource) => {
        const agg = sumUsage(
          withCents.map((w) => w.record),
          soulSource,
        );
        expect(agg.promptTokens).toBeGreaterThanOrEqual(0);
        expect(agg.completionTokens).toBeGreaterThanOrEqual(0);
        expect(agg.costUsd).toBeGreaterThanOrEqual(0);
        for (const row of agg.byModel) {
          expect(row.promptTokens).toBeGreaterThanOrEqual(0);
          expect(row.completionTokens).toBeGreaterThanOrEqual(0);
          expect(row.costUsd).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("has a sound per-model breakdown: subtotals sum to the totals and each model appears exactly once", () => {
    fc.assert(
      fc.property(arbRecords, arbSoulSource, (withCents, soulSource) => {
        const records = withCents.map((w) => w.record);
        const agg = sumUsage(records, soulSource);

        // Every model appears in exactly one byModel row (no duplicate rows).
        const rowModels = agg.byModel.map((r) => r.model);
        expect(new Set(rowModels).size).toBe(rowModels.length);

        // The set of rows equals the set of distinct served models in input.
        const inputModels = new Set(records.map((r) => r.model));
        expect(new Set(rowModels)).toEqual(inputModels);

        // Subtotals sum back to the aggregate totals (exact via cents).
        const sumRowPrompt = agg.byModel.reduce(
          (a, r) => a + r.promptTokens,
          0,
        );
        const sumRowCompletion = agg.byModel.reduce(
          (a, r) => a + r.completionTokens,
          0,
        );
        const sumRowCents = agg.byModel.reduce(
          (a, r) => a + Math.round(r.costUsd * 100),
          0,
        );
        expect(sumRowPrompt).toBe(agg.promptTokens);
        expect(sumRowCompletion).toBe(agg.completionTokens);
        expect(sumRowCents).toBe(Math.round(agg.costUsd * 100));

        // Each row's subtotal equals the per-model sum of its input records.
        for (const row of agg.byModel) {
          const forModel = withCents.filter((w) => w.record.model === row.model);
          expect(row.promptTokens).toBe(totalTokens(forModel, "promptTokens"));
          expect(row.completionTokens).toBe(
            totalTokens(forModel, "completionTokens"),
          );
          expect(Math.round(row.costUsd * 100)).toBe(totalCents(forModel));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("carries soulSource through unchanged", () => {
    fc.assert(
      fc.property(arbRecords, arbSoulSource, (withCents, soulSource) => {
        const agg = sumUsage(
          withCents.map((w) => w.record),
          soulSource,
        );
        expect(agg.soulSource).toBe(soulSource);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input folds to a zeroed aggregate with an empty breakdown (example)", () => {
    const agg = sumUsage([], "ORACLE");
    expect(agg.promptTokens).toBe(0);
    expect(agg.completionTokens).toBe(0);
    expect(agg.costUsd).toBe(0);
    expect(agg.byModel).toEqual([]);
    expect(agg.soulSource).toBe("ORACLE");
  });
});
