"use client";

// src/hooks/use-sound.ts
//
// Feature: 03-crt-terminal, task 17.2.
//
// `useSound` bridges the pure `SoundState` / `soundActivity` machine to the
// lazily-loaded Web Audio engine. It owns the imperative, browser-facing half
// of the sound feature; the decisions all come from the pure reducer.
//
// Responsibilities:
//   - Dispatch `gesture` exactly once, on the first keydown/pointerdown in the
//     terminal root (browsers require a user gesture before audio starts).
//   - Subscribe to the `VisibilityPort` and dispatch `hidden` / `visible`.
//   - Lazy-load the engine and call `start()` the first time the activity turns
//     active, in the same gesture call chain (R19.3), then follow every state
//     change with `engine.apply(soundActivity(state))` so the gain tracks the
//     pure activity (R19.5, R19.6).
//   - Call `engine.click()` on a printable keydown in the Command_Line only
//     when `soundActivity(state).click` is true (R19.6).
//   - On ANY rejection from loading or starting the engine, dispatch `sound_off`
//     and invoke the optional failure hook (the Terminal persists `sound off`
//     and appends the in-world "speakers are silent" message), never throwing
//     (R19.14).
//
// It reads neither the Motion_Mode nor the Live_Region (R19.11, R19.15): every
// effect here flows through the sound ports alone.
//
// _Requirements: R19.3, R19.5, R19.6, R19.8, R19.11, R19.14, R19.15_

import { useEffect, useRef, type RefObject } from "react";

import type { SoundLoaderPort, SoundEngine, VisibilityPort } from "../ports.js";
import {
  soundActivity,
  type SoundEvent,
  type SoundState,
} from "../sound/sound-reducer.js";

/** Inputs to the sound bridge. */
export interface UseSoundOptions {
  /** Lazily loads the Web Audio engine chunk. */
  readonly loader: SoundLoaderPort;
  /** Observes page visibility. */
  readonly visibility: VisibilityPort;
  /** The current pure sound state (preference, gesture, visibility). */
  readonly state: SoundState;
  /** Dispatches a sound event into the session. */
  readonly dispatch: (event: SoundEvent) => void;
  /** The terminal root; the gesture listener is attached here. */
  readonly rootRef: RefObject<HTMLElement | null>;
  /**
   * Invoked once when the engine cannot be loaded or started, after the hook
   * has already dispatched `sound_off`. The Terminal uses it to persist the
   * `off` preference and append the in-world failure message (R19.14).
   */
  readonly onEngineFailure?: (() => void) | undefined;
}

/** True for a single printable character keypress (not a modifier/navigation). */
function isPrintableKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1;
}

/**
 * Wire the lazy sound engine to the pure sound state. Returns nothing; every
 * effect is a side effect on the injected ports. Safe to call unconditionally.
 */
export function useSound(options: UseSoundOptions): void {
  const { loader, visibility, state, dispatch, rootRef, onEngineFailure } =
    options;

  // The loaded engine, and whether a load/start has been kicked off, survive
  // across renders. `failed` latches the fallback so it fires at most once.
  const engineRef = useRef<SoundEngine | null>(null);
  const loadingRef = useRef<boolean>(false);
  const failedRef = useRef<boolean>(false);

  // Keep the newest callbacks reachable from the long-lived listeners without
  // re-subscribing on every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const onFailureRef = useRef(onEngineFailure);
  onFailureRef.current = onEngineFailure;

  // ----- Gesture: dispatch once on the first keydown/pointerdown in root. ---
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    let fired = false;
    const onGesture = (): void => {
      if (fired) return;
      fired = true;
      dispatchRef.current({ type: "gesture" });
    };

    // Capture phase so the gesture is seen before any stopPropagation.
    root.addEventListener("keydown", onGesture, { capture: true });
    root.addEventListener("pointerdown", onGesture, { capture: true });
    return () => {
      root.removeEventListener("keydown", onGesture, { capture: true });
      root.removeEventListener("pointerdown", onGesture, { capture: true });
    };
  }, [rootRef]);

  // ----- Visibility: dispatch hidden/visible from the port. -----------------
  useEffect(() => {
    const unsubscribe = visibility.subscribe((visible) => {
      dispatchRef.current({ type: visible ? "visible" : "hidden" });
    });
    return unsubscribe;
  }, [visibility]);

  // ----- Click: a printable key in root clicks only when activity allows. ---
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPrintableKey(event)) return;
      if (!soundActivity(state).click) return;
      engineRef.current?.click();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef, state]);

  // ----- Engine lifecycle: load + start + apply following the activity. -----
  useEffect(() => {
    const activity = soundActivity(state);
    const wantEngine = activity.hum || activity.click;

    // Already have an engine: just follow the activity.
    if (engineRef.current !== null) {
      engineRef.current.apply(activity);
      return;
    }

    // Nothing wants the engine yet, or a failure has latched: do nothing.
    if (!wantEngine || loadingRef.current || failedRef.current) {
      return;
    }

    // First activation: lazily load, start, and apply — in this gesture chain.
    loadingRef.current = true;
    let cancelled = false;

    const fail = (): void => {
      if (failedRef.current) return;
      failedRef.current = true;
      dispatchRef.current({ type: "sound_off" });
      onFailureRef.current?.();
    };

    void (async () => {
      try {
        const engine = await loader();
        if (cancelled) return;
        await engine.start();
        if (cancelled) return;
        engineRef.current = engine;
        engine.apply(soundActivity(state));
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
  }, [loader, state]);
}
