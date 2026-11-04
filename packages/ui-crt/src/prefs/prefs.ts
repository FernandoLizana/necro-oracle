// src/prefs/prefs.ts
//
// Feature: 03-crt-terminal, task 11.2.
//
// Loaders that turn raw persisted strings (as returned by `localStorage.
// getItem`, which may be `null` for an absent key) into validated preference
// values. Anything that is not a valid literal falls back to the safe default
// (`auto` for motion, `off` for sound). This module performs NO storage access
// — the UI layer reads/writes through `StoragePort` and passes the raw value in.
//
// The shared literal unions are owned elsewhere and re-exported here so this
// module is the single import surface for the preference layer:
//   - `MotionPreference` is owned by `../motion/motion-mode.ts`.
//   - `SoundPreference` is owned by `../sound/sound-reducer.ts`.
//
// See design.md §"Motion and preferences" and Property 11.
//
// Requirements: R10.10, R19.1, R19.12

import type { MotionPreference } from "../motion/motion-mode.js";
import type { SoundPreference } from "../sound/sound-reducer.js";

export type { MotionPreference } from "../motion/motion-mode.js";
export type { SoundPreference } from "../sound/sound-reducer.js";

/** `localStorage` key for the persisted Motion_Preference. */
export const MOTION_STORAGE_KEY = "necro.motion";

/** `localStorage` key for the persisted Sound_Preference. */
export const SOUND_STORAGE_KEY = "necro.sound";

/** The three valid Motion_Preference literals. */
const MOTION_VALUES: readonly MotionPreference[] = ["auto", "on", "off"];

/** The two valid Sound_Preference literals. */
const SOUND_VALUES: readonly SoundPreference[] = ["on", "off"];

/**
 * Parse a raw stored value into a Motion_Preference. The three valid literals
 * (`auto`, `on`, `off`) pass through unchanged; anything else — including
 * `null`, `undefined`, wrong case, whitespace or garbage — maps to `"auto"`.
 */
export function parseMotionPreference(
  raw: string | null | undefined,
): MotionPreference {
  return (MOTION_VALUES as readonly string[]).includes(raw as string)
    ? (raw as MotionPreference)
    : "auto";
}

/**
 * Parse a raw stored value into a Sound_Preference. The two valid literals
 * (`on`, `off`) pass through unchanged; anything else — including `null`,
 * `undefined`, wrong case, whitespace or garbage — maps to `"off"`.
 */
export function parseSoundPreference(
  raw: string | null | undefined,
): SoundPreference {
  return (SOUND_VALUES as readonly string[]).includes(raw as string)
    ? (raw as SoundPreference)
    : "off";
}
