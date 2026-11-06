// src/sound/sound-cue.test.ts
//
// Feature: visual-necromancy, task 15.2.
//
// Pure unit tests for `soundCueAllowed` — the gate that decides when a core
// Visual_Layer cue (boot / reveal / glitch / rebirth) may play. These tests
// touch no DOM, clock, audio or randomness: they feed `SoundState` values
// straight into the gate and assert the boolean.
//
// The gate reuses the exact Click/Hum condition from `soundActivity`, so the
// four Sound_State rules hold through this single boolean:
//   - sound on + gesture + visible => allowed;
//   - preference "off" => silent while off (R8.2), off by default (R8.4);
//   - no gesture => never before the user gesture / no autoplay (R8.3);
//   - hidden => not allowed.
// Nothing here reads a Motion_Mode: the gate has no motion input at all, so a
// cue may fire in reduced motion whenever sound is on (R8.5) — the sound/motion
// independence is structural, documented by the absence of any motion argument.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5

import { describe, expect, it } from "vitest";

import { SOUND_CUES, soundCueAllowed, type SoundCue } from "./sound-cue.js";
import type { SoundState } from "./sound-reducer.js";

/** The one state in which cues may play: on + gesture + visible. */
const ON: SoundState = { preference: "on", gesture: true, visible: true };

describe("R8.1 (cue names): the core cues are named, plus the extra summon", () => {
  it("lists the four core cues first, in order, then the extra summon cue", () => {
    // The four core Visual_Layer cues (R8.1) lead the list unchanged, so any
    // reader of the first four still sees exactly boot/reveal/glitch/rebirth.
    expect(SOUND_CUES.slice(0, 4)).toEqual([
      "boot",
      "reveal",
      "glitch",
      "rebirth",
    ]);
    // `summon` (task 21.4) is the one additive extra, appended at the end so it
    // never shifts a core cue's position.
    expect(SOUND_CUES).toEqual([
      "boot",
      "reveal",
      "glitch",
      "rebirth",
      "summon",
    ]);
  });

  it("every name is a valid SoundCue usable as the gate's companion", () => {
    // Type-level: each member is assignable to SoundCue; value-level: unique.
    const names: readonly SoundCue[] = SOUND_CUES;
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("R8.1/R8.2/R8.3/R8.4 (cue gate): soundCueAllowed reuses the Click condition", () => {
  it("allows a cue when sound is on, a gesture happened and the page is visible", () => {
    expect(soundCueAllowed(ON)).toBe(true);
  });

  it("forbids a cue when the preference is off — silent while off (R8.2), off by default (R8.4)", () => {
    expect(soundCueAllowed({ ...ON, preference: "off" })).toBe(false);
  });

  it("forbids a cue before the user gesture — no autoplay (R8.3)", () => {
    expect(soundCueAllowed({ ...ON, gesture: false })).toBe(false);
  });

  it("forbids a cue while the document is hidden", () => {
    expect(soundCueAllowed({ ...ON, visible: false })).toBe(false);
  });

  it("stays false unless all three conditions hold together", () => {
    // Only the fully-on triple is allowed; every other combination is false.
    for (const preference of ["on", "off"] as const) {
      for (const gesture of [true, false]) {
        for (const visible of [true, false]) {
          const state: SoundState = { preference, gesture, visible };
          const expected = preference === "on" && gesture && visible;
          expect(soundCueAllowed(state)).toBe(expected);
        }
      }
    }
  });
});

describe("R8.5 (sound/motion independence): the gate has no motion input", () => {
  it("decides purely from preference/gesture/visibility — a cue may fire in reduced motion when sound is on", () => {
    // `soundCueAllowed` takes only a SoundState; there is no Motion_Mode
    // argument, so the result cannot depend on reduced vs full motion. A cue
    // therefore fires in reduced motion exactly when sound is on (R8.5). We
    // document this structurally: the one allowed state is motion-agnostic.
    expect(soundCueAllowed(ON)).toBe(true);
    expect(soundCueAllowed.length).toBe(1);
  });
});
