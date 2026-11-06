// src/sound/ambient-hum.test.ts
//
// Feature: visual-necromancy, task 21.1 (OPTIONAL polish, Requirement 13).
//
// Pure unit tests for `ambientHumActive` — the gate for the ambient
// Resurrection_Animation hum. These touch no DOM, clock, audio or randomness:
// they feed `SoundState` + `MotionMode` + a `resurrectionPlaying` flag into the
// gate and assert the boolean. The gate must be true ONLY when all three hold:
// sound resolves on (the shared Click/Hum/cue condition), the Motion_Mode is
// `full`, and the resurrection animation is actively playing. Any one turning
// false silences the hum (stops at rebirth, on `sound off`, when hidden, or in
// reduced motion).
//
// Validates: Requirements 13.1, 13.4

import { describe, expect, it } from "vitest";

import { ambientHumActive } from "./ambient-hum.js";
import type { SoundState } from "./sound-reducer.js";

/** The one sound state in which the hum may play: on + gesture + visible. */
const SOUND_ON: SoundState = { preference: "on", gesture: true, visible: true };

describe("R13.1 (ambient hum plays): full motion + sound on + resurrection playing", () => {
  it("hums when sound resolves on, motion is full, and the animation is playing", () => {
    expect(
      ambientHumActive({
        sound: SOUND_ON,
        motionMode: "full",
        resurrectionPlaying: true,
      }),
    ).toBe(true);
  });
});

describe("R13.1 (default-off / gesture-gated): sound must resolve on", () => {
  it("stays silent when the preference is off — off by default, silent while off", () => {
    expect(
      ambientHumActive({
        sound: { ...SOUND_ON, preference: "off" },
        motionMode: "full",
        resurrectionPlaying: true,
      }),
    ).toBe(false);
  });

  it("stays silent before the user gesture — no autoplay", () => {
    expect(
      ambientHumActive({
        sound: { ...SOUND_ON, gesture: false },
        motionMode: "full",
        resurrectionPlaying: true,
      }),
    ).toBe(false);
  });

  it("stops when the page is hidden", () => {
    expect(
      ambientHumActive({
        sound: { ...SOUND_ON, visible: false },
        motionMode: "full",
        resurrectionPlaying: true,
      }),
    ).toBe(false);
  });
});

describe("R13.1/R13.4 (full-motion only): reduced motion never hums", () => {
  it("stays silent in reduced motion even with sound on and the animation playing", () => {
    expect(
      ambientHumActive({
        sound: SOUND_ON,
        motionMode: "reduced",
        resurrectionPlaying: true,
      }),
    ).toBe(false);
  });
});

describe("R13.1 (stops at rebirth): only while the animation is actively playing", () => {
  it("stays silent when no resurrection animation is playing (before start / after rebirth)", () => {
    expect(
      ambientHumActive({
        sound: SOUND_ON,
        motionMode: "full",
        resurrectionPlaying: false,
      }),
    ).toBe(false);
  });
});

describe("R13.1 (all three independent): the gate is the AND of every condition", () => {
  it("is true only when sound-on AND full motion AND playing all hold together", () => {
    for (const preference of ["on", "off"] as const) {
      for (const gesture of [true, false]) {
        for (const visible of [true, false]) {
          for (const motionMode of ["full", "reduced"] as const) {
            for (const resurrectionPlaying of [true, false]) {
              const soundOn = preference === "on" && gesture && visible;
              const expected =
                soundOn && motionMode === "full" && resurrectionPlaying;
              expect(
                ambientHumActive({
                  sound: { preference, gesture, visible },
                  motionMode,
                  resurrectionPlaying,
                }),
              ).toBe(expected);
            }
          }
        }
      }
    }
  });
});
