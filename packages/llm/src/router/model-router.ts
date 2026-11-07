// @necro/llm — the pure Model_Router and resolveModel (A.3; R3.1–R3.7, R35.2).
//
// Two pure concerns live here:
//
//   1. TIER SELECTION — `routeModel(RouterSignals): ModelTier` picks FAST vs
//      STRONG from measurable signals, and `routeGenerate(...)` is the dedicated
//      Lovers GENERATE path. Both are total, deterministic, side-effect-free
//      functions of their inputs (no model call, no network, no clock, no I/O).
//
//   2. TIER -> MODEL-ID RESOLUTION — `resolveModel(tier, env, override?)` maps a
//      tier (plus an optional validated BYOK/YOURS override) to a concrete model
//      id with a fixed precedence.
//
// The caller wires these into the coven through `ModelRouterPort` (task 1.1);
// `@necro/llm` never imports `@necro/coven`, preserving the dependency
// direction `oracle <- grimoires <- coven <- web`.

import type { RouterSignals } from "./signals.js";

/** The two model tiers the router chooses between. */
export type ModelTier = "FAST" | "STRONG";

/**
 * Pinned FAST limits (A.3). Over EITHER limit forces STRONG. They are pure
 * constants — exercised directly by the Model_Router property test — so the
 * decision rule has no hidden configuration.
 *
 * `FAST_DIAGNOSTIC_LIMIT` is the maximum unresolved-diagnostics count a unit may
 * carry and still route FAST; `FAST_TOKEN_LIMIT` is the maximum estimated tokens
 * of the minimal context a unit may carry and still route FAST.
 */
export const FAST_DIAGNOSTIC_LIMIT = 6;
export const FAST_TOKEN_LIMIT = 1200;

/**
 * Pure, total tier selection (R3.1–R3.5). Returns exactly one {@link ModelTier}
 * with no side effects, by the pinned decision rule:
 *
 *   hard = metaclass OR unicodeBytes OR dynamicImport OR crossLangTypeMapping
 *   if hard                                        -> STRONG   (R3.2)
 *   else if unresolvedDiagnostics > FAST_DIAGNOSTIC_LIMIT -> STRONG   (R3.3)
 *   else if tokenEstimate       > FAST_TOKEN_LIMIT        -> STRONG   (R3.4)
 *   else                                                  -> FAST     (R3.5)
 *
 * Note the thresholds are STRICT `>`: a unit sitting exactly ON a limit stays
 * FAST. This is the PLAN/chunk path, where `crossLangTypeMapping` participates
 * in `hard`. The Lovers GENERATE path uses {@link routeGenerate} instead, which
 * deliberately ignores `crossLangTypeMapping` (R3.7).
 *
 * Pure: no model call, no network, no clock, no I/O.
 */
export function routeModel(signals: RouterSignals): ModelTier {
  const d = signals.difficulty;
  const hard = d.metaclass || d.unicodeBytes || d.dynamicImport || d.crossLangTypeMapping;
  if (hard) return "STRONG";
  if (signals.unresolvedDiagnostics > FAST_DIAGNOSTIC_LIMIT) return "STRONG";
  if (signals.tokenEstimate > FAST_TOKEN_LIMIT) return "STRONG";
  return "FAST";
}

/**
 * GENERATE routing decision (R3.7). Per design A.3 a Lovers GENERATE unit must
 * be routed by function count and token estimate, NOT forced to STRONG by the
 * `crossLangTypeMapping` difficulty flag — a small two-function binding may
 * legitimately generate on FAST. `crossLangTypeMapping` still INFORMS the
 * Lovers PLAN difficulty (via {@link routeModel}), but it never reaches this
 * path, so it cannot by itself escalate GENERATE.
 *
 * GENERATE routing choice: option (a) — a dedicated function that takes only
 * `functionCount` and `tokenEstimate` and escalates on either threshold.
 *
 * Thresholds: GENERATE reuses the same pinned limits as {@link routeModel} for
 * consistency — the function count is treated exactly like a diagnostics count
 * against `FAST_DIAGNOSTIC_LIMIT` (6), and the token estimate against
 * `FAST_TOKEN_LIMIT` (1200), both STRICT `>`. Reusing the pinned constants (no
 * separate GENERATE threshold) keeps one source of truth for the FAST envelope.
 *
 * Implementation: build a `RouterSignals` with all difficulty flags cleared
 * (crucially `crossLangTypeMapping: false`) and `unresolvedDiagnostics` set to
 * the function count, then defer to {@link routeModel}. This guarantees the
 * GENERATE decision is a strict projection of the same rule with the cross-lang
 * flag excluded.
 *
 * Pure: no model call, no network, no clock, no I/O.
 */
export function routeGenerate(input: {
  readonly functionCount: number;
  readonly tokenEstimate: number;
}): ModelTier {
  return routeModel({
    unresolvedDiagnostics: input.functionCount,
    tokenEstimate: input.tokenEstimate,
    difficulty: {
      metaclass: false,
      unicodeBytes: false,
      dynamicImport: false,
      crossLangTypeMapping: false,
    },
  });
}

/**
 * Pure tier -> model-id resolution with a fixed precedence (R35.2):
 *
 *   1. a YOURS-only session override for the requested tier (`override.fast`
 *      for FAST, `override.strong` for STRONG), THEN
 *   2. the tier's environment model (`env.fast` / `env.strong`).
 *
 * The override is honoured ONLY in BYOK/YOURS mode. That policy is enforced by
 * the CALLER (the Lovers route passes `override = undefined` on soulSource
 * ORACLE — design item 5 / D.2); `resolveModel` itself simply applies
 * override-then-env and does not know about soul sources. `env` is passed in
 * explicitly (rather than read from `@necro/config`) so this function stays
 * pure and `@necro/llm` imports no config/coven module; the coven-side
 * `ModelRouterPort.resolveModel(tier, override?)` adapter closes over `env`.
 *
 * Missing-model behaviour: if neither an override nor an env model is set for
 * the requested tier, `resolveModel` returns `undefined`. It never guesses or
 * throws. The caller treats a missing (`undefined`) model id as the signal to
 * stay on the Mock/deterministic path — consistent with `@necro/config`, which
 * (per R35.3) keeps the Mock default and logs a key-name-only warning rather
 * than failing when a key is present but the model env var is absent.
 *
 * Pure: no model call, no network, no clock, no I/O.
 */
export function resolveModel(
  tier: ModelTier,
  env: { readonly fast?: string; readonly strong?: string },
  override?: { readonly fast?: string; readonly strong?: string },
): string | undefined {
  if (tier === "FAST") {
    return override?.fast ?? env.fast;
  }
  return override?.strong ?? env.strong;
}
