"use client";

// src/hooks/use-terminal.ts
//
// Feature: 03-crt-terminal, task 17.2.
//
// `useTerminal` is the one adapter that turns the pure session reducer (`step`)
// into a live terminal: it holds the `SessionState`, performs the `Effect`
// descriptors the reducer returns against the injected `TerminalPorts`, and
// wires the three browser hooks (`useMotion`, `useReveal`, `useSound`).
//
// The reducer stays pure; EVERY side effect — the readings API (streamed),
// aborts, the demo bundle, preference persistence (through a key-restricted
// wrapper, R1.6), the sound engine and input focus — happens here, inside the
// `dispatch` call chain, never during render. Async effects dispatch follow-up
// actions (`api.summoned`, `api.progress`, `api.read`, `api.failed`,
// `demo.loaded`, `demo.failed`) that the reducer matches against the in-flight
// request id, so a late answer after an abort is ignored.
//
// _Requirements: R1.6, R3.1-R3.12, R6.*, R10.*, R15.*, R16.9, R18.*, R19.*_

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { TerminalPorts } from "../ports.js";
import type { Action, Effect, SessionState } from "../session/state.js";
import { initialState } from "../session/state.js";
import { step } from "../session/reducer.js";
import { historyNext, historyPrev } from "../session/history.js";
import {
  MOTION_STORAGE_KEY,
  SOUND_STORAGE_KEY,
  parseMotionPreference,
  parseSoundPreference,
} from "../prefs/prefs.js";
import { useMotion } from "./use-motion.js";
import { useReveal } from "./use-reveal.js";
import { useBoot } from "./use-boot.js";
import { useSound, type SoundCueRequest } from "./use-sound.js";
import { ambientHumActive } from "../sound/ambient-hum.js";
import type { SoundEvent } from "../sound/sound-reducer.js";
import type { SoundCue } from "../sound/sound-cue.js";
import type { NecroErrorCode } from "@necro/oracle/client";
import { blockText } from "../render/blocks.js";
import { revealedChars } from "../motion/reveal.js";
import {
  bootFrame,
  bootFrameKind,
  type BootFrame,
  type BootFrameKind,
} from "../render/boot.js";
import { resolveSeed } from "../session/demo-seed.js";
import { currentVisualReading } from "../session/visual-reading.js";

/** The surface the Terminal view consumes. */
export interface TerminalController {
  /** The current pure session state. */
  readonly state: SessionState;
  /** Whether the Live_Region should report `aria-busy` (one tick after inflight). */
  readonly ariaBusy: boolean;
  /** The ref for the terminal root (`main.crt`); the gesture listener binds here. */
  readonly rootRef: RefObject<HTMLElement | null>;
  /** The ref for the Live_Region (`role="log"`); auto-scroll targets it. */
  readonly logRef: RefObject<HTMLDivElement | null>;
  /** The ref for the Command_Line input. */
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Submit the current entry (Enter or a button). */
  readonly submit: (raw: string, source: "enter" | "button") => void;
  /** Key handler for the Command_Line. */
  readonly onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Prefill the input with `summon ` and focus it (the SUMMON button). */
  readonly prefillSummon: () => void;
  /** Toggle sound from the SOUND button (counts as a gesture). */
  readonly toggleSound: () => void;
  /**
   * Download the last completed Ritual's unified Patch (the DOWNLOAD PATCH
   * affordance, R7.3). A no-op when no Ritual with a non-empty patch is in
   * scope; the view shows the control only while `state.lastRitual` carries a
   * patch, so this performs the client-side download when clicked.
   */
  readonly downloadPatch: () => void;
  /**
   * How many characters of the block with the given id are revealed right now,
   * or `null` when the block is not animating (show the full text).
   */
  readonly revealedCountFor: (blockId: number, fullLength: number) => number | null;
  /**
   * Set once the sound engine could not be loaded or started, so the Terminal
   * renders the in-world "speakers are silent" notice exactly once (R19.14).
   */
  readonly engineFailed: boolean;
  /**
   * The Boot_Sequence frame the overlay should draw right now, derived purely
   * from `state.boot.stepIndex` (visual-necromancy task 16.1). The overlay
   * itself only renders while `state.boot.phase === "playing"`.
   */
  readonly bootFrameForRender: BootFrame;
  /**
   * Which kind of boot frame is on screen right now (`memory` | `logo` |
   * `warmup` | `ready`), derived purely from `state.boot.stepIndex`. The
   * overlay exposes it as `data-boot-frame` so a screenshot or test can wait
   * for the logo frame specifically.
   */
  readonly bootFrameKindForRender: BootFrameKind;
  /**
   * The seed the Visual_Layer feeds to the Glitch_Effect corruption and the
   * Rot_Transform — `DEMO_SEED` in demo mode, a deterministic per-reading /
   * per-ritual seed otherwise (`resolveSeed`, visual-necromancy task 13.1).
   */
  readonly visualSeed: number;
}

/** The fixed in-world message shown when the sound engine is unavailable (R19.14). */
export const SOUND_UNAVAILABLE_MESSAGE =
  "The old speakers are silent. Sound is unavailable here.";

/** The storage key each `prefs.save` effect maps to (R1.6: only these two). */
const PREFS_KEY: Readonly<Record<"motion" | "sound", string>> = {
  motion: MOTION_STORAGE_KEY,
  sound: SOUND_STORAGE_KEY,
};

/** Optional knobs for `useTerminal` (all default to the full-boot behaviour). */
export interface UseTerminalOptions {
  /**
   * The external Boot_Skip signal the one-time `boot` action carries. When
   * `true`, the reducer starts the Boot_Sequence already settled to
   * `phase: "done"` (no overlay, no frames) while the BOOT_PHRASE still leads
   * the Output_Log (R1.5, R12.5). The host app wires this from the `?boot=skip`
   * query flag (visual-necromancy task 16.2). Omitted / `undefined` / `false`
   * plays the full deterministic boot.
   */
  readonly bootSignal?: boolean | undefined;
  /**
   * Whether the decorative Resurrection_Animation (rot-then-rebirth) is
   * actively playing right now (visual-necromancy task 21.1, OPTIONAL polish).
   * The `RotOverlay` owns the rot playback (`useRot`) and reports its live
   * playing state up through `Terminal.tsx`, which forwards it here so the
   * ambient-hum gate can follow the single source of truth without a second
   * frame loop. Combined with the pure `ambientHumActive(...)` gate (sound on +
   * full motion + playing), this drives the low continuous drone through
   * `useSound`. Omitted / `undefined` / `false` means no resurrection is
   * animating, so the hum stays silent. (R13.1, R13.4)
   */
  readonly resurrectionPlaying?: boolean | undefined;
}

/** Drive the whole terminal from the injected ports. */
export function useTerminal(
  ports: TerminalPorts,
  options: UseTerminalOptions = {},
): TerminalController {
  // Capture the boot signal once per mount: the one-time `boot` action reads it
  // in the mount effect below, so a later prop change must not re-seed the boot
  // (the boot runs exactly once for a terminal instance).
  const bootSignalRef = useRef(options.bootSignal ?? false);
  const [state, setState] = useState<SessionState>(initialState);
  const [ariaBusy, setAriaBusy] = useState(false);
  const [revealClock, setRevealClock] = useState<number | null>(null);
  const [engineFailed, setEngineFailed] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const rootRef = useRef<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The AbortController backing the single in-flight request (R3.6, R3.11).
  const abortRef = useRef<AbortController | null>(null);

  const { prefersReduced } = useMotion(ports.media);

  // -------------------------------------------------------------------------
  // Effect performer — runs a single reducer Effect against the ports.
  // -------------------------------------------------------------------------
  const performEffect = useCallback(
    (effect: Effect): void => {
      switch (effect.type) {
        case "focus":
          // Defer so the input exists and is not stolen by the current event.
          queueMicrotask(() => inputRef.current?.focus());
          return;

        case "prefs.save": {
          // Key-restricted wrapper: only the two allowed preference keys ever
          // reach storage, never the log or a repo reference (R1.6).
          const key = PREFS_KEY[effect.key];
          ports.storage.set(key, effect.value);
          return;
        }

        case "api.summon": {
          const controller = new AbortController();
          abortRef.current = controller;
          const { requestId } = effect;
          void ports.api
            .summon(effect.repo, controller.signal)
            .then((summary) => {
              dispatchRef.current({ type: "api.summoned", requestId, summary });
            })
            .catch((error) => {
              dispatchRef.current({
                type: "api.failed",
                requestId,
                error: toErrorEnvelope(error),
              });
            });
          return;
        }

        case "api.read": {
          const controller = new AbortController();
          abortRef.current = controller;
          const { requestId } = effect;
          void ports.api
            .read(effect.pinned, effect.spread, controller.signal, (event) => {
              dispatchRef.current({ type: "api.progress", requestId, event });
            })
            .then((response) => {
              dispatchRef.current({ type: "api.read", requestId, response });
            })
            .catch((error) => {
              dispatchRef.current({
                type: "api.failed",
                requestId,
                error: toErrorEnvelope(error),
              });
            });
          return;
        }

        case "api.resurrect": {
          const controller = new AbortController();
          abortRef.current = controller;
          const { requestId } = effect;
          void ports.api
            .resurrect(
              effect.pinned,
              effect.target,
              effect.spread,
              controller.signal,
              (event) => {
                dispatchRef.current({
                  type: "api.resurrect.progress",
                  requestId,
                  event,
                });
              },
            )
            .then((result) => {
              dispatchRef.current({
                type: "api.resurrect.resolved",
                requestId,
                result,
              });
            })
            .catch((error) => {
              dispatchRef.current({
                type: "api.failed",
                requestId,
                error: toErrorEnvelope(error),
              });
            });
          return;
        }

        case "api.abort":
          abortRef.current?.abort();
          abortRef.current = null;
          return;

        case "patch.download":
          // The settled Ritual's unified diff is turned into a client-side
          // `.patch` download with no server round-trip (R7.3). The DOM/URL work
          // lives behind the injected `patchDownload` port so the heavy helper
          // stays in its own lazy chunk and merely performing this effect never
          // eagerly loads it (R14.5). An empty patch is a no-op in the port.
          void ports.patchDownload(effect.patch, effect.ritualId);
          return;

        case "demo.load": {
          const { requestId } = effect;
          void ports.demo
            .load()
            .then((bundle) => {
              dispatchRef.current({ type: "demo.loaded", requestId, bundle });
            })
            .catch(() => {
              dispatchRef.current({ type: "demo.failed", requestId });
            });
          return;
        }

        // Sound effects are owned by `useSound`'s engine lifecycle; the reducer
        // still emits them, but the engine follows `soundActivity(state)` in the
        // hook, so there is nothing imperative to do here.
        case "sound.start":
        case "sound.release":
        case "sound.apply":
          return;
      }
    },
    [ports],
  );

  // -------------------------------------------------------------------------
  // dispatch — step the reducer, commit, then perform the effects.
  // -------------------------------------------------------------------------
  const dispatch = useCallback(
    (action: Action): void => {
      const { state: next, effects } = step(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      for (const effect of effects) performEffect(effect);
    },
    [performEffect],
  );

  // A stable ref so the long-lived async callbacks always see the latest dispatch.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // -------------------------------------------------------------------------
  // Boot: once, after mount, seed from storage + media + visibility.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const motionPreference = parseMotionPreference(
      ports.storage.get(MOTION_STORAGE_KEY),
    );
    const soundPreference = parseSoundPreference(
      ports.storage.get(SOUND_STORAGE_KEY),
    );
    dispatchRef.current({
      type: "boot",
      motionPreference,
      soundPreference,
      prefersReduced: ports.media.prefersReducedMotion(),
      visible: ports.visibility.visible(),
      // The host app wires the real `?boot=skip` flag through the
      // `bootSignal` option (visual-necromancy task 16.2); when it is omitted
      // the signal is `false` and the full deterministic boot plays.
      bootSignal: bootSignalRef.current,
    });
    // Boot runs exactly once for this terminal instance; the ports are stable
    // for the life of the component, so an empty dependency list is correct.
  }, []);

  // -------------------------------------------------------------------------
  // Motion: feed system reduced-motion changes into the reducer (R10.6).
  // -------------------------------------------------------------------------
  useEffect(() => {
    dispatchRef.current({ type: "media", prefersReduced });
  }, [prefersReduced]);

  // -------------------------------------------------------------------------
  // aria-busy mirrors inflight, applied one tick after the commit (Q12).
  // -------------------------------------------------------------------------
  useEffect(() => {
    setAriaBusy(state.inflight !== null);
  }, [state.inflight]);

  // -------------------------------------------------------------------------
  // Reveal: only loop while a block is still animating in full motion (R16.9).
  // -------------------------------------------------------------------------
  const pendingReveal = computePendingReveal(state, revealClock);
  const onTick = useCallback((nowMs: number) => {
    setRevealClock(nowMs);
    dispatchRef.current({ type: "reveal.tick", nowMs });
  }, []);
  useReveal({
    frames: ports.frames,
    motionMode: state.motionMode,
    pending: pendingReveal,
    onTick,
  });

  // -------------------------------------------------------------------------
  // Boot: drive the one-time Boot_Sequence overlay (visual-necromancy 16.1).
  //
  // `useBoot` mirrors `useReveal`: it requests FramePort frames ONLY while the
  // Motion_Mode is `full` AND the boot is still `playing`; each tick becomes a
  // `boot.tick` action so the pure reducer advances the step and settles the
  // phase to `"done"` at the last step (R1.1). A non-modifier key skips the
  // boot (`boot.skip`) and focuses the Command_Line (R1.3, R1.9). When no
  // FramePort is available to animate, it forces the phase done so the terminal
  // still reaches the ready state (R1.9). Reduced motion / `bootSignal` already
  // start `phase: "done"`, so nothing is scheduled there.
  // -------------------------------------------------------------------------
  const onBootTick = useCallback((nowMs: number) => {
    dispatchRef.current({ type: "boot.tick", nowMs });
  }, []);
  const onBootSkip = useCallback(() => {
    dispatchRef.current({ type: "boot.skip" });
    queueMicrotask(() => inputRef.current?.focus());
  }, []);
  const onBootUnavailable = useCallback(() => {
    dispatchRef.current({ type: "boot.skip" });
  }, []);
  // The boot action runs in a mount effect after the first paint; until it has
  // seeded the real Motion_Mode and phase (`boot.seen`), the initial state
  // still carries the `initialState()` defaults (`motionMode: "full"`,
  // `phase: "playing"`). Treat the boot as not-yet-playing during that first
  // render so no stray frame is scheduled before reduced motion / `bootSignal`
  // is known — mirrors how `useReveal` never animates an empty queue (R16.9).
  const bootPhaseForHook = state.boot.seen ? state.boot.phase : "done";
  useBoot({
    frames: ports.frames,
    motionMode: state.motionMode,
    bootPhase: bootPhaseForHook,
    onTick: onBootTick,
    onSkip: onBootSkip,
    onUnavailable: onBootUnavailable,
    rootRef,
  });

  // -------------------------------------------------------------------------
  // Sound: wire the lazy engine to the pure sound state.
  // -------------------------------------------------------------------------
  const soundDispatch = useCallback((event: SoundEvent) => {
    dispatchRef.current({ type: "sound", event });
  }, []);
  const onEngineFailure = useCallback(() => {
    // Persist the forced-off preference and show the in-world notice once. The
    // notice is rendered by the Terminal (the pure reducer has no block-append
    // action for sound, which by design changes only its own region), so it is
    // added to the Live_Region a single time (R19.14).
    ports.storage.set(SOUND_STORAGE_KEY, "off");
    setEngineFailed(true);
  }, [ports]);

  // -------------------------------------------------------------------------
  // Sound cues (visual-necromancy, task 15.1): the four core Visual_Layer
  // one-shots — boot completion, card reveal, glitch, resurrection rebirth.
  //
  // Each cue is derived from an observable session-state transition so it fires
  // exactly once per event, with no new Action or Effect (design §7). The
  // playback gate lives wholly in `useSound` (`soundCueAllowed(state.sound)`):
  // cues stay off by default, never autoplay, never fire before the gesture,
  // and stay silent while sound is off, independent of the Motion_Mode. Here we
  // only decide WHICH event occurred; the hook decides whether it may be heard.
  // -------------------------------------------------------------------------
  const cueSeqRef = useRef(0);
  const [cueRequest, setCueRequest] = useState<SoundCueRequest | null>(null);
  const requestCue = useCallback((name: SoundCue): void => {
    cueSeqRef.current += 1;
    setCueRequest({ seq: cueSeqRef.current, name });
  }, []);
  const prevBootPhaseRef = useRef(state.boot.phase);
  const prevFlippedRef = useRef(state.cardReveal.flippedCount);
  const prevGlitchFlippedRef = useRef(state.cardReveal.flippedCount);
  const prevRitualRef = useRef(state.lastRitual);
  const prevReadingRef = useRef(currentVisualReading(state));

  useEffect(() => {
    // Boot completion: the overlay's phase settles to "done" (R8.1).
    if (prevBootPhaseRef.current !== "done" && state.boot.phase === "done") {
      requestCue("boot");
    }
    prevBootPhaseRef.current = state.boot.phase;
  }, [state.boot.phase, requestCue]);

  useEffect(() => {
    // Card reveal: one cue each time another card finishes flipping face-up.
    // The glitch cue rides the same reveal (severity-driven glitch is applied
    // as a card is revealed, design §5); card-level glitch intensity is a
    // presentational concern the card view owns (task 16.1), so at this seam a
    // reveal of a new card also plays the glitch cue once.
    const flipped = state.cardReveal.flippedCount;
    if (flipped > prevFlippedRef.current) {
      requestCue("reveal");
    }
    prevFlippedRef.current = flipped;
    if (flipped > prevGlitchFlippedRef.current) {
      requestCue("glitch");
    }
    prevGlitchFlippedRef.current = flipped;
  }, [state.cardReveal.flippedCount, requestCue]);

  useEffect(() => {
    // Resurrection rebirth: a freshly settled ritual result marks the rebirth
    // (the rot-then-rebirth animation has reached the revived code, R8.1).
    const ritual = state.lastRitual;
    if (ritual !== null && ritual !== prevRitualRef.current) {
      requestCue("rebirth");
    }
    prevRitualRef.current = ritual;
  }, [state.lastRitual, requestCue]);

  // Summon (visual-necromancy task 21.4, OPTIONAL extra cue): a single toll the
  // instant a Reading resolves and its spread is laid out, before the one-by-one
  // Card_Reveal plays. `currentVisualReading` is the same pure, Motion_Mode-
  // independent selector the card overlay resolves from, so this fires once per
  // new in-scope Reading identically in full and reduced motion (R8.5) and is
  // never conflated with a per-card `reveal` flip. Gating is entirely
  // `useSound`'s `soundCueAllowed` — off by default, gesture-gated, silent while
  // off (R8.1-R8.4). The spread-drawn moment is the one dramatic beat the core
  // four cues leave unscored.
  const currentReading = currentVisualReading(state);
  useEffect(() => {
    if (currentReading !== null && currentReading !== prevReadingRef.current) {
      requestCue("summon");
    }
    prevReadingRef.current = currentReading;
  }, [currentReading, requestCue]);

  // The ambient Resurrection_Animation hum gate (visual-necromancy task 21.1,
  // OPTIONAL polish). A pure boolean over the sound state, the Motion_Mode and
  // the rot-playing signal the Terminal forwards: the low drone hums only when
  // sound resolves on, motion is `full`, and the rot-then-rebirth animation is
  // actively playing. `useSound` follows this flag through the live engine and
  // fades the drone out the instant it drops (rebirth, `sound off`, hidden, or
  // reduced motion) (R13.1, R13.4).
  const ambientHum = ambientHumActive({
    sound: state.sound,
    motionMode: state.motionMode,
    resurrectionPlaying: options.resurrectionPlaying ?? false,
  });

  useSound({
    loader: ports.sound,
    visibility: ports.visibility,
    state: state.sound,
    dispatch: soundDispatch,
    rootRef,
    onEngineFailure,
    cueRequest,
    ambient: ambientHum,
  });

  // -------------------------------------------------------------------------
  // Auto-scroll: the log is the one scroll container; scroll to end on growth.
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log === null) return;
    log.scrollTop = log.scrollHeight;
  }, [state.log]);

  // -------------------------------------------------------------------------
  // View handlers.
  // -------------------------------------------------------------------------
  const submit = useCallback(
    (raw: string, source: "enter" | "button") => {
      dispatch({ type: "submit", raw, source });
    },
    [dispatch],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const input = event.currentTarget;

      // Ctrl+L: clear, suppressing the browser default (R3.4).
      if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        input.value = "";
        dispatch({ type: "submit", raw: "clear", source: "enter" });
        return;
      }

      // Ctrl+C: abort, only while a request is in flight (R3.6). Otherwise the
      // browser's copy shortcut works untouched.
      if (event.key === "c" && event.ctrlKey) {
        if (stateRef.current.inflight !== null) {
          event.preventDefault();
          dispatch({ type: "abort" });
        }
        return;
      }

      // Escape: skip the running reveal (R3.5).
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "skip-reveal" });
        return;
      }

      // History navigation (R3.2, R3.3): compute the restored text here, and
      // persist the cursor through the reducer.
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const current = input.value;
        const { text } =
          event.key === "ArrowUp"
            ? historyPrev(stateRef.current.history, current)
            : historyNext(stateRef.current.history, current);
        input.value = text;
        dispatch({
          type: "history",
          direction: event.key === "ArrowUp" ? "prev" : "next",
          current,
        });
        return;
      }

      // Tab is never intercepted (R3.7); every other key falls through.
    },
    [dispatch],
  );

  const prefillSummon = useCallback(() => {
    // The SUMMON button fills `summon ` and focuses the Command_Line (R3.10).
    const input = inputRef.current;
    if (input !== null) {
      input.value = "summon ";
      input.focus();
    }
    dispatch({ type: "submit", raw: "summon", source: "button" });
  }, [dispatch]);

  const toggleSound = useCallback(() => {
    // Clicking SOUND is a gesture; flip to the opposite preference (R3.12).
    const next = stateRef.current.sound.preference === "on" ? "off" : "on";
    dispatch({ type: "submit", raw: `sound ${next}`, source: "button" });
  }, [dispatch]);

  const downloadPatch = useCallback(() => {
    // Build + trigger the patch download for the last completed Ritual, routed
    // through the reducer as a `patch.download` effect so the one effect-seam
    // owns every side effect (R7.3). A no-op when no patch is in scope.
    const ritual = stateRef.current.lastRitual;
    if (ritual === null || ritual.patch.length === 0) return;
    for (const effect of [
      { type: "patch.download", patch: ritual.patch, ritualId: ritual.ritualId } as const,
    ]) {
      performEffect(effect);
    }
  }, [performEffect]);

  const revealedCountFor = useCallback(
    (blockId: number, fullLength: number): number | null => {
      const s = stateRef.current;
      if (s.motionMode !== "full") return null;
      if (!s.reveal.queue.includes(blockId)) return null;
      // The boot banner and the echoed command line are shown at once; only
      // the Oracle's own output typewriter-reveals.
      const block = s.log.find((b) => b.id === blockId);
      if (block !== undefined && (block.kind === "boot" || block.kind === "echo")) {
        return null;
      }
      if (s.reveal.startedAtMs === null || revealClock === null) return 0;
      const elapsed = revealClock - s.reveal.startedAtMs;
      const revealed = revealedChars(fullLength, "full", elapsed);
      // Fully revealed: stop treating the block as animating.
      return revealed >= fullLength ? null : revealed;
    },
    [revealClock],
  );

  // The boot frame for the current step (pure; the overlay renders it only
  // while playing) and the resolved Visual_Layer seed (pure over the session).
  const bootFrameForRender = bootFrame(state.boot.stepIndex);
  const bootFrameKindForRender = bootFrameKind(state.boot.stepIndex);
  const visualSeed = resolveSeed(state);

  return {
    state,
    ariaBusy,
    rootRef,
    logRef,
    inputRef,
    submit,
    onInputKeyDown,
    prefillSummon,
    toggleSound,
    downloadPatch,
    revealedCountFor,
    engineFailed,
    bootFrameForRender,
    bootFrameKindForRender,
    visualSeed,
  };
}

/** Whether any queued block is still animating in full motion (R16.9). */
function computePendingReveal(
  state: SessionState,
  revealClock: number | null,
): boolean {
  if (state.motionMode !== "full") return false;
  if (state.reveal.queue.length === 0) return false;
  // Before the first tick the clock is unset: run one frame to set it.
  if (state.reveal.startedAtMs === null || revealClock === null) return true;
  const elapsed = revealClock - state.reveal.startedAtMs;
  // Keep looping while any animating queued block has characters still to
  // reveal. The boot banner and echoed commands never animate (shown at once).
  return state.log.some((block) => {
    if (!state.reveal.queue.includes(block.id)) return false;
    if (block.kind === "boot" || block.kind === "echo") return false;
    const len = [...blockText(block)].length;
    return revealedChars(len, "full", elapsed) < len;
  });
}

/** The error envelope the `api.failed` action carries. */
interface ErrorEnvelope {
  readonly code: NecroErrorCode;
  readonly userMessage: string;
}

/**
 * Normalise any thrown value from the readings API into the `{ code,
 * userMessage }` envelope the reducer's `api.failed` action expects. A thrown
 * `NecroError` carries its own code/message; anything else maps to a generic
 * client-side network failure. No stack, cause or exception text is read.
 */
function toErrorEnvelope(error: unknown): ErrorEnvelope {
  const maybe = error as { code?: unknown; userMessage?: unknown } | null;
  if (
    maybe !== null &&
    typeof maybe === "object" &&
    typeof maybe.code === "string" &&
    typeof maybe.userMessage === "string"
  ) {
    return {
      code: maybe.code as NecroErrorCode,
      userMessage: maybe.userMessage,
    };
  }
  return {
    code: "NETWORK_TIMEOUT",
    userMessage:
      "The summons echoed into silence.\n" +
      "The connection failed or timed out; check your link and retry.",
  };
}
