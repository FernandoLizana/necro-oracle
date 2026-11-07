// @necro/coven — extractPlan unit tests (task 8.2).
//
// Example-based coverage of the deterministic PLAN extractor over small
// RESURRECTED Python 3 snippets: function names, params (defaults/required),
// return types, the MAX_BINDABLE cap, the MAX_SOURCE_BYTES precondition, and
// the bindability heuristics (non-JSON types + *args/**kwargs flip bindable
// off with a skip reason), and the JavaScript-identifier guarantee (a function
// or parameter named a JS reserved word / non-identifier is NON-bindable so the
// bridge never emits invalid JavaScript). No network / LLM / sandbox — the real
// oracle parser is armed once up front via `initParser`.
//
// Validates: Requirements 15.1, 15.2, 15.5, 16.1

import { initParser } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_BINDABLE } from "./types.js";
import { extractPlan, MAX_SOURCE_BYTES } from "./extract-plan.js";

beforeAll(async () => {
  await initParser();
});

describe("extractPlan (R15.1, R15.2, R15.5, R16.1)", () => {
  it("extracts top-level function names, params, defaults, and return types", () => {
    const src = [
      "def add(a, b):",
      "    return a + b",
      "",
      "def greet(name: str, excited: bool = False) -> str:",
      "    return name",
      "",
      "async def total(xs: list) -> int:",
      "    return len(xs)",
      "",
    ].join("\n");

    const result = extractPlan(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.plan.functions.map((f) => f.name);
    expect(names).toEqual(["add", "greet", "total"]);

    const greet = result.plan.functions.find((f) => f.name === "greet");
    expect(greet?.params.map((p) => p.name)).toEqual(["name", "excited"]);
    expect(greet?.params.map((p) => p.required)).toEqual([true, false]);
    expect(greet?.params[0]?.jsonType).toBe("string");
    expect(greet?.params[1]?.jsonType).toBe("boolean");
    expect(greet?.returns.jsonType).toBe("string");

    const total = result.plan.functions.find((f) => f.name === "total");
    expect(total?.returns.jsonType).toBe("integer");
    expect(total?.params[0]?.jsonType).toBe("array");
  });

  it("marks *args/**kwargs functions non-bindable (and excludes them from the plan)", () => {
    const src = [
      "def ok(a, b):",
      "    return a",
      "",
      "def variadic(*args, **kwargs):",
      "    return args",
      "",
    ].join("\n");

    const result = extractPlan(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the bindable function survives into the plan.
    expect(result.plan.functions.map((f) => f.name)).toEqual(["ok"]);
    expect(result.plan.functions.every((f) => f.bindable)).toBe(true);
  });

  it("rejects when no bindable function exists", () => {
    const src = [
      "def to_bytes(x: str) -> bytes:",
      "    return x.encode()",
      "",
      "def variadic(*args):",
      "    return args",
      "",
    ].join("\n");

    const result = extractPlan(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("caps the plan at MAX_BINDABLE bindable functions, in source order", () => {
    const parts: string[] = [];
    for (let i = 0; i < MAX_BINDABLE + 3; i++) {
      parts.push(`def f${i}(a):\n    return a\n`);
    }
    const result = extractPlan(parts.join("\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.functions).toHaveLength(MAX_BINDABLE);
    expect(result.plan.functions[0]?.name).toBe("f0");
    expect(result.plan.functions[MAX_BINDABLE - 1]?.name).toBe(`f${MAX_BINDABLE - 1}`);
  });

  it("rejects source larger than MAX_SOURCE_BYTES with an oracle-voice reason and no model call", () => {
    const filler = "    # padding comment line that adds bytes to the source\n";
    const big = `def f(a):\n    return a\n${filler.repeat(700)}`;
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(MAX_SOURCE_BYTES);

    const result = extractPlan(big);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(MAX_SOURCE_BYTES));
  });

  it("derives a de-duplicated typeMap from params and returns", () => {
    const src = "def f(a: int, b: int) -> str:\n    return str(a + b)\n";
    const result = extractPlan(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.plan.typeMap.map((r) => `${r.py}|${r.json}|${r.js}`);
    // int (two params collapse to one row) + str return.
    expect(keys).toContain("int|integer|number");
    expect(keys).toContain("str|string|string");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("extractPlan JavaScript-identifier guarantee (R16.1): emittable-JS names only", () => {
  it("marks a function whose NAME is a JS reserved word non-bindable (excluded, with a skipReason)", () => {
    // `delete` is a legal Python function name but a JS keyword; the bridge
    // would emit `export async function delete(...)` — invalid JavaScript.
    const src = [
      "def delete(a: int) -> int:",
      "    return a",
      "",
      "def keep(a: int) -> int:",
      "    return a",
      "",
    ].join("\n");

    const result = extractPlan(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the all-valid function survives into the plan; `delete` is dropped.
    expect(result.plan.functions.map((f) => f.name)).toEqual(["keep"]);
  });

  it("marks a function with a reserved-word PARAMETER name non-bindable", () => {
    // `delete` and `new` are legal Python parameter names (they are NOT Python
    // keywords) but ARE JavaScript keywords; the bridge would emit
    // `(delete, new)` — invalid JavaScript — so the whole function is refused.
    const src = [
      "def route(delete: str, new: str) -> str:",
      "    return new",
      "",
      "def plain(x: str) -> str:",
      "    return x",
      "",
    ].join("\n");

    const result = extractPlan(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.functions.map((f) => f.name)).toEqual(["plain"]);
  });

  it("reports an oracle-voice reason when EVERY function is non-emittable", () => {
    // A reserved-word function name (`delete`) and a reserved-word param (`new`)
    // leave nothing bindable, so extraction rejects with a plain-English reason.
    const reserved = [
      "def delete(a: int) -> int:",
      "    return a",
      "",
      "def f(new: int) -> int:",
      "    return new",
      "",
    ].join("\n");

    const result = extractPlan(reserved);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("keeps an all-valid-identifier function bindable (no skipReason)", () => {
    const clean = "def add_numbers(first: int, second: int) -> int:\n    return first + second\n";
    const result = extractPlan(clean);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.functions.map((f) => f.name)).toEqual(["add_numbers"]);
    expect(result.plan.functions[0]?.bindable).toBe(true);
    expect(result.plan.functions[0]?.skipReason).toBeUndefined();
  });
});
