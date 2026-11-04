// src/prefs/prefs.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 11
//
// Property-based tests for the preference loaders (task 11.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `prefs/prefs.ts` (task 11.2),
// so the import below fails to resolve and the whole suite is red for the
// expected reason: the module does not exist yet.
//
// Property 11 (requirements.md §"P11 — Stored preference validation (R10.10,
// R19.1, R19.12)"): For all stored string values, the loaded Motion_Preference
// is the stored value when it is one of `auto`, `on`, or `off`, and `auto`
// otherwise; the loaded Sound_Preference is the stored value when it is one of
// `on` or `off`, and `off` otherwise.
//
// Semantics under test (design.md §"Motion and preferences"):
//   - MOTION_STORAGE_KEY = "necro.motion", SOUND_STORAGE_KEY = "necro.sound".
//   - parseMotionPreference(raw): the three valid values pass through; anything
//     else (including null/undefined/garbage) maps to "auto".
//   - parseSoundPreference(raw): "on"/"off" pass through; anything else maps to
//     "off".
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R10.10, R19.1, R19.12**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 11.2 adds this module.
import {
  MOTION_STORAGE_KEY,
  SOUND_STORAGE_KEY,
  parseMotionPreference,
  parseSoundPreference,
  type MotionPreference,
  type SoundPreference,
} from "./prefs.js";

/** P11 runs the default property budget. */
const NUM_RUNS = 200;

const VALID_MOTION: readonly MotionPreference[] = ["auto", "on", "off"];
const VALID_SOUND: readonly SoundPreference[] = ["on", "off"];

/**
 * Raw stored values the loaders must tolerate: the valid literals, close-miss
 * strings, empty string, and any arbitrary string, plus null and undefined
 * (the shape returned by `localStorage.getItem` for an absent key).
 */
const arbRawValue: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constantFrom<string>("auto", "on", "off"),
  fc.constantFrom<string>("ON", "Off", "Auto", "", " ", "quiet", "true", "0"),
  fc.string(),
  fc.constant(null),
  fc.constant(undefined),
);

describe("P11 (R10.10, R19.1, R19.12): preference loaders", () => {
  it("exposes the fixed storage key constants", () => {
    expect(MOTION_STORAGE_KEY).toBe("necro.motion");
    expect(SOUND_STORAGE_KEY).toBe("necro.sound");
  });

  it("passes every valid Motion_Preference through unchanged", () => {
    fc.assert(
      fc.property(fc.constantFrom<MotionPreference>(...VALID_MOTION), (pref) => {
        expect(parseMotionPreference(pref)).toBe(pref);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps any non-valid stored value to auto for Motion_Preference", () => {
    fc.assert(
      fc.property(arbRawValue, (raw) => {
        const result = parseMotionPreference(raw);
        const isValid =
          typeof raw === "string" &&
          (VALID_MOTION as readonly string[]).includes(raw);
        expect(result).toBe(isValid ? raw : "auto");
        // The result is always one of the three valid preferences.
        expect(VALID_MOTION).toContain(result);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("passes every valid Sound_Preference through unchanged", () => {
    fc.assert(
      fc.property(fc.constantFrom<SoundPreference>(...VALID_SOUND), (pref) => {
        expect(parseSoundPreference(pref)).toBe(pref);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps any non-valid stored value to off for Sound_Preference", () => {
    fc.assert(
      fc.property(arbRawValue, (raw) => {
        const result = parseSoundPreference(raw);
        const isValid =
          typeof raw === "string" &&
          (VALID_SOUND as readonly string[]).includes(raw);
        expect(result).toBe(isValid ? raw : "off");
        // The result is always one of the two valid preferences.
        expect(VALID_SOUND).toContain(result);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps null and undefined to the safe defaults", () => {
    expect(parseMotionPreference(null)).toBe("auto");
    expect(parseMotionPreference(undefined)).toBe("auto");
    expect(parseSoundPreference(null)).toBe("off");
    expect(parseSoundPreference(undefined)).toBe("off");
  });
});
