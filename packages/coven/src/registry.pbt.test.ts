// @necro/coven — property tests for the Language_Pair_Registry (task 7.2).
//
// Property 14: Language_Pair_Registry resolution is a unique, guarded binding.
//   - resolve(id) of a registered id returns that exact grimoire;
//   - resolve(unknown) throws the typed PAIR_UNKNOWN NecroError;
//   - register(duplicate) throws the typed PAIR_DUPLICATE NecroError and leaves
//     the FIRST binding intact.
//
// No network/LLM/sandbox: the registry is a pure, in-memory binding and the
// grimoires here are inert stubs. fast-check runs 1000 times over randomly
// generated SETS of distinct language-pair ids; the seed is printed on failure.
import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Grimoire, type LanguagePairId } from "./index.js";
import { LanguagePairRegistry } from "./registry.js";

// A minimal inert Grimoire stub. The registry never inspects a grimoire's
// internals — it only stores and returns the reference — so a tagged shell with
// a unique identity is enough to assert "resolve returns the SAME object".
function stubGrimoire(id: string): Grimoire {
  return {
    id,
    pair: "stub->stub" as LanguagePairId,
    inputSchema: undefined as unknown as Grimoire["inputSchema"],
    outputSchema: undefined as unknown as Grimoire["outputSchema"],
    fixers: [],
    llm: undefined as unknown as Grimoire["llm"],
    validate: () => ({ valid: true, errorNodeCount: 0 }),
    divergenceAllowlist: [],
  };
}

/** A well-formed `${string}->${string}` pair id built from two non-empty halves. */
const arbPairId: fc.Arbitrary<LanguagePairId> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes("->")),
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes("->")),
  )
  .map(([from, to]) => `${from}->${to}` as LanguagePairId);

/** A non-empty SET of distinct pair ids (dedup via a Set on the string value). */
const arbPairIdSet: fc.Arbitrary<readonly LanguagePairId[]> = fc
  .uniqueArray(arbPairId, { minLength: 1, maxLength: 12 })
  .map((ids) => ids as readonly LanguagePairId[]);

/** Assert a thrown value is a NecroError carrying the expected machine code. */
function expectNecroCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(NecroError);
  expect((thrown as NecroError).code).toBe(code);
}

describe("P14 (R15.1, R15.2, R15.3): registry resolution is a unique, guarded binding", () => {
  it("resolves each registered id to its exact grimoire (R15.1)", () => {
    fc.assert(
      fc.property(arbPairIdSet, (ids) => {
        const registry = new LanguagePairRegistry();
        const bound = new Map<LanguagePairId, Grimoire>();
        for (const id of ids) {
          const grimoire = stubGrimoire(id);
          bound.set(id, grimoire);
          registry.register(id, grimoire);
        }
        for (const id of ids) {
          expect(registry.has(id)).toBe(true);
          // Same object identity, not merely a structural match.
          expect(registry.resolve(id)).toBe(bound.get(id));
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("throws PAIR_UNKNOWN for any id never registered (R15.2)", () => {
    fc.assert(
      fc.property(arbPairIdSet, arbPairId, (ids, candidate) => {
        // Only exercise the unknown path when `candidate` is genuinely absent.
        fc.pre(!ids.includes(candidate));
        const registry = new LanguagePairRegistry();
        for (const id of ids) registry.register(id, stubGrimoire(id));

        expect(registry.has(candidate)).toBe(false);
        expectNecroCode(() => registry.resolve(candidate), "PAIR_UNKNOWN");
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects re-registration with PAIR_DUPLICATE, leaving the first binding intact (R15.3)", () => {
    fc.assert(
      fc.property(arbPairIdSet, (ids) => {
        const registry = new LanguagePairRegistry();
        const first = new Map<LanguagePairId, Grimoire>();
        for (const id of ids) {
          const grimoire = stubGrimoire(id);
          first.set(id, grimoire);
          registry.register(id, grimoire);
        }

        // Re-registering every id with a DIFFERENT grimoire must throw and must
        // not overwrite the original binding.
        for (const id of ids) {
          const intruder = stubGrimoire(`${id}#intruder`);
          expect(intruder).not.toBe(first.get(id));
          expectNecroCode(() => registry.register(id, intruder), "PAIR_DUPLICATE");
          // The FIRST binding survives the rejected second registration.
          expect(registry.resolve(id)).toBe(first.get(id));
        }
      }),
      { numRuns: 1000 },
    );
  });
});
