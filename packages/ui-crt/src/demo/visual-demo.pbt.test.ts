// src/demo/visual-demo.pbt.test.ts
//
// Feature: visual-necromancy, task 13.2 — Property 12.
//
// Property-based test for Demo reproducibility given the Demo_Seed. In Demo mode
// the Visual_Layer drives every Glitch_Effect corruption and Rot_Transform from
// the single fixed `DEMO_SEED` rather than the wall clock or unseeded
// randomness (task 13.1). Property 12 (design §Property 12, R9.2) pins the
// user-visible consequence: rendering a Demo reading twice with the same
// Demo_Seed yields the same sequence of Glitch_Effect parameters and the same
// Rot_Transform outputs.
//
// Here we exercise the two pure derivations the Visual_Layer composes in Demo
// mode:
//   - the glitch-parameter sequence `glitchProfile(severity)` over a reading's
//     per-card severities, and
//   - the rot-output sequence `rot(source, decay, DEMO_SEED)` over a
//     `decaySequence(frameCount)` for the Resurrection_Animation.
// Deriving each twice with `DEMO_SEED` must produce identical results. We also
// confirm a demo-session state resolves `resolveSeed` to `DEMO_SEED`, so the
// seed fed into these derivations in Demo mode is the stable Demo_Seed.
//
// Testing steering: fast-check with explicit numRuns (default 200). No network,
// LLM, sandbox, clock, DOM, or real randomness — pure computation over the
// Demo_Seed.
//
// **Validates: Requirements 9.2**

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEMO_SEED } from "./catalog.js";
import { decaySequence } from "../motion/decay.js";
import { glitchProfile } from "../motion/glitch.js";
import { rot } from "../render/rot.js";
import { initialState } from "../session/state.js";
import type { SessionState } from "../session/state.js";
import type { DemoBundle, ReadingResponse, SummonSummary } from "../protocol.js";
import { isDemoSession, resolveSeed } from "../session/demo-seed.js";

/** The property budget (steering default 200). */
const NUM_RUNS = 200;

// --- Arbitraries -------------------------------------------------------------

/**
 * A reading's per-card severities: 0..3 integers, one per drawn card, covering
 * the empty spread through a full Celtic Cross (10 cards).
 */
const arbSeverities: fc.Arbitrary<readonly (0 | 1 | 2 | 3)[]> = fc.array(
  fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3),
  { maxLength: 10 },
);

/**
 * A pre-ritual source text that mixes newlines, spaces, and code-like glyphs so
 * the rot derivation runs over realistic resurrection input.
 */
const arbSource: fc.Arbitrary<string> = fc.stringOf(
  fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom(..."abcdefgHIJKL0123 ()=+_.") },
    { weight: 2, arbitrary: fc.constant("\n") },
  ),
  { maxLength: 200 },
);

/** A Resurrection_Animation frame count (drives the Decay_Sequence). */
const arbFrameCount: fc.Arbitrary<number> = fc.integer({ min: 0, max: 12 });

// --- Demo-session helpers ----------------------------------------------------

function demoSummary(): SummonSummary {
  return {
    ref: { owner: "o", name: "r", sha: "a".repeat(40), defaultBranch: "main" },
    stars: 0,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 1,
    truncated: false,
    demo: true,
  };
}

function demoReading(id: string): ReadingResponse {
  return {
    summary: demoSummary(),
    reading: {
      id,
      repo: { owner: "o", name: "r", sha: "a".repeat(40), defaultBranch: "main" },
      draws: [],
      spread: [],
      vitality: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
      engineVersion: "0.0.0",
      errors: [],
    },
  };
}

const demoBundle: DemoBundle = {
  "lich-py2": {
    fates: demoReading("11111111-1111-4111-8111-111111111111"),
    necropsy: demoReading("22222222-2222-4222-8222-222222222222"),
  },
};

function demoSessionState(): SessionState {
  return {
    ...initialState(),
    demoBundle,
    summary: demoSummary(),
    lastSpread: "fates",
    readings: { fates: demoReading("11111111-1111-4111-8111-111111111111") },
  };
}

/** Derive the glitch-parameter sequence for a reading's per-card severities. */
function glitchSequence(severities: readonly (0 | 1 | 2 | 3)[]) {
  return severities.map((s) => glitchProfile(s));
}

/** Derive the rot outputs for a source across a Decay_Sequence, seeded by `seed`. */
function rotOutputs(source: string, frameCount: number, seed: number): readonly string[] {
  return decaySequence(frameCount).map((d) => rot(source, d, seed));
}

// --- Property 12 -------------------------------------------------------------

describe("P12 (R9.2): demo reproducibility given Demo_Seed", () => {
  it("resolves the Demo_Seed for a demo session (the seed fed to glitch + rot)", () => {
    const state = demoSessionState();
    expect(isDemoSession(state)).toBe(true);
    expect(resolveSeed(state)).toBe(DEMO_SEED);
  });

  it("derives the same glitch-parameter sequence twice with DEMO_SEED", () => {
    fc.assert(
      fc.property(arbSeverities, (severities) => {
        const first = glitchSequence(severities);
        const second = glitchSequence(severities);
        expect(first).toEqual(second);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("derives the same rot outputs twice with DEMO_SEED over the Decay_Sequence", () => {
    fc.assert(
      fc.property(arbSource, arbFrameCount, (source, frameCount) => {
        const first = rotOutputs(source, frameCount, DEMO_SEED);
        const second = rotOutputs(source, frameCount, DEMO_SEED);

        // One rot output per Decay_Sequence frame, identical across renders.
        expect(first.length).toBe(decaySequence(frameCount).length);
        expect(first).toEqual(second);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reproduces glitch params and rot outputs together across two full demo renders", () => {
    fc.assert(
      fc.property(
        arbSeverities,
        arbSource,
        arbFrameCount,
        (severities, source, frameCount) => {
          // A full "render" of a demo reading: the glitch-parameter sequence for
          // its cards plus the rot outputs for its resurrection, both keyed off
          // the same Demo_Seed. Two renders must be byte-for-byte identical.
          const render = () => ({
            glitch: glitchSequence(severities),
            rot: rotOutputs(source, frameCount, DEMO_SEED),
          });
          expect(render()).toEqual(render());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
