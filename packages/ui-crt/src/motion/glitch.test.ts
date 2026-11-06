// src/motion/glitch.test.ts
//
// Feature: visual-necromancy, task 3.3.
//
// Example/unit tests for the Glitch_Profile bounds (`motion/glitch.ts`, task
// 3.1). These complement the property tests in `glitch.pbt.test.ts` (task 3.2)
// with concrete, documented values: the all-zero severity-0 profile, the
// severity-3 duration ceiling (Flash_Limit), the per-severity field table, and
// out-of-range severity clamping (negatives, values beyond 3, non-integers).
//
// Semantics under test (motion/glitch.ts):
//   glitchProfile(severity):
//     intensity     = clamp(round(severity), 0..3)   (NaN -> 0)
//     offsetPx      = intensity * 2
//     tearCount     = intensity
//     corruptChars  = intensity * 3
//     durationMs    = min(GLITCH_MAX_DURATION_MS, intensity * 90)
//
// No network, clock, DOM, or real randomness — pure computation.
//
// _Requirements: 5.3, 5.5_
import { describe, expect, it } from "vitest";

import {
  GLITCH_MAX_DURATION_MS,
  glitchProfile,
  type GlitchParams,
} from "./glitch.js";

describe("glitchProfile bounds (R5.3, R5.5)", () => {
  it("returns an all-zero profile at severity 0 (R5.3)", () => {
    expect(glitchProfile(0)).toEqual<GlitchParams>({
      intensity: 0,
      offsetPx: 0,
      tearCount: 0,
      corruptChars: 0,
      durationMs: 0,
    });
  });

  it("caps severity-3 duration at the Flash_Limit ceiling (R5.5)", () => {
    const p = glitchProfile(3);
    // min(300, 3 * 90) === 270, which is within the 300 ms Flash_Limit cap.
    expect(p.durationMs).toBe(270);
    expect(p.durationMs).toBeLessThanOrEqual(GLITCH_MAX_DURATION_MS);
  });

  it("maps each in-range severity to its documented parameters", () => {
    expect(glitchProfile(1)).toEqual<GlitchParams>({
      intensity: 1,
      offsetPx: 2,
      tearCount: 1,
      corruptChars: 3,
      durationMs: 90,
    });
    expect(glitchProfile(2)).toEqual<GlitchParams>({
      intensity: 2,
      offsetPx: 4,
      tearCount: 2,
      corruptChars: 6,
      durationMs: 180,
    });
    expect(glitchProfile(3)).toEqual<GlitchParams>({
      intensity: 3,
      offsetPx: 6,
      tearCount: 3,
      corruptChars: 9,
      durationMs: 270,
    });
  });

  it("derives offsetPx, tearCount, and corruptChars from the documented formulas", () => {
    for (const severity of [0, 1, 2, 3] as const) {
      const p = glitchProfile(severity);
      expect(p.offsetPx).toBe(severity * 2);
      expect(p.tearCount).toBe(severity);
      expect(p.corruptChars).toBe(severity * 3);
    }
  });

  it("clamps a negative severity down to the all-zero profile (R5.3, R5.5)", () => {
    expect(glitchProfile(-5)).toEqual<GlitchParams>({
      intensity: 0,
      offsetPx: 0,
      tearCount: 0,
      corruptChars: 0,
      durationMs: 0,
    });
  });

  it("clamps a severity above 3 to the severity-3 profile (R5.5)", () => {
    expect(glitchProfile(7)).toEqual<GlitchParams>({
      intensity: 3,
      offsetPx: 6,
      tearCount: 3,
      corruptChars: 9,
      durationMs: 270,
    });
  });

  it("rounds a non-integer severity to the nearest intensity (R5.5)", () => {
    // 2.4 rounds to 2.
    expect(glitchProfile(2.4).intensity).toBe(2);
    expect(glitchProfile(2.4)).toEqual(glitchProfile(2));
    // 2.6 rounds up to 3.
    expect(glitchProfile(2.6).intensity).toBe(3);
    expect(glitchProfile(2.6)).toEqual(glitchProfile(3));
    // 0.4 rounds down to 0 (all-zero).
    expect(glitchProfile(0.4).intensity).toBe(0);
    expect(glitchProfile(0.4)).toEqual(glitchProfile(0));
  });
});
