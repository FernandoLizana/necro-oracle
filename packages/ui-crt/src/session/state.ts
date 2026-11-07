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
  LoversModelOverrides,
  LoversProgressEvent,
  LoversResponse,
  PlayableSpread,
  ProgressEvent,
  ReadingResponse,
  ResurrectProgressEvent,
  RitualResponse,
  SummonSummary,
} from "../protocol.js";
import type { ModelTierArg, ResurrectTarget } from "../command/types.js";
import type { OutputBlock } from "../render/blocks.js";
import type { CardRevealStep } from "../motion/card-reveal.js";
import type { History } from "./history.js";
import type { MotionMode, MotionPreference } from "../motion/motion-mode.js";
import type { SoundEvent, SoundPreference, SoundState } from "../sound/sound-reducer.js";

/** A single outstanding request, tagged by the kind of work it performs. */
export interface InflightRequest {
  readonly id: number;
  readonly kind: "summon" | "read" | "demo-load" | "resurrect" | "lovers";
}

/** The reveal queue: the ids of blocks still animating, and the start clock. */
export interface RevealState {
  readonly queue: readonly number[];
  readonly startedAtMs: number | null;
}

/**
 * The Boot_Sequence slice (visual-necromancy, task 7.1). `phase` gates the boot
 * overlay; `startedAtMs` anchors the elapsed-time schedule; `stepIndex` is the
 * current boot frame; `seen` records the once-per-page-session guard (R1.5) and
 * is session memory only — it is never written through `StoragePort`.
 */
export interface BootState {
  readonly phase: "playing" | "done";
  readonly startedAtMs: number | null;
  readonly stepIndex: number;
  readonly seen: boolean;
}

/**
 * The Card_Reveal slice (visual-necromancy, task 7.1). `schedule` holds the
 * per-position flip offsets (empty until a reading is seeded); `flippedCount`
 * is how many positions have finished flipping.
 */
export interface CardRevealState {
  readonly schedule: readonly CardRevealStep[];
  readonly flippedCount: number;
}

/**
 * The active key source for the current browser tab (lovers-binding R24.1,
 * R24.2). `ORACLE` is the server key under the daily ceilings; `YOURS` is the
 * user-supplied BYOK key. The reducer only ever flips this flag — the raw key
 * value never lives in session state (design §D.3/D.6): it is held solely in
 * the `apps/web` `SoulKeyContext` ref and transported per request.
 */
export type SoulSource = "ORACLE" | "YOURS";

/**
 * The HUD mirror of the BYOK key status (lovers-binding R25.3, D.6). It carries
 * ONLY whether a key is set and the last four characters for the status line —
 * never the raw key. The shell reports these two facts to the reducer through a
 * `byok.key-set` action after the masked input accepts a value; the reducer
 * never receives (and so never stores, logs, or historises) the key itself.
 */
export interface SoulKeyStatus {
  readonly keySet: boolean;
  readonly last4: string;
}

/**
 * A session-only model override per tier (lovers-binding R25.8, D.2). Set by the
 * `model fast|strong <id>` command; the ids are already `MODEL_ID_RE`-validated
 * by the parser. This lives in session state ONLY and is never written to any
 * storage (no `StoragePort`, no `prefs.save` effect) — it dies with the tab.
 */
export type SessionModelOverrides = {
  readonly [T in ModelTierArg]?: string;
};

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
  /**
   * The most recent completed Lovers binding `LoversResult`, surfaced so the
   * view layer can mount the lazy DMG `LoversView` (lovers-binding R21.*,
   * R22.1). The pure reducer renders a result-summary block into the log
   * itself; this field carries only the settled result the DMG view reads,
   * mirroring `lastRitual`. `null` until a `lovers` command resolves.
   */
  readonly lastLovers: LoversResponse | null;
  readonly inflight: InflightRequest | null;
  /** A demo name waiting for the bundle to load. */
  readonly pendingDemo: string | null;
  readonly motionPreference: MotionPreference;
  readonly prefersReduced: boolean;
  /** Derived from `motionPreference` + `prefersReduced`; kept for the view. */
  readonly motionMode: MotionMode;
  readonly sound: SoundState;
  readonly reveal: RevealState;
  readonly boot: BootState;
  readonly cardReveal: CardRevealState;
  /**
   * Whether the Landing_State has been dismissed by the first accepted command
   * (oracle-landing-polish, R1.2/R1.5). Seeded `false`; set `true` on the first
   * `submit` that produces output; set back to `false` by the `home` command.
   * Pure session memory — no clock, DOM, network or storage.
   */
  readonly landingDismissed: boolean;
  /**
   * The active Soul_Source (lovers-binding R24.1, R24.2, D.6). Seeded `ORACLE`;
   * set `YOURS` when the shell reports a key has been set (`byok.key-set`) and
   * reset to `ORACLE` by `key clear`. Pure session memory — never persisted.
   */
  readonly soulSource: SoulSource;
  /**
   * The HUD mirror of the BYOK key status (lovers-binding R25.3, D.6): whether a
   * key is set and its last four characters. The raw key is NEVER held here — it
   * lives only in the `apps/web` `SoulKeyContext` ref. Seeded not-set.
   */
  readonly soulKeyStatus: SoulKeyStatus;
  /**
   * The session-only model overrides (lovers-binding R25.8, D.2). Recorded from
   * the `model fast|strong <id>` command and used by the server (when the
   * Soul_Source is `YOURS`) for THIS session only. Never written to any storage.
   */
  readonly sessionModelOverrides: SessionModelOverrides;
}

/** Every action the reducer understands. */
export type Action =
  | {
      readonly type: "boot";
      readonly motionPreference: MotionPreference;
      readonly soundPreference: SoundPreference;
      readonly prefersReduced: boolean;
      readonly visible: boolean;
      /**
       * The single test/skip signal (visual-necromancy D4). When `true`
       * (`apps/web` reads `?boot=skip`, and the Playwright runner sets it), the
       * reducer starts `boot.phase: "done"` so no overlay renders and no frames
       * are scheduled, while the boot phrase stays the first Output_Block.
       */
      readonly bootSignal: boolean;
    }
  | { readonly type: "boot.tick"; readonly nowMs: number }
  | { readonly type: "boot.skip" }
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
      readonly type: "api.lovers.progress";
      readonly requestId: number;
      readonly event: LoversProgressEvent;
    }
  | {
      readonly type: "api.lovers.resolved";
      readonly requestId: number;
      readonly result: LoversResponse;
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
  | { readonly type: "sound"; readonly event: SoundEvent }
  /**
   * The shell reports that the masked `SoulKeyInput` accepted a key
   * (lovers-binding R24.2, R25.2, D.3). It carries ONLY the last four
   * characters — NEVER the raw key — so the reducer can mirror
   * `soulKeyStatus` and flip `soulSource` to `YOURS` while the key value
   * stays in the `apps/web` ref alone. The masked input, not this action, is
   * the only path a key value travels, and it never reaches session state.
   */
  | { readonly type: "byok.key-set"; readonly last4: string };

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
  | {
      readonly type: "api.lovers";
      readonly requestId: number;
      readonly pinned: string;
      readonly file: string;
      readonly spread: PlayableSpread;
      /**
       * The session-only BYOK model overrides, carried ONLY when the
       * Soul_Source is `YOURS` (lovers-binding D.2 item 5); omitted on ORACLE so
       * the reducer never forwards an override the server would ignore.
       */
      readonly models?: LoversModelOverrides | undefined;
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
  | { readonly type: "focus"; readonly target: "input" }
  /**
   * Signal the shell to open the masked `SoulKeyInput` (lovers-binding R25.2,
   * D.2). The reducer describes the intent as an Effect — exactly as it
   * describes `api.*`, `prefs.save`, and `focus` — and NEVER touches the DOM
   * or the key value itself. The adapter mounts the masked input; when the
   * user submits, the shell stores the raw key in the `SoulKeyContext` ref and
   * dispatches a `byok.key-set` action carrying ONLY the last four characters.
   * This is how `key set` opens the masked input while the key value stays out
   * of the pure reducer entirely.
   */
  | { readonly type: "byok.open-key-input" }
  /**
   * Signal the shell to drop the raw key from the `SoulKeyContext` ref
   * (lovers-binding R25.4, R26.*). Emitted by `key clear`; the reducer resets
   * only its own status mirror and Soul_Source, while the adapter clears the
   * ref that actually held the value.
   */
  | { readonly type: "byok.clear-key" };

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
    lastLovers: null,
    inflight: null,
    pendingDemo: null,
    motionPreference: "auto",
    prefersReduced: false,
    motionMode: "full",
    sound: { preference: "off", gesture: false, visible: true },
    reveal: { queue: [], startedAtMs: null },
    boot: { phase: "playing", startedAtMs: null, stepIndex: 0, seen: false },
    cardReveal: { schedule: [], flippedCount: 0 },
    landingDismissed: false,
    soulSource: "ORACLE",
    soulKeyStatus: { keySet: false, last4: "" },
    sessionModelOverrides: {},
  };
}
