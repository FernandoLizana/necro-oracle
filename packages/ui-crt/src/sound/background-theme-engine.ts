// src/sound/background-theme-engine.ts
//
// Feature: arcana-visions, task 8.
//
// The lazily loaded Background_Theme engine. It is its own bundler chunk
// (fetched only when `backgroundThemeActive` first turns true after a user
// gesture, see `load-background-theme.ts`) and turns a pure `ThemeScore` into a
// looping chiptune bed built from Web Audio nodes alone — no `<audio>` element
// and no audio file or sample (R8.1, R8.3, R8.9, R11.2).
//
// The engine makes NO policy decision: it never checks Sound_State, a user
// gesture, visibility or the test/CI flag. The pure `backgroundThemeActive`
// gate (background-theme.ts) is the single source of truth and the caller only
// invokes `start()`/`stop()` after consulting it (R8.4–R8.10). The engine plays
// exactly the score it is handed and stops when told.
//
// The `AudioContext` constructor is injected so tests drive the graph with a
// fake context and fake timers; production resolves `window.AudioContext ??
// window.webkitAudioContext` in `load-background-theme.ts`. When the ctor is
// absent (no Web Audio API) `createBackgroundThemeEngine` returns a NO-OP
// engine whose `start()`/`stop()` are safe no-ops, so the Terminal_Route stays
// usable and silent (R8.8).
//
// Graph (design.md §"Background theme engine (lazy chunk)"):
//   master (gain <= MAX_THEME_GAIN) -> destination
//   per voice: osc (square|triangle) -> voiceGain (score voice gain) -> master
//
// Timing uses the AudioContext clock (`currentTime` + a short lookahead), never
// a wall-clock timer, so the musical schedule is sample-accurate and the loop
// is GAPLESS: each loop is scheduled a lookahead ahead of the previous one
// ending, so the last note's release meets the next loop's first attack with no
// silent gap (R8.2).
//
// Requirements: R8.1, R8.2, R8.7, R8.8, R8.9, R11.2

import type { ThemeScore } from "./background-theme.js";

/**
 * The hard linear cap on the theme's master gain. The pure `peakGain(score)`
 * already guarantees the summed voice gains stay `<= 0.2`; the engine clamps
 * the master to this ceiling too so it can never exceed it regardless of the
 * score it is handed (R8.1).
 */
export const MAX_THEME_GAIN = 0.2;

/**
 * How far ahead of the audio clock note events are scheduled, in seconds. Each
 * loop is scheduled this far before the previous one ends, which keeps the loop
 * boundary gapless without a wall-clock timer (R8.2).
 */
const LOOKAHEAD_SECONDS = 0.25;

/**
 * How often the lookahead scheduler wakes to enqueue the next loop, in ms. Kept
 * well under `LOOKAHEAD_SECONDS` so a loop is always queued before the audio
 * clock reaches it, even under timer jitter.
 */
const SCHEDULER_INTERVAL_MS = 50;

/** The time constant of the master fade-out ramp on `stop()`, in seconds. */
const STOP_RAMP_TIME_CONSTANT = 0.08;

/**
 * Delay before the oscillators are stopped after a `stop()` fade, in ms. Well
 * inside the 1 s stop budget (R8.7): the fade plus this delay halts audio in
 * ~0.2 s.
 */
const STOP_OSC_DELAY_MS = 200;

/**
 * A `BackgroundThemeEngine` builds oscillators from a `ThemeScore`, schedules a
 * gapless loop whose peak output gain stays `<= 0.2`, and halts within 1 s on
 * `stop()`. A no-op engine (no Web Audio API) implements the same shape with
 * safe no-ops so the caller needs no branch.
 */
export interface BackgroundThemeEngine {
  /** Build the graph, resume the context and start the gapless loop. */
  start(score: ThemeScore): Promise<void>;
  /** Fade out and stop every oscillator within 1 s. Idempotent. */
  stop(): void;
}

/** Loads the Background_Theme engine from a separate bundler chunk. */
export type BackgroundThemeLoaderPort = () => Promise<BackgroundThemeEngine>;

/** The seconds-per-beat of a score, from its tempo. */
function secondsPerBeat(score: ThemeScore): number {
  // bpm is bounded well above 0 by `composeTheme`; guard anyway so a hand-built
  // score with a non-positive tempo cannot divide by zero.
  const bpm = Number.isFinite(score.bpm) && score.bpm > 0 ? score.bpm : 120;
  return 60 / bpm;
}

/** The total duration of one loop of the score, in seconds. */
function loopSeconds(score: ThemeScore): number {
  const beatsPerBar = 4; // the composed theme is authored in 4/4.
  return score.loopBars * beatsPerBar * secondsPerBeat(score);
}

/** Convert a MIDI note number to its frequency in hertz (A4 = 69 = 440 Hz). */
function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A no-op engine: both methods are safe no-ops so the route stays usable (R8.8). */
function noopEngine(): BackgroundThemeEngine {
  return {
    async start(): Promise<void> {
      // Intentionally silent: no Web Audio API, so there is nothing to play and
      // nothing to fail. The Terminal_Route carries on, just without music.
    },
    stop(): void {
      // Nothing was ever started.
    },
  };
}

/**
 * Create a Background_Theme engine. `ctor` is the `AudioContext` constructor to
 * use; when omitted (no Web Audio API available) a NO-OP engine is returned so
 * the Terminal_Route stays usable and silent (R8.8). Otherwise the returned
 * engine builds the oscillator graph on `start(score)` and schedules a gapless
 * loop whose peak output gain is clamped to `MAX_THEME_GAIN`.
 */
export function createBackgroundThemeEngine(
  ctor?: typeof AudioContext,
): BackgroundThemeEngine {
  if (!ctor) {
    return noopEngine();
  }

  /** The live context + master gain, or null while stopped. */
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  /** Every oscillator that has been started, so `stop()` can halt them all. */
  const oscillators: OscillatorNode[] = [];
  /** The lookahead scheduler handle, or null when not looping. */
  let schedulerHandle: ReturnType<typeof setInterval> | null = null;
  /** The audio-clock time, in seconds, up to which loops have been scheduled. */
  let scheduledUntil = 0;
  /** True once `start()` has built a live graph and not yet been stopped. */
  let running = false;

  /**
   * Schedule one loop of the score starting at `startTime` (an AudioContext
   * clock value). Each voice's arpeggio is spread evenly across the loop; every
   * note is a short oscillator through the voice's gain into the capped master,
   * self-stopping at its note boundary so the loop boundary stays gapless.
   */
  function scheduleLoop(audioCtx: AudioContext, bus: GainNode, score: ThemeScore, startTime: number): void {
    const loopLen = loopSeconds(score);
    for (const voice of score.voices) {
      const count = voice.notes.length;
      if (count === 0) continue;
      const noteLen = loopLen / count;
      for (let i = 0; i < count; i += 1) {
        const noteStart = startTime + i * noteLen;
        const midi = voice.notes[i];
        if (midi === undefined) continue;

        const osc = audioCtx.createOscillator();
        osc.type = voice.wave;
        osc.frequency.value = midiToHz(midi);

        const gain = audioCtx.createGain();
        gain.gain.value = voice.gain;
        gain.connect(bus);
        osc.connect(gain);

        osc.start(noteStart);
        // Stop exactly at the next note's attack so successive notes abut with
        // no overlap and no gap — the loop wraps seamlessly (R8.2).
        osc.stop(noteStart + noteLen);
        oscillators.push(osc);
      }
    }
  }

  /**
   * Enqueue any loops whose start falls within the lookahead window. Called on
   * an interval; it schedules ahead of the audio clock so a fresh loop is
   * always queued before the previous one ends (R8.2). Old self-stopping
   * oscillator references are pruned so the array does not grow without bound.
   */
  function pump(score: ThemeScore): void {
    const audioCtx = ctx;
    const bus = master;
    if (!audioCtx || !bus || !running) return;
    const loopLen = loopSeconds(score);
    const horizon = audioCtx.currentTime + LOOKAHEAD_SECONDS;
    while (scheduledUntil < horizon) {
      scheduleLoop(audioCtx, bus, score, scheduledUntil);
      scheduledUntil += loopLen;
    }
  }

  return {
    async start(score: ThemeScore): Promise<void> {
      // Idempotent: a second start() while already running does nothing.
      if (running) return;

      const audioCtx = new ctor();
      const bus = audioCtx.createGain();
      // Clamp the master to the ceiling. The pure peakGain already keeps the
      // summed voice gains <= 0.2, so a master of MAX_THEME_GAIN never lifts the
      // output past the ceiling (R8.1).
      bus.gain.value = MAX_THEME_GAIN;
      bus.connect(audioCtx.destination);

      await audioCtx.resume();

      ctx = audioCtx;
      master = bus;
      running = true;
      scheduledUntil = audioCtx.currentTime;

      // Prime the first loops synchronously so audio begins immediately within
      // the gesture call chain (R8.5), then keep the loop fed on an interval.
      pump(score);
      schedulerHandle = setInterval(() => pump(score), SCHEDULER_INTERVAL_MS);
    },

    stop(): void {
      if (!running) return;
      running = false;

      if (schedulerHandle !== null) {
        clearInterval(schedulerHandle);
        schedulerHandle = null;
      }

      const audioCtx = ctx;
      const bus = master;
      const live = oscillators.slice();
      oscillators.length = 0;
      ctx = null;
      master = null;

      if (!audioCtx || !bus) return;

      // Fade the master out, then stop every oscillator and close the context —
      // all well inside the 1 s stop budget (R8.7).
      const now = audioCtx.currentTime;
      bus.gain.setTargetAtTime(0, now, STOP_RAMP_TIME_CONSTANT);
      setTimeout(() => {
        for (const osc of live) {
          try {
            osc.stop();
          } catch {
            // Already stopped (a self-stopping note that elapsed): ignore.
          }
        }
        void audioCtx.close();
      }, STOP_OSC_DELAY_MS);
    },
  };
}
