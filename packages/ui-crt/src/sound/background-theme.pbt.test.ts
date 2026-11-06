// src/sound/background-theme.pbt.test.ts
//
// Feature: arcana-visions, task 7.2 (TEST-FIRST for the Background_Theme model).
//
// Property-based tests for the pure Background_Theme model in
// `./background-theme.js`:
//   - `backgroundThemeActive(state, env)` — the gate that decides when the
//     theme may play.
//   - `composeTheme(seed)` — the seeded, deterministic, original chiptune loop.
//   - `peakGain(score)` — the summed gain across simultaneous voices.
//
// The `SoundState` values fed to the gate are NOT hand-faked: they are built
// by driving the real `soundReducer` (./sound-reducer.js) from a `load` event
// plus a tail of UI events, exactly as the running app builds them. This keeps
// the arbitrary honest to the real state shape and transition rules.
//
// Testing steering: fast-check with explicit numRuns (200); print the seed on
// failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.6, 8.10, 13.5**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  backgroundThemeActive,
  composeTheme,
  peakGain,
} from "./background-theme.js";
import {
  soundReducer,
  type SoundEvent,
  type SoundState,
} from "./sound-reducer.js";

/** Default property budget for this suite. */
const NUM_RUNS = 200;

/** The peak gain ceiling the composed theme must never exceed (R8.1). */
const PEAK_GAIN_CEILING = 0.2;

/** Only these two chiptune waveforms are permitted (R8.1). */
const ALLOWED_WAVES: ReadonlySet<string> = new Set(["square", "triangle"]);

// --- SoundState arbitrary, driven through the real reducer ------------------

/** An arbitrary `load` event: the required first event of any sequence. */
const arbLoadEvent: fc.Arbitrary<Extract<SoundEvent, { type: "load" }>> =
  fc.record({
    type: fc.constant("load" as const),
    preference: fc.constantFrom("on" as const, "off" as const),
    visible: fc.boolean(),
  });

/** An arbitrary non-`load` event (every transition after the initial load). */
const arbStepEvent: fc.Arbitrary<Exclude<SoundEvent, { type: "load" }>> =
  fc.constantFrom<Exclude<SoundEvent, { type: "load" }>>(
    { type: "sound_on" },
    { type: "sound_off" },
    { type: "gesture" },
    { type: "hidden" },
    { type: "visible" },
  );

/**
 * A real `SoundState` built the way the app builds it: seed from a `load`
 * event (which always resets `gesture` to false) then fold a tail of UI
 * events through `soundReducer`. The event mix covers every combination of
 * preference on/off, gesture present/absent and visible/hidden, so the gate
 * arbitrary exercises all gate conditions.
 */
const arbSoundState: fc.Arbitrary<SoundState> = fc
  .tuple(arbLoadEvent, fc.array(arbStepEvent, { maxLength: 24 }))
  .map(([load, rest]) => {
    let state = soundReducer(
      { preference: "off", gesture: false, visible: false },
      load,
    );
    for (const event of rest) {
      state = soundReducer(state, event);
    }
    return state;
  });

/** An arbitrary environment flag: a real CI/test run vs. the browser. */
const arbEnv: fc.Arbitrary<{ readonly isTest: boolean }> = fc.record({
  isTest: fc.boolean(),
});

// --- P13: the gate --------------------------------------------------------

describe("P13 (R8.4, R8.5, R8.6, R8.10, R13.5): theme plays only when every gate condition holds", () => {
  it("is true ONLY when sound is on AND a gesture occurred AND visible AND !isTest", () => {
    fc.assert(
      fc.property(arbSoundState, arbEnv, (state, env) => {
        const soundOn = state.preference === "on";
        const expected =
          soundOn && state.gesture && state.visible && !env.isTest;
        expect(backgroundThemeActive(state, env)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is false whenever any single condition fails (off, no gesture, hidden, or isTest)", () => {
    fc.assert(
      fc.property(arbSoundState, arbEnv, (state, env) => {
        const soundOn = state.preference === "on";
        if (
          !soundOn ||
          !state.gesture ||
          !state.visible ||
          env.isTest
        ) {
          expect(backgroundThemeActive(state, env)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is silent in a test/CI run no matter the Sound_State (R8.10)", () => {
    fc.assert(
      fc.property(arbSoundState, (state) => {
        expect(backgroundThemeActive(state, { isTest: true })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- P14: gain ceiling and permitted waveforms ----------------------------

describe("P14 (R8.1): composed theme never exceeds peak gain 0.2 and uses only square/triangle", () => {
  it("has peakGain <= 0.2 and every voice wave is square or triangle for any seed", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const score = composeTheme(seed);
        expect(peakGain(score)).toBeLessThanOrEqual(PEAK_GAIN_CEILING);
        expect(score.voices.length).toBeGreaterThan(0);
        for (const voice of score.voices) {
          expect(ALLOWED_WAVES.has(voice.wave)).toBe(true);
          // Each voice's gain is a finite non-negative number.
          expect(Number.isFinite(voice.gain)).toBe(true);
          expect(voice.gain).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("holds the ceiling for degenerate seeds (NaN, +/-Infinity, fractional, negative)", () => {
    for (const seed of [NaN, Infinity, -Infinity, 0, -1, 1.5, -2.75]) {
      const score = composeTheme(seed);
      expect(peakGain(score)).toBeLessThanOrEqual(PEAK_GAIN_CEILING);
      for (const voice of score.voices) {
        expect(ALLOWED_WAVES.has(voice.wave)).toBe(true);
      }
    }
  });
});

// --- P15: gapless loop and determinism ------------------------------------

describe("P15 (R8.2): composed theme loops gaplessly", () => {
  it("has loopBars > 0 and every voice carries a whole number of notes per bar", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const score = composeTheme(seed);
        expect(score.loopBars).toBeGreaterThan(0);
        for (const voice of score.voices) {
          // Gapless: notes divide evenly across the loop's bars, so each bar
          // carries a whole number of notes and the wrap meets no silent gap.
          expect(voice.notes.length).toBeGreaterThan(0);
          expect(voice.notes.length % score.loopBars).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is deterministic: the same seed yields a deep-equal score", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        expect(composeTheme(seed)).toEqual(composeTheme(seed));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
