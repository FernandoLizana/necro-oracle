// src/sound/sound-cue.ts
//
// Feature: visual-necromancy, task 15.1.
//
// The four core Visual_Layer sound cues and the pure gate that decides when
// they may play. A cue is a short one-shot sound — boot completion, a card
// reveal, a glitch, and a resurrection rebirth (R8.1). Like the keystroke
// Click, a cue plays ONLY when `soundActivity(state.sound)` resolves sound to
// on, so every existing Sound_State rule holds without this module knowing any
// of them: off by default (R8.4), never before the user gesture and never
// autoplay (R8.3), silent while sound is off (R8.2). Sound and motion are
// independent, so this gate reads no Motion_Mode — a cue may fire in reduced
// motion when sound is on (R8.5).
//
// This module performs NO audio, DOM, clock or storage access. It only names
// the cues and computes the boolean gate from the pure sound state; the lazy
// `SoundEngine` plays the actual one-shot (`engine.cue`), mirroring how the
// Click reuses the engine's one-shot path (design §7 "Sound cues").
//
// _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5_

import { soundActivity, type SoundState } from "./sound-reducer.js";

/**
 * The Visual_Layer cues, each a short one-shot. The first four are the core set
 * (R8.1); `summon` is an additive extra (visual-necromancy task 21.4, OPTIONAL
 * polish under Requirement 13) that marks the one dramatic moment the core four
 * leave unscored — the instant a Reading's spread is drawn and laid out, before
 * the one-by-one Card_Reveal plays:
 * - `boot` — the Boot_Sequence has completed.
 * - `reveal` — a card has flipped face-up during the Card_Reveal.
 * - `glitch` — a Glitch_Effect fired on a revealed card.
 * - `rebirth` — the resurrection rebirth, after the rot frames.
 * - `summon` — a Reading has resolved and its spread is laid (EXTRA, task 21.4).
 *
 * `summon` is gated by the exact same `soundCueAllowed` as every other cue, so
 * it stays off by default, never autoplays, never fires before the gesture, is
 * silent while sound is off, and is independent of the Motion_Mode (R8.1-R8.5).
 * It derives from a Motion_Mode-independent state transition (a Reading coming
 * into scope), so it fires identically in full and reduced motion (R8.5).
 */
export const SOUND_CUES = [
  "boot",
  "reveal",
  "glitch",
  "rebirth",
  "summon",
] as const;

/** One of the Visual_Layer cue names (the four core plus the extra `summon`). */
export type SoundCue = (typeof SOUND_CUES)[number];

/**
 * Whether a Visual_Layer sound cue may play right now. It reuses the exact
 * Click/Hum condition from `soundActivity`: the preference is on, a user
 * gesture has occurred, and the document is visible. Nothing here depends on
 * the Motion_Mode, so sound and motion stay independent (R8.5).
 */
export function soundCueAllowed(state: SoundState): boolean {
  return soundActivity(state).click;
}
