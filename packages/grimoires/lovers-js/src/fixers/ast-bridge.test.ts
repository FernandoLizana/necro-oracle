// @necro/grimoires-lovers-js — ast-bridge emit/shape tests (task 8.3).
//
// Scope: SHAPE + EMIT only. This asserts the pure bridge emits a deterministic
// heart (always) and a full template pair (fallback) that satisfy the coven
// `LoversPairSchema`/`LoversPairLlmSchema` shapes, that the heart carries the
// pinned C.2a protocol markers, that every planned function name appears on
// both sides and as a contract `$defs` pair, and that the output is stable.
// Full tree-sitter parse + contract round-trip + deny-list validation is the
// job of tasks 8.4 / 8.9 and is intentionally NOT done here.
//
// No network / LLM / sandbox — the bridge is a pure function of the plan.
//
// Validates: Requirements 16.2, 16.3, 16.4, 16.6, 17.4, 37.2, 38.1

import {
  LoversPairLlmSchema,
  LoversPairSchema,
  type LoversPlan,
} from "@necro/coven";
import { describe, expect, it } from "vitest";

import {
  astBridge,
  buildContractSchema,
  buildDeterministicHeart,
  buildTemplatePair,
  CONTRACT_DIALECT,
  HEART_FILENAME,
} from "../index.js";

/** A small 2-function plan (one with a default param) used across the suite. */
const PLAN: LoversPlan = {
  functions: [
    {
      name: "add",
      params: [
        { name: "a", pyType: "int", jsonType: "integer", jsType: "number", required: true },
        { name: "b", pyType: "int", jsonType: "integer", jsType: "number", required: true },
      ],
      returns: { pyType: "int", jsonType: "integer", jsType: "number" },
      bindable: true,
      edgeCases: ["a=0, b=0", "negative ints"],
    },
    {
      name: "greet",
      params: [
        { name: "name", pyType: "str", jsonType: "string", jsType: "string", required: true },
        { name: "loud", pyType: "bool", jsonType: "boolean", jsType: "boolean", required: false },
      ],
      returns: { pyType: "str", jsonType: "string", jsType: "string" },
      bindable: true,
      edgeCases: ["empty name"],
    },
  ],
  typeMap: [
    { py: "int", json: "integer", js: "number" },
    { py: "str", json: "string", js: "string" },
    { py: "bool", json: "boolean", js: "boolean" },
  ],
};

describe("buildDeterministicHeart (R16.2, R16.6)", () => {
  const heart = buildDeterministicHeart(PLAN);

  it("emits the pinned JSON-lines protocol serialization + handle entry", () => {
    expect(heart).toContain("def handle(request):");
    expect(heart).toContain('json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))');
    expect(heart).toContain("sys.stdout.flush()");
    // User stdout redirected to stderr during a call (C.2a stdout isolation).
    expect(heart).toContain("contextlib.redirect_stdout(sys.stderr)");
    // The pinned failure object shape.
    expect(heart).toContain('"ok": False');
    expect(heart).toContain('"error": {"type": err_type, "message": message}');
    // EOF exits 0.
    expect(heart).toContain("sys.exit(main())");
  });

  it("reaches every planned function by name (import + dispatch key)", () => {
    expect(heart).toContain("from resurrected import add, greet");
    expect(heart).toContain('"add": add,');
    expect(heart).toContain('"greet": greet,');
  });

  it("is deterministic (identical plan => identical bytes)", () => {
    expect(buildDeterministicHeart(PLAN)).toBe(heart);
  });

  it("is deny-list-clean (no eval/exec/os.system/network/fs-write)", () => {
    expect(heart).not.toMatch(/\beval\s*\(/);
    expect(heart).not.toMatch(/\bexec\s*\(/);
    expect(heart).not.toContain("os.system");
    expect(heart).not.toContain("subprocess");
    expect(heart).not.toContain("socket");
    expect(heart).not.toContain("urllib");
    expect(heart).not.toMatch(/open\s*\([^)]*["'][wa]/);
  });
});

describe("buildTemplatePair (R16.3, R16.4, R17.4, R37.2, R38.1)", () => {
  const pair = buildTemplatePair(PLAN);

  it("assembles a full LoversPair that satisfies the coven schema", () => {
    const parsed = LoversPairSchema.parse(pair);
    expect(parsed.pythonHeart.length).toBeGreaterThan(0);
    expect(parsed.jsBeloved.length).toBeGreaterThan(0);
  });

  it("the four LLM-shaped artifacts satisfy LoversPairLlmSchema", () => {
    const { pythonHeart: _omit, ...llm } = pair;
    expect(LoversPairLlmSchema.safeParse(llm).success).toBe(true);
  });

  it("the heart is identical to the always-path heart", () => {
    expect(pair.pythonHeart).toBe(buildDeterministicHeart(PLAN));
  });

  it("jsBeloved is a client: single python spawn, close(), one wrapper per fn", () => {
    expect(pair.jsBeloved).toContain('import { spawn } from "node:child_process";');
    expect(pair.jsBeloved).toContain('process.env.PYTHON ?? "python3"');
    expect(pair.jsBeloved).toContain(`join(__dirname, ${JSON.stringify(HEART_FILENAME)})`);
    expect(pair.jsBeloved).toContain("export function close()");
    expect(pair.jsBeloved).toContain("export async function add(a, b)");
    expect(pair.jsBeloved).toContain("export async function greet(name, loud)");
    // Exactly one spawn.
    expect(pair.jsBeloved.split("spawn(PYTHON").length - 1).toBe(1);
  });

  it("jsBeloved is deny-list-clean (no eval/Function/network/fs-write)", () => {
    expect(pair.jsBeloved).not.toMatch(/\beval\s*\(/);
    expect(pair.jsBeloved).not.toMatch(/new\s+Function\s*\(/);
    expect(pair.jsBeloved).not.toMatch(/\bfetch\s*\(/);
    expect(pair.jsBeloved).not.toMatch(/node:(net|http|https|dgram|dns|tls)/);
    expect(pair.jsBeloved).not.toMatch(/writeFile|unlink|\brm\b|rmdir|appendFile/);
  });
});

describe("buildContractSchema (R16.4, R17.2 shape)", () => {
  it("serializes a draft 2020-12 doc with exactly <fn>.request/.response defs", () => {
    const serialized = buildContractSchema(PLAN);
    const doc = JSON.parse(serialized) as {
      $schema: string;
      $defs: Record<string, unknown>;
    };
    expect(doc.$schema).toBe(CONTRACT_DIALECT);
    expect(Object.keys(doc.$defs).sort()).toEqual([
      "add.request",
      "add.response",
      "greet.request",
      "greet.response",
    ]);
  });

  it("is deterministic (stable key order)", () => {
    expect(buildContractSchema(PLAN)).toBe(buildContractSchema(PLAN));
  });
});

describe("astBridge convenience entry (task 8.6 call shape)", () => {
  it("returns only the heart by default (LLM path)", () => {
    const out = astBridge(PLAN);
    expect(out.pythonHeart).toBe(buildDeterministicHeart(PLAN));
    expect(out.pair).toBeUndefined();
  });

  it("returns the full pair with fullPair (fallback path)", () => {
    const out = astBridge(PLAN, { fullPair: true });
    expect(out.pair).toBeDefined();
    expect(LoversPairSchema.safeParse(out.pair).success).toBe(true);
    expect(out.pair?.pythonHeart).toBe(out.pythonHeart);
  });
});

describe("single-function plan still emits a valid pair", () => {
  it("emits a schema-valid pair for a 1-function plan", () => {
    const one: LoversPlan = {
      functions: [PLAN.functions[0]!],
      typeMap: [{ py: "int", json: "integer", js: "number" }],
    };
    const pair = buildTemplatePair(one);
    expect(LoversPairSchema.safeParse(pair).success).toBe(true);
    const defs = JSON.parse(buildContractSchema(one)) as { $defs: Record<string, unknown> };
    expect(Object.keys(defs.$defs).sort()).toEqual(["add.request", "add.response"]);
  });
});
