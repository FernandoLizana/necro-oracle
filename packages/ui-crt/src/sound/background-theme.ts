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

/*
 * Item 11: a fixed, original i-VI-III-VII A-minor chord progression, ONE
 * chord per bar (Am, F, C, G) as semitone offsets from the voice root. The
 * lead + harmony arpeggiate the chord sounding in each bar and the bass plays
 * its root, so the loop outlines real harmony instead of wandering the scale.
 */
const CHORD_PROGRESSION: readonly (readonly number[])[] = [
  [0, 3, 7],
  [-4, 0, 3],
  [3, 7, 10],
  [-2, 2, 5],
];

/** Each bar's bass root offset (semitones from the voice root). */
const CHORD_BASS_OFFSET: readonly number[] = [0, -4, 3, -2];

/** Harmony voice notes per bar (a whole number keeps the loop gapless). */
const HARMONY_NOTES_PER_BAR = 2;

/** Harmony root: A3 (MIDI 57), between the lead and the bass. */
const HARMONY_ROOT_MIDI = 57;

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
function composeChordVoice(
  root: number,
  notesPerBar: number,
  state: number,
): { readonly notes: number[]; readonly state: number } {
  const notes: number[] = [];
  let s = state;
  for (let bar = 0; bar < LOOP_BARS; bar += 1) {
    const chord = CHORD_PROGRESSION[bar % CHORD_PROGRESSION.length] ?? MINOR_SCALE_DEGREES;
    for (let n = 0; n < notesPerBar; n += 1) {
      const draw = nextRandom(s);
      s = draw.state;
      const tone = chord[Math.min(chord.length - 1, Math.floor(draw.value * chord.length))] ?? 0;
      notes.push(root + (tone as number));
    }
  }
  return { notes, state: s };
}

/** The bass voice: each bar's chord ROOT, anchoring the harmony (item 11). */
function composeBassVoice(root: number, notesPerBar: number): readonly number[] {
  const notes: number[] = [];
  for (let bar = 0; bar < LOOP_BARS; bar += 1) {
    const offset = CHORD_BASS_OFFSET[bar % CHORD_BASS_OFFSET.length] ?? 0;
    for (let n = 0; n < notesPerBar; n += 1) notes.push(root + offset);
  }
  return notes;
}

/**
 * Compose a seeded, deterministic, original theme. Same seed always yields the
 * identical `ThemeScore`. The result satisfies `peakGain(score) <= 0.2` and
 * loops gaplessly by construction (see the module header). Pure: no audio, no
 * clock, no DOM.
 */
export function composeTheme(seed: number): ThemeScore {
  let state = normaliseSeed(seed);

  const bpmDraw = nextRandom(state);
  state = bpmDraw.state;
  const bpm = 90 + Math.floor(bpmDraw.value * 21);

  // Item 11: THREE voices now. Gain bands: lead [0.08,0.10], harmony
  // [0.04,0.05], bass [0.04,0.05]; max sum 0.20 <= PEAK_GAIN_CEILING.
  const leadGainDraw = nextRandom(state);
  state = leadGainDraw.state;
  const leadGain = 0.08 + leadGainDraw.value * 0.02;

  const harmonyGainDraw = nextRandom(state);
  state = harmonyGainDraw.state;
  const harmonyGain = 0.04 + harmonyGainDraw.value * 0.01;

  const bassGainDraw = nextRandom(state);
  state = bassGainDraw.state;
  const bassGain = 0.04 + bassGainDraw.value * 0.01;

  const lead = composeChordVoice(LEAD_ROOT_MIDI, LEAD_NOTES_PER_BAR, state);
  state = lead.state;

  const harmony = composeChordVoice(HARMONY_ROOT_MIDI, HARMONY_NOTES_PER_BAR, state);
  state = harmony.state;

  const bassNotes = composeBassVoice(BASS_ROOT_MIDI, BASS_NOTES_PER_BAR);

  const summedGain = leadGain + harmonyGain + bassGain;
  if (summedGain > PEAK_GAIN_CEILING) {
    throw new NecroError(
      "VALIDATION_FAILED",
      "The theme\u2019s voices rose too loud; the summoned chorus breaches the gain ward.",
    );
  }

  return {
    bpm,
    loopBars: LOOP_BARS,
    voices: [
      { wave: "square", notes: lead.notes, gain: leadGain },
      { wave: "triangle", notes: harmony.notes, gain: harmonyGain },
      { wave: "triangle", notes: bassNotes, gain: bassGain },
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
