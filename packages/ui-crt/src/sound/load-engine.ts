// src/sound/load-engine.ts
//
// Feature: 03-crt-terminal, task 16.2.
//
// The `SoundLoaderPort` production adapter. The `import("./engine.js")` target
// is a string literal, so the bundler emits the engine as its own chunk that
// is fetched only when this loader runs — i.e. on `sound on` after a user
// gesture, never at page load (R19.3, R19.17).
//
// The engine is created with the browser `AudioContext` (falling back to the
// legacy `webkitAudioContext`); when neither exists the constructor is
// undefined and `start()` rejects, driving the `sound_off` fallback (R19.14).
//
// Requirements: R19.3, R19.17

import type { SoundEngine, SoundLoaderPort } from "../ports.js";

/** Resolve the platform `AudioContext` constructor, if any. */
function resolveAudioContextCtor(): typeof AudioContext | undefined {
  const w = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Lazily import the engine chunk and construct an engine bound to the
 * platform `AudioContext`.
 */
export const loadEngine: SoundLoaderPort = async (): Promise<SoundEngine> => {
  const { createEngine } = await import("./engine.js");
  return createEngine(resolveAudioContextCtor());
};
