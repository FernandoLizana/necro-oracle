// src/sound/item-11-theme-music.test.ts
//
// Item 11 (judge-ready-pass): replace the aimless random-walk background music
// with an ORIGINAL, harmonically-grounded composition.
//
// The prior theme drew each note by an independent PRNG draw over a flat minor
// scale -- a directionless arpeggio with no chord structure and only two voices
// (a thin, "placeholder" sound a judge would notice). This replacement keeps
// every committed invariant (peak gain <= 0.2, square/triangle only, gapless
// loop, determinism -- all still covered by background-theme.pbt.test.ts) and
// ADDS real musical structure:
//
//   1. a THIRD voice (a harmony/pad) so the texture is a chord, not a duet;
//   2. every lead/harmony note belongs to the CHORD sounding in its bar, drawn
//      from a fixed i-VI-III-VII A-minor progression (Am, F, C, G) -- so the
//      arpeggio outlines real chords instead of wandering the scale;
//   3. the bass plays each bar's chord ROOT, anchoring the harmony.
//
// Still fully deterministic and original (seeded; no transcription).
//
// Validates: judge-ready-pass item 11 (and preserves R8.1, R8.2).

import { describe, expect, it } from "vitest";

import { composeTheme, peakGain } from "./background-theme.js";

/** Pitch-class (0..11) of a MIDI note. */
function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// The fixed A-minor progression, one chord per bar, as pitch-class SETS.
// Am = {A,C,E} = {9,0,4}; F = {F,A,C} = {5,9,0}; C = {C,E,G} = {0,4,7};
// G = {G,B,D} = {7,11,2}. Roots: A=9, F=5, C=0, G=7.
const CHORD_PCS: readonly (readonly number[])[] = [
  [9, 0, 4],
  [5, 9, 0],
  [0, 4, 7],
  [7, 11, 2],
];
const CHORD_ROOT_PC = [9, 5, 0, 7];

describe("item 11: the background theme is a harmonically-grounded composition", () => {
  it("has at least three voices (lead + harmony + bass), not a thin duet", () => {
    const score = composeTheme(12345);
    expect(score.voices.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the committed invariants (peak gain <= 0.2, square/triangle, gapless)", () => {
    for (const seed of [0, 1, 7, 12345, -3, 2 ** 20]) {
      const score = composeTheme(seed);
      expect(peakGain(score)).toBeLessThanOrEqual(0.2);
      for (const v of score.voices) {
        expect(["square", "triangle"]).toContain(v.wave);
        expect(v.notes.length % score.loopBars).toBe(0);
      }
    }
  });

  it("the LEAD and HARMONY notes belong to the chord sounding in each bar", () => {
    for (const seed of [0, 1, 42, 999, 2024]) {
      const score = composeTheme(seed);
      // Voices other than the bass carry a MELODIC role; the bass is the lowest
      // voice. Identify the bass as the voice with the lowest mean pitch.
      const means = score.voices.map(
        (v) => v.notes.reduce((s, n) => s + n, 0) / v.notes.length,
      );
      const bassIdx = means.indexOf(Math.min(...means));
      score.voices.forEach((voice, vi) => {
        if (vi === bassIdx) return; // bass checked separately
        const perBar = voice.notes.length / score.loopBars;
        voice.notes.forEach((note, i) => {
          const bar = Math.floor(i / perBar) % CHORD_PCS.length;
          const chord = CHORD_PCS[bar] as readonly number[];
          expect(
            chord.includes(pc(note)),
            `seed ${seed} voice ${vi} note ${i} (pc ${pc(note)}) not in bar ${bar} chord ${JSON.stringify(chord)}`,
          ).toBe(true);
        });
      });
    }
  });

  it("the BASS plays each bar's chord root", () => {
    for (const seed of [0, 5, 77, 1234]) {
      const score = composeTheme(seed);
      const means = score.voices.map(
        (v) => v.notes.reduce((s, n) => s + n, 0) / v.notes.length,
      );
      const bass = score.voices[means.indexOf(Math.min(...means))];
      expect(bass).toBeDefined();
      const bassNotes = (bass as { readonly notes: readonly number[] }).notes;
      const perBar = bassNotes.length / score.loopBars;
      bassNotes.forEach((note, i) => {
        const bar = Math.floor(i / perBar) % CHORD_ROOT_PC.length;
        expect(pc(note)).toBe(CHORD_ROOT_PC[bar]);
      });
    }
  });

  it("is deterministic (same seed -> deep-equal score)", () => {
    expect(composeTheme(2024)).toEqual(composeTheme(2024));
  });
});