// @necro/coven — LoversRunner unit tests (design C.4, A.8, item 3).
//
// Drives `LocalLoversRunner.run` end to end over the Mock path (network-free,
// no real LLM, no sandbox — testing steering). Two scenarios:
//
//   1. PLAN + GENERATE mock fixtures -> validate -> emit a LoversResult with
//      `path: "llm"` (the accepted-LLM path).
//   2. A forced GENERATE validation failure after the one retry -> deterministic
//      template fallback with `path: "template"`.
//
// The real `@necro/grimoires-lovers-js` is deliberately NOT imported — that
// would invert the enforced dependency direction `oracle <- grimoires <- coven`
// (the grimoire package depends on `@necro/coven`). Instead a tiny DETERMINISTIC
// stub `LoversGrimoirePort` is injected, mirroring the grimoire barrel's
// contract. The stub reuses the REAL coven pieces where it can (the plan comes
// from the runner's own `extractPlan`; the heart/pair are byte-stable strings
// the gate accepts). The Mock `LlmPort` is a passthrough that echoes the
// request prompt, so each stub step's `buildRequest` emits the fixture JSON
// directly — exactly the "PLAN + GENERATE mock fixtures" path.

import { initParser } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import type { ClockPort, LedgerPort, LlmPort, ModelRouterPort } from "../ports.js";
import type { LlmConstructInput, LedgerEvent } from "../models.js";
import {
  LocalLoversRunner,
  type LoversEmit,
  type LoversGrimoirePort,
  type LoversPhase,
  type LoversRunnerInput,
} from "./runner.js";
import type {
  LoversPair,
  LoversPairLlm,
  LoversPlan,
} from "./types.js";
import { LoversPairLlmSchema, LoversPlanSchema } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures: a tiny resurrected module with one bindable top-level function.
// ---------------------------------------------------------------------------

const SOURCE = ["def add(a, b):", "    return a + b", ""].join("\n");

/** The deterministic heart a stub emits — a minimal parseable dispatcher. */
function stubHeart(plan: LoversPlan): string {
  const names = plan.functions.map((f) => f.name);
  const importList = names.join(", ");
  const dispatch = names.map((n) => `        "${n}": ${n},`).join("\n");
  return [
    `import json`,
    `import sys`,
    `try:`,
    names.length > 0 ? `    from resurrected import ${importList}` : `    pass`,
    `    _DISPATCH = {`,
    dispatch,
    `    }`,
    `except Exception:`,
    `    _DISPATCH = {}`,
    ``,
    ``,
    `def handle(request):`,
    `    return {"id": request.get("id"), "ok": False, "error": {"type": "X", "message": "stub"}}`,
    ``,
  ].join("\n");
}

/** A deterministic jsBeloved exporting one async wrapper per planned function. */
function stubBeloved(plan: LoversPlan): string {
  const spawn = `import { spawn } from "node:child_process";\nconst PYTHON = process.env.PYTHON ?? "python3";\nconst _child = spawn(PYTHON, ["heart.py"]);\nexport function close() {}\n`;
  const wrappers = plan.functions
    .map(
      (f) =>
        `export async function ${f.name}(${f.params
          .map((p) => p.name)
          .join(", ")}) {\n  return undefined;\n}\n`,
    )
    .join("\n");
  return spawn + wrappers;
}

/** A deterministic contract whose $defs keys equal the plan function names. */
function stubContract(plan: LoversPlan): string {
  const defs: Record<string, unknown> = {};
  for (const f of plan.functions) {
    defs[`${f.name}.request`] = { type: "object" };
    defs[`${f.name}.response`] = { type: "object" };
  }
  return JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: defs,
  });
}

/** Four schema-valid LLM artifacts for a plan (NO heart). */
function stubLlmArtifacts(plan: LoversPlan): LoversPairLlm {
  return {
    jsBeloved: stubBeloved(plan),
    contractSchema: stubContract(plan),
    pythonTests: `import unittest\nimport heart\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n`,
    jsTests: `import test from "node:test";\nimport { close } from "./beloved.mjs";\ntest("ok", () => {});\n`,
  };
}

// ---------------------------------------------------------------------------
// A deterministic stub LoversGrimoirePort mirroring the grimoire barrel.
//
// `valid` controls whether the stub's gate accepts: `true` emits the LLM path,
// `false` forces every candidate pair to fail so the runner falls back to the
// template. The stub steps' `buildRequest` puts the fixture JSON straight into
// the prompt so the passthrough Mock echoes it back as the completion.
// ---------------------------------------------------------------------------

function stubGrimoire(opts: { gatePasses: boolean }): LoversGrimoirePort {
  const planFixture = (input: LlmConstructInput): string => {
    // The PLAN step's fixture: re-derive the deterministic plan from the source
    // (same as the real grimoire's mockFixture does via extractPlan). Here the
    // runner already masked the source; a minimal single-fn plan is enough.
    const plan: LoversPlan = {
      functions: [
        {
          name: "add",
          params: [
            { name: "a", pyType: "Any", jsonType: "object", jsType: "*", required: true },
            { name: "b", pyType: "Any", jsonType: "object", jsType: "*", required: true },
          ],
          returns: { pyType: "Any", jsonType: "object", jsType: "*" },
          bindable: true,
          edgeCases: [],
        },
      ],
      typeMap: [{ py: "Any", json: "object", js: "*" }],
    };
    void input;
    return JSON.stringify(plan);
  };

  return {
    plan: {
      outputSchema: LoversPlanSchema,
      buildRequest: (input) => ({
        system: "plan",
        prompt: planFixture(input),
        maxTokens: 1200,
        timeoutMs: 12_000,
        cacheKey: `plan:${input.path}`,
      }),
      apply: (_source, parsed) => JSON.stringify(parsed),
      mockFixture: (input) => planFixture(input),
    },
    generate: {
      outputSchema: LoversPairLlmSchema,
      buildRequest: (input) => {
        // The plan JSON arrives as `input.construct`; derive the four artifacts.
        const plan = LoversPlanSchema.parse(JSON.parse(input.construct));
        return {
          system: "generate",
          prompt: JSON.stringify(stubLlmArtifacts(plan)),
          maxTokens: 6144,
          timeoutMs: 45_000,
          cacheKey: `generate:${input.path}`,
        };
      },
      apply: (_source, parsed) => JSON.stringify(parsed),
      mockFixture: (input) => {
        const plan = LoversPlanSchema.parse(JSON.parse(input.construct));
        return JSON.stringify(stubLlmArtifacts(plan));
      },
    },
    buildDeterministicHeart: (plan) => stubHeart(plan),
    buildTemplatePair: (plan): LoversPair => ({
      pythonHeart: stubHeart(plan),
      jsBeloved: stubBeloved(plan),
      contractSchema: stubContract(plan),
      pythonTests: `import unittest\nimport heart\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n`,
      jsTests: `import test from "node:test";\nimport { close } from "./beloved.mjs";\ntest("ok", () => {});\n`,
    }),
    validateLovers: (_plan, _pair, _parsePy, _parseJs, _validateSchema, _denyScan) =>
      opts.gatePasses ? { ok: true } : { ok: false, reason: "forced_failure" },
  };
}

// ---------------------------------------------------------------------------
// Test doubles: a frozen clock, an in-memory ledger, a passthrough Mock LlmPort,
// and a deterministic router (always FAST, resolves to a fixed model id).
// ---------------------------------------------------------------------------

function makeClock(startMs = 0): ClockPort {
  return { nowMs: () => startMs };
}

function makeLedger(): { port: LedgerPort; events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    port: {
      append(event: LedgerEvent): Promise<void> {
        events.push(event);
        return Promise.resolve();
      },
    },
    events,
  };
}

/** A passthrough Mock: echoes the request prompt (the stub's fixture JSON). */
function passthroughLlm(): LlmPort {
  return {
    providerId: "mock",
    complete: (req) =>
      Promise.resolve({
        text: req.prompt,
        cached: false,
        usage: {
          model: req.model ?? "mock-model",
          promptTokens: 10,
          completionTokens: 20,
          costUsd: 0.001,
        },
      }),
  };
}

/** A deterministic router: always FAST, resolves to a fixed model id. */
function fixedRouter(): ModelRouterPort {
  return {
    route: () => "FAST",
    resolveModel: (tier) => (tier === "FAST" ? "fast-model" : "strong-model"),
  };
}

function makeEmit(): { emit: LoversEmit; phases: LoversPhase[] } {
  const phases: LoversPhase[] = [];
  return {
    emit: {
      phase: (p) => {
        phases.push(p);
      },
    },
    phases,
  };
}

const INPUT: LoversRunnerInput = {
  source: SOURCE,
  file: "resurrected.py",
  targetLang: "javascript",
  soulSource: "ORACLE",
  demo: true,
};

beforeAll(async () => {
  await initParser();
});

// ---------------------------------------------------------------------------
// Scenario 1: PLAN + GENERATE mock fixtures -> validate -> path "llm".
// ---------------------------------------------------------------------------

describe("LoversRunner (C.4): accepted LLM path", () => {
  it("drives PLAN+GENERATE mock fixtures through validate and emits a LoversResult with path llm", async () => {
    const runner = new LocalLoversRunner(stubGrimoire({ gatePasses: true }));
    const { emit, phases } = makeEmit();
    const { port: ledger } = makeLedger();

    const result = await runner.run(INPUT, {
      clock: makeClock(),
      ledger,
      llm: passthroughLlm(),
      router: fixedRouter(),
    }, emit);

    expect(result.path).toBe("llm");
    expect(result.file).toBe("resurrected.py");
    expect(result.targetLang).toBe("javascript");
    expect(result.demo).toBe(true);
    expect(result.soulSource).toBe("ORACLE");
    // The deterministic heart is present on the assembled pair (item 3).
    expect(result.pair.pythonHeart).toContain("def handle(request)");
    // Usage was accumulated from both PLAN and GENERATE calls.
    expect(result.soulsSpent.promptTokens).toBeGreaterThan(0);
    expect(result.soulsSpent.completionTokens).toBeGreaterThan(0);
    // Phases emitted in order.
    expect(phases).toEqual(["PLAN", "GENERATE", "VALIDATE", "BIND"]);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: forced validation failure -> template fallback -> path "template".
// ---------------------------------------------------------------------------

describe("LoversRunner (C.4, A.8): deterministic template fallback", () => {
  it("falls back to the AST-template bridge with path template when validation fails after the one retry", async () => {
    const runner = new LocalLoversRunner(stubGrimoire({ gatePasses: false }));
    const { emit, phases } = makeEmit();
    const { port: ledger } = makeLedger();

    const result = await runner.run(INPUT, {
      clock: makeClock(),
      ledger,
      llm: passthroughLlm(),
      router: fixedRouter(),
    }, emit);

    expect(result.path).toBe("template");
    // The pythonHeart is identical on both paths (item 3): still the stub heart.
    expect(result.pair.pythonHeart).toContain("def handle(request)");
    expect(phases).toEqual(["PLAN", "GENERATE", "VALIDATE", "BIND"]);
  });
});
