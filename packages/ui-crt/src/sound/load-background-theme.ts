// src/sound/load-background-theme.ts
//
// Feature: arcana-visions, task 8.
//
// The `BackgroundThemeLoaderPort` production adapter. The
// `import("./background-theme-engine.js")` target is a STRING LITERAL, so the
// bundler emits the synthesis engine as its own chunk fetched only when this
// loader runs — i.e. the first time `backgroundThemeActive` turns true after a
// user gesture, never in the first Terminal_Route render (R8.9, R11.2). This
// mirrors `load-engine.ts` and keeps the dynamic import a literal so it passes
// the `boundary.guard.test.ts` lazy-chunk guard.
//
// The engine is created with the browser `AudioContext` (falling back to the
// legacy `webkitAudioContext`); when neither exists the constructor is
// undefined and `createBackgroundThemeEngine` returns a NO-OP engine, so the
// Terminal_Route stays usable and silent (R8.8).
//
// Requirements: R8.8, R8.9, R11.2

import type {
  BackgroundThemeEngine,
  BackgroundThemeLoaderPort,
} from "./background-theme-engine.js";

/** Resolve the platform `AudioContext` constructor, if any. */
function resolveAudioContextCtor(): typeof AudioContext | undefined {
  const w = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Lazily import the Background_Theme engine chunk and construct an engine bound
 * to the platform `AudioContext`. Resolves to a no-op engine when Web Audio is
 * unavailable (R8.8).
 */
export const loadBackgroundTheme: BackgroundThemeLoaderPort =
  async (): Promise<BackgroundThemeEngine> => {
    const { createBackgroundThemeEngine } = await import("./background-theme-engine.js");
    return createBackgroundThemeEngine(resolveAudioContextCtor());
  };
