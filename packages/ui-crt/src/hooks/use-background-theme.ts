"use client";

// src/hooks/use-background-theme.ts
//
// Feature: arcana-visions, task 21.
//
// `useBackgroundTheme` is the imperative bridge between the pure
// `backgroundThemeActive` gate (sound/background-theme.ts) and the lazily
// loaded `BackgroundThemeEngine` (sound/background-theme-engine.ts). It is the
// exact parallel of `useSound`: the pure gate decides WHEN the theme may play,
// and this hook performs the lazy load + `start`/`stop` side effects, making no
// policy decision of its own.
//
// Responsibilities:
//   - Watch the pure `backgroundThemeActive(state, { isTest })` boolean. On the
//     transition to `true` — only ever after a user gesture, with sound on, the
//     document visible, and NOT in a test/CI run (all enforced by the gate) —
//     it lazily imports the engine chunk and calls `start(composeTheme(seed))`
//     within the same activation chain (R8.4, R8.5, R8.7).
//   - On the transition to `false` (sound off, document hidden, Web Audio
//     unavailable resolving to a no-op engine, or a test/CI run) it calls
//     `stop()` (R8.8).
//   - NEVER start before a user gesture, with sound off, or in a test/CI run:
//     the gate returns `false` in every one of those cases, so the engine is
//     never even loaded (R8.10). In unit tests / CI the theme must never start;
//     passing `isTest: true` (or simply not providing a loader) guarantees it.
//   - Swallow every load/start failure exactly like `useSound`: a rejected
//     chunk load or `start()` latches a failure flag so the hook never retries
//     and never throws; the Terminal_Route stays usable and silent (R8.8).
//
// It reads neither the Motion_Mode nor the Live_Region: the theme is a sound
// concern gated solely by `backgroundThemeActive`.
//
// _Requirements: R8.4, R8.5, R8.7, R8.8, R8.10_

import { useEffect, useRef } from "react";

import type { BackgroundThemeLoaderPort, BackgroundThemeEngine } from "../sound/background-theme-engine.js";
import {
  backgroundThemeActive,
  composeTheme,
} from "../sound/background-theme.js";
import type { SoundState } from "../sound/sound-reducer.js";

/** Inputs to the Background_Theme bridge. */
export interface UseBackgroundThemeOptions {
  /**
   * Lazily loads the Web Audio Background_Theme engine chunk. `undefined` means
   * no loader is wired (the default in `@necro/ui-crt` unit tests, and any host
   * that opts out), so the theme is never loaded and never plays — the safe
   * default that keeps CI silent (R8.10).
   */
  readonly loader?: BackgroundThemeLoaderPort | undefined;
  /** The current pure sound state (preference, gesture, visibility). */
  readonly state: SoundState;
  /**
   * The seed the theme is composed from. A stable constant for the live loop
   * (so the bed is identical across renders) or `DEMO_SEED` in demo mode for
   * determinism; `composeTheme(seed)` is pure and deterministic in the seed.
   */
  readonly seed: number;
  /**
   * Whether this is a test/CI run. When `true`, the pure gate
   * `backgroundThemeActive` is `false` for every state, so the engine is never
   * loaded and never started (R8.10). Omitted / `undefined` is treated as
   * `false` (a live browser run).
   */
  readonly isTest?: boolean | undefined;
}

/**
 * Wire the lazy Background_Theme engine to the pure `backgroundThemeActive`
 * gate. Returns nothing; every effect is a side effect on the injected loader.
 * Safe to call unconditionally — with no `loader` it is inert.
 *
 * The structure mirrors `useSound`: a long-lived `engineRef` holds the loaded
 * engine (no re-render on load), `loadingRef` guards against a double load in
 * the same activation chain, `failedRef` latches a load/start failure so the
 * hook never retries, and a cancelled guard drops a late async resolution.
 */
export function useBackgroundTheme(options: UseBackgroundThemeOptions): void {
  const { loader, state, seed, isTest } = options;

  // The loaded engine, and whether a load/start is in flight, survive across
  // renders. `failed` latches so a failure fallback happens at most once.
  const engineRef = useRef<BackgroundThemeEngine | null>(null);
  const loadingRef = useRef<boolean>(false);
  const failedRef = useRef<boolean>(false);

  // The seed is read inside the async start chain through a ref so a seed change
  // never re-subscribes the effect; the live loop keeps whatever seed was in
  // scope when it started (the host passes a stable seed).
  const seedRef = useRef(seed);
  seedRef.current = seed;

  // ----- Engine lifecycle: load + start on the gate's rise, stop on fall. ----
  //
  // The single source of truth is the pure gate. The engine is loaded ONLY the
  // first time the gate turns true (after a gesture, sound on, visible, and not
  // a test/CI run), so it can never start before the gesture or in tests — the
  // gate returns false in every one of those cases (R8.10, R8.4, R8.5).
  useEffect(() => {
    const active = backgroundThemeActive(state, { isTest: isTest ?? false });

    // Already have an engine: follow the gate — start on rise, stop on fall.
    const engine = engineRef.current;
    if (engine !== null) {
      if (active) {
        // Idempotent in the engine (a second start while running is a no-op).
        void engine.start(composeTheme(seedRef.current)).catch(() => {
          // A late start failure must never surface; the loop simply stays
          // silent (R8.8).
        });
      } else {
        engine.stop();
      }
      return;
    }

    // No engine yet. Only a live rise loads it; nothing to stop while inactive.
    if (!active || loadingRef.current || failedRef.current) {
      return;
    }

    // First activation: lazily load, then start — within this gesture chain.
    // With no loader wired the theme is simply never played (the safe default).
    if (loader === undefined) {
      return;
    }

    loadingRef.current = true;
    let cancelled = false;

    const fail = (): void => {
      // Latch so the hook never retries a broken chunk; the route stays usable
      // and silent (R8.8). No user-facing error — the theme is pure polish.
      failedRef.current = true;
    };

    void (async () => {
      try {
        const loaded = await loader();
        if (cancelled) return;
        await loaded.start(composeTheme(seedRef.current));
        if (cancelled) return;
        engineRef.current = loaded;
      } catch {
        if (cancelled) return;
        fail();
      } finally {
        loadingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loader, state, isTest]);

  // ----- Teardown: stop the engine when the hook unmounts. ------------------
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);
}
