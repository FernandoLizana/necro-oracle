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
import { useSound } from "./use-sound.js";
import type { SoundEvent } from "../sound/sound-reducer.js";
import type { NecroErrorCode } from "@necro/oracle/client";
import { blockText } from "../render/blocks.js";
import { revealedChars } from "../motion/reveal.js";

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
   * How many characters of the block with the given id are revealed right now,
   * or `null` when the block is not animating (show the full text).
   */
  readonly revealedCountFor: (blockId: number, fullLength: number) => number | null;
  /**
   * Set once the sound engine could not be loaded or started, so the Terminal
   * renders the in-world "speakers are silent" notice exactly once (R19.14).
   */
  readonly engineFailed: boolean;
}

/** The fixed in-world message shown when the sound engine is unavailable (R19.14). */
export const SOUND_UNAVAILABLE_MESSAGE =
  "The old speakers are silent. Sound is unavailable here.";

/** The storage key each `prefs.save` effect maps to (R1.6: only these two). */
const PREFS_KEY: Readonly<Record<"motion" | "sound", string>> = {
  motion: MOTION_STORAGE_KEY,
  sound: SOUND_STORAGE_KEY,
};

/** Drive the whole terminal from the injected ports. */
export function useTerminal(ports: TerminalPorts): TerminalController {
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

        case "api.abort":
          abortRef.current?.abort();
          abortRef.current = null;
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
  useSound({
    loader: ports.sound,
    visibility: ports.visibility,
    state: state.sound,
    dispatch: soundDispatch,
    rootRef,
    onEngineFailure,
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
    revealedCountFor,
    engineFailed,
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
