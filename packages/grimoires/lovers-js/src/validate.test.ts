// @necro/grimoires-lovers-js — unit tests for the Lovers validation gate.
//
// Minimal example-based coverage for `validateLovers` + `contractFnNames`
// (task 8.4). The property tests (8.8/8.9/8.13) live elsewhere; here we assert:
//   - a clean `buildTemplatePair(plan)` output is ACCEPTED (deny-list clean,
//     both sides parse with zero error nodes, $defs == plan names, every
//     planned fn on both sides),
//   - a tampered pair that smuggles `eval(` into the beloved is REJECTED with a
//     `deny_list_hit:` reason, and
//   - a tampered pair that DROPS a planned function from the beloved is
//     REJECTED (`missing_js_fn:`),
//   - `contractFnNames` reduces `$defs` keys to the plan's function-name set.
//
// Offline: the only capabilities are the oracle's real tree-sitter parsers
// (armed once via `initParser`), coven's pure `parseContract`-backed schema
// check, and coven's pure `denyScan`. No network, LLM, or sandbox.
//
// Validates: Requirements 17.1, 17.2, 17.3, 17.7, 17.8

import { denyScan, parseContract, type LoversPlan } from "@necro/coven";
import { initJavascript, initParser, parseJavascript, parsePython } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { buildTemplatePair } from "./fixers/ast-bridge.js";
import { contractFnNames, validateLovers } from "./validate.js";

/** The injected JSON-Schema check: valid when `parseContract` accepts it. */
const validateSchema = (serialized: string): boolean => parseContract(serialized).ok;

/** A tiny two-function plan: `add(a, b) -> int`, `greet(name) -> str`. */
function samplePlan(): LoversPlan {
  return {
    functions: [
      {
        name: "add",
        params: [
          { name: "a", pyType: "int", jsonType: "integer", jsType: "number", required: true },
          { name: "b", pyType: "int", jsonType: "integer", jsType: "number", required: true },
        ],
        returns: { pyType: "int", jsonType: "integer", jsType: "number" },
        bindable: true,
        edgeCases: ["0 and 0", "negative ints"],
      },
      {
        name: "greet",
        params: [
          { name: "name", pyType: "str", jsonType: "string", jsType: "string", required: true },
        ],
        returns: { pyType: "str", jsonType: "string", jsType: "string" },
        bindable: true,
        edgeCases: ["empty string", "unicode"],
      },
    ],
    typeMap: [
      { py: "int", json: "integer", js: "number" },
      { py: "str", json: "string", js: "string" },
    ],
  };
}

describe("R17.1, R17.2, R17.3, R17.7: validateLovers accepts a clean template pair", () => {
  beforeAll(async () => {
    await initParser();
    await initJavascript();
  });

  it("accepts the deterministic buildTemplatePair(plan) output", () => {
    const plan = samplePlan();
    const pair = buildTemplatePair(plan);
    const result = validateLovers(plan, pair, parsePython, parseJavascript, validateSchema, denyScan);
    expect(result).toEqual({ ok: true });
  });

  it("contractFnNames reduces the $defs keys to the plan's function names", () => {
    const pair = buildTemplatePair(samplePlan());
    expect(contractFnNames(pair.contractSchema)).toEqual(new Set(["add", "greet"]));
  });
});

describe("R17.7, R17.8: validateLovers rejects a pair that smuggles a forbidden construct", () => {
  beforeAll(async () => {
    await initParser();
    await initJavascript();
  });

  it("rejects a beloved tampered with an eval() call (deny-list hit)", () => {
    const plan = samplePlan();
    const pair = buildTemplatePair(plan);
    // Inject a real eval() call into the beloved (outside any string/comment).
    const tampered = {
      ...pair,
      jsBeloved: `${pair.jsBeloved}\nconst pwned = eval("1 + 1");\n`,
    };
    const result = validateLovers(
      plan,
      tampered,
      parsePython,
      parseJavascript,
      validateSchema,
      denyScan,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^deny_list_hit:eval$/);
    }
  });
});

describe("R17.3: validateLovers rejects a pair that drops a planned function", () => {
  beforeAll(async () => {
    await initParser();
    await initJavascript();
  });

  it("rejects a beloved missing one planned export (missing_js_fn)", () => {
    const plan = samplePlan();
    const pair = buildTemplatePair(plan);
    // Drop ONLY the `greet` export body from the beloved, keeping `add` intact
    // and the file syntactically valid JS. `greet` is the last wrapper so its
    // function runs to EOF; its leftover JSDoc comment is harmless.
    const strippedBeloved = pair.jsBeloved.replace(
      /export async function greet\([\s\S]*$/,
      "",
    );
    expect(strippedBeloved).not.toContain("export async function greet");
    const tampered = { ...pair, jsBeloved: strippedBeloved };
    const result = validateLovers(
      plan,
      tampered,
      parsePython,
      parseJavascript,
      validateSchema,
      denyScan,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing_js_fn:greet");
    }
  });
});
