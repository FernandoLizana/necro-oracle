// src/motion/glitch.ts
//
// Feature: visual-necromancy, task 3.1.
//
// The Glitch_Profile: the pure mapping from a CardDraw severity (0..3) to a
// Glitch_Intensity and its bounded glitch parameters (chromatic offset
// magnitude, scanline tear count, transient corruption count, and duration).
// This module is pure — it reads no clock, network, DOM, or unseeded
// randomness. The UI layer (`AsciiCardView`) consumes `GlitchParams` and, in
// `full` motion only, drives the CSS glitch animation from them.
//
// See design.md §"4. Severity-driven glitch" and Properties 6 and 7.
//
// Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6

/**
 * The bounded, deterministic glitch parameters for a single card reveal. Every
 * field is a finite, non-negative number derived from severity alone.
 */
export interface GlitchParams {
  /** The Glitch_Intensity, always equal to the clamped severity (R5.2). */
  readonly intensity: 0 | 1 | 2 | 3;
  /** Chromatic offset magnitude in pixels (`severity * 2`). */
  readonly offsetPx: number;
  /** Number of scanline tears (`severity`). */
  readonly tearCount: number;
  /** Count of transiently corrupted glyphs (`severity * 3`). */
  readonly corruptChars: number;
  /** Effect duration in milliseconds, capped at 300 to honour Flash_Limit. */
  readonly durationMs: number;
}

/** The maximum glitch duration in milliseconds (Flash_Limit ceiling, R5.9). */
export const GLITCH_MAX_DURATION_MS = 300;

/**
 * Clamp a raw severity to an integer Glitch_Intensity in `0..3`. Non-integer,
 * negative, out-of-range, and `NaN` severities are coerced to the nearest valid
 * intensity (`NaN` becomes 0).
 */
function clampIntensity(severity: number): 0 | 1 | 2 | 3 {
  if (Number.isNaN(severity)) return 0;
  const rounded = Math.round(severity);
  if (rounded <= 0) return 0;
  if (rounded >= 3) return 3;
  return rounded as 1 | 2;
}

/**
 * Map a severity of 0 to 3 to its Glitch_Profile.
 *
 * Severity is clamped to an integer `0..3`; each parameter is then derived as a
 * bounded, non-decreasing function of that intensity:
 *
 * - `intensity = severity`
 * - `offsetPx = severity * 2`
 * - `tearCount = severity`
 * - `corruptChars = severity * 3`
 * - `durationMs = min(300, severity * 90)`
 *
 * Severity 0 yields all-zero parameters (no offset, no tear, no corruption, no
 * duration), so a calm card is perfectly steady (R5.3). Every field is
 * non-decreasing in severity (R5.4) and the result is a pure function of
 * severity alone (R5.5, R5.6).
 */
export function glitchProfile(severity: number): GlitchParams {
  const intensity = clampIntensity(severity);
  return {
    intensity,
    offsetPx: intensity * 2,
    tearCount: intensity,
    corruptChars: intensity * 3,
    durationMs: Math.min(GLITCH_MAX_DURATION_MS, intensity * 90),
  };
}
