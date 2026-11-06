// src/session/state.ts
//
// Feature: 03-crt-terminal, task 15.2.
//
// The pure session model for the CRT terminal: the `SessionState` shape, the
// `Action` and `Effect` unions, the `InflightRequest` descriptor, and the
// `initialState()` seed. The reducer that transitions this state lives in
// `./reducer.ts`; both are pure (design.md §"Session reducer and effects").
//
// Nothing here reads the DOM, clock, network or storage. Side effects are
// described as `Effect` descriptors the UI adapter layer performs; the reducer
// only ever returns them.

import type { NecroErrorCode } from "@necro/oracle/client";

import type {
  DemoBundle,
  PlayableSpread,
  ProgressEvent,
  ReadingResponse,
  ResurrectProgressEvent,
  RitualResponse,
  SummonSummary,
} from "../protocol.js";
import type { ResurrectTarget } from "../command/types.js";
import type { OutputBlock } from "../render/blocks.js";
import type { History } from "./history.js";
import type { MotionMode, MotionPreference } from "../motion/motion-mode.js";
import type { SoundEvent, SoundPreference, SoundState } from "../sound/sound-reducer.js";

/** A single outstanding request, tagged by the kind of work it performs. */
export interface InflightRequest {
  readonly id: number;
  readonly kind: "summon" | "read" | "demo-load" | "resurrect";
}

/** The reveal queue: the ids of blocks still animating, and the start clock. */
export interface RevealState {
  readonly queue: readonly number[];
  readonly startedAtMs: number | null;
}

/** The complete pure session model the reducer transitions. */
export interface SessionState {
  readonly log: readonly OutputBlock[];
  readonly nextBlockId: number;
  readonly nextRequestId: number;
  readonly history: History;
  readonly summary: SummonSummary | null;
  /** Held readings for the current `summary.ref.sha` only. */
  readonly readings: Readonly<Partial<Record<PlayableSpread, ReadingResponse>>>;
  /** Which held reading `explain` renders from. */
  readonly lastSpread: PlayableSpread | null;
  readonly demoBundle: DemoBundle | null;
  /**
   * The most recent completed resurrection `RitualResult`, surfaced so the view
   * layer can mount the client-side patch-download affordance (R7.3). The pure
   * reducer renders the diff/residual and vitality blocks into the log itself;
   * this field carries only the settled result the DOM download button reads.
   * `null` until a `resurrect` command resolves.
   */
  readonly lastRitual: RitualResponse | null;
  readonly inflight: InflightRequest | null;
  /** A demo name waiting for the bundle to load. */
  readonly pendingDemo: string | null;
  readonly motionPreference: MotionPreference;
  readonly prefersReduced: boolean;
  /** Derived from `motionPreference` + `prefersReduced`; kept for the view. */
  readonly motionMode: MotionMode;
  readonly sound: SoundState;
  readonly reveal: RevealState;
}

/** Every action the reducer understands. */
export type Action =
  | {
      readonly type: "boot";
      readonly motionPreference: MotionPreference;
      readonly soundPreference: SoundPreference;
      readonly prefersReduced: boolean;
      readonly visible: boolean;
    }
  | { readonly type: "submit"; readonly raw: string; readonly source: "enter" | "button" }
  | { readonly type: "history"; readonly direction: "prev" | "next"; readonly current: string }
  | { readonly type: "api.summoned"; readonly requestId: number; readonly summary: SummonSummary }
  | { readonly type: "api.progress"; readonly requestId: number; readonly event: ProgressEvent }
  | { readonly type: "api.read"; readonly requestId: number; readonly response: ReadingResponse }
  | {
      readonly type: "api.resurrect.progress";
      readonly requestId: number;
      readonly event: ResurrectProgressEvent;
    }
  | {
      readonly type: "api.resurrect.resolved";
      readonly requestId: number;
      readonly result: RitualResponse;
    }
  | {
      readonly type: "api.failed";
      readonly requestId: number;
      readonly error: { readonly code: NecroErrorCode; readonly userMessage: string };
    }
  | { readonly type: "demo.loaded"; readonly requestId: number; readonly bundle: DemoBundle }
  | { readonly type: "demo.failed"; readonly requestId: number }
  | { readonly type: "abort" }
  | { readonly type: "skip-reveal" }
  | { readonly type: "reveal.tick"; readonly nowMs: number }
  | { readonly type: "media"; readonly prefersReduced: boolean }
  | { readonly type: "sound"; readonly event: SoundEvent };

/** Every side effect the reducer describes for the adapter layer to perform. */
export type Effect =
  | { readonly type: "api.summon"; readonly requestId: number; readonly repo: string }
  | {
      readonly type: "api.read";
      readonly requestId: number;
      readonly pinned: string;
      readonly spread: PlayableSpread;
    }
  | {
      readonly type: "api.resurrect";
      readonly requestId: number;
      readonly pinned: string;
      readonly target: ResurrectTarget;
      readonly spread: PlayableSpread;
    }
  | { readonly type: "api.abort" }
  | {
      readonly type: "patch.download";
      readonly patch: string;
      readonly ritualId: string;
    }
  | { readonly type: "demo.load"; readonly requestId: number }
  | { readonly type: "prefs.save"; readonly key: "motion" | "sound"; readonly value: string }
  | { readonly type: "sound.start" }
  | { readonly type: "sound.release" }
  | { readonly type: "sound.apply"; readonly hum: boolean; readonly click: boolean }
  | { readonly type: "focus"; readonly target: "input" };

/** The fresh, pre-boot session. The `boot` action fills in the live values. */
export function initialState(): SessionState {
  return {
    log: [],
    nextBlockId: 0,
    nextRequestId: 0,
    history: { entries: [], cursor: null, draft: "" },
    summary: null,
    readings: {},
    lastSpread: null,
    demoBundle: null,
    lastRitual: null,
    inflight: null,
    pendingDemo: null,
    motionPreference: "auto",
    prefersReduced: false,
    motionMode: "full",
    sound: { preference: "off", gesture: false, visible: true },
    reveal: { queue: [], startedAtMs: null },
  };
}
