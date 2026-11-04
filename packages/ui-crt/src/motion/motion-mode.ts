// src/motion/motion-mode.ts
//
// Feature: 03-crt-terminal, task 11.2.
//
// Resolution of the effective Motion_Mode from the user's stored
// Motion_Preference and the `prefers-reduced-motion` media query. This module
// is pure: no DOM, storage or media access. The UI layer reads the media query
// through `MediaPort` and the preference through `prefs.ts`, then feeds both
// into `resolveMotionMode`.
//
// See design.md §"Motion and preferences" and Property 10.
//
// Requirements: R10.6, R10.7

/**
 * The persisted motion setting. `auto` defers to the operating system's
 * `prefers-reduced-motion` media query; `on` forces full motion; `off` forces
 * reduced motion. This module is the canonical owner of the union.
 */
export type MotionPreference = "auto" | "on" | "off";

/** The effective motion behaviour the UI renders with. */
export type MotionMode = "full" | "reduced";

/**
 * Resolve the effective Motion_Mode.
 *
 * - `"off"` always yields `"reduced"`.
 * - `"on"` always yields `"full"`.
 * - `"auto"` yields `"reduced"` when the media query matches
 *   (`prefersReduced === true`), otherwise `"full"`.
 */
export function resolveMotionMode(
  pref: MotionPreference,
  prefersReduced: boolean,
): MotionMode {
  if (pref === "off") return "reduced";
  if (pref === "on") return "full";
  return prefersReduced ? "reduced" : "full";
}
