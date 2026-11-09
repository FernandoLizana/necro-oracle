// src/session/reducer.ts
//
// Feature: 03-crt-terminal, task 15.2.
//
// The pure session reducer for the CRT terminal. `step(state, action)` returns
// the next `SessionState` and the list of `Effect` descriptors the adapter
// layer must perform. It reads no DOM, clock, network or storage; every side
// effect is described, never performed (design.md Â§"Session reducer and
// effects").
//
// The reducer composes the already-built pure modules: command parse/print,
// the renderers, the history ring, the bounded output log, the pinned-ref
// helper, the demo catalog, motion-mode resolution, the sound reducer, and the
// demo-label decorator. Block ids come from `nextBlockId`, request ids from
// `nextRequestId`.
//
// _Requirements: R1.6, R2.10, R2.13, R3.1, R3.4, R3.5, R3.6, R3.11, R5.4, R6.1,
// R6.2, R6.3, R6.12, R6.13, R6.15, R10.5, R15.4, R15.5, R15.10, R15.13, R16.8,
// R18.3-R18.7, R18.14, R18.15, R19.11_

import type {
  LoversPhase,
  LoversResponse,
  PlayableSpread,
  ReadingResponse,
  ResurrectionPhase,
} from "../protocol.js";
import type { BlockDraft, OutputBlock } from "../render/blocks.js";
import { appendBlocks } from "./log.js";
import { historyNext, historyPrev, historyPush } from "./history.js";
import { formatPinnedRef } from "./pinned-ref.js";
import { withDemoLabel } from "../render/demo-label.js";
import { tarotRevealBlocks } from "../render/tarot.js";
import {
  cryptoRandomFn,
  drawTarot,
  fallbackReading,
  seededRandomFn,
} from "@necro/oracle/client";

import { parseCommand } from "../command/parse.js";
import {
  MAX_ENTRY_LENGTH,
  type Command,
  type KeyOp,
  type ModelTierArg,
  type ResurrectTarget,
} from "../command/types.js";

import {
  renderCardBlock,
  renderEcho,
  renderProgress,
  renderReading,
  renderSkipNote,
  type RenderContext,
} from "../render/reading.js";
import { blockText } from "../render/blocks.js";
import { renderExplain } from "../render/explain.js";
import { renderHelp } from "../render/help.js";
import { renderNoPython, renderSummary } from "../render/summary.js";
import { renderError } from "../render/errors.js";
import { renderFileResults } from "../render/resurrect-diff.js";
import { renderResurrectVitality } from "../render/resurrect-vitality.js";

import {
  BOOT_PHRASE,
  LOVERS_PHASE_VOICE,
  PRE_BINDING_PHRASE,
  PRE_READING_PHRASE,
  PRE_RESURRECTION_PHRASE,
  RESURRECT_PHASE_VOICE,
} from "../voice/phrases.js";
import { DEMO_CATALOG } from "../demo/catalog.js";
import { resolveMotionMode } from "../motion/motion-mode.js";
import { BOOT_STEP_COUNT } from "../render/boot.js";
import { bootStepAt } from "../motion/boot-schedule.js";
import { cardRevealSchedule } from "../motion/card-reveal.js";
import { soundActivity, soundReducer, type SoundEvent } from "../sound/sound-reducer.js";

import type { Action, Effect, InflightRequest, SessionState } from "./state.js";

/** A step result: the next state and the effects to perform. */
interface StepResult {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
}

/** A mutable accumulator used while a single `step` composes its result. */
interface Accumulator {
  state: SessionState;
  effects: Effect[];
}

// ---------------------------------------------------------------------------
// Block helpers â€” assign ids, append with the 500-line cap, queue for reveal.
// ---------------------------------------------------------------------------

/**
 * Assign ids to a list of `BlockDraft`s from `nextBlockId` and append them to
 * the log with the bounded-log cap. In full motion the new block ids are
 * pushed on the reveal queue; in reduced motion nothing is queued. Returns the
 * updated state (log, nextBlockId, reveal all advanced).
 */
function appendDrafts(state: SessionState, drafts: readonly BlockDraft[]): SessionState {
  if (drafts.length === 0) return state;

  let nextBlockId = state.nextBlockId;
  const blocks: OutputBlock[] = drafts.map((draft) => ({
    ...draft,
    id: nextBlockId++,
  }));

  const log = appendBlocks(state.log, blocks);

  // Only full motion animates; reduced motion never queues a reveal (R16.9).
  const queueAdditions =
    state.motionMode === "full" ? blocks.map((b) => b.id) : [];
  const reveal =
    queueAdditions.length === 0
      ? state.reveal
      : {
          queue: [...state.reveal.queue, ...queueAdditions],
          startedAtMs: state.reveal.startedAtMs,
        };

  return { ...state, log, nextBlockId, reveal };
}

/** Drain the reveal queue, marking the running reveal complete (R3.5, R10.5). */
function completeReveal(state: SessionState): SessionState {
  if (state.reveal.queue.length === 0 && state.reveal.startedAtMs === null) {
    return state;
  }
  return { ...state, reveal: { queue: [], startedAtMs: null } };
}

// ---------------------------------------------------------------------------
// Card-reveal slice (visual-necromancy task 7.2)
// ---------------------------------------------------------------------------

/**
 * Seed the Card_Reveal slice for a freshly rendered reading. The schedule has
 * one step per spread position in the Reading's order, so it never reorders,
 * adds, or omits a position â€” `renderReading` still emits exactly one block per
 * position (R4.1, R4.6). Each position's `diagnosisLength` is the length of its
 * rendered diagnosis text, so the per-card typewriter duration matches what the
 * view types out.
 *
 * In full motion the schedule drives a one-by-one flip, so `flippedCount`
 * starts at 0. In reduced motion no queue is seeded â€” every card is face-up
 * with full text in a single render (R4.4) â€” so the schedule is empty and every
 * position counts as already flipped.
 */
function seedCardReveal(state: SessionState, resp: ReadingResponse): SessionState {
  const ctx: RenderContext = {
    live: resp.summary.demo !== true,
    ref: resp.reading.repo,
  };
  const positions = resp.reading.spread.map((position) => ({
    diagnosisLength: blockText(renderCardBlock(position, ctx)).length,
  }));

  if (state.motionMode !== "full") {
    // Reduced motion: one render, all cards face-up, no flip queue (R4.4). The
    // empty schedule means nothing animates; every position is already flipped.
    return {
      ...state,
      cardReveal: { schedule: [], flippedCount: positions.length },
    };
  }

  const schedule = cardRevealSchedule(positions);
  return {
    ...state,
    cardReveal: { schedule, flippedCount: 0 },
  };
}

/**
 * Complete the Card_Reveal slice: every card flipped and every diagnosis fully
 * revealed (R4.5). Reaches the same final state the reduced-motion / Escape
 * path lands on â€” `flippedCount` is the full count and nothing remains queued.
 */
function completeCardReveal(state: SessionState): SessionState {
  const total = state.cardReveal.schedule.length;
  if (state.cardReveal.flippedCount >= total) return state;
  return {
    ...state,
    cardReveal: { ...state.cardReveal, flippedCount: total },
  };
}

/** Whether the current session is a demo replay (its blocks carry the label). */
function isDemoSession(state: SessionState): boolean {
  return state.summary?.demo === true;
}

/**
 * Apply the demo label to a list of non-echo drafts when the session is a demo
 * replay (R18.5). Live sessions pass the drafts through unchanged.
 */
function labelled(state: SessionState, drafts: readonly BlockDraft[]): readonly BlockDraft[] {
  return isDemoSession(state) ? withDemoLabel(drafts) : drafts;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function stepBoot(
  state: SessionState,
  action: Extract<Action, { type: "boot" }>,
): StepResult {
  const motionMode = resolveMotionMode(action.motionPreference, action.prefersReduced);

  // Once per page session: a `boot` action after the sequence has been seen
  // refreshes the live preferences but never replays the overlay or re-appends
  // the boot phrase (R1.5). `seen` is session memory, never persisted.
  const alreadySeen = state.boot.seen;

  // The overlay only animates in full motion, when no skip signal is set, and
  // only the first time (R1.1, R1.6, R1.5). Otherwise it starts already done:
  // reduced motion, `bootSignal`, or a replay all land on `phase: "done"`.
  const playing = motionMode === "full" && !action.bootSignal && !alreadySeen;
  const boot: SessionState["boot"] = {
    phase: playing ? "playing" : "done",
    startedAtMs: null,
    stepIndex: 0,
    seen: true,
  };

  const booted: SessionState = {
    ...state,
    motionPreference: action.motionPreference,
    prefersReduced: action.prefersReduced,
    motionMode,
    sound: {
      preference: action.soundPreference,
      gesture: false,
      visible: action.visible,
    },
    boot,
  };

  // A replay refreshes preferences only: the boot phrase was already the first
  // Output_Block from the first boot, so it is not appended again.
  if (alreadySeen) {
    return { state: booted, effects: [{ type: "focus", target: "input" }] };
  }

  // The boot phrase is ALWAYS the first Output_Block, independent of the boot
  // phase or motion mode (R1.2): in full motion it sits beneath the overlay; in
  // reduced / skip it is simply the ready prompt.
  const withBoot = appendDrafts(booted, [bootBlock()]);
  // Boot focuses the Command_Line (R15.4).
  return { state: withBoot, effects: [{ type: "focus", target: "input" }] };
}

/**
 * Advance the Boot_Sequence by one frame tick (R1.1). The first tick of a
 * playing sequence records `startedAtMs`; later ticks map elapsed time to a
 * step via `bootStepAt`. Reaching the final step transitions `phase` to
 * `"done"`. Ticks while already done (or never playing) are no-ops.
 */
function stepBootTick(
  state: SessionState,
  action: Extract<Action, { type: "boot.tick" }>,
): StepResult {
  if (state.boot.phase !== "playing") return noop(state);

  // Record the start clock on the first tick; the step is 0 at elapsed 0.
  if (state.boot.startedAtMs === null) {
    return {
      state: { ...state, boot: { ...state.boot, startedAtMs: action.nowMs, stepIndex: 0 } },
      effects: [],
    };
  }

  const stepIndex = bootStepAt(action.nowMs - state.boot.startedAtMs);
  const phase = stepIndex >= BOOT_STEP_COUNT - 1 ? "done" : "playing";
  return {
    state: { ...state, boot: { ...state.boot, stepIndex, phase } },
    effects: [],
  };
}

/** Skip the Boot_Sequence immediately, reaching the ready state (R1.3). */
function stepBootSkip(state: SessionState): StepResult {
  if (state.boot.phase === "done") return noop(state);
  return { state: { ...state, boot: { ...state.boot, phase: "done" } }, effects: [] };
}

/** The boot banner block (kind `boot`). */
function bootBlock(): BlockDraft {
  const echo = renderEcho(BOOT_PHRASE);
  return { ...echo, kind: "boot" };
}

/**
 * SEC-02: does this raw entry look like a key typed inline after `key set`?
 *
 * `true` when the first whitespace-delimited token is `key` (any case) and
 * the second is `set` (any case) AND at least one further token follows, i.e.
 * `key set <secret...>`. The bare `key set` (which safely opens the masked
 * input) returns `false` and flows through the normal parser. Pure; never
 * throws; never copies the secret tail anywhere.
 */
function isInlineKeySet(raw: string): boolean {
  const tokens = raw.trim().split(/\s+/u);
  return (
    tokens.length >= 3 &&
    tokens[0]!.toLowerCase() === "key" &&
    tokens[1]!.toLowerCase() === "set"
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function stepSubmit(
  state: SessionState,
  action: Extract<Action, { type: "submit" }>,
): StepResult {
  // A submit first completes any running reveal (R10.5).
  const base = completeReveal(state);
  const acc: Accumulator = { state: base, effects: [] };

  const raw = action.raw;

  // The SUMMON button sends the bare command `summon` to prefill `summon ` and
  // focus the Command_Line; it does not itself summon (R3.10). No echo, no
  // request, just the focus effect.
  if (action.source === "button" && raw.trim().toLowerCase() === "summon") {
    acc.effects.push({ type: "focus", target: "input" });
    return result(acc);
  }

  // Over-length entries are echoed (truncated) and rejected before parsing,
  // never pushed to history, and never produce a request (R2.13).
  if (raw.length > MAX_ENTRY_LENGTH) {
    const truncated = raw.slice(0, MAX_ENTRY_LENGTH);
    pushBlocks(acc, [renderEcho(truncated)]);
    pushBlocks(acc, [
      oracleBlock(
        `That incantation runs too long; keep it within ${MAX_ENTRY_LENGTH} characters.`,
      ),
    ]);
    maybeFocus(acc, action);
    return result(acc);
  }

  // SEC-02: a key typed inline after `key set` (e.g. `key set sk-...`) is a
  // secret. It must NEVER be echoed, pushed to history, or reflected in an
  // "Unknown command" line. Intercept it BEFORE parse/echo/history: drop the
  // raw tail entirely, open the masked `SoulKeyInput` (the only safe entry
  // path), and explain in oracle voice; the secret characters never leave the
  // caller's keystrokes (R25.1, R25.2).
  if (isInlineKeySet(raw)) {
    acc.effects.push({ type: "byok.open-key-input" });
    pushLabelled(acc, [
      oracleBlock(
        "Never speak your key aloud on the command line. " +
          "Whisper it into the masked sigil instead; it is held in memory for " +
          "this tab only and cleared on reload.",
      ),
    ]);
    maybeFocus(acc, action);
    return result(acc);
  }

  const command = parseCommand(raw);

  // An empty / whitespace-only entry gives a fresh prompt only (R2.10): no
  // echo, no history push, no request.
  if (command === null) {
    maybeFocus(acc, action);
    return result(acc);
  }

  // Echo the entry and push a non-empty entry to history (R3.1).
  const echoDraft = isDemoSession(acc.state)
    ? { ...renderEcho(raw), demo: true }
    : renderEcho(raw);
  pushBlocks(acc, [echoDraft]);
  acc.state = { ...acc.state, history: historyPush(acc.state.history, raw.trim()) };

  // An accepted command dismisses the Landing_State (R1.2). This is the first
  // submit path that produces output: the empty-entry (`command === null`) and
  // the bare SUMMON-button prefill both returned above, so neither reaches
  // here. `home` resets the flag back to false in `doHome`, which runs inside
  // `dispatchCommand` below, so the `home` round-trip lands on `false` (R2.3).
  acc.state = { ...acc.state, landingDismissed: true };

  dispatchCommand(acc, command);
  maybeFocus(acc, action);
  return result(acc);
}

/** Emit a `focus` effect after a typed command or the SUMMON button (R15.4/5). */
function maybeFocus(acc: Accumulator, action: Extract<Action, { type: "submit" }>): void {
  if (action.source === "enter") {
    acc.effects.push({ type: "focus", target: "input" });
    return;
  }
  // The SUMMON button fills `summon ` and focuses; other buttons do not.
  const command = parseCommand(action.raw);
  if (command !== null && command.kind === "summon") {
    acc.effects.push({ type: "focus", target: "input" });
  }
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

function dispatchCommand(acc: Accumulator, command: Command): void {
  switch (command.kind) {
    case "help":
      pushLabelled(acc, [renderHelp()]);
      return;
    case "clear":
      doClear(acc);
      return;
    case "home":
      doHome(acc);
      return;
    case "summon":
      doSummon(acc, command.repo);
      return;
    case "read":
      doRead(acc, command.spread);
      return;
    case "explain":
      doExplain(acc, command);
      return;
    case "resurrect":
      doResurrect(acc, command.target);
      return;
    case "motion":
      doMotion(acc, command.arg);
      return;
    case "demo":
      doDemo(acc, command.name);
      return;
    case "sound":
      doSound(acc, command.arg);
      return;
    case "lovers":
      // The `lovers` ritual request flow (precondition, streaming route, result
      // rendering) is wired in task 11.6b / task 12; task 10.4 scopes only the
      // Soul_Source + model-override + key-status session state. Until the
      // ritual effect lands, a `lovers` entry is acknowledged in oracle voice so
      // the parsed command is never silently swallowed.
      doLovers(acc, command.file, command.targetLang);
      return;
    case "tarot":
      doTarot(acc, command.question);
      return;
    case "key":
      doKey(acc, command.op);
      return;
    case "model":
      doModel(acc, command.tier, command.id);
      return;
    case "unknown":
      pushLabelled(acc, [unknownBlock(command.raw)]);
      return;
  }
}

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

function doClear(acc: Accumulator): void {
  const cleared = clearBlock();
  const demo = isDemoSession(acc.state);
  const block: BlockDraft = demo ? { ...cleared, demo: true } : cleared;
  // clear replaces the whole log with one "screen cleared" block â€” the prior
  // output and the just-echoed `clear` command are both wiped â€” while keeping
  // summary / readings / lastSpread (R15.10). The reveal queue is reset too.
  const reset: SessionState = {
    ...acc.state,
    log: [],
    reveal: { queue: [], startedAtMs: null },
  };
  acc.state = appendDrafts(reset, [block]);
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------

/**
 * Return to the Landing_State (oracle-landing-polish R1.4, R2.3). `home` is a
 * superset of `clear` plus the landing restore: it empties the output log (no
 * "screen cleared" block is left â€” the log must be empty for `landingVisible`),
 * nulls `summary`/`readings`/`lastSpread`/`lastRitual`, resets the reveal and
 * card-reveal queues, and sets `landingDismissed = false`. With the boot phase
 * already `done`, an empty log, and `summary === null`, `landingVisible(state)`
 * becomes true again â€” a clean round-trip from Dismissed to LandingVisible.
 */
function doHome(acc: Accumulator): void {
  acc.state = {
    ...acc.state,
    log: [],
    summary: null,
    readings: {},
    lastSpread: null,
    lastRitual: null,
    lastLovers: null,
    reveal: { queue: [], startedAtMs: null },
    cardReveal: { schedule: [], flippedCount: 0 },
    landingDismissed: false,
    // Item 7 (demo exit): leave any demo replay cleanly. `summary: null` already
    // ends the demo session (isDemoSession reads summary.demo); also drop the
    // pending demo name so no stale demo selection lingers. The cached
    // demoBundle is kept so a later `demo <name>` re-installs without a reload.
    pendingDemo: null,
  };
}

// ---------------------------------------------------------------------------
// summon
// ---------------------------------------------------------------------------

function doSummon(acc: Accumulator, repo: string): void {
  if (acc.state.inflight !== null) {
    pushLabelled(acc, [ritualUnderwayBlock()]);
    return;
  }

  const requestId = acc.state.nextRequestId;
  const inflight: InflightRequest = { id: requestId, kind: "summon" };
  acc.state = {
    ...acc.state,
    nextRequestId: requestId + 1,
    inflight,
  };
  pushBlocks(acc, [oracleBlock("The summons goes out across the graveyard...")]);
  acc.effects.push({ type: "api.summon", requestId, repo });
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

function doRead(acc: Accumulator, spread: "fates" | "necropsy" | "celtic"): void {
  if (acc.state.inflight !== null) {
    pushLabelled(acc, [ritualUnderwayBlock()]);
    return;
  }

  // Celtic is web-only; the terminal never plays it (R6.3).
  if (spread === "celtic") {
    pushLabelled(acc, [
      oracleBlock(
        "The Celtic Cross is not yet available here. Try read fates or read necropsy.",
      ),
    ]);
    return;
  }

  // No summon yet (R6.2).
  if (acc.state.summary === null) {
    pushLabelled(acc, [
      oracleBlock("Summon a repository first before laying the cards."),
    ]);
    return;
  }

  const playable = spread as PlayableSpread;

  // A demo session renders from the loaded bundle, never the network (R6.13).
  if (isDemoSession(acc.state)) {
    doReadDemo(acc, playable);
    return;
  }

  // A held reading for the same sha + spread is re-rendered (R6.12), no request.
  const held = acc.state.readings[playable];
  if (held !== undefined) {
    const blocks = renderReading(held);
    acc.state = seedCardReveal({ ...acc.state, lastSpread: playable }, held);
    pushBlocks(acc, blocks);
    return;
  }

  // Fresh live read: pre-reading phrase + one api.read request (R6.1).
  const requestId = acc.state.nextRequestId;
  const inflight: InflightRequest = { id: requestId, kind: "read" };
  acc.state = {
    ...acc.state,
    nextRequestId: requestId + 1,
    inflight,
    lastSpread: playable,
  };
  pushBlocks(acc, [oracleBlock(PRE_READING_PHRASE)]);
  const pinned = formatPinnedRef(acc.state.summary!.ref);
  acc.effects.push({ type: "api.read", requestId, pinned, spread: playable });
}

/** Render a demo spread from the loaded bundle (R6.13), with the demo label. */
function doReadDemo(acc: Accumulator, spread: PlayableSpread): void {
  const bundle = acc.state.demoBundle;
  const pending = acc.state.pendingDemo;
  const response =
    bundle !== null && pending !== null ? bundle[pending]?.[spread] : undefined;
  if (response === undefined) {
    pushLabelled(acc, [
      oracleBlock("This demo holds no such spread. Try read fates or read necropsy."),
    ]);
    return;
  }
  acc.state = seedCardReveal({ ...acc.state, lastSpread: spread }, response);
  pushLabelled(acc, renderReading(response));
}

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

function doExplain(acc: Accumulator, command: Extract<Command, { kind: "explain" }>): void {
  const spread = acc.state.lastSpread;
  const response = spread === null ? undefined : currentReading(acc.state, spread);
  if (response === undefined) {
    pushLabelled(acc, [
      oracleBlock("There is no reading to explain. Lay a spread with read first."),
    ]);
    return;
  }
  pushLabelled(acc, renderExplain(response, command.target));
}

/** The response `explain` renders from: a demo spread or a held live reading. */
function currentReading(state: SessionState, spread: PlayableSpread): ReadingResponse | undefined {
  if (isDemoSession(state) && state.demoBundle !== null && state.pendingDemo !== null) {
    return state.demoBundle[state.pendingDemo]?.[spread];
  }
  return state.readings[spread];
}

// ---------------------------------------------------------------------------
// resurrect
// ---------------------------------------------------------------------------

/**
 * The spread a `resurrect` scopes to: the last spread laid in this session, if
 * a completed reading for it is in scope. A live session needs a held reading
 * in `state.readings[lastSpread]`; a demo session needs the bundle entry for
 * `lastSpread`. Returns `null` when no completed reading is in scope (R1.6),
 * mirroring how `doExplain` resolves `currentReading`.
 */
function inScopeResurrectSpread(state: SessionState): PlayableSpread | null {
  const spread = state.lastSpread;
  if (spread === null) return null;
  return currentReading(state, spread) === undefined ? null : spread;
}

/**
 * Begin a resurrection for the parsed target (R1.1). Refuses with an
 * oracle-voice block when no completed reading is in scope â€” no summary, or no
 * live/demo reading for the pinned ref (R1.6). Otherwise guards the single
 * in-flight slot, opens a `resurrect` request, pushes a pre-resurrection
 * phrase, and emits one `api.resurrect` effect carrying the pinned ref, the
 * parsed target, and the in-scope spread. The server owns all semantic
 * validation (card/file existence, Python-2 classification).
 */
function doResurrect(acc: Accumulator, target: ResurrectTarget): void {
  if (acc.state.inflight !== null) {
    pushLabelled(acc, [ritualUnderwayBlock()]);
    return;
  }

  // A resurrection needs a completed reading in scope (R1.6): a summary plus a
  // held live reading, or the demo reading, for the in-scope spread.
  const summary = acc.state.summary;
  const spread = inScopeResurrectSpread(acc.state);
  if (summary === null || spread === null) {
    pushLabelled(acc, [
      oracleBlock(
        "There is no reading to raise. Lay a spread with read before you resurrect.",
      ),
    ]);
    return;
  }

  const requestId = acc.state.nextRequestId;
  const inflight: InflightRequest = { id: requestId, kind: "resurrect" };
  acc.state = {
    ...acc.state,
    nextRequestId: requestId + 1,
    inflight,
  };
  pushBlocks(acc, [oracleBlock(PRE_RESURRECTION_PHRASE)]);
  const pinned = formatPinnedRef(summary.ref);
  // Item 2 (judge-ready-pass): a demo session resurrects the bundled fixture
  // OFFLINE. Forward demo:true so the server reads the fixture and never calls
  // GitHub (the demo pinned ref is not a real repo) or OpenRouter.
  const resurrectEffect = isDemoSession(acc.state)
    ? ({ type: "api.resurrect", requestId, pinned, target, spread, demo: true } as const)
    : ({ type: "api.resurrect", requestId, pinned, target, spread } as const);
  acc.effects.push(resurrectEffect);
}

// ---------------------------------------------------------------------------
// motion (changes only the motion region â€” P27)
// ---------------------------------------------------------------------------

function doMotion(acc: Accumulator, arg: "auto" | "on" | "off" | undefined): void {
  if (arg === undefined) {
    pushLabelled(acc, [
      oracleBlock(`Motion is ${acc.state.motionPreference}. Use motion auto, on or off.`),
    ]);
    return;
  }
  const motionMode = resolveMotionMode(arg, acc.state.prefersReduced);
  acc.state = { ...acc.state, motionPreference: arg, motionMode };
  acc.effects.push({ type: "prefs.save", key: "motion", value: arg });
  pushLabelled(acc, [oracleBlock(`Motion set to ${arg}.`)]);
}

// ---------------------------------------------------------------------------
// sound (changes only the sound region â€” P27; never writes a block itself)
// ---------------------------------------------------------------------------

function doSound(acc: Accumulator, arg: "on" | "off" | undefined): void {
  if (arg === undefined) {
    pushLabelled(acc, [
      oracleBlock(`Sound is ${acc.state.sound.preference}. Use sound on or off.`),
    ]);
    return;
  }

  // A sound command counts as a user gesture (R3.12), then sets the preference.
  let sound = soundReducer(acc.state.sound, { type: "gesture" });
  sound = soundReducer(sound, { type: arg === "on" ? "sound_on" : "sound_off" });
  acc.state = { ...acc.state, sound };

  if (arg === "on") {
    acc.effects.push({ type: "sound.start" });
  } else {
    acc.effects.push({ type: "sound.release" });
  }
  acc.effects.push({ type: "prefs.save", key: "sound", value: arg });
  const activity = soundActivity(sound);
  acc.effects.push({ type: "sound.apply", hum: activity.hum, click: activity.click });
  // Item 8: a confirmation line, mirroring motion's "Motion set to X." — the
  // viewer sees the toggle was honoured (the sound STATE still lives only in
  // the sound region; this block is command output, not a sound side effect).
  pushLabelled(acc, [oracleBlock(`Sound set to ${arg}.`)]);
}

// ---------------------------------------------------------------------------
// tarot -- the destiny draw + reading (judge-ready-pass items 30-33)
// ---------------------------------------------------------------------------

/**
 * Draw a three-card Past/Present/Future tarot spread and render its reading.
 *
 * The draw is a SEPARATE deck from the diagnosis cards and needs no repository,
 * so `tarot` works on the bare landing with nothing summoned. A live session
 * draws with the crypto-backed RNG; a DEMO session draws with a seeded RNG
 * LOCAL to the demo (item 33) -- never patching `globalThis.crypto` -- so the
 * replay is deterministic. This reducer renders the DETERMINISTIC offline
 * reading (`fallbackReading`); the model-backed reading text (item 32) arrives
 * through the client effect/route, which may later replace this block.
 */
function doTarot(acc: Accumulator, question: string | undefined): void {
  const demo = isDemoSession(acc.state);
  // Demo: a seeded RNG local to the demo (item 33). The seed is derived from
  // the pending demo name so the same replay always lays the same spread, with
  // NO globalThis.crypto patch. Live: the crypto-backed RNG.
  const rng = demo
    ? seededRandomFn(demoTarotSeed(acc.state.pendingDemo))
    : cryptoRandomFn();
  const draw = drawTarot(rng);
  const reading = fallbackReading(draw);
  // `question` is untrusted DATA; the offline reading does not consume it, but
  // keeping it in the parsed command lets the model path (item 32) use it.
  void question;
  // Item 31: mark the spread laid so the sound hook can toll one tone (gated by
  // soundCueAllowed; sound-off stays silent).
  acc.state = { ...acc.state, tarotSeq: acc.state.tarotSeq + 1 };
  // Item 31 (ritual reveal): push the CEREMONIAL sequence as ordered blocks --
  // the shuffle/cut opener, then one block per card (its dealt line + a single
  // Seer line as it flips face-up), then the reading typed paragraph by
  // paragraph, then the verdict. Each block rides the shell's existing reveal
  // queue, so it deals/types one-by-one in full motion and renders instantly in
  // reduced motion; Escape/clear/home cancel it with no leaked timers.
  pushLabelled(
    acc,
    tarotRevealBlocks(draw, reading).map((text) => oracleBlock(text)),
  );
}

/** A stable per-demo seed for the local tarot RNG (item 33). */
function demoTarotSeed(pendingDemo: string | null): number {
  const name = pendingDemo ?? "demo";
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// lovers â€” the Lovers binding ritual (lovers-binding R14.1, R14.4, task 14.4)
// ---------------------------------------------------------------------------

/**
 * Begin a Lovers binding for the parsed `lovers <file> js` entry, mirroring
 * `doResurrect` exactly. Refuses with an oracle-voice block when no completed
 * reading is in scope â€” no summary, or no live/demo reading for the pinned ref
 * (the same precondition `doResurrect` enforces for R1.6). Otherwise guards the
 * single in-flight slot, opens a `lovers` request, pushes the pre-binding
 * phrase, and emits one `api.lovers` effect carrying the pinned ref, the file
 * to bind and the in-scope spread. The session model overrides ride along ONLY
 * when the Soul_Source is `YOURS` (design Â§D.2 item 5); on ORACLE they are
 * omitted so the reducer never forwards an override the server would ignore.
 * The server owns all semantic validation (THE LOVERS drawn, file bindable,
 * function/byte caps).
 */
function doLovers(acc: Accumulator, file: string, _targetLang: "javascript"): void {
  if (acc.state.inflight !== null) {
    pushLabelled(acc, [ritualUnderwayBlock()]);
    return;
  }

  // A binding needs a completed reading in scope, exactly like a resurrection:
  // a summary plus a held live reading, or the demo reading, for the in-scope
  // spread (mirrors `doResurrect`'s precondition).
  const summary = acc.state.summary;
  const spread = inScopeResurrectSpread(acc.state);
  if (summary === null || spread === null) {
    pushLabelled(acc, [
      oracleBlock(
        "There is no reading to bind. Lay a spread with read before you bind.",
      ),
    ]);
    return;
  }

  const requestId = acc.state.nextRequestId;
  const inflight: InflightRequest = { id: requestId, kind: "lovers" };
  acc.state = {
    ...acc.state,
    nextRequestId: requestId + 1,
    inflight,
  };
  pushBlocks(acc, [oracleBlock(PRE_BINDING_PHRASE)]);
  const pinned = formatPinnedRef(summary.ref);

  // The session model overrides are honoured by the server only on YOURS, so
  // the reducer forwards them only then (design Â§D.2 item 5); on ORACLE the
  // effect omits `models` entirely.
  const overrides = acc.state.sessionModelOverrides;
  const hasOverride =
    overrides.fast !== undefined || overrides.strong !== undefined;
  const models =
    acc.state.soulSource === "YOURS" && hasOverride
      ? { ...overrides }
      : undefined;

  // Item 2 (judge-ready-pass): a demo session binds the bundled fixture
  // OFFLINE â€” forward demo:true so the server never calls GitHub/OpenRouter.
  const demo = isDemoSession(acc.state) ? (true as const) : undefined;
  const loversEffect = {
    type: "api.lovers" as const,
    requestId,
    pinned,
    file,
    spread,
    ...(models === undefined ? {} : { models }),
    ...(demo === undefined ? {} : { demo }),
  };
  acc.effects.push(loversEffect);
}

// ---------------------------------------------------------------------------
// key â€” the BYOK Soul_Source commands (lovers-binding R25.1-R25.4, D.2, D.6)
// ---------------------------------------------------------------------------

/**
 * Reduce a `key set|status|clear` command. The reducer stays pure: it mirrors
 * only the key STATUS (`soulKeyStatus = { keySet, last4 }`) and the
 * `soulSource` flag, and NEVER the raw key â€” the key value lives solely in the
 * `apps/web` `SoulKeyContext` ref (design Â§D.3). The reducer signals UI intent
 * through `Effect` descriptors (exactly as `api.*` / `prefs.save` / `focus`
 * are signalled), so it touches no DOM and no storage.
 *
 * - `set`    â€” signals the shell to open the masked `SoulKeyInput` via the
 *              `byok.open-key-input` effect, plus an oracle-voice line stating
 *              the key is memory-only for this tab (R25.2, R26.4). The reducer
 *              does NOT receive the key value here; the shell later dispatches a
 *              `byok.key-set` action carrying only `{ last4 }`.
 * - `status` â€” renders set/not-set plus the last four from `soulKeyStatus`
 *              (never the raw key) (R25.3).
 * - `clear`  â€” resets `soulKeyStatus` to not-set and `soulSource` to `ORACLE`,
 *              and signals the shell to drop the ref via `byok.clear-key`
 *              (R25.4).
 */
function doKey(acc: Accumulator, op: KeyOp): void {
  switch (op) {
    case "set":
      // Open the masked input; the raw key never travels through the reducer.
      acc.effects.push({ type: "byok.open-key-input" });
      pushLabelled(acc, [
        oracleBlock(
          "Whisper your key to the void. " +
            "It is held in memory for this tab only and cleared on reload.",
        ),
      ]);
      return;
    case "status": {
      const { keySet, last4 } = acc.state.soulKeyStatus;
      const line = keySet
        ? `A key is bound. SOUL SOURCE: YOURS; the last four runes are ${last4}.`
        : "No key is bound. SOUL SOURCE: ORACLE; the oracle pays for this reading.";
      pushLabelled(acc, [oracleBlock(line)]);
      return;
    }
    case "clear":
      // Reset the status mirror and Soul_Source; signal the shell to drop the
      // ref that actually held the value. Idempotent when no key is set.
      acc.state = {
        ...acc.state,
        soulKeyStatus: { keySet: false, last4: "" },
        soulSource: "ORACLE",
      };
      acc.effects.push({ type: "byok.clear-key" });
      pushLabelled(acc, [
        oracleBlock(
          "The key dissolves into the ether. SOUL SOURCE: ORACLE once more.",
        ),
      ]);
      return;
  }
}

// ---------------------------------------------------------------------------
// model â€” the session-only model override (lovers-binding R25.5-R25.8, D.2)
// ---------------------------------------------------------------------------

/**
 * Reduce a `model fast|strong <id>` command. The `<id>` is already
 * `MODEL_ID_RE`-validated by the parser (an invalid id parses to `unknown`),
 * so the reducer records it into `sessionModelOverrides` for THIS session only
 * â€” it is never written to any storage (no `prefs.save` effect).
 *
 * An override is honoured by the server only when the Soul_Source is `YOURS`
 * (design Â§D.2 item 5): the server-side honour/ignore is enforced in task 11.6.
 * When the Soul_Source is still `ORACLE`, the reducer records the override but
 * the oracle-voice confirmation states it is ignored until a key is bound, so
 * the HUD/notice reflects that it has no effect on ORACLE.
 */
function doModel(acc: Accumulator, tier: ModelTierArg, id: string): void {
  acc.state = {
    ...acc.state,
    sessionModelOverrides: { ...acc.state.sessionModelOverrides, [tier]: id },
  };
  const confirm = `The ${tier.toUpperCase()} vessel is renamed ${id} for this session.`;
  const notice =
    acc.state.soulSource === "YOURS"
      ? confirm
      : `${confirm} It stays dormant until you bind your own key; the oracle keeps its own vessels.`;
  pushLabelled(acc, [oracleBlock(notice)]);
}

// ---------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------

function doDemo(acc: Accumulator, name: string | undefined): void {
  if (acc.state.inflight !== null) {
    pushLabelled(acc, [ritualUnderwayBlock()]);
    return;
  }

  if (name === undefined) {
    pushLabelled(acc, [catalogBlock()]);
    return;
  }

  const known = DEMO_CATALOG.some((entry) => entry.name === name);
  if (!known) {
    pushLabelled(acc, [catalogBlock()]);
    return;
  }

  // With the bundle already loaded, install the demo synchronously (R18.3,
  // R16.8); otherwise request the bundle and remember the pending name.
  if (acc.state.demoBundle !== null) {
    installDemo(acc, acc.state.demoBundle, name);
    return;
  }

  const requestId = acc.state.nextRequestId;
  const inflight: InflightRequest = { id: requestId, kind: "demo-load" };
  acc.state = {
    ...acc.state,
    nextRequestId: requestId + 1,
    inflight,
    pendingDemo: name,
  };
  acc.effects.push({ type: "demo.load", requestId });
}

/**
 * Install a demo by name from a loaded bundle: store a demo summary, clear the
 * live readings, remember the pending name so `read`/`explain` find the bundle
 * entry, and render the demo's summary block with the demo label (R18.14).
 */
function installDemo(
  acc: Accumulator,
  bundle: NonNullable<SessionState["demoBundle"]>,
  name: string,
): void {
  const entry = bundle[name];
  if (entry === undefined) {
    pushLabelled(acc, [catalogBlock()]);
    return;
  }
  const summary = entry.fates.summary;
  acc.state = {
    ...acc.state,
    summary,
    readings: {},
    lastSpread: null,
    demoBundle: bundle,
    pendingDemo: name,
    lastRitual: null,
    lastLovers: null,
    inflight: null,
  };
  // Now a demo session: the summary block carries the demo label (R18.5).
  pushLabelled(acc, [renderSummary(summary)]);
  // Item 7 (autoplay): a replay is a canned, self-running demonstration -- it
  // should SHOW a reading immediately, not wait for the viewer to type `read`.
  // Auto-run the fates spread from the bundle (the same path `read fates` takes
  // in a demo session), so `demo <name>` lands on a full reading. `doReadDemo`
  // reads only the just-installed bundle entry (no network), seeds the card
  // reveal, and renders the demo-labelled reading.
  doReadDemo(acc, "fates");
  // Item 33: the demo autoplay ENDS with a tarot destiny reading. Because this
  // is now a demo session, `doTarot` draws with the seeded RNG LOCAL to the
  // demo (never patching globalThis.crypto), so the replay's spread is
  // deterministic and offline.
  doTarot(acc, undefined);
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

function stepHistory(
  state: SessionState,
  action: Extract<Action, { type: "history" }>,
): StepResult {
  const { history } =
    action.direction === "prev"
      ? historyPrev(state.history, action.current)
      : historyNext(state.history, action.current);
  return { state: { ...state, history }, effects: [] };
}

// ---------------------------------------------------------------------------
// api.* / demo.* resolution
// ---------------------------------------------------------------------------

/** Whether an incoming async action matches the current in-flight request. */
function matchesInflight(state: SessionState, requestId: number): boolean {
  return state.inflight !== null && state.inflight.id === requestId;
}

function stepSummoned(
  state: SessionState,
  action: Extract<Action, { type: "api.summoned" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // A live summary replaces any demo state: readings, lastSpread cleared,
  // demo bundle dropped (R5.4, R18.14).
  const resolved: SessionState = {
    ...state,
    summary: action.summary,
    readings: {},
    lastSpread: null,
    demoBundle: null,
    pendingDemo: null,
    lastRitual: null,
    lastLovers: null,
    inflight: null,
  };
  const acc: Accumulator = { state: resolved, effects: [] };
  // A summon that landed on a repository with no extractable source files has
  // nothing to resurrect: surface the in-world no-Python block (R19.4) in
  // place of the usual "type read fates" summary, so the user is told the plain
  // fact instead of being invited to read an empty body.
  pushBlocks(acc, [
    action.summary.fileCount === 0
      ? renderNoPython(action.summary)
      : renderSummary(action.summary),
  ]);
  return result(acc);
}

function stepProgress(
  state: SessionState,
  action: Extract<Action, { type: "api.progress" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // Exactly one status block per phase; inflight (aria-busy) stays set
  // (R6.15, R15.13).
  const block =
    action.event.kind === "phase"
      ? renderProgress(action.event.phase)
      : renderSkipNote(action.event.note);
  const acc: Accumulator = { state, effects: [] };
  pushBlocks(acc, [block]);
  return result(acc);
}

function stepRead(
  state: SessionState,
  action: Extract<Action, { type: "api.read" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  const spread = state.lastSpread;
  const resolved: SessionState = {
    ...state,
    inflight: null,
    readings:
      spread === null
        ? state.readings
        : { ...state.readings, [spread]: action.response },
  };
  const acc: Accumulator = { state: seedCardReveal(resolved, action.response), effects: [] };
  pushBlocks(acc, renderReading(action.response));
  return result(acc);
}

function stepResurrectProgress(
  state: SessionState,
  action: Extract<Action, { type: "api.resurrect.progress" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // Exactly one status block per phase/skip-note; inflight (aria-busy) stays
  // set until the terminal result resolves (mirrors `stepProgress`, R9.2).
  const block =
    action.event.kind === "phase"
      ? resurrectPhaseBlock(action.event.phase)
      : resurrectSkipNoteBlock(action.event.note);
  const acc: Accumulator = { state, effects: [] };
  pushBlocks(acc, [block]);
  return result(acc);
}

function stepResurrectResolved(
  state: SessionState,
  action: Extract<Action, { type: "api.resurrect.resolved" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // Clear the in-flight marker and store the settled result so the view layer
  // can mount the client-side patch-download affordance (R7.3).
  const resolved: SessionState = {
    ...state,
    inflight: null,
    lastRitual: action.result,
  };
  const acc: Accumulator = { state: resolved, effects: [] };
  // Render the per-file diff / Residual_List (R7.1, R7.2, R8.1, R8.3) and the
  // Vitality_Delta / changed-card blocks (R6.3, R6.4, R6.5), labelled for a
  // demo session exactly as a reading is. The server already applies the
  // `[DEMO]` prefix to its stream lines, but the terminal renders the result
  // blocks from the decoded `RitualResult`, so the demo label is applied here.
  pushLabelled(acc, renderFileResults(action.result.files));
  pushLabelled(acc, [renderResurrectVitality(action.result)]);
  return result(acc);
}

function stepLoversProgress(
  state: SessionState,
  action: Extract<Action, { type: "api.lovers.progress" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // Exactly one status block per phase/skip-note; inflight (aria-busy) stays
  // set until the terminal result resolves (mirrors `stepResurrectProgress`).
  const block =
    action.event.kind === "phase"
      ? loversPhaseBlock(action.event.phase)
      : loversSkipNoteBlock(action.event.note);
  const acc: Accumulator = { state, effects: [] };
  pushBlocks(acc, [block]);
  return result(acc);
}

function stepLoversResolved(
  state: SessionState,
  action: Extract<Action, { type: "api.lovers.resolved" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  // Clear the in-flight marker and store the settled result so the view layer
  // can mount the lazy DMG `LoversView` (R21.*, R22.1), mirroring how
  // `stepResurrectResolved` stores `lastRitual` for the resurrection view.
  const resolved: SessionState = {
    ...state,
    inflight: null,
    lastLovers: action.result,
  };
  const acc: Accumulator = { state: resolved, effects: [] };
  // Render the Lovers result summary into the log (the authoritative text),
  // labelled for a demo session exactly as a reading / resurrection is.
  pushLabelled(acc, [loversResultBlock(action.result)]);
  return result(acc);
}

function stepFailed(
  state: SessionState,
  action: Extract<Action, { type: "api.failed" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  const resolved: SessionState = { ...state, inflight: null };
  const acc: Accumulator = { state: resolved, effects: [] };
  pushBlocks(acc, [renderError(action.error)]);
  return result(acc);
}

function stepDemoLoaded(
  state: SessionState,
  action: Extract<Action, { type: "demo.loaded" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  const name = state.pendingDemo;
  // Keep the bundle for future installs; clear the in-flight marker.
  const withBundle: SessionState = {
    ...state,
    demoBundle: action.bundle,
    inflight: null,
  };
  if (name === null || action.bundle[name] === undefined) {
    const acc: Accumulator = { state: withBundle, effects: [] };
    pushBlocks(acc, [catalogBlock()]);
    return result(acc);
  }
  const acc: Accumulator = { state: withBundle, effects: [] };
  installDemo(acc, action.bundle, name);
  return result(acc);
}

function stepDemoFailed(
  state: SessionState,
  action: Extract<Action, { type: "demo.failed" }>,
): StepResult {
  if (!matchesInflight(state, action.requestId)) return noop(state);

  const resolved: SessionState = { ...state, inflight: null, pendingDemo: null };
  const acc: Accumulator = { state: resolved, effects: [] };
  pushBlocks(acc, [
    oracleBlock("The replay would not wake from its slumber. Reload the page while online."),
  ]);
  return result(acc);
}

// ---------------------------------------------------------------------------
// abort / skip-reveal / reveal.tick / media / sound
// ---------------------------------------------------------------------------

function stepAbort(state: SessionState): StepResult {
  if (state.inflight === null) {
    return noop(state);
  }
  const resolved: SessionState = { ...state, inflight: null, pendingDemo: null };
  const acc: Accumulator = { state: resolved, effects: [] };
  pushBlocks(acc, [oracleBlock("The ritual is interrupted. The threads fall slack.")]);
  acc.effects.push({ type: "api.abort" });
  return result(acc);
}

function stepSkipReveal(state: SessionState): StepResult {
  // Escape completes both the typewriter reveal queue (R10.5) and the card
  // reveal: every card flipped, every diagnosis fully revealed (R4.5).
  return { state: completeCardReveal(completeReveal(state)), effects: [] };
}

function stepRevealTick(
  state: SessionState,
  action: Extract<Action, { type: "reveal.tick" }>,
): StepResult {
  // Reveal only animates in full motion (R16.9); in reduced motion there is
  // nothing to tick.
  if (state.motionMode !== "full" || state.reveal.queue.length === 0) {
    return noop(state);
  }
  // Record the start clock on the first tick of a running reveal; the UI reads
  // `revealedChars` with the elapsed time derived from this.
  if (state.reveal.startedAtMs === null) {
    return {
      state: { ...state, reveal: { ...state.reveal, startedAtMs: action.nowMs } },
      effects: [],
    };
  }
  // Advance the Card_Reveal one-by-one flip in position order (design D2,
  // R4.1, R4.2): a card is face-up once the elapsed time has reached its
  // `flipDoneMs`. The schedule's offsets are non-decreasing, so counting the
  // steps whose flip has finished yields a monotonic `flippedCount` that never
  // reorders, skips or omits a position.
  const schedule = state.cardReveal.schedule;
  if (schedule.length === 0) return noop(state);
  const elapsed = action.nowMs - state.reveal.startedAtMs;
  let flippedCount = 0;
  for (const step of schedule) {
    if (step.flipDoneMs <= elapsed) flippedCount++;
    else break;
  }
  if (flippedCount === state.cardReveal.flippedCount) return noop(state);
  return {
    state: { ...state, cardReveal: { ...state.cardReveal, flippedCount } },
    effects: [],
  };
}

function stepMedia(
  state: SessionState,
  action: Extract<Action, { type: "media" }>,
): StepResult {
  const motionMode = resolveMotionMode(state.motionPreference, action.prefersReduced);
  return {
    state: { ...state, prefersReduced: action.prefersReduced, motionMode },
    effects: [],
  };
}

function stepSound(
  state: SessionState,
  action: Extract<Action, { type: "sound" }>,
): StepResult {
  const sound = soundReducer(state.sound, action.event as SoundEvent);
  const activity = soundActivity(sound);
  return {
    state: { ...state, sound },
    effects: [{ type: "sound.apply", hum: activity.hum, click: activity.click }],
  };
}

/**
 * The shell reports that the masked `SoulKeyInput` accepted a key
 * (lovers-binding R24.2, R25.2, D.3). The action carries ONLY the last four
 * characters â€” never the raw key â€” so the reducer mirrors `soulKeyStatus` and
 * flips `soulSource` to `YOURS`, leaving the key value in the `apps/web` ref
 * alone. An oracle-voice confirmation names only the last four runes.
 */
function stepKeySet(
  state: SessionState,
  action: Extract<Action, { type: "byok.key-set" }>,
): StepResult {
  const resolved: SessionState = {
    ...state,
    soulKeyStatus: { keySet: true, last4: action.last4 },
    soulSource: "YOURS",
  };
  const acc: Accumulator = { state: resolved, effects: [] };
  pushLabelled(acc, [
    oracleBlock(
      `The key is bound. SOUL SOURCE: YOURS; the last four runes are ${action.last4}.`,
    ),
  ]);
  return result(acc);
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

/** A single-line oracle block (used for the terminal's own local messages). */
function oracleBlock(text: string): BlockDraft {
  const echo = renderEcho(text);
  return { ...echo, kind: "oracle" };
}

/** The "ritual underway" block shown while a request is in flight (R3.11). */
function ritualUnderwayBlock(): BlockDraft {
  return oracleBlock(
    "A ritual is already underway. Press Ctrl+C to interrupt it before starting another.",
  );
}

/** The "screen cleared" block (R15.10). */
function clearBlock(): BlockDraft {
  return oracleBlock("The screen is cleared. The reading endures.");
}

/** A block for an unrecognised command (R2.11). */
function unknownBlock(raw: string): BlockDraft {
  return oracleBlock(`Unknown command: ${raw}. Type help for the grimoire of commands.`);
}

/** The demo-catalog listing block (R18.2, R18.4). */
function catalogBlock(): BlockDraft {
  const header = "The crypt holds these recorded readings:";
  const entries = DEMO_CATALOG.map((entry) => `  ${entry.name} - ${entry.description}`);
  const hint = "Type demo <name> to replay one.";
  const text = [header, ...entries, hint].join("\n");
  return oracleBlock(text);
}

/**
 * One Progress_Line for a resurrection phase (R9.2), kind `status`. The two
 * `RESURRECT_PHASE_VOICE` layers (mystical + technical) are rendered as one
 * status block; the technical line carries the phase TOKEN verbatim so the
 * client/e2e can key its progress display off it. Mirrors `renderProgress`.
 */
function resurrectPhaseBlock(phase: ResurrectionPhase): BlockDraft {
  const voice = RESURRECT_PHASE_VOICE[phase];
  const first = renderEcho(voice.mystical);
  const second = renderEcho(voice.technical);
  return {
    kind: "status",
    demo: false,
    lines: [...first.lines, ...second.lines],
  };
}

/** A resurrection skip-note as a status block (mirrors `renderSkipNote`). */
function resurrectSkipNoteBlock(note: string): BlockDraft {
  const echo = renderEcho(note);
  return { kind: "status", demo: false, lines: echo.lines };
}

/**
 * One Progress_Line for a Lovers phase, kind `status`. The two
 * `LOVERS_PHASE_VOICE` layers (mystical + technical) are rendered as one status
 * block; the technical line carries the phase TOKEN verbatim so the client/e2e
 * can key its progress display off it. Mirrors `resurrectPhaseBlock`.
 */
function loversPhaseBlock(phase: LoversPhase): BlockDraft {
  const voice = LOVERS_PHASE_VOICE[phase];
  const first = renderEcho(voice.mystical);
  const second = renderEcho(voice.technical);
  return {
    kind: "status",
    demo: false,
    lines: [...first.lines, ...second.lines],
  };
}

/** A Lovers skip-note as a status block (mirrors `resurrectSkipNoteBlock`). */
function loversSkipNoteBlock(note: string): BlockDraft {
  const echo = renderEcho(note);
  return { kind: "status", demo: false, lines: echo.lines };
}

/**
 * Render a settled Lovers binding as a single oracle block: a mystical line,
 * then the technical facts â€” how many functions were bound, the path the
 * accepted pair came from (`llm` vs `template`), and the souls spent attributed
 * to the Soul_Source that paid. The authoritative summary lives here in the
 * log; the DMG `LoversView` (mounted from `lastLovers`) shows the full split
 * view. Pure Oracle_Voice, two layers, ASCII-only.
 */
function loversResultBlock(result: LoversResponse): BlockDraft {
  const count = result.plan.functions.length;
  const pathWord =
    result.path === "llm" ? "the living tongue" : "the old rite";
  const totalTokens =
    result.soulsSpent.promptTokens + result.soulsSpent.completionTokens;
  const whose = result.soulSource === "YOURS" ? "your key" : "the oracle";
  const cost = `$${result.soulsSpent.costUsd.toFixed(4)}`;

  const mystical = renderEcho(
    "THE LOVERS are bound. Two hearts answer one contract.",
  );
  const technical = renderEcho(
    `BOUND ${result.file} to JavaScript: ${count} function(s) via ${pathWord}.`,
  );
  const souls = renderEcho(
    `Souls spent on ${whose}: ${totalTokens} tokens, ${cost}.`,
  );
  return {
    kind: "oracle",
    demo: false,
    lines: [...mystical.lines, ...technical.lines, ...souls.lines],
  };
}

// ---------------------------------------------------------------------------
// Accumulator plumbing
// ---------------------------------------------------------------------------

/** Append raw (unlabelled) drafts to the accumulator's state. */
function pushBlocks(acc: Accumulator, drafts: readonly BlockDraft[]): void {
  acc.state = appendDrafts(acc.state, drafts);
}

/** Append drafts, applying the demo label first on a demo session (R18.5). */
function pushLabelled(acc: Accumulator, drafts: readonly BlockDraft[]): void {
  acc.state = appendDrafts(acc.state, labelled(acc.state, drafts));
}

/** Finalise an accumulator into a step result. */
function result(acc: Accumulator): StepResult {
  return { state: acc.state, effects: acc.effects };
}

/** A no-op step: the state unchanged, no effects. */
function noop(state: SessionState): StepResult {
  return { state, effects: [] };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Transition the session by one action. Pure: returns the next state and the
 * effects the adapter layer must perform; never touches DOM, clock, network or
 * storage.
 */
export function step(state: SessionState, action: Action): StepResult {
  switch (action.type) {
    case "boot":
      return stepBoot(state, action);
    case "boot.tick":
      return stepBootTick(state, action);
    case "boot.skip":
      return stepBootSkip(state);
    case "submit":
      return stepSubmit(state, action);
    case "history":
      return stepHistory(state, action);
    case "api.summoned":
      return stepSummoned(state, action);
    case "api.progress":
      return stepProgress(state, action);
    case "api.read":
      return stepRead(state, action);
    case "api.resurrect.progress":
      return stepResurrectProgress(state, action);
    case "api.resurrect.resolved":
      return stepResurrectResolved(state, action);
    case "api.lovers.progress":
      return stepLoversProgress(state, action);
    case "api.lovers.resolved":
      return stepLoversResolved(state, action);
    case "api.failed":
      return stepFailed(state, action);
    case "demo.loaded":
      return stepDemoLoaded(state, action);
    case "demo.failed":
      return stepDemoFailed(state, action);
    case "abort":
      return stepAbort(state);
    case "skip-reveal":
      return stepSkipReveal(state);
    case "reveal.tick":
      return stepRevealTick(state, action);
    case "media":
      return stepMedia(state, action);
    case "sound":
      return stepSound(state, action);
    case "byok.key-set":
      return stepKeySet(state, action);
  }
}
