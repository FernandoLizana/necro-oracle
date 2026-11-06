// Unit tests for the Demo_Mode `[DEMO]` line prefix (task 16.2; R14.3).
//
// These cover the browser-safe labelling primitives: `DEMO_PREFIX`,
// `prefixDemoLine`, and the `demoEmit` PhaseEmit wrapper. The labelling/
// determinism PROPERTIES (Properties 15/16) are task 16.3; here we assert the
// example-level behaviour: the marker is applied once, phase tokens pass
// through untouched, and the runner's skip-notes come out `[DEMO]`-prefixed.

import { describe, expect, it } from "vitest";

import type { PhaseEmit, ResurrectionPhase } from "../runners/local.js";
import { DEMO_PREFIX, demoEmit, prefixDemoLine } from "./prefix.js";

describe("Demo_Mode [DEMO] prefix (R14.3)", () => {
  it("prefixes a serialized line with the fixed marker exactly once", () => {
    expect(prefixDemoLine("SELECT")).toBe(`${DEMO_PREFIX}SELECT`);
    expect(prefixDemoLine("The oracle works bare-handed.")).toBe(
      "[DEMO] The oracle works bare-handed.",
    );
  });

  it("uses the canonical marker token", () => {
    expect(DEMO_PREFIX).toBe("[DEMO] ");
  });

  it("demoEmit prefixes skip-notes but passes phase tokens through verbatim", async () => {
    const phases: ResurrectionPhase[] = [];
    const notes: string[] = [];
    const base: PhaseEmit = {
      phase: (p) => {
        phases.push(p);
      },
      skipNote: (n) => {
        notes.push(n);
      },
    };

    const wrapped = demoEmit(base);
    await wrapped.phase("SELECT");
    await wrapped.phase("PRE_PASS");
    await wrapped.skipNote("No model is bound.");

    // Phase tokens are a fixed enum the route renders to a line; demoEmit must
    // not mangle them (the route prefixes the rendered line itself).
    expect(phases).toEqual(["SELECT", "PRE_PASS"]);
    // The free-text skip-note is labelled once.
    expect(notes).toEqual(["[DEMO] No model is bound."]);
  });

  it("propagates the underlying emit's async return so the runner can await it", async () => {
    let resolved = false;
    const base: PhaseEmit = {
      phase: () => Promise.resolve(),
      skipNote: () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            resolved = true;
            r();
          }, 0),
        ),
    };
    await demoEmit(base).skipNote("note");
    expect(resolved).toBe(true);
  });
});
