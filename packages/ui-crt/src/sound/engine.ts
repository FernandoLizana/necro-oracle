// src/sound/engine.ts
//
// Feature: 03-crt-terminal, task 16.2.
//
// The lazily loaded Web Audio sound engine. It is its own bundler chunk
// (fetched only on `sound on`, see `load-engine.ts`) and builds the whole
// ambient-hum and keystroke-click graph with Web Audio nodes alone — no
// `<audio>` element and no file URL (R19.9).
//
// The `AudioContext` constructor is injected so tests can drive the graph with
// a fake context and fake timers; production passes `window.AudioContext`.
//
// Graph (design.md §"Sound engine (lazy chunk)"):
//   master (gain MASTER_GAIN) -> destination
//   hum:   osc 50 Hz + osc 100 Hz -> low-pass 200 Hz -> humGain (0.5) -> master
//   click: 12 ms mono noise buffer -> band-pass 2 kHz -> clickGain -> master
//
// Requirements: R19.3, R19.4, R19.9, R19.10, R19.17

import type { SoundEngine } from "../ports.js";
import type { SoundCue } from "./sound-cue.js";
import type { AudioGraph, EngineActivity } from "./engine-types.js";

/** The ambient master gain. Kept well below the perceptual ceiling (R19.10). */
export const MASTER_GAIN = 0.15;

/** The hard linear cap on the master gain (R19.10). */
export const MAX_MASTER_GAIN = 0.2;

/** Hum oscillator frequencies, in hertz. */
const HUM_FREQUENCIES: readonly [number, number] = [50, 100];

/** The low-pass cutoff shaping the hum, in hertz. */
const HUM_LOWPASS_HZ = 200;

/** The band-pass centre shaping the click, in hertz. */
const CLICK_BANDPASS_HZ = 2000;

/** The hum gain when audible. */
const HUM_GAIN = 0.5;

/** The click gain when audible. */
const CLICK_GAIN = 0.4;

/** The click noise burst length, in seconds. */
const CLICK_SECONDS = 0.012;

/** The time constant of the hum fade-out ramp, in seconds (R19.4). */
const HUM_RAMP_TIME_CONSTANT = 0.03;

/** Delay before the oscillators are stopped after a hum fade, in ms (R19.4). */
const OSC_STOP_DELAY_MS = 100;

/** Delay before the context is closed on release, in ms. */
const CLOSE_DELAY_MS = 150;

/**
 * The ambient Resurrection_Animation hum (visual-necromancy task 21.1). A low
 * continuous drone, one octave below the base CRT hum, played only WHILE the
 * rot-then-rebirth animation is actively playing and only when sound is on in
 * full motion (the caller gates this with `ambientHumActive`). It rides its own
 * oscillator + gain into the shared, capped master so it adds no node at rest
 * and never lifts the overall level past the R19.10 ceiling.
 */
const AMBIENT_FREQUENCY_HZ = 25;

/** The ambient drone's audible gain — below the base hum so it only underlays it. */
const AMBIENT_GAIN = 0.3;

/** The time constant of the ambient fade in/out ramp, in seconds. */
const AMBIENT_RAMP_TIME_CONSTANT = 0.08;

/** Delay before the ambient oscillator is stopped after a fade-out, in ms. */
const AMBIENT_STOP_DELAY_MS = 200;

/** The peak gain of a one-shot cue envelope, routed through clickGain. */
const CUE_PEAK_GAIN = 0.5;

/** The one-shot cue envelope length, in seconds (a short blip, no sustain). */
const CUE_SECONDS = 0.14;

/**
 * The lead frequency of each cue's one-shot tone, in hertz. The cues are
 * audibly distinct one-shots built from the same oscillator path — no file and
 * no new dependency. Boot completion is a low confirming tone, the card reveal
 * a mid chime, the glitch a harsh high buzz, the rebirth a rising-register
 * swell anchored higher than reveal, and the `summon` a warm mid-low toll that
 * sits below the reveal chime so the spread-drawn moment reads as its own note
 * rather than a card flip (visual-necromancy task 21.4).
 */
const CUE_FREQUENCIES: Readonly<Record<SoundCue, number>> = {
  boot: 220,
  reveal: 523,
  glitch: 1200,
  rebirth: 659,
  summon: 392,
};

/** The oscillator shape per cue; the glitch uses a harsher square wave. */
const CUE_WAVEFORMS: Readonly<Record<SoundCue, OscillatorType>> = {
  boot: "sine",
  reveal: "triangle",
  glitch: "square",
  rebirth: "sine",
  summon: "triangle",
};

/**
 * Create a sound engine. `ctor` is the `AudioContext` constructor to use; when
 * omitted (no Web Audio API available) `start()` rejects, which drives the
 * `sound_off` fallback in `use-sound` (R19.14).
 */
export function createEngine(ctor?: typeof AudioContext): SoundEngine {
  let graph: AudioGraph | null = null;
  /** True once the hum oscillators are running and not yet stopped. */
  let humRunning = false;
  /**
   * The live ambient-hum layer (visual-necromancy task 21.1), lazily built the
   * first time `ambient(true)` fires so the engine adds no ambient node at rest.
   * `null` whenever the drone is not running; its oscillator self-stops and the
   * reference is dropped on fade-out so a later resurrection builds a fresh one.
   */
  let ambientLayer: { readonly osc: OscillatorNode; readonly gain: GainNode } | null = null;

  function buildGraph(ctx: AudioContext): AudioGraph {
    // master -> destination, clamped to the R19.10 ceiling.
    const master = ctx.createGain();
    master.gain.value = Math.min(MASTER_GAIN, MAX_MASTER_GAIN);
    master.connect(ctx.destination);

    // Hum: two sine oscillators -> low-pass -> humGain -> master.
    const humGain = ctx.createGain();
    humGain.gain.value = HUM_GAIN;
    humGain.connect(master);

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = HUM_LOWPASS_HZ;
    lowPass.connect(humGain);

    const oscillators = HUM_FREQUENCIES.map((hz) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      osc.connect(lowPass);
      return osc;
    });

    // Click: 12 ms mono noise -> band-pass -> clickGain -> master.
    const clickGain = ctx.createGain();
    clickGain.gain.value = CLICK_GAIN;
    clickGain.connect(master);

    const bandPass = ctx.createBiquadFilter();
    bandPass.type = "bandpass";
    bandPass.frequency.value = CLICK_BANDPASS_HZ;
    bandPass.connect(clickGain);

    const clickBuffer = buildClickBuffer(ctx);

    return { ctx, master, humGain, clickGain, oscillators, clickBuffer };
  }

  /** A 12 ms mono noise buffer with exponential decay, generated in code. */
  function buildClickBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.round(CLICK_SECONDS * ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const decay = Math.exp((-8 * i) / length);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
  }

  function startHum(g: AudioGraph): void {
    const now = g.ctx.currentTime;
    g.humGain.gain.setTargetAtTime(HUM_GAIN, now, HUM_RAMP_TIME_CONSTANT);
    humRunning = true;
  }

  function stopHum(g: AudioGraph): void {
    const now = g.ctx.currentTime;
    g.humGain.gain.setTargetAtTime(0, now, HUM_RAMP_TIME_CONSTANT);
    if (humRunning) {
      const oscillators = g.oscillators;
      setTimeout(() => {
        for (const osc of oscillators) {
          osc.stop();
        }
      }, OSC_STOP_DELAY_MS);
      humRunning = false;
    }
  }

  /**
   * Fade the ambient Resurrection_Animation drone in. Builds the layer lazily —
   * a single low oscillator through its own gain into the shared master — so
   * nothing exists at rest and the drone rides under the capped master gain.
   */
  function startAmbient(g: AudioGraph): void {
    if (ambientLayer !== null) return;
    const now = g.ctx.currentTime;
    const gain = g.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(g.master);

    const osc = g.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = AMBIENT_FREQUENCY_HZ;
    osc.connect(gain);
    osc.start();

    gain.gain.setTargetAtTime(AMBIENT_GAIN, now, AMBIENT_RAMP_TIME_CONSTANT);
    ambientLayer = { osc, gain };
  }

  /**
   * Fade the ambient drone out and stop its oscillator shortly after, dropping
   * the layer so the next resurrection builds a fresh one. A no-op when the
   * drone is not running, so repeated `ambient(false)` calls are harmless.
   */
  function stopAmbient(g: AudioGraph): void {
    const layer = ambientLayer;
    if (layer === null) return;
    ambientLayer = null;
    const now = g.ctx.currentTime;
    layer.gain.gain.setTargetAtTime(0, now, AMBIENT_RAMP_TIME_CONSTANT);
    setTimeout(() => {
      layer.osc.stop();
    }, AMBIENT_STOP_DELAY_MS);
  }

  return {
    async start(): Promise<void> {
      if (!ctor) {
        throw new Error("Web Audio API is unavailable");
      }
      const ctx = new ctor();
      // Building the graph may throw if any node constructor fails; let it
      // reject the start() promise (R19.14).
      const built = buildGraph(ctx);
      for (const osc of built.oscillators) {
        osc.start();
      }
      humRunning = true;
      await ctx.resume();
      if (ctx.state === "suspended" || ctx.state === "closed") {
        throw new Error(`AudioContext failed to start: ${ctx.state}`);
      }
      graph = built;
    },

    apply(activity: EngineActivity): void {
      const g = graph;
      if (!g) return;
      if (activity.hum) {
        startHum(g);
      } else {
        stopHum(g);
      }
    },

    click(): void {
      const g = graph;
      if (!g) return;
      const ctx = g.ctx;
      const source = ctx.createBufferSource();
      source.buffer = g.clickBuffer;
      const bandPass = ctx.createBiquadFilter();
      bandPass.type = "bandpass";
      bandPass.frequency.value = CLICK_BANDPASS_HZ;
      source.connect(bandPass);
      bandPass.connect(g.clickGain);
      source.start();
    },

    ambient(on: boolean): void {
      const g = graph;
      if (!g) return;
      if (on) {
        startAmbient(g);
      } else {
        stopAmbient(g);
      }
    },

    cue(name: SoundCue): void {
      const g = graph;
      if (!g) return;
      const ctx = g.ctx;
      const now = ctx.currentTime;

      // A one-shot oscillator through its own short envelope into clickGain —
      // the same one-shot path the Click uses, so cues add no new graph nodes
      // at rest and ride under the capped master gain (R19.10). The envelope
      // self-stops, so nothing lingers after the blip.
      const osc = ctx.createOscillator();
      osc.type = CUE_WAVEFORMS[name];
      osc.frequency.value = CUE_FREQUENCIES[name];

      const env = ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(CUE_PEAK_GAIN, now + CUE_SECONDS * 0.25);
      env.gain.setTargetAtTime(0, now + CUE_SECONDS * 0.25, CUE_SECONDS * 0.3);

      osc.connect(env);
      env.connect(g.clickGain);
      osc.start(now);
      osc.stop(now + CUE_SECONDS);
    },

    release(): void {
      const g = graph;
      if (!g) return;
      stopHum(g);
      stopAmbient(g);
      const ctx = g.ctx;
      setTimeout(() => {
        void ctx.close();
      }, CLOSE_DELAY_MS);
      graph = null;
    },
  };
}
