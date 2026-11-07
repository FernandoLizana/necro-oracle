// @necro/llm — usage / cost accounting for the LLM_Pass (R6.1, R6.2, R6.3).
//
// One `UsageRecord` is ONE completion call: it records the model OpenRouter
// ACTUALLY served (`response.model`), the prompt/completion token counts, and
// the dollar cost that call incurred. The reading-level aggregate carries the
// summed totals AND a per-model breakdown, plus the active `soulSource` — whose
// souls paid for the reading (`ORACLE` = the circle's own key, `YOURS` = a
// user-supplied BYOK key). `soulSource` lives at the reading level, not on each
// record, because a single reading is paid for from a single source.
//
// `sumUsage` is the "souls spent" aggregate the UI shows. It is a pure fold: no
// clock, no network, no I/O. Summing is a simple associative/commutative add
// over tokens and cost, so folding the same records in any order (or in any
// grouping) yields the same totals, and the per-model subtotals always sum back
// to the aggregate totals (R6.1, R6.2, R6.3).

import { z } from "zod";

/**
 * One completion call's usage. `model` is the model OpenRouter ACTUALLY served
 * (taken from `response.model`), which may differ from the requested model when
 * a fallback endpoint answered. Token counts are non-negative integers and
 * `costUsd` is a non-negative dollar amount read from `usage.cost`.
 */
export const UsageRecordSchema = z
  .object({
    model: z.string(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict();

/** A single completion call's usage (see {@link UsageRecordSchema}). */
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

/**
 * The reading-level usage aggregate: the summed token/cost totals, the active
 * `soulSource`, and a per-model breakdown. Each `byModel` entry is the subtotal
 * for one served model; the breakdown's subtotals always sum to the aggregate
 * totals. `byModel` defaults to the empty array (a reading that spent no souls).
 */
export const UsageAggregateSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    soulSource: z.enum(["ORACLE", "YOURS"]),
    byModel: z
      .array(
        z
          .object({
            model: z.string(),
            promptTokens: z.number().int().nonnegative(),
            completionTokens: z.number().int().nonnegative(),
            costUsd: z.number().nonnegative(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** The reading-level usage aggregate (see {@link UsageAggregateSchema}). */
export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;

/** One per-model subtotal row inside a {@link UsageAggregate}. */
export type UsageByModel = UsageAggregate["byModel"][number];

/**
 * Pure fold: sum the token and cost fields across all `records` and build a
 * per-model breakdown (grouping records by served `model` and subtotalling
 * each). The active `soulSource` is carried through onto the aggregate.
 *
 * The fold is associative and commutative over the token/cost fields — numeric
 * addition over non-negative values — so the aggregate totals do not depend on
 * the order or grouping of `records`, and they are always non-negative. The
 * per-model subtotals are guaranteed to sum back to the aggregate totals: every
 * record contributes to exactly one model row and to the totals by the same
 * amount.
 *
 * Model row order follows first appearance in `records`, which keeps the output
 * deterministic for a given input ordering without affecting the totals.
 *
 * Pure: no clock, no network, no I/O.
 */
export function sumUsage(
  records: readonly UsageRecord[],
  soulSource: "ORACLE" | "YOURS",
): UsageAggregate {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;

  // Insertion-ordered map preserves first-appearance order for the breakdown.
  const byModel = new Map<string, UsageByModel>();

  for (const record of records) {
    promptTokens += record.promptTokens;
    completionTokens += record.completionTokens;
    costUsd += record.costUsd;

    const existing = byModel.get(record.model);
    if (existing === undefined) {
      byModel.set(record.model, {
        model: record.model,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        costUsd: record.costUsd,
      });
    } else {
      existing.promptTokens += record.promptTokens;
      existing.completionTokens += record.completionTokens;
      existing.costUsd += record.costUsd;
    }
  }

  return {
    promptTokens,
    completionTokens,
    costUsd,
    soulSource,
    byModel: [...byModel.values()],
  };
}
