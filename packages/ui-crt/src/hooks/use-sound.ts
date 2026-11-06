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

import { useEffect, useRef, useState, type RefObject } from "react";

import type { SoundLoaderPort, SoundEngine, VisibilityPort } from "../ports.js";
import {
  soundActivity,
  type SoundEvent,
  type SoundState,
} from "../sound/sound-reducer.js";
import { soundCueAllowed, type SoundCue } from "../sound/sound-cue.js";

/**
 * A single Visual_Layer cue request (task 15.1). The Terminal bumps `seq` each
 * time a boot completion, card reveal, glitch, or rebirth should play a cue;
 * the hook plays `name` through the engine once per new `seq`, but only while
 * `soundCueAllowed(state)` holds. `null` means no cue has been requested yet.
 */
export interface SoundCueRequest {
  readonly seq: number;
  readonly name: SoundCue;
}

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
  /**
   * The latest Visual_Layer cue request (task 15.1). When its `seq` advances
   * and `soundCueAllowed(state)` holds, the hook plays the cue through the
   * engine as a one-shot — the same gesture-gated, default-off, off-while-off
   * path the Click uses (R8.1-R8.5). `null` or an unchanged `seq` plays
   * nothing. Sound and motion are independent here: the cue fires whenever
   * sound resolves on, including in reduced motion (R8.5).
   */
  readonly cueRequest?: SoundCueRequest | null | undefined;
  /**
   * Whether the ambient Resurrection_Animation hum should be playing right now
   * (visual-necromancy task 21.1, OPTIONAL polish). The Terminal computes this
   * with `ambientHumActive(...)` — true only when sound resolves on, the
   * Motion_Mode is `full`, and the rot-then-rebirth animation is actively
   * playing. The hook follows the flag through the already-loaded engine's
   * `ambient(on)`: it never loads the engine on its own (so the drone stays
   * default-off and never fires before the gesture), and it fades the drone out
   * when the flag drops — at rebirth, on `sound off`, when hidden, or in reduced
   * motion. `undefined` is treated as `false` (no hum). (R13.1, R13.4)
   */
  readonly ambient?: boolean | undefined;
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
  const {
    loader,
    visibility,
    state,
    dispatch,
    rootRef,
    onEngineFailure,
    cueRequest,
    ambient,
  } = options;

  // The loaded engine, and whether a load/start has been kicked off, survive
  // across renders. `failed` latches the fallback so it fires at most once.
  const engineRef = useRef<SoundEngine | null>(null);
  const loadingRef = useRef<boolean>(false);
  const failedRef = useRef<boolean>(false);
  // A render-visible flag that flips true once the lazy engine is live. The
  // engine itself lives in a ref (no re-render on load), so the ambient-hum
  // effect depends on this flag to re-check its gated intent the moment the
  // engine becomes available — otherwise a drone requested during the same
  // commit that first loads the engine would never start (task 21.1).
  const [engineReady, setEngineReady] = useState<boolean>(false);
  // The `seq` of the last cue request already played, so each request plays at
  // most once (task 15.1). `null` until the first cue is honoured.
  const lastCueSeqRef = useRef<number | null>(null);

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
        // Signal the ambient-hum effect that the engine is now live so it can
        // apply any already-requested, still-gated drone intent (task 21.1).
        setEngineReady(true);
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

  // ----- Cues: play one one-shot per new request, only when sound is on. ----
  //
  // The gate is the pure `soundCueAllowed(state)` — identical to the Click
  // condition — so a cue honours every Sound_State rule without this effect
  // knowing them: off by default (R8.4), never before the gesture and never
  // autoplay (R8.3), silent while off (R8.2). The gate reads no Motion_Mode, so
  // a cue fires in reduced motion whenever sound is on (R8.5). The cue rides
  // the engine the activity effect already loaded when sound turned on; if no
  // engine is live (sound off, so the gate is false anyway) nothing plays.
  useEffect(() => {
    if (cueRequest === null || cueRequest === undefined) return;
    // Already honoured this request: do not replay it on an unrelated rerender.
    if (lastCueSeqRef.current === cueRequest.seq) return;
    if (!soundCueAllowed(state)) {
      // Sound is off / no gesture / hidden: swallow the request so a later
      // `sound on` never retroactively fires this stale cue (R8.2, R8.3).
      lastCueSeqRef.current = cueRequest.seq;
      return;
    }
    lastCueSeqRef.current = cueRequest.seq;
    engineRef.current?.cue(cueRequest.name);
  }, [cueRequest, state]);

  // ----- Ambient hum: follow the gated flag through the live engine. --------
  //
  // The ambient Resurrection_Animation drone (visual-necromancy task 21.1) is a
  // default-off, gesture-gated, full-motion-only flourish. The Terminal has
  // already resolved every rule in the pure `ambientHumActive(...)` gate, so
  // this effect only forwards the resulting boolean to `engine.ambient(on)`.
  //
  // It never loads or starts the engine: it rides whatever engine the activity
  // effect brought up when sound turned on. While sound is off no engine is
  // live (and the gate would be false anyway), so `want` is false and nothing
  // plays — the drone cannot fire before the gesture or autoplay (R13.1). When
  // the flag drops (rebirth done, `sound off`, hidden, or reduced motion) the
  // hook fades the drone out. The last-applied value guards against redundant
  // calls on unrelated rerenders.
  const lastAmbientRef = useRef<boolean>(false);
  useEffect(() => {
    const want = ambient === true;
    const engine = engineRef.current;
    if (engine === null) {
      // No live engine (sound off / not yet loaded): there is nothing to drive,
      // and the gate guarantees `want` is only true once sound is on. Remember
      // the intent as "off" so a later engine does not inherit a stale on.
      lastAmbientRef.current = false;
      return;
    }
    if (lastAmbientRef.current === want) return;
    lastAmbientRef.current = want;
    engine.ambient(want);
  }, [ambient, state, engineReady]);
}
