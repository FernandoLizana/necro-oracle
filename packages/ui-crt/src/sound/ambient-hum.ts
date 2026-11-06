// src/sound/ambient-hum.ts
//
// Feature: visual-necromancy, task 21.1 (OPTIONAL polish, Requirement 13).
//
// The pure gate for the ambient Resurrection_Animation hum — a low continuous
// drone that plays ONLY while the rot-then-rebirth animation is actively
// playing. It is an additive, default-off, gesture-gated, full-motion-only
// flourish layered over the existing sound machinery; it decides nothing about
// audio itself. The lazy `SoundEngine.ambient(on)` plays the actual drone, the
// same way `soundCueAllowed` + `engine.cue` drive the one-shot cues.
//
// The hum is gated behind THREE independent conditions, all of which must hold:
//   1. Sound resolves to on — reuse the exact Click/Hum/cue condition from
//      `soundActivity` (preference on + a user gesture + the page visible), so
//      every Sound_State rule holds without this module knowing any of them:
//      off by default (R13.1 → R8.4), never before the gesture and never
//      autoplay (R8.3), silent while sound is off (R8.2), and it stops when the
//      page is hidden (visibility flips the gate false).
//   2. Motion_Mode is `full` — unlike the one-shot cues, this ambient layer is
//      a motion flourish, so it stays silent in reduced motion (R13.1, R13.4).
//   3. The Resurrection_Animation is actively playing — the rot-then-rebirth
//      sequence has started and has NOT yet reached rebirth. The hum therefore
//      stops the instant the animation completes (rebirth done), sound turns
//      off, the page hides, or motion drops to reduced.
//
// This module performs NO audio, DOM, clock or storage access. It only computes
// the boolean from the pure sound state, the Motion_Mode and a
// resurrection-playing flag the Terminal derives from the rot playback.
//
// _Requirements: R13.1, R13.4 (R8.2, R8.3, R8.4)_

import type { MotionMode } from "../motion/motion-mode.js";
import { soundActivity, type SoundState } from "./sound-reducer.js";

/** The inputs the ambient-hum gate decides from (all pure values). */
export interface AmbientHumInput {
  /** The pure sound state (preference, gesture, visibility). */
  readonly sound: SoundState;
  /** The effective Motion_Mode; only `full` ever hums. */
  readonly motionMode: MotionMode;
  /**
   * Whether the Resurrection_Animation (rot-then-rebirth) is actively playing
   * right now, i.e. it has started and has not yet reached rebirth. The
   * Terminal derives this from the rot playback (`useRot`'s `done` flag); the
   * gate treats it as an opaque boolean so it stays free of any clock or DOM.
   */
  readonly resurrectionPlaying: boolean;
}

/**
 * Whether the ambient Resurrection_Animation hum may play right now. True only
 * when sound resolves on (the shared Click/Hum/cue condition), the Motion_Mode
 * is `full`, AND the resurrection animation is actively playing. Any one of
 * those turning false silences the hum, so it stops at rebirth, on `sound off`,
 * when the page hides, or in reduced motion.
 */
export function ambientHumActive(input: AmbientHumInput): boolean {
  if (input.motionMode !== "full") return false;
  if (!input.resurrectionPlaying) return false;
  return soundActivity(input.sound).hum;
}
