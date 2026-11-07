// @necro/coven — souls-spent fold + healer attribution (design B.3).
//
// Part B reports, as OPTIONAL ADDITIVE fields on the runner's `RitualOutcome`,
// two redaction-safe views the public `RitualResult`/`FileResult` deliberately
// do NOT carry (R13.4): a "souls spent" `UsageAggregate` (tokens + cost + a
// per-model breakdown) and a per-chunk healer attribution (`"llm"` vs
// `"rules"`) with the per-change reason (R13.1/R13.2).
//
// coven stays ADAPTER-FREE (coven-contracts): the canonical `sumUsage` fold and
// `UsageAggregate` schema are OWNED by `@necro/llm` (`usage/accounting.ts`), and
// `@necro/coven` must never import `@necro/llm` (that would invert the enforced
// dependency direction oracle <- grimoires <- coven <- llm-adapter). So this
// module re-implements the SAME pure fold over the coven-owned structural
// `UsageRecord` shape (ports.ts). The output is byte-compatible with
// `@necro/llm`'s `UsageAggregateSchema` and coven's own structural
// `UsageAggregateSchema` (lovers/types.ts), so a value produced here validates
// against either unchanged. The fold is associative, commutative, and
// non-negative over the token/cost fields (R6.1-R6.3), matching the owning
// implementation.

import type { UsageRecord } from "../ports.js";

/** The reading-level `soulSource`: the server's key (ORACLE) or the user's (YOURS). */
export type SoulSource = "ORACLE" | "YOURS";

/** One per-model subtotal row inside a {@link UsageAggregate}. */
export interface UsageByModel {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

/**
 * The reading-level "souls spent" aggregate (design B.3 / A.6). Structurally
 * identical to `@necro/llm`'s `UsageAggregate` and coven's structural
 * `UsageAggregateSchema` (lovers/types.ts), so a value produced by {@link
 * sumUsage} validates against either schema unchanged.
 */
export interface UsageAggregate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly soulSource: SoulSource;
  readonly byModel: readonly UsageByModel[];
}

/**
 * Pure, non-negative fold of `records` into a reading-level `UsageAggregate`,
 * keeping a per-model breakdown whose subtotals sum to the totals (R6.1-R6.3).
 * A coven-local re-implementation of `@necro/llm`'s `sumUsage` so coven stays
 * adapter-free; the fold is associative and commutative over the token/cost
 * fields and clamps any negative field to 0 so the totals are non-negative.
 *
 * The per-model breakdown is ordered by first appearance of each `model`, so
 * the fold is deterministic for a given input order; the numeric totals are
 * order-independent (commutative), which is what the accounting property pins.
 */
export function sumUsage(
  records: readonly UsageRecord[],
  soulSource: SoulSource,
): UsageAggregate {
  const nn = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  const byModelMap = new Map<string, { p: number; c: number; cost: number }>();
  const order: string[] = [];

  for (const r of records) {
    const p = nn(r.promptTokens);
    const c = nn(r.completionTokens);
    const cost = nn(r.costUsd);
    promptTokens += p;
    completionTokens += c;
    costUsd += cost;

    const existing = byModelMap.get(r.model);
    if (existing === undefined) {
      byModelMap.set(r.model, { p, c, cost });
      order.push(r.model);
    } else {
      existing.p += p;
      existing.c += c;
      existing.cost += cost;
    }
  }

  const byModel: UsageByModel[] = order.map((model) => {
    const sub = byModelMap.get(model)!;
    return {
      model,
      promptTokens: sub.p,
      completionTokens: sub.c,
      costUsd: sub.cost,
    };
  });

  return { promptTokens, completionTokens, costUsd, soulSource, byModel };
}

// ---------------------------------------------------------------------------
// Healer attribution (design B.3) — OPTIONAL ADDITIVE per-chunk record.
// ---------------------------------------------------------------------------

/** Who applied a chunk's change: the LLM edit, or the deterministic rules. */
export type Healer = "llm" | "rules";

/**
 * One per-chunk healer attribution row: the chunk id, who healed it (`"llm"`
 * when an LLM chunk edit passed the gate, `"rules"` when the deterministic
 * chunk was kept), and a short redaction-safe reason. These are reported as an
 * OPTIONAL ADDITIVE field on the runner's `RitualOutcome`; the public
 * `RitualResult`/`FileResult` shapes are UNCHANGED (R13.4).
 */
export interface HealerAttribution {
  readonly chunkId: string;
  readonly path: string;
  readonly healer: Healer;
  readonly reason: string;
}
