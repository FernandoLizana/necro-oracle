// Fixed phrases and phase/vitality voice — example tests (TEST-FIRST).
//
// Validates: Requirements R7.3, R7.4, R6.15, R6.21
//
// Covers the fixed Oracle_Voice copy the terminal prints outside a card
// reading:
//   - BOOT_PHRASE / PRE_READING_PHRASE: the canonical Fixed_Phrases from the
//     `oracle-voice` steering (R7.3).
//   - DEMO_LABEL: the demo-replay banner (R18.5 support).
//   - PHASE_VOICE: one entry per ReadingPhase, each a mystical line (≤ 16 words)
//     plus a technical line naming the phase (R6.15).
//   - EXTERNAL_SKIP_NOTE: the two-line Oracle_Voice note shown when external
//     data is skipped (R6.21).
//   - vitalityVoice: three bands, each a mystical line of ≤ 16 words.
//
// TEST-FIRST (task 7.1): written before `voice/phrases.ts` and
// `voice/voice-table.ts` exist (task 7.2). EXPECTED TO FAIL now — the imports
// of `./phrases.js` / `./voice-table.js` cannot resolve. That is the correct
// red.

import { describe, expect, it } from "vitest";

import type { ReadingPhase } from "../protocol.js";

import {
  BOOT_PHRASE,
  DEMO_LABEL,
  EXTERNAL_SKIP_NOTE,
  PHASE_VOICE,
  PRE_READING_PHRASE,
  vitalityVoice,
} from "./phrases.js";

/** The four ordered Reading_Phases, as surfaced to the client. */
const READING_PHASES: readonly ReadingPhase[] = [
  "SUMMON",
  "DOWNLOAD",
  "EXTERNAL",
  "READING",
];

/** Count whitespace-separated words on a single mystical line. */
function wordCount(line: string): number {
  const trimmed = line.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

/** A single mystical line: non-empty, no newline, ≤ 16 words, ≤ 72 columns. */
function expectMysticalLine(line: string): void {
  expect(typeof line).toBe("string");
  expect(line.trim().length).toBeGreaterThan(0);
  expect(line).not.toContain("\n");
  expect(wordCount(line)).toBeGreaterThanOrEqual(1);
  expect(wordCount(line)).toBeLessThanOrEqual(16);
  expect([...line].length).toBeLessThanOrEqual(72);
}

describe("Fixed_Phrases (R7.3): boot and pre-reading copy", () => {
  it("BOOT_PHRASE is the canonical boot banner", () => {
    expect(BOOT_PHRASE).toBe(
      "NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP",
    );
  });

  it("PRE_READING_PHRASE is the canonical pre-reading line", () => {
    expect(PRE_READING_PHRASE).toBe("Shuffle. Cut. The repository speaks.");
  });

  it("keeps boot and pre-reading lines within 72 columns, no newline", () => {
    for (const phrase of [BOOT_PHRASE, PRE_READING_PHRASE]) {
      expect(phrase).not.toContain("\n");
      expect([...phrase].length).toBeLessThanOrEqual(72);
    }
  });
});

describe("DEMO_LABEL (R18.5): demo-replay banner", () => {
  it("is a non-empty single line within 72 columns", () => {
    expect(typeof DEMO_LABEL).toBe("string");
    expect(DEMO_LABEL.trim().length).toBeGreaterThan(0);
    expect(DEMO_LABEL).not.toContain("\n");
    expect([...DEMO_LABEL].length).toBeLessThanOrEqual(72);
  });

  it("marks the output as a demo so it reads as a fixture replay", () => {
    expect(DEMO_LABEL.toLowerCase()).toContain("demo");
  });
});

describe("PHASE_VOICE (R6.15): one Progress_Line copy per Reading_Phase", () => {
  it("has exactly one entry for each of the four ordered phases", () => {
    expect(Object.keys(PHASE_VOICE).sort()).toEqual(
      [...READING_PHASES].sort(),
    );
  });

  it("gives each phase a mystical line (≤ 16 words) and a technical line naming the phase", () => {
    for (const phase of READING_PHASES) {
      const entry = PHASE_VOICE[phase];
      expect(entry, `PHASE_VOICE has an entry for ${phase}`).toBeDefined();

      // Mystical line: short, single line, within budget.
      expectMysticalLine(entry.mystical);

      // Technical line: non-empty and names the phase (R6.15).
      expect(entry.technical.trim().length).toBeGreaterThan(0);
      expect(entry.technical).toContain(phase);
      expect([...entry.technical].length).toBeLessThanOrEqual(72);
    }
  });
});

describe("EXTERNAL_SKIP_NOTE (R6.21): external-data skip note", () => {
  it("is a two-line Oracle_Voice note: a mystical line then a technical line", () => {
    const parts = EXTERNAL_SKIP_NOTE.split("\n");
    expect(parts.length).toBe(2);

    const [mystical, technical] = parts;
    expect(mystical).toBeDefined();
    expect(technical).toBeDefined();
    if (mystical === undefined || technical === undefined) return;
    expectMysticalLine(mystical);
    expect(technical.trim().length).toBeGreaterThan(0);
    expect([...technical].length).toBeLessThanOrEqual(72);
  });
});

describe("vitalityVoice (R7.3, R7.4): three bands, each ≤ 16 words", () => {
  it("returns a non-empty mystical line of ≤ 16 words across the 0–100 range", () => {
    for (let vitality = 0; vitality <= 100; vitality += 5) {
      expectMysticalLine(vitalityVoice(vitality));
    }
  });

  it("produces three distinct bands across low, middle, and high vitality", () => {
    const low = vitalityVoice(0);
    const mid = vitalityVoice(50);
    const high = vitalityVoice(100);
    const bands = new Set([low, mid, high]);
    expect(bands.size).toBe(3);
  });

  it("is a pure function: equal vitality yields the same line", () => {
    for (const vitality of [0, 25, 50, 75, 100]) {
      expect(vitalityVoice(vitality)).toBe(vitalityVoice(vitality));
    }
  });
});
