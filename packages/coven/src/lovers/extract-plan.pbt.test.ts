// @necro/coven — extractPlan grounding + caps property tests (task 8.14).
//
// Property 31 (R37.1, R37.2, R37.3): the Lovers binding is GROUNDED in the
// deterministic `extractPlan` read of the RESURRECTED Python 3 source, and its
// caps hold. "The cards cannot lie": the FAST model never decides which
// functions bind — `extractPlan` does, as a pure read of the real source.
//
// GROUNDING. Over generated Python 3 modules mixing bindable and NON-bindable
// functions (variadic `*args`/`**kwargs`, bytes/set/tuple return/params, and
// reserved-word / non-identifier names), every function the plan emits is:
//   - a REAL top-level `def` in the source (never invented),
//   - BINDABLE (never a variadic / non-JSON-serialisable / reserved-word one),
//   - carried in SOURCE ORDER.
//
// CAPS. `MAX_SOURCE_BYTES` rejects oversized source with an oracle-voice reason
// and no model call (the pure extractor returns `{ ok:false, reason }`);
// `MAX_BINDABLE` caps the plan at the first 8 bindable functions in source
// order; a source with zero bindable functions returns `{ ok:false }` with an
// oracle-voice reason.
//
// Grounded against the REAL exported `extractPlan`, `MAX_SOURCE_BYTES`, and
// `MAX_BINDABLE`. No network / LLM / sandbox — the real oracle parser is armed
// once up front via `initParser` (the pure extractor itself makes NO model
// call; being pure, it cannot).
//
// Validates: Requirements 37.1, 37.2, 37.3

import { initParser } from "@necro/oracle";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_BINDABLE } from "./types.js";
import { extractPlan, MAX_SOURCE_BYTES } from "./extract-plan.js";

beforeAll(async () => {
  await initParser();
});

// ---------------------------------------------------------------------------
// Generators: Python 3 function specs with a KNOWN bindability + name, so the
// test can assert the plan is a subset of the real defs, bindable-only, and
// order-preserving — WITHOUT re-implementing extractPlan's heuristics.
// ---------------------------------------------------------------------------

interface FnSpec {
  /** The expected deterministic bindability of this function. */
  readonly bindable: boolean;
  /**
   * Whether this spec's disqualifier IS its function name (a reserved word).
   * Such a spec cannot be renamed without losing the disqualifier, so the
   * module builder must keep its reserved name and drop later duplicates; all
   * OTHER specs are given a fresh unique name so no two top-level `def`s in the
   * generated module ever collide (Python would otherwise shadow the earlier
   * one, breaking the name-keyed grounding assertions).
   */
  readonly fixedName: string | null;
  /** Render the Python 3 `def` block for the assigned `name`. */
  readonly render: (name: string) => string;
}

/** A rendered function with its finally-assigned, module-unique name. */
interface RenderedFn {
  readonly name: string;
  readonly bindable: boolean;
  readonly source: string;
}

// Plain lowercase identifiers that are NOT JavaScript reserved words, so a
// bindable function/param name stays emittable JavaScript.
const arbSafeName = fc
  .tuple(
    fc.constantFrom("a", "b", "c", "m", "n", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"),
    fc.array(
      fc.constantFrom("a", "b", "c", "o", "n", "u", "m", "0", "1", "2", "_"),
      { minLength: 0, maxLength: 6 },
    ),
  )
  .map(([head, rest]) => head + rest.join(""));

// JavaScript reserved words that are LEGAL Python identifiers — a function or
// parameter named one of these flips bindability off (invalid emitted JS).
// Deliberately EXCLUDES words that are ALSO Python keywords (`class`, `yield`,
// `await`, …): those are not valid Python identifiers, so they could never
// appear as a real `def`/param name in resurrected Python 3 source.
const JS_RESERVED = [
  "delete",
  "new",
  "typeof",
  "instanceof",
  "void",
  "switch",
  "export",
  "extends",
  "super",
  "debugger",
] as const;

// JSON-serialisable Python param/return types (keep the function bindable).
const SERIALISABLE_TYPES = ["int", "str", "bool", "float", "list", "dict"] as const;
// Explicitly NON-serialisable Python types (flip bindability off).
const NON_SERIALISABLE_TYPES = ["bytes", "set", "frozenset", "tuple", "bytearray", "memoryview"] as const;

/** A BINDABLE function: safe param names, all-serialisable types. */
const arbBindableFn = fc
  .record({
    params: fc.array(
      fc.record({ pname: arbSafeName, ptype: fc.constantFrom(...SERIALISABLE_TYPES) }),
      { minLength: 0, maxLength: 3 },
    ),
    ret: fc.constantFrom(...SERIALISABLE_TYPES),
    isAsync: fc.boolean(),
  })
  .map(({ params, ret, isAsync }): FnSpec => {
    const paramList = params.map((p) => `${p.pname}: ${p.ptype}`).join(", ");
    const prefix = isAsync ? "async def" : "def";
    return {
      bindable: true,
      fixedName: null,
      render: (name) => `${prefix} ${name}(${paramList}) -> ${ret}:\n    return None\n\n`,
    };
  });

/** A NON-bindable function via one of several distinct disqualifiers. */
const arbNonBindableFn = fc.oneof(
  // (1) variadic *args / **kwargs
  fc.constantFrom("*args", "**kwargs", "*args, **kwargs").map(
    (kind): FnSpec => ({
      bindable: false,
      fixedName: null,
      render: (name) => `def ${name}(${kind}):\n    return None\n\n`,
    }),
  ),
  // (2) non-JSON-serialisable RETURN type
  fc.constantFrom(...NON_SERIALISABLE_TYPES).map(
    (ret): FnSpec => ({
      bindable: false,
      fixedName: null,
      render: (name) => `def ${name}(a: int) -> ${ret}:\n    return None\n\n`,
    }),
  ),
  // (3) non-JSON-serialisable PARAM type
  fc.constantFrom(...NON_SERIALISABLE_TYPES).map(
    (ptype): FnSpec => ({
      bindable: false,
      fixedName: null,
      render: (name) => `def ${name}(a: ${ptype}) -> int:\n    return None\n\n`,
    }),
  ),
  // (4) reserved-word FUNCTION name — the disqualifier IS the name, so it is
  // fixed (and the module builder keeps it, dropping later duplicates).
  fc.constantFrom(...JS_RESERVED).map(
    (reserved): FnSpec => ({
      bindable: false,
      fixedName: reserved,
      render: (name) => `def ${name}(a: int) -> int:\n    return a\n\n`,
    }),
  ),
  // (5) reserved-word PARAMETER name
  fc.constantFrom(...JS_RESERVED).map(
    (reserved): FnSpec => ({
      bindable: false,
      fixedName: null,
      render: (name) => `def ${name}(${reserved}: int) -> int:\n    return ${reserved}\n\n`,
    }),
  ),
);

/** A module = ordered list of function specs, each bindable or not. */
const arbModule = fc.array(fc.oneof(arbBindableFn, arbNonBindableFn), {
  minLength: 1,
  maxLength: 14,
});

/**
 * Assign module-unique names and render. Specs whose disqualifier is NOT their
 * name get a fresh `gen_<i>` identifier; a reserved-word-named spec keeps its
 * reserved name but a later duplicate reserved name is DROPPED (Python would
 * shadow it, which would corrupt the name-keyed grounding assertions). The
 * result preserves source order and never contains two defs of the same name.
 */
function renderModule(fns: readonly FnSpec[]): RenderedFn[] {
  const used = new Set<string>();
  const out: RenderedFn[] = [];
  let counter = 0;
  for (const spec of fns) {
    let name: string;
    if (spec.fixedName !== null) {
      if (used.has(spec.fixedName)) continue; // drop the shadowing duplicate
      name = spec.fixedName;
    } else {
      name = `gen_${counter}`;
    }
    counter += 1;
    used.add(name);
    out.push({ name, bindable: spec.bindable, source: spec.render(name) });
  }
  return out;
}

function sourceOf(fns: readonly RenderedFn[]): string {
  return fns.map((f) => f.source).join("");
}

describe("Property 31 (R37.1, R37.2, R37.3): extractPlan grounding + caps", () => {
  it("the plan is always a GROUNDED subset: real defs only, bindable-only, order-preserving, capped", () => {
    fc.assert(
      fc.property(arbModule, (specs) => {
        const fns = renderModule(specs);
        fc.pre(fns.length > 0);
        const source = sourceOf(fns);
        // Guard: these generated modules stay well under the byte cap, so the
        // grounding assertions are about content, not the size precondition.
        fc.pre(Buffer.byteLength(source, "utf8") <= MAX_SOURCE_BYTES);

        const result = extractPlan(source);

        // Deterministic expectation derived from the generator's own labels:
        // the bindable functions, in source order, capped at MAX_BINDABLE.
        const expectedNames = fns.filter((f) => f.bindable).map((f) => f.name).slice(0, MAX_BINDABLE);

        if (expectedNames.length === 0) {
          // No bindable function => rejected with an oracle-voice reason, no
          // model call (the pure extractor makes none).
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.reason.length).toBeGreaterThan(0);
          return;
        }

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const planNames = result.plan.functions.map((f) => f.name);
        const realDefNames = fns.map((f) => f.name);
        const bindableRealDefNames = new Set(fns.filter((f) => f.bindable).map((f) => f.name));
        const nonBindableRealDefNames = new Set(fns.filter((f) => !f.bindable).map((f) => f.name));

        // GROUNDING: never invents a function — every planned name is a real
        // top-level def in the source.
        for (const name of planNames) expect(realDefNames).toContain(name);

        // BINDABLE-ONLY: never binds a variadic / non-serialisable /
        // reserved-word function (the FAST model never decides this).
        for (const name of planNames) {
          expect(bindableRealDefNames.has(name)).toBe(true);
          expect(nonBindableRealDefNames.has(name)).toBe(false);
        }
        // The schema's own `bindable` flag agrees.
        expect(result.plan.functions.every((f) => f.bindable)).toBe(true);

        // ORDER-PRESERVING + CAP: exactly the first MAX_BINDABLE bindable
        // functions, in source order.
        expect(planNames).toEqual(expectedNames);
        expect(result.plan.functions.length).toBeLessThanOrEqual(MAX_BINDABLE);
      }),
      { numRuns: 1000 },
    );
  });

  it("MAX_BINDABLE caps a source with >8 bindable functions at exactly 8, in order", () => {
    fc.assert(
      fc.property(
        fc.array(arbBindableFn, { minLength: MAX_BINDABLE + 1, maxLength: MAX_BINDABLE + 10 }),
        (bindables) => {
          // renderModule assigns module-unique `gen_<i>` names in source order.
          const fns = renderModule(bindables);
          const source = sourceOf(fns);
          fc.pre(Buffer.byteLength(source, "utf8") <= MAX_SOURCE_BYTES);

          const result = extractPlan(source);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.plan.functions).toHaveLength(MAX_BINDABLE);
          expect(result.plan.functions.map((f) => f.name)).toEqual(
            fns.slice(0, MAX_BINDABLE).map((f) => f.name),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("MAX_SOURCE_BYTES rejects oversized source with an oracle-voice reason and NO model call", () => {
    fc.assert(
      fc.property(
        // A valid bindable function plus enough padding to exceed the byte cap.
        fc.integer({ min: MAX_SOURCE_BYTES + 1, max: MAX_SOURCE_BYTES + 20_000 }),
        (targetBytes) => {
          const head = "def f(a: int) -> int:\n    return a\n";
          const comment = "# padding comment line to grow the source past the byte cap\n";
          const padCount = Math.ceil((targetBytes - Buffer.byteLength(head, "utf8")) / Buffer.byteLength(comment, "utf8"));
          const source = head + comment.repeat(Math.max(padCount, 1));
          fc.pre(Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES);

          const result = extractPlan(source);
          // Rejected at the precondition: a pure `{ ok:false, reason }`, which
          // is exactly the "no model call" signal the runner/route acts on.
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.reason.length).toBeGreaterThan(0);
          // The oracle-voice reason names the byte cap.
          expect(result.reason).toContain(String(MAX_SOURCE_BYTES));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a source with ZERO bindable functions returns { ok:false } with an oracle-voice reason", () => {
    fc.assert(
      fc.property(fc.array(arbNonBindableFn, { minLength: 1, maxLength: 10 }), (nonBindables) => {
        const fns = renderModule(nonBindables);
        fc.pre(fns.length > 0);
        const source = sourceOf(fns);
        fc.pre(Buffer.byteLength(source, "utf8") <= MAX_SOURCE_BYTES);

        const result = extractPlan(source);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});
