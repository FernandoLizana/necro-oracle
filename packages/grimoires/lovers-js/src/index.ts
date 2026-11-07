// @necro/grimoires-lovers-js — The Lovers (VI) binding grimoire (shell).
//
// The Lovers grimoire binds a RESURRECTED Python 3 module to a JavaScript
// beloved across the pinned JSON-lines contract (design C.2 "Lovers grimoire",
// C.4 "LoversRunner"). Like every grimoire it is ADAPTER-FREE: it imports
// `@necro/coven` (the shared zod contracts + the ONE prompt-template source of
// truth) and `@necro/oracle` (`parsePython`/`maskSecret`, used by `extractPlan`
// and the LLM steps), but NO adapter — no `@necro/llm`, no `@necro/sandbox`, no
// `@necro/github`. The runner injects the `LlmPort`/`ModelRouterPort`; the
// grimoire only DECLARES its two LLM steps (dependency direction:
// oracle <- grimoires <- coven). A static import-ban guard
// (`src/import-ban.test.ts`) proves this structurally, mirroring py2to3.
//
// Unlike the single-step py2to3 `Grimoire`, the Lovers binding is a TWO-step
// pipeline (PLAN then GENERATE) plus a deterministic heart + validate + runner
// that land in tasks 8.3-8.6. So this barrel exposes a Lovers-SHAPED grimoire
// object — `id`, the `pair` typed as `LanguagePairId` (= `LOVERS_LANGUAGE_PAIR`,
// "python3->javascript"), and the two declarative `LlmStep`s — rather than the
// py2to3 `Grimoire` interface. The `ast-bridge` fixer (task 8.3), `validate`
// (8.4), golden fixtures (8.5), and the `LoversRunner` (8.6) extend this shape
// without changing what is exported here.
//
// Cross-package consumers import the grimoire only through this `src/index.ts`
// barrel (structure rule: imports cross packages only via `src/index.ts`).

import {
  LOVERS_LANGUAGE_PAIR,
  type LanguagePairId,
  type LlmStep,
  type LoversPairLlm,
  type LoversPlan,
} from "@necro/coven";

import { GENERATE_STEP } from "./llm/generate.js";
import { PLAN_STEP } from "./llm/plan.js";

/** Stable grimoire id; also the registry key segment (R15.4). */
export const GRIMOIRE_ID = "lovers-js";

/**
 * The language pair the Lovers grimoire binds: resurrected Python 3 bound to
 * JavaScript. Typed as the canonical `LanguagePairId` so the `->` shape is
 * checked at the source (design C.2).
 */
export const LANGUAGE_PAIR: LanguagePairId = LOVERS_LANGUAGE_PAIR;

/**
 * The declarative, adapter-free Lovers grimoire. A two-step LLM pipeline:
 *   - `plan`:     FAST model -> strict {@link LoversPlan} (task 8.2),
 *   - `generate`: routed model -> {@link LoversPairLlm} (four artifacts, NO
 *                 `pythonHeart`; task 8.2).
 * The deterministic heart (`ast-bridge`, task 8.3), `validate` (8.4) and the
 * `LoversRunner` (8.6) are added to this object by later tasks.
 */
export interface LoversGrimoire {
  /** Stable grimoire id (R15.4). */
  readonly id: string;
  /** The bound language pair ("python3->javascript"). */
  readonly pair: LanguagePairId;
  /** Step 1: FAST model -> strict `LoversPlan`. */
  readonly plan: LlmStep<LoversPlan>;
  /** Step 2: routed model -> `LoversPairLlm` (four artifacts, never the heart). */
  readonly generate: LlmStep<LoversPairLlm>;
}

/** The Lovers (VI) binding grimoire object (design C.2 / C.4). */
export const loversJsGrimoire: LoversGrimoire = {
  id: GRIMOIRE_ID,
  pair: LANGUAGE_PAIR,
  plan: PLAN_STEP,
  generate: GENERATE_STEP,
};

export default loversJsGrimoire;

// Re-export the two steps' public surface for cross-package consumers that
// drive a single step directly (the runner, tests). Re-exported only through
// this barrel per the structure rule.
export { PLAN_STEP } from "./llm/plan.js";
export { GENERATE_STEP, MAX_TOKENS_HARD_CAP } from "./llm/generate.js";

// The pure deterministic AST-template bridge (task 8.3). The LoversRunner
// (task 8.6) ALWAYS calls `buildDeterministicHeart`/`astBridge` for the heart
// (both the LLM and template paths) and calls `buildTemplatePair`/`astBridge`
// with `fullPair` for the whole deterministic pair on the fallback path.
export {
  astBridge,
  buildContractSchema,
  buildDeterministicHeart,
  buildJsBeloved,
  buildJsTests,
  buildPythonTests,
  buildTemplatePair,
  CONTRACT_DIALECT,
  HEART_FILENAME,
  RESURRECTED_MODULE,
  type AstBridgeOptions,
} from "./fixers/ast-bridge.js";

// The pure Lovers validation gate (task 8.4). `validateLovers` runs the seven
// C.3 checks (tree-sitter zero-error-node parse of both sides + their tests,
// contract JSON Schema + $defs-name equality via `contractFnNames`, the static
// deny-list scan, and every planned fn defined on both sides) over the full
// assembled pair. Every capability is injected so the gate stays pure/adapter-
// free and never executes the generated code.
export {
  contractFnNames,
  validateLovers,
  type DenyScanFn,
  type ParseFn as LoversValidateParseFn,
  type ValidateLoversResult,
  type ValidateSchemaFn,
} from "./validate.js";
