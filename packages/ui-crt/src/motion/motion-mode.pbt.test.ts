// src/motion/motion-mode.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 10
//
// Property-based tests for Motion_Mode resolution (task 11.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `motion/motion-mode.ts`
// (task 11.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module does not exist yet.
//
// Property 10 (requirements.md §"P10 — Motion_Mode resolution (R10.6, R10.7)"):
// For all Motion_Preference values and media query results, Motion_Mode is
// `reduced` exactly when the preference is `off`, or the preference is `auto`
// and the media query matches (prefers-reduced-motion). Otherwise it is `full`.
//
// Semantics under test (design.md §"Motion and preferences"):
//   resolveMotionMode(pref, prefersReduced):
//     - "auto" -> "reduced" iff prefersReduced, else "full"
//     - "on"   -> "full"
//     - "off"  -> "reduced"
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R10.6, R10.7**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 11.2 adds this module.
import {
  resolveMotionMode,
  type MotionMode,
  type MotionPreference,
} from "./motion-mode.js";

/** P10 runs the default property budget. */
const NUM_RUNS = 200;

const PREFERENCES: readonly MotionPreference[] = ["auto", "on", "off"];

/** The specification's truth table over pref × prefersReduced. */
function expectedMode(
  pref: MotionPreference,
  prefersReduced: boolean,
): MotionMode {
  if (pref === "off") return "reduced";
  if (pref === "on") return "full";
  return prefersReduced ? "reduced" : "full"; // "auto"
}

describe("P10 (R10.6, R10.7): motion mode resolution", () => {
  it("matches the specification truth table for every preference and media result", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MotionPreference>(...PREFERENCES),
        fc.boolean(),
        (pref, prefersReduced) => {
          expect(resolveMotionMode(pref, prefersReduced)).toBe(
            expectedMode(pref, prefersReduced),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is reduced exactly when preference is off or (auto and media matches)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MotionPreference>(...PREFERENCES),
        fc.boolean(),
        (pref, prefersReduced) => {
          const isReduced = resolveMotionMode(pref, prefersReduced) === "reduced";
          const shouldBeReduced =
            pref === "off" || (pref === "auto" && prefersReduced);
          expect(isReduced).toBe(shouldBeReduced);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("ignores the media query when the preference is on or off", () => {
    for (const pref of ["on", "off"] as const) {
      expect(resolveMotionMode(pref, true)).toBe(
        resolveMotionMode(pref, false),
      );
    }
    expect(resolveMotionMode("on", true)).toBe("full");
    expect(resolveMotionMode("off", false)).toBe("reduced");
  });

  it("depends on the media query only when the preference is auto", () => {
    expect(resolveMotionMode("auto", true)).toBe("reduced");
    expect(resolveMotionMode("auto", false)).toBe("full");
  });
});
