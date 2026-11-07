// @necro/coven — the LoversRunner (design C.4 "LoversRunner", A.8 "one retry
// policy + timeout arithmetic", A.3 "Model_Router", item 3 "deterministic
// heart").
//
// `LoversRunner.run(input, ports, emit)` drives the Lovers (VI) binding through
// the fixed phase sequence
//
//   PLAN -> GENERATE -> VALIDATE -> EMIT
//
// over the RESURRECTED Python 3 source of ONE file. It mirrors the shape of
// `LocalCovenRunner` (`runners/local.ts`): every side-effecting capability is
// INJECTED through ports (`clock`, `ledger`, the optional `llm`/`router`/`cache`
// — {@link LoversPorts}), the runner imports `@necro/oracle` (the two armed
// tree-sitter parsers + `maskSecret`) and the local pure modules only, and it
// imports NO adapter (`@necro/llm`/`@necro/sandbox` arrive via ports) and NO
// grimoire package.
//
// DEPENDENCY DIRECTION (oracle <- grimoires <- coven <- web). The Lovers
// capabilities the runner needs — the two declarative `LlmStep`s, the pure
// deterministic `ast-bridge` (heart + template pair), and the `validateLovers`
// gate — all live in `@necro/grimoires-lovers-js`. `@necro/coven` must NOT
// import a grimoire (that inverts the enforced direction), so EXACTLY as
// `LocalCovenRunner` resolves its `Grimoire` from an injected
// `LanguagePairRegistry`, the LoversRunner receives those capabilities through
// the injected {@link LoversGrimoirePort}. The composition root in `apps/web`
// (the sanctioned grimoire import point) builds the port from the grimoire
// barrel and injects it. Nothing here references a grimoire module.
//
// THE DETERMINISTIC HEART IS ALWAYS EMITTED (design item 3). The GENERATE LLM
// step produces the FOUR artifacts only (`LoversPairLlmSchema`, NO heart). On
// BOTH the LLM path and the template fallback path the runner assembles the
// full {@link LoversPair} by combining those artifacts (or the template ones)
// with the SAME deterministic `pythonHeart` from
// `grimoire.buildDeterministicHeart(plan)`. The heart is byte-identical on both
// paths; the model never writes it.
//
// ONE UNIFIED RETRY POLICY UNDER A SINGLE-REQUEST DEADLINE (design A.8). PLAN
// and GENERATE each obey the one policy: call #1 at the started tier; on a
// zod-schema OR `validateLovers` failure, EXACTLY ONE retry carrying the exact
// error, escalating FAST->STRONG (a STRONG start stays STRONG); MAX CALLS PER
// UNIT = 2; then the deterministic fallback. Each call's
// `timeoutMs = min(perCallCap, remaining - WRITE_RESERVE_MS)` read from the ONE
// request deadline (`deadline = clock.nowMs() + totalBudgetMs`); PLAN cap 12 s,
// GENERATE cap 45 s. A retry is SKIPPED straight to the fallback when
// `remaining < the retry minimum`; the PLAN retry is REPLACED by the
// `extractPlan` fallback plan when `remaining < 30 s`.
//
// MASKING + NEUTRALISATION (R12.3, A.9). All repository source is masked through
// `maskSecretsInText` before it enters the runner's working state and before it
// reaches any sink (ledger, prompt). The grimoire's `LlmStep.buildRequest`
// delegates to the shared templates, which neutralise delimiters and wrap the
// untrusted slot (exactly one marker pair), so the runner never hand-rolls the
// wrapping.
//
// CACHE (design A.8 "Cache rule"). Only ACCEPTED outputs (schema AND gate
// passed) are written to the injected shared cache. On a cache hit the runner
// reuses the stored text without a model call.
//
// USAGE ACCOUNTING (design B.3). Every `LlmResult.usage` is accumulated into a
// `UsageRecord[]` and folded with the coven-local `sumUsage` (`runners/souls.ts`
// — coven never imports `@necro/llm`) into the `LoversResult.soulsSpent`
// aggregate, stamped with the `soulSource` from the input.

import {
  initParser,
  parseJavascript,
  parsePython,
  type NecroError,
  type Tree,
} from "@necro/oracle";

import { covenError } from "../models.js";
import type { LedgerEvent, LlmConstructInput } from "../models.js";
import type {
  LlmRequest,
  LlmStep,
  LoversPorts,
  ModelTier,
  RouterSignals,
  UsageRecord,
} from "../ports.js";
import { denyScan, type DenyScanLang } from "./deny-list.js";
import { extractPlan } from "./extract-plan.js";
import { maskSecretsInText } from "../mask.js";
import { parseContract } from "./types.js";
import { sumUsage, type SoulSource } from "../runners/souls.js";
import type {
  LoversPair,
  LoversPairLlm,
  LoversPlan,
  LoversResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Injected Lovers grimoire capabilities (keeps coven adapter-free; design C.4).
//
// The runner never imports `@necro/grimoires-lovers-js`. These structural types
// mirror the grimoire barrel's public surface (`PLAN_STEP`, `GENERATE_STEP`,
// `buildDeterministicHeart`, `buildTemplatePair`, `validateLovers`), so the
// composition root injects the concrete values unchanged.
// ---------------------------------------------------------------------------

/** A tree-sitter parse fn (the oracle's `parsePython`/`parseJavascript`). */
export type LoversGateParseFn = (source: string) => Tree;

/** A JSON-Schema validator for the serialized `contractSchema` string. */
export type LoversValidateSchemaFn = (serialized: string) => boolean;

/** The pure static deny-list scan (coven `denyScan`). */
export type LoversDenyScanFn = (code: string, lang: DenyScanLang) => string | null;

/** The Lovers gate's discriminated result (mirrors the grimoire's). */
export type LoversValidateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * The structural port over the `@necro/grimoires-lovers-js` capabilities the
 * runner drives (design C.4). Injected so coven stays adapter-free and the
 * dependency direction holds. Each member is byte-compatible with the grimoire
 * barrel export of the same name.
 */
export interface LoversGrimoirePort {
  /** Step 1: FAST model -> strict `LoversPlan` (`PLAN_STEP`). */
  readonly plan: LlmStep<LoversPlan>;
  /** Step 2: routed model -> `LoversPairLlm`, four artifacts, NO heart (`GENERATE_STEP`). */
  readonly generate: LlmStep<LoversPairLlm>;
  /** ALWAYS emit the deterministic `pythonHeart` from the plan (item 3). */
  buildDeterministicHeart(plan: LoversPlan): string;
  /** The full deterministic template pair from the plan alone (fallback path). */
  buildTemplatePair(plan: LoversPlan): LoversPair;
  /** The pure Lovers validation gate (every capability injected by the runner). */
  validateLovers(
    plan: LoversPlan,
    pair: LoversPair,
    parsePy: LoversGateParseFn,
    parseJs: LoversGateParseFn,
    validateSchema: LoversValidateSchemaFn,
    denyScan: LoversDenyScanFn,
  ): LoversValidateResult;
}

// ---------------------------------------------------------------------------
// Runner input (design C.4).
// ---------------------------------------------------------------------------

/**
 * The LoversRunner input: the RESURRECTED Python 3 `source` of ONE file, the
 * repo-relative `file` path, the `targetLang` (JavaScript today), the reading's
 * `soulSource` (whose key pays — stamped on the result's `soulsSpent`), the
 * `demo` flag (the offline Mock path), and an OPTIONAL validated session model
 * override (BYOK/YOURS only; the route passes `undefined` on ORACLE — A.3/D.2).
 */
export interface LoversRunnerInput {
  /** The resurrected Python 3 module source for the file being bound. */
  readonly source: string;
  /** The repo-relative path of the bound file. */
  readonly file: string;
  /** The bound target language (JavaScript today). */
  readonly targetLang: "javascript";
  /** Whose key pays for the binding — stamped on `soulsSpent` (design B.3). */
  readonly soulSource: SoulSource;
  /** True on the offline Mock demo path (network blocked upstream; R14.4). */
  readonly demo: boolean;
  /**
   * OPTIONAL validated session model override (BYOK/YOURS only). Honoured by
   * `router.resolveModel`; `undefined` on ORACLE (the route decides, A.3).
   */
  readonly modelOverride?: { readonly fast?: string; readonly strong?: string };
}

/** The runner's phase reporter (mirrors the resurrect route's monotonic emit). */
export interface LoversEmit {
  /** Called once per phase in order: PLAN, GENERATE, VALIDATE, BIND. */
  phase(phase: LoversPhase): void | Promise<void>;
}

/** The fixed, ordered Lovers phases (the public BIND name maps to EMIT). */
export const LOVERS_PHASES = ["PLAN", "GENERATE", "VALIDATE", "BIND"] as const;

/** A single Lovers phase name. */
export type LoversPhase = (typeof LOVERS_PHASES)[number];

// ---------------------------------------------------------------------------
// Deadline arithmetic (design A.8). All time is read through `ports.clock`.
// ---------------------------------------------------------------------------

/** Write/cleanup headroom held back out of every call's timeout (design A.8). */
const WRITE_RESERVE_MS = 5_000;

/** PLAN per-call cap (design A.8 `PLAN_PER_CALL_CAP`). */
const PLAN_PER_CALL_CAP_MS = 12_000;

/** GENERATE per-call cap (design A.8 `GENERATE_PER_CALL_CAP`). */
const GENERATE_PER_CALL_CAP_MS = 45_000;

/** `extractPlan` fallback threshold for the PLAN retry (design A.8). */
const PLAN_FALLBACK_FLOOR_MS = 30_000;

/** The minimum remaining time for a retry to be worth attempting (design A.8). */
const RETRY_MIN_MS = WRITE_RESERVE_MS + 1;

/** Default overall request budget — the single deadline PLAN+GENERATE read. */
const DEFAULT_TOTAL_BUDGET_MS = 90_000;

// ---------------------------------------------------------------------------
// Runner options + contract.
// ---------------------------------------------------------------------------

/** Tunable budget for one Lovers binding. Time is read via `ports.clock`. */
export interface LoversRunnerOptions {
  /**
   * The overall request budget in milliseconds. The single deadline every
   * PLAN/GENERATE call reads (`deadline = clock.nowMs() + totalBudgetMs`). The
   * route derives this from the remaining `maxDuration` after summon +
   * resurrect (design A.8); the default is a standalone fallback.
   */
  readonly totalBudgetMs?: number;
}

/** Drives one Lovers binding to a {@link LoversResult}. */
export interface LoversRunner {
  run(
    input: LoversRunnerInput,
    ports: LoversPorts,
    emit: LoversEmit,
  ): Promise<LoversResult>;
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/**
 * The in-process LoversRunner (design C.4). Construct once with the injected
 * {@link LoversGrimoirePort} the composition root builds from the
 * `@necro/grimoires-lovers-js` barrel; the runner never imports a grimoire.
 */
export class LocalLoversRunner implements LoversRunner {
  readonly #grimoire: LoversGrimoirePort;
  readonly #totalBudgetMs: number;

  constructor(grimoire: LoversGrimoirePort, options: LoversRunnerOptions = {}) {
    this.#grimoire = grimoire;
    this.#totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  }

  async run(
    input: LoversRunnerInput,
    ports: LoversPorts,
    emit: LoversEmit,
  ): Promise<LoversResult> {
    const deadline = ports.clock.nowMs() + this.#totalBudgetMs;
    let seq = 0;
    const append = async (type: string): Promise<void> => {
      // Every ledger entry routes through masking (R12.3). Event types are
      // fixed constants, but masking keeps the "every sink is masked" invariant.
      const event: LedgerEvent = {
        seq: seq++,
        type: maskSecretsInText(type),
        at: new Date(ports.clock.nowMs()).toISOString(),
      };
      await ports.ledger.append(event);
    };

    await append("lovers.start");

    // The fixers/gate parse with the oracle parsers, which require the parser
    // to be armed once, up front, so PLAN precondition + VALIDATE both find it
    // ready. (The gate reports a decisive error rather than crashing if not.)
    await initParser();

    // Mask the repository source AS IT ENTERS the runner, before it can reach
    // any sink (ledger, prompt, fallback plan). `extractPlan` reads the MASKED
    // source so no raw secret ever leaves the runner (R12.3).
    const maskedSource = maskSecretsInText(input.source);
    const usageRecords: UsageRecord[] = [];

    // ---- PLAN precondition (R16.6 defence-in-depth) --------------------------
    // Compute extractPlan FIRST. On a rejection (> 8 fns, > 32768 bytes, no
    // bindable fn) terminate with a typed VALIDATION_FAILED oracle-voice error
    // and NO model call. The route enforces this precondition too (task 11.6b);
    // the runner guards regardless so it can never call a model on bad input.
    const extracted = extractPlan(maskedSource);
    if (!extracted.ok) {
      await append("lovers.precondition_failed");
      throw loversPreconditionError(extracted.reason);
    }
    // The extractPlan plan is BOTH the minimal PLAN context (the grimoire step
    // re-derives it internally for the prompt) AND the PLAN-failure fallback.
    const fallbackPlan: LoversPlan = extracted.plan;

    // ---- PLAN phase ----------------------------------------------------------
    await emit.phase("PLAN");
    await append("lovers.plan");
    const plan = await this.#runPlan(
      maskedSource,
      input,
      ports,
      fallbackPlan,
      deadline,
      usageRecords,
    );

    // ---- GENERATE phase ------------------------------------------------------
    await emit.phase("GENERATE");
    await append("lovers.generate");
    const generated = await this.#runGenerate(
      plan,
      input,
      ports,
      deadline,
      usageRecords,
    );

    // ---- VALIDATE + EMIT (BIND) ---------------------------------------------
    // The GENERATE phase already ran validateLovers on each candidate pair to
    // decide accept/retry/fallback and returns the accepted pair + its path.
    await emit.phase("VALIDATE");
    await append("lovers.validate");

    await emit.phase("BIND");
    await append("lovers.bind");

    // Fold every call's usage with the coven-local `sumUsage` (coven never
    // imports `@necro/llm`). The fold returns a readonly `byModel`; the result
    // schema infers a mutable array, so copy it into the schema-shaped value.
    const folded = sumUsage(usageRecords, input.soulSource);
    const result: LoversResult = {
      file: input.file,
      targetLang: "javascript",
      pair: generated.pair,
      plan,
      path: generated.path,
      soulsSpent: {
        promptTokens: folded.promptTokens,
        completionTokens: folded.completionTokens,
        costUsd: folded.costUsd,
        soulSource: folded.soulSource,
        byModel: folded.byModel.map((m) => ({ ...m })),
      },
      soulSource: input.soulSource,
      demo: input.demo,
    };
    await append("lovers.complete");
    return result;
  }

  // -------------------------------------------------------------------------
  // PLAN phase — FAST model -> strict LoversPlan, A.8 retry, extractPlan
  // fallback (design C.4 / A.8).
  // -------------------------------------------------------------------------

  /**
   * Drive the PLAN unit. The grimoire's `plan` step builds the request (FAST
   * model, strict `LoversPlanSchema`); the runner routes it, calls the injected
   * `LlmPort`, validates with the step's `outputSchema`, and on a zod failure
   * applies the one-retry policy (escalating FAST->STRONG) under the deadline.
   * When no model is bound, the deadline skips the retry, or the PLAN floor is
   * reached, the deterministic `extractPlan` `fallbackPlan` is used.
   */
  async #runPlan(
    maskedSource: string,
    input: LoversRunnerInput,
    ports: LoversPorts,
    fallbackPlan: LoversPlan,
    deadline: number,
    usageRecords: UsageRecord[],
  ): Promise<LoversPlan> {
    // No model bound (or no router): the deterministic extractPlan is the plan.
    if (ports.llm === undefined || ports.router === undefined) {
      return fallbackPlan;
    }
    const step = this.#grimoire.plan;
    const construct: LlmConstructInput = {
      path: input.file,
      construct: maskedSource,
      source: maskedSource,
    };
    // PLAN signals: a small single unit. tokenEstimate ~4 chars/token over the
    // source; one "diagnostic" per bindable function; crossLangTypeMapping is a
    // Lovers concern but PLAN is the FAST discovery step, so it stays FAST
    // unless the token estimate is large (design A.3).
    const signals = planSignals(maskedSource, fallbackPlan);
    let tier: ModelTier = ports.router.route(signals);
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - ports.clock.nowMs();
      const timeoutMs = Math.min(PLAN_PER_CALL_CAP_MS, remaining - WRITE_RESERVE_MS);
      if (timeoutMs <= 0) {
        // Not enough time even for this call: use the deterministic plan.
        return fallbackPlan;
      }
      const model = ports.router.resolveModel(tier, input.modelOverride);
      const req = this.#withRetryPrompt(step.buildRequest(construct), attempt, lastError, {
        model,
        timeoutMs,
      });

      const text = await this.#complete(ports, req, usageRecords);
      if (text === null) {
        // Timeout / unavailable: the deterministic plan stands in.
        return fallbackPlan;
      }
      const parsed = step.outputSchema.safeParse(safeJson(text));
      if (parsed.success) {
        // Accepted output: cache it (A.8 cache rule) and return the plan.
        ports.cache?.set(req.cacheKey, text);
        return parsed.data;
      }

      // zod failure. Decide whether to retry under the deadline (design A.8):
      // the PLAN retry is REPLACED by the extractPlan fallback when remaining
      // < 30 s, and SKIPPED entirely when there is not enough time for a retry.
      lastError = schemaErrorText(parsed.error);
      if (attempt === 0) {
        const afterRemaining = deadline - ports.clock.nowMs();
        if (afterRemaining < PLAN_FALLBACK_FLOOR_MS) return fallbackPlan;
        if (afterRemaining < RETRY_MIN_MS) return fallbackPlan;
        tier = "STRONG"; // FAST escalates; a STRONG start stays STRONG.
        continue;
      }
      // Retry also failed: the deterministic plan is the fallback.
      return fallbackPlan;
    }
    return fallbackPlan;
  }

  // -------------------------------------------------------------------------
  // GENERATE phase — routed model -> LoversPairLlm, assemble the full pair with
  // the deterministic heart, validate, A.8 retry, template fallback (C.4/A.8).
  // -------------------------------------------------------------------------

  /**
   * Drive the GENERATE unit. The routed model (started FAST, escalated to
   * STRONG on failure) produces the four LLM artifacts; the runner ALWAYS
   * assembles the full pair with the deterministic `pythonHeart`
   * (`buildDeterministicHeart`), then runs `validateLovers`. On a zod OR
   * validation failure it applies the one-retry policy under the deadline;
   * still failing (or no model, or the deadline skips the retry) it FALLS BACK
   * to the deterministic `buildTemplatePair` with `path: "template"`. A pair
   * that passes validation reports `path: "llm"`. The `pythonHeart` is
   * byte-identical on both paths (item 3).
   */
  async #runGenerate(
    plan: LoversPlan,
    input: LoversRunnerInput,
    ports: LoversPorts,
    deadline: number,
    usageRecords: UsageRecord[],
  ): Promise<{ readonly pair: LoversPair; readonly path: "llm" | "template" }> {
    const templatePair = (): LoversPair => this.#grimoire.buildTemplatePair(plan);

    // No model bound (or no router): straight to the deterministic template.
    if (ports.llm === undefined || ports.router === undefined) {
      const pair = templatePair();
      if (this.#validate(plan, pair).ok) return { pair, path: "template" };
      // The deterministic template is designed to pass the gate; if it somehow
      // does not, it is still the only deterministic artifact we can emit.
      return { pair, path: "template" };
    }

    const step = this.#grimoire.generate;
    const heart = this.#grimoire.buildDeterministicHeart(plan);
    const planJson = JSON.stringify(plan);
    const construct: LlmConstructInput = {
      path: input.file,
      construct: planJson,
      source: planJson,
    };
    // GENERATE routing (design A.3): by function count + token estimate, NOT
    // crossLangTypeMapping (which would always force STRONG). A larger plan
    // (more functions / bigger prompt) escalates.
    const signals = generateSignals(plan, planJson);
    let tier: ModelTier = ports.router.route(signals);
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - ports.clock.nowMs();
      const timeoutMs = Math.min(
        GENERATE_PER_CALL_CAP_MS,
        remaining - WRITE_RESERVE_MS,
      );
      if (timeoutMs <= 0) {
        return { pair: templatePair(), path: "template" };
      }
      const model = ports.router.resolveModel(tier, input.modelOverride);
      const req = this.#withRetryPrompt(step.buildRequest(construct), attempt, lastError, {
        model,
        timeoutMs,
      });

      const text = await this.#complete(ports, req, usageRecords);
      if (text === null) {
        return { pair: templatePair(), path: "template" };
      }
      const parsed = step.outputSchema.safeParse(safeJson(text));
      if (parsed.success) {
        // ALWAYS combine the four LLM artifacts with the deterministic heart to
        // form the full pair (item 3), then run the gate.
        const pair: LoversPair = { ...parsed.data, pythonHeart: heart };
        const gate = this.#validate(plan, pair);
        if (gate.ok) {
          // Accepted output: cache it (A.8 cache rule) and emit via the LLM path.
          ports.cache?.set(req.cacheKey, text);
          return { pair, path: "llm" };
        }
        lastError = gate.reason;
      } else {
        lastError = schemaErrorText(parsed.error);
      }

      // Decide whether to retry under the deadline (design A.8). GENERATE has no
      // extractPlan-floor special case; a retry is simply skipped when there is
      // not enough time for the retry minimum.
      if (attempt === 0) {
        const afterRemaining = deadline - ports.clock.nowMs();
        if (afterRemaining < RETRY_MIN_MS) {
          return { pair: templatePair(), path: "template" };
        }
        tier = "STRONG"; // FAST escalates; a STRONG start stays STRONG.
        continue;
      }
      // The one retry also failed: deterministic AST-template fallback.
      return { pair: templatePair(), path: "template" };
    }
    return { pair: templatePair(), path: "template" };
  }

  // -------------------------------------------------------------------------
  // VALIDATE — run the injected Lovers gate with the oracle parsers, a schema
  // validator backed by coven `parseContract`, and coven `denyScan`.
  // -------------------------------------------------------------------------

  /**
   * Run `validateLovers` over the full assembled pair. The two tree-sitter
   * parsers are the armed oracle `parsePython`/`parseJavascript`; the JSON
   * Schema validator is backed by coven's {@link parseContract}; the deny-list
   * scan is coven's {@link denyScan}. All injected so the gate stays pure and
   * never executes the generated code (security rule 1).
   */
  #validate(plan: LoversPlan, pair: LoversPair): LoversValidateResult {
    const validateSchema: LoversValidateSchemaFn = (serialized) =>
      parseContract(serialized).ok;
    return this.#grimoire.validateLovers(
      plan,
      pair,
      (src) => parsePython(src),
      (src) => parseJavascript(src),
      validateSchema,
      (code, lang) => denyScan(code, lang),
    );
  }

  // -------------------------------------------------------------------------
  // Shared LLM helpers.
  // -------------------------------------------------------------------------

  /**
   * Build the per-attempt request: the retry (attempt 1) carries the EXACT
   * prior error appended to the prompt (design A.8 / R36.3), and every call
   * carries the routed `model` + the deadline-derived `timeoutMs`.
   */
  #withRetryPrompt(
    base: LlmRequest,
    attempt: number,
    lastError: string,
    over: { readonly model: string; readonly timeoutMs: number },
  ): LlmRequest {
    return {
      ...base,
      model: over.model,
      timeoutMs: over.timeoutMs,
      prompt:
        attempt === 0
          ? base.prompt
          : `${base.prompt}\n\nPREVIOUS ATTEMPT REJECTED: ${lastError}`,
    };
  }

  /**
   * Call the injected `LlmPort`, honouring the shared cache for ACCEPTED
   * outputs (a cache hit returns the stored text without a call). Accumulates
   * each call's `LlmResult.usage` into `usageRecords` (folded into
   * `soulsSpent`). Returns the raw text, or `null` on timeout / unavailable /
   * breaker-open so the caller can fall back. Never throws.
   */
  async #complete(
    ports: LoversPorts,
    req: LlmRequest,
    usageRecords: UsageRecord[],
  ): Promise<string | null> {
    const llm = ports.llm;
    if (llm === undefined) return null;
    const hit = ports.cache?.get(req.cacheKey);
    if (hit !== undefined) return hit;
    try {
      const result = await llm.complete(req, { timeoutMs: req.timeoutMs });
      if (result.usage !== undefined) usageRecords.push(result.usage);
      return result.text;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure routing-signal derivation (design A.3).
// ---------------------------------------------------------------------------

/**
 * PLAN router signals: the small discovery unit. `tokenEstimate` ~4 chars/token
 * over the masked source; `unresolvedDiagnostics` is the bindable-function
 * count; difficulty flags stay false so PLAN routes FAST unless the source is
 * large (design A.3). crossLangTypeMapping is NOT set here (it would force
 * STRONG; PLAN is the cheap FAST step).
 */
function planSignals(maskedSource: string, plan: LoversPlan): RouterSignals {
  return {
    tokenEstimate: Math.ceil(maskedSource.length / 4),
    unresolvedDiagnostics: plan.functions.length,
    difficulty: {
      metaclass: false,
      unicodeBytes: false,
      dynamicImport: false,
      crossLangTypeMapping: false,
    },
  };
}

/**
 * GENERATE router signals: routed by FUNCTION COUNT + TOKEN ESTIMATE, NOT
 * crossLangTypeMapping (design A.3; task 8.6). `tokenEstimate` ~4 chars/token
 * over the plan JSON; `unresolvedDiagnostics` is the function count so a larger
 * binding escalates FAST->STRONG via the pure router's diagnostic limit.
 * crossLangTypeMapping is deliberately FALSE so routing is driven by size, not
 * a blanket "it's a cross-language unit" STRONG override.
 */
function generateSignals(plan: LoversPlan, planJson: string): RouterSignals {
  return {
    tokenEstimate: Math.ceil(planJson.length / 4),
    unresolvedDiagnostics: plan.functions.length,
    difficulty: {
      metaclass: false,
      unicodeBytes: false,
      dynamicImport: false,
      crossLangTypeMapping: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/** Tolerant JSON parse (mirrors the resurrect runner); never throws. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Collapse a zod error into a short, stable, secret-free retry hint. */
function schemaErrorText(error: { readonly issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }> }): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

/**
 * The oracle-voice VALIDATION_FAILED error raised when the PLAN precondition
 * rejects the input (oversized source, too many functions, or no bindable
 * top-level function). NO model call is made in that case (R16.6). The
 * `extractPlan` `reason` is already oracle-voice, so it is the user message.
 */
function loversPreconditionError(reason: string): NecroError {
  return covenError("VALIDATION_FAILED", reason);
}
