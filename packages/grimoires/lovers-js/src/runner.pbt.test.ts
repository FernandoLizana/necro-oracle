// @necro/coven — property test for the LoversRunner's ONE unified retry policy
// (task 8.7).
//
// Property 2 (R4.1, R4.2, R4.4): one retry per unit, FAST->STRONG only, max 2
//   calls, then the deterministic fallback.
// Property 30 (R36.1, R36.2): the per-reading call cap is honoured.
//
// The two phases PLAN and GENERATE each obey the SAME policy (design A.8 "one
// retry policy + timeout arithmetic"):
//   - call #1 at the routed start tier;
//   - on a zod-schema OR `validateLovers` failure, EXACTLY ONE retry carrying
//     the exact prior error, escalating FAST->STRONG (a STRONG start stays
//     STRONG);
//   - MAX CALLS PER UNIT = 2;
//   - then the deterministic fallback (PLAN -> `extractPlan` plan; GENERATE ->
//     the AST-template bridge, reporting `path: "template"`).
// A pair that passes validation on the LLM path reports `path: "llm"`; the
// deterministic `pythonHeart` is byte-identical on both paths (design item 3).
//
// This property drives the REAL `LocalLoversRunner.run` over generated per-unit
// outcome scenarios. Every side-effecting capability is a tiny in-memory fake:
//   - a Mock `LlmPort` that NEVER touches the network and returns a scripted,
//     per-call text while COUNTING its calls and recording the exact `model`
//     + `prompt` of each request (so we can assert the retry carries the error
//     and the FAST->STRONG escalation);
//   - a pure `ModelRouterPort` that maps FAST/STRONG to two fixed, distinct
//     model ids and whose `route` start tier is generated;
//   - a controllable `ClockPort`;
//   - a capturing `LedgerPort`;
//   - a stub `LoversGrimoirePort` whose `plan`/`generate` `outputSchema` and
//     `validateLovers` are DRIVEN by the scenario to accept / zod-fail /
//     gate-fail at each attempt, and whose deterministic `buildDeterministicHeart`
//     / `buildTemplatePair` emit a fixed valid pair.
// coven never imports a grimoire or `@necro/llm` (dependency direction
// oracle <- grimoires <- coven), so the stubs live in this file.
//
// The runner internally arms the real oracle parser and computes the real
// `extractPlan` over the input, so the input is a genuine, small, valid Python
// 3 source with two bindable top-level functions (the precondition passes and
// the deterministic `fallbackPlan` is well-formed).
//
// fast-check runs 300 times; the seed is printed on failure (fast-check prints
// the failing seed by default). When a counterexample is found it should be
// pinned as a permanent regression example next to this property.

import {
  LocalLoversRunner,
  type ClockPort,
  type LedgerEvent,
  type LedgerPort,
  type LlmPort,
  type LlmRequest,
  type LlmResult,
  type LoversGrimoirePort,
  type LoversPair,
  type LoversPairLlm,
  type LoversPlan,
  type LoversValidateResult,
  type ModelRouterPort,
  type ModelTier,
  type RouterSignals,
} from "@necro/coven";
import { initParser } from "@necro/oracle";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { SafeParseReturnType, ZodType } from "zod";

// ---------------------------------------------------------------------------
// Fixed, genuinely-valid inputs the real `extractPlan`/parser accept.
// ---------------------------------------------------------------------------

/**
 * A small, valid Python 3 module with two bindable top-level functions. The
 * runner computes the REAL `extractPlan` over this, so the precondition passes
 * and the deterministic fallback plan is well-formed. No secrets, so masking is
 * a no-op on it.
 */
const PY_SOURCE = [
  "def add(a: int, b: int) -> int:",
  "    return a + b",
  "",
  "def greet(name: str) -> str:",
  '    return "hi " + name',
  "",
].join("\n");

/** The two fixed model ids the pure router resolves FAST/STRONG to. */
const FAST_MODEL = "vendor/fast-1";
const STRONG_MODEL = "vendor/strong-1";

// ---------------------------------------------------------------------------
// A fixed, schema-shaped deterministic pair + plan the stubs emit. The runner
// never inspects these beyond handing them to the (stubbed) gate, so concrete
// valid-looking values are enough.
// ---------------------------------------------------------------------------

const FIXED_HEART = "import sys\n# deterministic heart\n";

const FIXED_LLM_PAIR: LoversPairLlm = {
  jsBeloved: "// js beloved client\nexport const x = 1;\n",
  contractSchema: '{"$schema":"https://json-schema.org/draft/2020-12/schema","$defs":{}}',
  pythonTests: "# python tests\n",
  jsTests: "// js tests\n",
};

const FIXED_TEMPLATE_PAIR: LoversPair = {
  ...FIXED_LLM_PAIR,
  jsBeloved: "// template js beloved\nexport const y = 2;\n",
  pythonHeart: FIXED_HEART,
};

// ---------------------------------------------------------------------------
// Scenario model — one generated outcome per attempt, per unit.
// ---------------------------------------------------------------------------

/**
 * How one attempt resolves. `accept` => the step's output schema parses AND the
 * gate passes (GENERATE) / the schema parses (PLAN). `zodFail` => the output
 * schema `safeParse` fails. `gateFail` => the schema parses but
 * `validateLovers` returns `{ ok: false }` (GENERATE only; PLAN has no gate).
 */
type AttemptOutcome = "accept" | "zodFail" | "gateFail";

interface Scenario {
  /** PLAN per-attempt outcomes (index 0 = first call, 1 = the one retry). */
  readonly plan: readonly [AttemptOutcome, AttemptOutcome];
  /** GENERATE per-attempt outcomes (index 0 = first call, 1 = the one retry). */
  readonly generate: readonly [AttemptOutcome, AttemptOutcome];
  /** The routed START tier for both units (route() is pure of signals). */
  readonly startTier: ModelTier;
}

const arbOutcome: fc.Arbitrary<AttemptOutcome> = fc.constantFrom(
  "accept",
  "zodFail",
  "gateFail",
);

// PLAN has no gate, so a PLAN `gateFail` behaves as a `zodFail` for PLAN; we
// still generate it to prove PLAN never over-retries regardless.
const arbScenario: fc.Arbitrary<Scenario> = fc.record({
  plan: fc.tuple(arbOutcome, arbOutcome),
  generate: fc.tuple(arbOutcome, arbOutcome),
  startTier: fc.constantFrom<ModelTier>("FAST", "STRONG"),
});

// ---------------------------------------------------------------------------
// In-memory fakes — no network, no real LLM, no sandbox.
// ---------------------------------------------------------------------------

/** A fixed-time `ClockPort` so the deadline never forces a retry to be skipped. */
function makeFixedClock(): ClockPort {
  return { nowMs: () => 1_000_000 };
}

/** A capturing `LedgerPort` — appends are recorded, never fail. */
function makeLedger(): { port: LedgerPort; events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    events,
    port: {
      async append(event: LedgerEvent): Promise<void> {
        events.push(event);
      },
    },
  };
}

/** A pure router: `route` returns the generated start tier; `resolveModel` maps tiers to fixed ids. */
function makeRouter(startTier: ModelTier): ModelRouterPort {
  return {
    route(_signals: RouterSignals): ModelTier {
      return startTier;
    },
    resolveModel(tier: ModelTier): string {
      return tier === "STRONG" ? STRONG_MODEL : FAST_MODEL;
    },
  };
}

interface RecordedCall {
  readonly model: string;
  readonly prompt: string;
}

/**
 * A Mock `LlmPort` that records every call's model + prompt and returns a fixed
 * non-empty text (the stub schema decides accept/fail, not the text). Never
 * touches the network. Each call reports a small `usage` record so the souls
 * fold has something to sum.
 */
function makeLlm(calls: RecordedCall[]): LlmPort {
  return {
    providerId: "mock",
    async complete(req: LlmRequest): Promise<LlmResult> {
      calls.push({ model: req.model ?? "", prompt: req.prompt });
      return {
        text: "{}",
        cached: false,
        usage: {
          model: req.model ?? FAST_MODEL,
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0,
        },
      };
    },
  };
}

/**
 * Build a stub `ZodType` whose `safeParse` succeeds/fails per the unit's
 * per-attempt outcome. A call counter selects the attempt index (0 then 1); an
 * out-of-range index (should never happen under a max-2 policy) defaults to the
 * last outcome so an over-retry would surface as a wrong accept/fail rather
 * than crash. `accept` and `gateFail` both PARSE (the gate — not the schema —
 * then decides on the GENERATE path); only `zodFail` fails the schema.
 */
function makeSchema<T>(
  outcomes: readonly [AttemptOutcome, AttemptOutcome],
  value: T,
  parseCounter: { n: number },
): ZodType<T> {
  const fail = {
    success: false as const,
    error: { issues: [{ message: "stub schema rejection", path: ["field"] }] },
  };
  return {
    safeParse(_input: unknown): SafeParseReturnType<unknown, T> {
      const idx = Math.min(parseCounter.n, outcomes.length - 1);
      parseCounter.n += 1;
      const outcome = outcomes[idx]!;
      if (outcome === "zodFail") {
        return fail as unknown as SafeParseReturnType<unknown, T>;
      }
      return {
        success: true as const,
        data: value,
      } as unknown as SafeParseReturnType<unknown, T>;
    },
  } as unknown as ZodType<T>;
}

/**
 * Build the stub `LoversGrimoirePort`. The two steps' `outputSchema` are driven
 * by the scenario; `validateLovers` returns `{ ok: false }` whenever the
 * current GENERATE attempt's outcome is `gateFail` (so a parse-success +
 * gate-fail exercises the gate-driven retry). `buildRequest` returns a minimal
 * request; the deterministic heart/template-pair are fixed valid values.
 */
function makeGrimoire(
  scenario: Scenario,
  planParse: { n: number },
  genParse: { n: number },
  fallbackPlanValue: LoversPlan,
): LoversGrimoirePort {
  const planSchema = makeSchema<LoversPlan>(scenario.plan, fallbackPlanValue, planParse);
  const genSchema = makeSchema<LoversPairLlm>(scenario.generate, FIXED_LLM_PAIR, genParse);

  const baseRequest = (prompt: string): LlmRequest => ({
    system: "stub-system",
    prompt,
    maxTokens: 64,
    timeoutMs: 1_000,
    cacheKey: `stub:${prompt}`,
  });

  return {
    plan: {
      outputSchema: planSchema,
      buildRequest: () => baseRequest("PLAN_BASE_PROMPT"),
      apply: (source) => source,
      mockFixture: () => "{}",
    },
    generate: {
      outputSchema: genSchema,
      buildRequest: () => baseRequest("GENERATE_BASE_PROMPT"),
      apply: (source) => source,
      mockFixture: () => "{}",
    },
    buildDeterministicHeart: () => FIXED_HEART,
    buildTemplatePair: () => FIXED_TEMPLATE_PAIR,
    validateLovers(): LoversValidateResult {
      // Called once per GENERATE attempt WHOSE SCHEMA JUST PARSED, so the
      // relevant attempt is the one the parse counter most recently consumed
      // (`genParse.n - 1`). This keeps the gate decision aligned with the exact
      // attempt even when an earlier attempt zod-failed (and never reached the
      // gate). `gateFail` at that attempt => reject.
      const idx = Math.min(Math.max(genParse.n - 1, 0), scenario.generate.length - 1);
      const outcome = scenario.generate[idx]!;
      if (outcome === "gateFail") {
        return { ok: false, reason: "stub gate rejection" };
      }
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe("Property 2 / Property 30 (R4.1, R4.2, R4.4, R36.1, R36.2): the LoversRunner's one unified retry policy", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("issues at most one retry per unit (max 2 calls), FAST->STRONG only, never throws, and always emits a result", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const planCalls: RecordedCall[] = [];
        const genCalls: RecordedCall[] = [];

        // Separate Mock ports per unit so each unit's call list is isolated;
        // the runner uses ONE `ports.llm`, so we key by the base prompt to
        // split the recorded calls after the run instead.
        const allCalls: RecordedCall[] = [];
        const llm = makeLlm(allCalls);

        const router = makeRouter(scenario.startTier);
        const { port: ledger } = makeLedger();
        const clock = makeFixedClock();

        // The real extractPlan over PY_SOURCE is the fallback plan value the
        // stub plan-schema "accepts" — a genuine, schema-valid LoversPlan.
        // (The runner recomputes it internally; we only need a valid value for
        // the stub schema's success branch.)
        const planParse = { n: 0 };
        const genParse = { n: 0 };

        // A minimal valid plan for the stub's accept branch. The runner's own
        // fallbackPlan comes from the real extractPlan; this value is only ever
        // returned by the stub plan schema on `accept`.
        const fallbackPlanValue: LoversPlan = {
          functions: [
            {
              name: "add",
              params: [
                { name: "a", pyType: "int", jsonType: "integer", jsType: "number", required: true },
                { name: "b", pyType: "int", jsonType: "integer", jsType: "number", required: true },
              ],
              returns: { pyType: "int", jsonType: "integer", jsType: "number" },
              bindable: true,
              edgeCases: [],
            },
          ],
          typeMap: [{ py: "int", json: "integer", js: "number" }],
        };

        const grimoire = makeGrimoire(scenario, planParse, genParse, fallbackPlanValue);

        const runner = new LocalLoversRunner(grimoire, { totalBudgetMs: 90_000 });

        const emittedPhases: string[] = [];
        let result;
        let threw = false;
        try {
          result = await runner.run(
            {
              source: PY_SOURCE,
              file: "mod.py",
              targetLang: "javascript",
              soulSource: "ORACLE",
              demo: false,
            },
            { clock, ledger, llm, router },
            { phase: (p) => void emittedPhases.push(p) },
          );
        } catch {
          threw = true;
        }

        // --- NEVER throws, ALWAYS emits a result (R4.4 fallback guarantee) ---
        expect(threw).toBe(false);
        expect(result).toBeDefined();
        if (result === undefined) return;

        // Split the recorded calls by their base prompt so we can reason per
        // unit (PLAN vs GENERATE).
        for (const c of allCalls) {
          if (c.prompt.startsWith("PLAN_BASE_PROMPT")) planCalls.push(c);
          else if (c.prompt.startsWith("GENERATE_BASE_PROMPT")) genCalls.push(c);
        }

        // --- MAX CALLS PER UNIT = 2 (R4.1): never more than one retry --------
        expect(planCalls.length).toBeLessThanOrEqual(2);
        expect(genCalls.length).toBeLessThanOrEqual(2);

        // --- Per-reading call cap (R36.1, R36.2): total <= 4 (2 units x 2) ---
        expect(allCalls.length).toBeLessThanOrEqual(4);

        // --- PLAN retry iff the first attempt zod-failed --------------------
        // PLAN has NO gate: the runner only checks `plan.outputSchema.safeParse`.
        // In the stub schema a `gateFail` outcome still PARSES (only `zodFail`
        // fails the schema), so PLAN accepts on the first call for both `accept`
        // and `gateFail` and retries only on a genuine `zodFail`.
        const planFirstZodFails = scenario.plan[0] === "zodFail";
        if (planFirstZodFails) {
          // Retry happens unless the deadline forbids it — but the fixed clock
          // keeps the whole budget available, so exactly 2 calls occur.
          expect(planCalls.length).toBe(2);
        } else {
          expect(planCalls.length).toBe(1);
        }

        // --- GENERATE retry iff the first attempt failed (zod OR gate) ------
        const genFirstFails = scenario.generate[0] !== "accept";
        if (genFirstFails) {
          expect(genCalls.length).toBe(2);
        } else {
          expect(genCalls.length).toBe(1);
        }

        // --- FAST->STRONG escalation only; the retry carries the exact error -
        const assertEscalation = (
          calls: readonly RecordedCall[],
          basePrompt: string,
        ): void => {
          if (calls.length === 0) return;
          // Call #1 is always at the routed start tier.
          const startModel = scenario.startTier === "STRONG" ? STRONG_MODEL : FAST_MODEL;
          expect(calls[0]!.model).toBe(startModel);
          // Call #1 carries the base prompt, NO appended error.
          expect(calls[0]!.prompt).toBe(basePrompt);
          if (calls.length === 2) {
            // The retry escalates FAST->STRONG; a STRONG start stays STRONG.
            expect(calls[1]!.model).toBe(STRONG_MODEL);
            // The retry carries the EXACT prior error appended to the prompt.
            expect(calls[1]!.prompt.startsWith(basePrompt)).toBe(true);
            expect(calls[1]!.prompt).toContain("PREVIOUS ATTEMPT REJECTED:");
            expect(calls[1]!.prompt.length).toBeGreaterThan(basePrompt.length);
          }
        };
        assertEscalation(planCalls, "PLAN_BASE_PROMPT");
        assertEscalation(genCalls, "GENERATE_BASE_PROMPT");

        // --- GENERATE path reflects accept vs deterministic fallback --------
        // The LLM path ("llm") is reported ONLY when some GENERATE attempt both
        // parsed AND passed the gate. Otherwise the deterministic AST-template
        // bridge is used ("template").
        const genAccepted = scenario.generate.some((o) => o === "accept");
        if (genAccepted) {
          expect(result.path).toBe("llm");
          // On the LLM path the pair is the LLM artifacts + the deterministic heart.
          expect(result.pair.pythonHeart).toBe(FIXED_HEART);
          expect(result.pair.jsBeloved).toBe(FIXED_LLM_PAIR.jsBeloved);
        } else {
          expect(result.path).toBe("template");
          // The deterministic heart is byte-identical on both paths (item 3).
          expect(result.pair.pythonHeart).toBe(FIXED_HEART);
          expect(result.pair.jsBeloved).toBe(FIXED_TEMPLATE_PAIR.jsBeloved);
        }

        // --- The result is always a well-formed LoversResult ----------------
        expect(result.file).toBe("mod.py");
        expect(result.targetLang).toBe("javascript");
        expect(result.soulSource).toBe("ORACLE");
        expect(result.demo).toBe(false);
        expect(result.soulsSpent.soulSource).toBe("ORACLE");
      }),
      { numRuns: 300 },
    );
  });
});
