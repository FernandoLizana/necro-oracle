// src/sound/background-theme.ts
//
// Feature: arcana-visions, task 7.1.
//
// The pure Background_Theme model. It names the shape of an ORIGINAL chiptune
// loop and the gate that decides when it may play, and composes a score
// procedurally from a seed — but it performs NO audio, DOM, clock or storage
// access. The lazy `BackgroundThemeEngine` (task 8) turns a `ThemeScore` into
// `OscillatorNode`s; this module only describes the score and computes the
// boolean gate from the pure Sound_State.
//
// The composition is generated from the seed with a small deterministic PRNG
// (a mulberry32 step). It is NOT a transcription of any existing game or song:
// the notes are derived arithmetically from the seed over a fixed scale, so the
// same seed always yields the identical score (R8.2 determinism) while no
// external melody is reproduced.
//
// Two guarantees hold BY CONSTRUCTION, independent of the seed:
//  - `peakGain(composeTheme(seed)) <= 0.2` — the per-voice gains are chosen from
//    a range whose sum across the simultaneously-sounding voices never exceeds
//    the 0.2 ceiling (R8.1).
//  - the loop is gapless — `loopBars` is fixed and every voice carries a whole
//    number of notes per bar, so `notes.length` divides evenly into `loopBars`
//    and the last note's release meets the first note's attack with no silent
//    gap when the loop wraps (R8.2).
//
// The gate `backgroundThemeActive` mirrors `soundCueAllowed` exactly, reusing
// `soundActivity` so every Sound_State rule holds here without this module
// knowing any of them: off by default (R8.4), never before a user gesture and
// never autoplay (R8.3/R8.5 via `soundActivity`), silent while sound is off
// (R8.6). It adds one extra condition — the theme is also silent in a test/CI
// run (`env.isTest`) (R8.10) — and makes NO audio policy decision of its own.
//
// _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.10_

import { NecroError } from "@necro/oracle/client";

import { soundActivity, type SoundState } from "./sound-reducer.js";

/**
 * One synth voice of the theme: a single waveform playing a repeating arpeggio
 * pattern at a fixed per-voice gain. Only `square` and `triangle` are allowed —
 * the plain chiptune waveforms (R8.1).
 */
export interface ThemeVoice {
  /** The oscillator waveform. Only the two chiptune shapes are permitted. */
  readonly wave: "square" | "triangle";
  /** The arpeggio as MIDI note numbers, read in order and looped. */
  readonly notes: readonly number[];
  /** This voice's gain. Summed across voices the peak stays `<= 0.2`. */
  readonly gain: number;
}

/**
 * A complete, loopable theme: a tempo, a bar count the loop wraps on, and the
 * voices that sound together. `peakGain(score) <= 0.2` and the loop is gapless.
 */
export interface ThemeScore {
  /** Beats per minute. */
  readonly bpm: number;
  /** Bars in one loop; every voice carries a whole number of notes per bar. */
  readonly loopBars: number;
  /** The simultaneously-sounding voices. */
  readonly voices: readonly ThemeVoice[];
}

/**
 * The peak gain ceiling. The summed gain of all voices that sound at the same
 * instant must never exceed this (R8.1).
 */
const PEAK_GAIN_CEILING = 0.2;

/** Bars in one loop. Fixed so the loop boundary is deterministic and gapless. */
const LOOP_BARS = 4;

/** Notes the lead voice plays per bar (a whole number keeps the loop gapless). */
const LEAD_NOTES_PER_BAR = 4;

/** Notes the bass voice plays per bar (a whole number keeps the loop gapless). */
const BASS_NOTES_PER_BAR = 2;

/**
 * A fixed A natural-minor scale as MIDI offsets from the voice's root. The
 * composition only ever picks degrees from this scale, so every seed yields a
 * consonant, original arpeggio rather than a chromatic jumble.
 */
const MINOR_SCALE_DEGREES = [0, 2, 3, 5, 7, 8, 10, 12] as const;

/** Lead root: A4 (MIDI 69). The arpeggio hovers around the mid register. */
const LEAD_ROOT_MIDI = 69;

/** Bass root: A2 (MIDI 45), two octaves below the lead. */
const BASS_ROOT_MIDI = 45;

/**
 * One mulberry32 step. Deterministic 32-bit PRNG: same input state yields the
 * same output, so the whole composition is reproducible from the seed. Returns
 * a float in `[0, 1)` and the next state.
 */
function nextRandom(state: number): { readonly value: number; readonly state: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

/**
 * Normalise an arbitrary (possibly fractional, NaN or negative) seed into a
 * non-negative 32-bit integer so the PRNG is stable across every input.
 */
function normaliseSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  // Keep the integer part, fold into the unsigned 32-bit range.
  return Math.abs(Math.trunc(seed)) >>> 0;
}

/**
 * Build one voice's arpeggio of `count` notes by walking the PRNG and mapping
 * each draw onto a degree of the minor scale, offset from `root`. Returns the
 * notes and the advanced PRNG state so the next voice continues the sequence.
 */
function composeVoiceNotes(
  root: number,
  count: number,
  state: number,
): { readonly notes: number[]; readonly state: number } {
  const notes: number[] = [];
  let s = state;
  for (let i = 0; i < count; i += 1) {
    const draw = nextRandom(s);
    s = draw.state;
    const index = Math.min(
      MINOR_SCALE_DEGREES.length - 1,
      Math.floor(draw.value * MINOR_SCALE_DEGREES.length),
    );
    const degree = MINOR_SCALE_DEGREES[index] ?? 0;
    notes.push(root + degree);
  }
  return { notes, state: s };
}

/**
 * Compose a seeded, deterministic, original theme. Same seed always yields the
 * identical `ThemeScore`. The result satisfies `peakGain(score) <= 0.2` and
 * loops gaplessly by construction (see the module header). Pure: no audio, no
 * clock, no DOM.
 */
export function composeTheme(seed: number): ThemeScore {
  let state = normaliseSeed(seed);

  // Tempo wanders a little with the seed but stays in a calm 90-110 BPM band.
  const bpmDraw = nextRandom(state);
  state = bpmDraw.state;
  const bpm = 90 + Math.floor(bpmDraw.value * 21);

  // Gains are chosen so their sum is always <= PEAK_GAIN_CEILING. The lead sits
  // in [0.10, 0.13] and the bass in [0.04, 0.06]; the maximum possible sum is
  // 0.13 + 0.06 = 0.19 <= 0.2, so the ceiling holds for every seed.
  const leadGainDraw = nextRandom(state);
  state = leadGainDraw.state;
  const leadGain = 0.1 + leadGainDraw.value * 0.03;

  const bassGainDraw = nextRandom(state);
  state = bassGainDraw.state;
  const bassGain = 0.04 + bassGainDraw.value * 0.02;

  const lead = composeVoiceNotes(LEAD_ROOT_MIDI, LOOP_BARS * LEAD_NOTES_PER_BAR, state);
  state = lead.state;

  const bass = composeVoiceNotes(BASS_ROOT_MIDI, LOOP_BARS * BASS_NOTES_PER_BAR, state);
  state = bass.state;

  // Runtime invariant guard (R8.1): the summed gain of the simultaneously-
  // sounding voices must never exceed the ceiling. For the current gain bands
  // the max sum is 0.13 + 0.06 = 0.19 <= 0.2, so this never fires — it fails
  // loudly only if a future edit to the bands breaks the ceiling.
  const summedGain = leadGain + bassGain;
  if (summedGain > PEAK_GAIN_CEILING) {
    throw new NecroError(
      "VALIDATION_FAILED",
      "The theme's voices rose too loud; the summoned chorus breaches the gain ward.",
    );
  }

  return {
    bpm,
    loopBars: LOOP_BARS,
    voices: [
      { wave: "square", notes: lead.notes, gain: leadGain },
      { wave: "triangle", notes: bass.notes, gain: bassGain },
    ],
  };
}

/**
 * The peak SUMMED gain across simultaneously-sounding voices. Every voice in a
 * `ThemeScore` sounds throughout the loop (each loops its own arpeggio), so the
 * worst-case instant is all voices sounding at once: the sum of their gains.
 * The property test asserts this is `<= 0.2` for the composed theme (R8.1).
 */
export function peakGain(score: ThemeScore): number {
  return score.voices.reduce((sum, voice) => sum + voice.gain, 0);
}

/**
 * Whether the Background_Theme may play right now. It reuses the exact
 * Click/cue condition from `soundActivity` — the preference is on, a user
 * gesture has occurred and the document is visible — and adds the one extra
 * rule the one-shot cues do not need: the theme is also silent in a test or CI
 * run (`env.isTest`) (R8.10). The engine makes no policy decision; this gate is
 * the single source of truth.
 */
export function backgroundThemeActive(
  state: SoundState,
  env: { readonly isTest: boolean },
): boolean {
  return soundActivity(state).click && !env.isTest;
}
