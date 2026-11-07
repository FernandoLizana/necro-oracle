// packages/ui-crt/src/landing/key-binding.pbt.test.ts
//
// Feature: oracle-landing-polish, Property 4: key bindings never steal
// modified or unmapped keys.
//
// P4 (R7.2, R7.3, R7.4, R7.5, R7.6, R7.7): `landingKeyAction` is a pure, total
// classifier over a minimal key descriptor. It must:
//   - return `none` for ANY key carrying Alt/Ctrl/Meta, so browser shortcuts
//     and the NECRO> input's own editing keys are never hijacked (R7.2);
//   - return `none` for any key outside the binding set (R7.7);
//   - map the bound keys, case-insensitively for letters, to the right action:
//     ArrowUp -> move up, ArrowDown -> move down (R7.3), Enter/a/A -> activate
//     (R7.4), b/B/d/D -> demo (R7.5), h/H -> help (R7.6);
//   - never throw for any descriptor (totality).
//
// No network / LLM / sandbox: the handler is a pure function of its input.
//
// _Requirements: R7.2, R7.3, R7.4, R7.5, R7.6, R7.7_

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { landingKeyAction, type KeyDescriptor, type LandingAction } from "./key-binding.js";

// --- arbitraries ------------------------------------------------------------

/** The full set of mapped keys, as the handler sees them after lowercasing. */
const MAPPED_KEYS = [
  "arrowup",
  "arrowdown",
  "enter",
  "a",
  "b",
  "d",
  "h",
] as const;

/** Keys the handler recognises (bound), in the real casings a browser emits. */
const arbMappedKey: fc.Arbitrary<string> = fc.constantFrom(
  "ArrowUp",
  "ArrowDown",
  "Enter",
  "a",
  "A",
  "b",
  "B",
  "d",
  "D",
  "h",
  "H",
);

/** An arbitrary key string that is NOT one of the bound keys (case-folded). */
const arbUnmappedKey: fc.Arbitrary<string> = fc
  .string()
  .filter((k) => !MAPPED_KEYS.includes(k.toLowerCase() as (typeof MAPPED_KEYS)[number]));

/** At least one of Alt/Ctrl/Meta is set. */
const arbModifiers: fc.Arbitrary<Pick<KeyDescriptor, "altKey" | "ctrlKey" | "metaKey">> = fc
  .record({ altKey: fc.boolean(), ctrlKey: fc.boolean(), metaKey: fc.boolean() })
  .filter((m) => m.altKey || m.ctrlKey || m.metaKey);

const NO_MODS = { altKey: false, ctrlKey: false, metaKey: false } as const;

/** A fully arbitrary descriptor (any key, any modifier combination). */
const arbDescriptor: fc.Arbitrary<KeyDescriptor> = fc.record({
  key: fc.string(),
  altKey: fc.boolean(),
  ctrlKey: fc.boolean(),
  metaKey: fc.boolean(),
});

/** The action a mapped key (no modifiers) is expected to produce. */
function expectedUnmodifiedAction(key: string): LandingAction {
  switch (key.toLowerCase()) {
    case "arrowup":
      return { kind: "move", dir: "up" };
    case "arrowdown":
      return { kind: "move", dir: "down" };
    case "enter":
    case "a":
      return { kind: "activate" };
    case "b":
    case "d":
      return { kind: "demo" };
    case "h":
      return { kind: "help" };
    default:
      return { kind: "none" };
  }
}

describe("P4 (R7.2, R7.3, R7.4, R7.5, R7.6, R7.7): landingKeyAction never steals modified or unmapped keys", () => {
  it("R7.2: any key carrying Alt/Ctrl/Meta yields none, for arbitrary key strings", () => {
    fc.assert(
      fc.property(fc.string(), arbModifiers, (key, mods) => {
        expect(landingKeyAction({ key, ...mods })).toEqual({ kind: "none" });
      }),
      { numRuns: 1000 },
    );
  });

  it("R7.2: even a mapped key yields none once a modifier is present", () => {
    fc.assert(
      fc.property(arbMappedKey, arbModifiers, (key, mods) => {
        expect(landingKeyAction({ key, ...mods })).toEqual({ kind: "none" });
      }),
      { numRuns: 1000 },
    );
  });

  it("R7.7: an unmapped key with no modifiers yields none", () => {
    fc.assert(
      fc.property(arbUnmappedKey, (key) => {
        expect(landingKeyAction({ key, ...NO_MODS })).toEqual({ kind: "none" });
      }),
      { numRuns: 1000 },
    );
  });

  it("R7.3/R7.4/R7.5/R7.6: mapped keys (no modifiers) return the right action, case-insensitively", () => {
    fc.assert(
      fc.property(arbMappedKey, (key) => {
        expect(landingKeyAction({ key, ...NO_MODS })).toEqual(expectedUnmodifiedAction(key));
      }),
      { numRuns: 1000 },
    );
  });

  it("totality: landingKeyAction never throws for any descriptor", () => {
    fc.assert(
      fc.property(arbDescriptor, (ev) => {
        expect(() => landingKeyAction(ev)).not.toThrow();
        // the result is always exactly one of the known kinds
        const action = landingKeyAction(ev);
        expect(["move", "activate", "demo", "help", "none"]).toContain(action.kind);
      }),
      { numRuns: 1000 },
    );
  });
});
