// @necro/grimoires-lovers-js — PLAN/GENERATE LlmStep contract tests (task 8.2).
//
// Locks the two declarative steps' contract: each `buildRequest` delegates to
// the shared `@necro/coven` templates (so the built user message carries
// exactly one UNTRUSTED_OPEN / UNTRUSTED_CLOSE marker pair — R8.2), the HARD
// token caps are set, and each `mockFixture` returns a schema-valid output
// (PLAN -> `LoversPlanSchema`; GENERATE -> `LoversPairLlmSchema` with NO
// `pythonHeart`). No network / LLM / sandbox — the oracle parser (reached via
// `extractPlan` inside the PLAN `buildRequest`/`mockFixture`) is armed once.
//
// Validates: Requirements 15.1, 15.2, 15.5, 16.1, 23.2, 37.1, 37.2

import {
  LoversPairLlmSchema,
  LoversPlanSchema,
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  type LlmConstructInput,
} from "@necro/coven";
import { initParser } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { GENERATE_STEP, MAX_TOKENS_HARD_CAP, PLAN_STEP } from "../index.js";

beforeAll(async () => {
  await initParser();
});

const RESURRECTED = "def add(a, b):\n    return a + b\n";

function countMarkers(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

describe("PLAN_STEP (R15.1, R15.2, R15.5, R16.1, R37.1)", () => {
  const input: LlmConstructInput = {
    path: "sample.py",
    construct: "add",
    source: RESURRECTED,
  };

  it("builds a request that delegates to the shared lovers.plan template", () => {
    const req = PLAN_STEP.buildRequest(input);
    expect(req.system).toContain("JSON contract");
    expect(req.prompt).toContain("Extracted top-level functions");
    // The extractPlan signatures are rendered into the trusted slot.
    expect(req.prompt).toContain("- add(a, b)");
    // Exactly one untrusted marker pair (R8.2).
    expect(countMarkers(req.prompt, UNTRUSTED_OPEN)).toBe(1);
    expect(countMarkers(req.prompt, UNTRUSTED_CLOSE)).toBe(1);
    expect(req.maxTokens).toBe(1200);
    expect(req.promptVersion).toBe("v1");
    expect(req.cacheKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a schema-valid LoversPlan from its mock fixture", () => {
    const text = PLAN_STEP.mockFixture(input);
    const parsed = LoversPlanSchema.parse(JSON.parse(text));
    expect(parsed.functions.map((f) => f.name)).toEqual(["add"]);
  });
});

describe("GENERATE_STEP (R16.1, R37.2)", () => {
  const input: LlmConstructInput = {
    path: "sample.py",
    construct: JSON.stringify({
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
    }),
    source: RESURRECTED,
  };

  it("builds a request that delegates to the shared lovers.generate template with the HARD cap", () => {
    const req = GENERATE_STEP.buildRequest(input);
    expect(req.system).toContain("JavaScript side");
    expect(req.prompt).toContain("Validated plan");
    expect(countMarkers(req.prompt, UNTRUSTED_OPEN)).toBe(1);
    expect(countMarkers(req.prompt, UNTRUSTED_CLOSE)).toBe(1);
    expect(req.maxTokens).toBe(MAX_TOKENS_HARD_CAP);
    expect(req.maxTokens).toBe(6144);
    expect(req.promptVersion).toBe("v1");
  });

  it("returns a schema-valid LoversPairLlm (no pythonHeart) from its mock fixture", () => {
    const text = GENERATE_STEP.mockFixture(input);
    const obj = JSON.parse(text) as Record<string, unknown>;
    expect(obj).not.toHaveProperty("pythonHeart");
    const parsed = LoversPairLlmSchema.parse(obj);
    expect(parsed.jsBeloved.length).toBeGreaterThan(0);
    expect(parsed.contractSchema.length).toBeGreaterThan(0);
  });
});
