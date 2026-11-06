// @necro/ui-crt — CRT design system components: Screen, Terminal, Card, Spread*, EvidenceScroll, SigilRitual
export const UI_CRT_VERSION = "0.0.0";

// Protocol types — the shapes shared with the readings API (types only).
export type {
  ApiPort,
  DemoBundle,
  DemoPort,
  PlayableSpread,
  ProgressEvent,
  ReadProgress,
  ReadingPhase,
  ReadingResponse,
  ResurrectDiffLine,
  ResurrectFileResult,
  ResurrectionPhase,
  ResurrectProgress,
  ResurrectProgressEvent,
  ResurrectResidual,
  RitualResponse,
  SummonSummary,
} from "./protocol.js";

// Ports — every side effect the Terminal is constructed with (types only).
export type {
  FramePort,
  MediaPort,
  SoundEngine,
  SoundLoaderPort,
  StoragePort,
  TerminalPorts,
  VisibilityPort,
} from "./ports.js";

// Voice — the mystical card lines and the fixed Oracle_Voice terminal copy.
export { VOICE_TABLE, type Orientation } from "./voice/voice-table.js";
export {
  BOOT_PHRASE,
  DEMO_LABEL,
  EXTERNAL_SKIP_NOTE,
  PHASE_VOICE,
  PRE_READING_PHRASE,
  RESURRECT_PHASE_VOICE,
  vitalityVoice,
  type PhaseVoice,
} from "./voice/phrases.js";

// Text — sanitiser and 72-column wrapper (defends every rendered string).
export { sanitizeText } from "./text/sanitize.js";
export { LINE_WIDTH, wrapSegments, wrapText } from "./text/wrap.js";
export type { Segment } from "./text/wrap.js";

// Sound reducer — pure state machine for CRT hum/click (no audio side effects).
export { soundActivity, soundReducer } from "./sound/sound-reducer.js";
export type {
  SoundActivity,
  SoundEvent,
  SoundPreference,
  SoundState,
} from "./sound/sound-reducer.js";

// Motion — effective mode resolution and the reveal schedule (pure, no clock).
// `MotionMode` and `MotionPreference` are canonically owned by motion-mode.ts;
// `SoundPreference` stays canonically re-exported from sound-reducer.ts above.
export { resolveMotionMode } from "./motion/motion-mode.js";
export type { MotionMode, MotionPreference } from "./motion/motion-mode.js";
export {
  REVEAL_BASE_CPS,
  REVEAL_MAX_MS,
  revealDurationMs,
  revealRate,
  revealedChars,
} from "./motion/reveal.js";

// Preferences — validate raw persisted strings into safe preference values.
// Types (MotionPreference, SoundPreference) are re-exported from their
// canonical modules above, so only the values are surfaced from here.
export {
  MOTION_STORAGE_KEY,
  SOUND_STORAGE_KEY,
  parseMotionPreference,
  parseSoundPreference,
} from "./prefs/prefs.js";

// Commands — parse a terminal entry and render it back to canonical text.
export type {
  Command,
  CommandMotionArg,
  CommandSoundArg,
  ExplainTarget,
  ResurrectTarget,
  SpreadArg,
} from "./command/types.js";
export { MAX_ENTRY_LENGTH } from "./command/types.js";
export { parseCommand } from "./command/parse.js";
export { printCommand } from "./command/print.js";

// Render — the block/line output model and the only Evidence_Link builder.
export { blockText, lineText } from "./render/blocks.js";
export type {
  BlockDraft,
  BlockKind,
  OutputBlock,
  OutputLine,
} from "./render/blocks.js";
export { buildEvidenceLink } from "./render/evidence-link.js";
export {
  renderCardBlock,
  renderEcho,
  renderProgress,
  renderReading,
  renderSkipNote,
  type RenderContext,
} from "./render/reading.js";
export { renderSummary } from "./render/summary.js";
export { renderHelp } from "./render/help.js";
export { renderExplain } from "./render/explain.js";
export {
  demoUnavailableError,
  invalidResponseError,
  networkError,
  renderError,
  upstreamError,
} from "./render/errors.js";
export { withDemoLabel } from "./render/demo-label.js";
export {
  renderFileResult,
  renderFileResults,
} from "./render/resurrect-diff.js";

// Session — command history, the bounded output log, and the pinned reference.
export {
  HISTORY_MAX,
  historyNext,
  historyPrev,
  historyPush,
} from "./session/history.js";
export type { History } from "./session/history.js";
export { LOG_MAX_LINES, appendBlocks } from "./session/log.js";
export { formatPinnedRef } from "./session/pinned-ref.js";

// Demo — the fixed Demo_Catalog and the Demo_Name validation pattern.
export { DEMO_CATALOG, DEMO_NAME_PATTERN } from "./demo/catalog.js";
export type { DemoCatalogEntry } from "./demo/catalog.js";

// Session reducer — the pure state machine driving the Terminal. `step` and
// `initialState` are the only runtime exports; the SessionState / Action /
// Effect / InflightRequest shapes are types the UI layer and tests consume.
export { initialState } from "./session/state.js";
export type {
  Action,
  Effect,
  InflightRequest,
  RevealState,
  SessionState,
} from "./session/state.js";
export { step } from "./session/reducer.js";

// Sound loader — the production SoundLoaderPort. The engine itself stays a
// separate lazy chunk behind `loadEngine`; engine.ts is never barrelled.
export { loadEngine } from "./sound/load-engine.js";

// CRT design tokens — the single source of truth the stylesheet mirrors.
export {
  CRT_AFTERGLOW_MS,
  CRT_BG,
  CRT_ERROR,
  CRT_FG,
  CRT_FG_DIM,
  CRT_FLICKER_CYCLES_PER_S,
  CRT_FLICKER_DEPTH,
  CRT_FOCUS,
  CRT_GLOW_ALPHA,
  CRT_GLOW_RADIUS_PX,
  CRT_SCANLINE_ALPHA,
  CRT_SCANLINE_PERIOD_PX,
} from "./tokens.js";

// React components — the CRT design system. `Terminal` is the live terminal;
// the rest are the screen chrome and the block/spread/evidence renderers.
export { Terminal, type TerminalProps } from "./components/Terminal.js";
export { Screen, type ScreenProps } from "./components/Screen.js";
export {
  OutputLog,
  type OutputLogProps,
} from "./components/OutputLog.js";
export {
  OutputBlockView,
  type OutputBlockViewProps,
} from "./components/OutputBlockView.js";
export { Card, type CardProps } from "./components/Card.js";
export { Spread, type SpreadProps } from "./components/Spread.js";
export {
  EvidenceScroll,
  type EvidenceScrollProps,
} from "./components/EvidenceScroll.js";
export {
  CommandLine,
  type CommandLineProps,
} from "./components/CommandLine.js";
export { ButtonRow, type ButtonRowProps } from "./components/ButtonRow.js";

// Hooks — the browser-facing adapters that drive the pure reducer and motion.
export {
  useTerminal,
  SOUND_UNAVAILABLE_MESSAGE,
  type TerminalController,
} from "./hooks/use-terminal.js";
export { useMotion, type MotionSignal } from "./hooks/use-motion.js";
export { useReveal, type UseRevealOptions } from "./hooks/use-reveal.js";
export { useSound, type UseSoundOptions } from "./hooks/use-sound.js";

// Resurrection vitality — render inputs (types only) and the Vitality_Delta /
// changed-card renderer for the terminal resurrection result view (task 14.9).
export type {
  ChangedCard,
  ChangedCardKind,
  VitalityResult,
} from "./protocol.js";
export { renderResurrectVitality } from "./render/resurrect-vitality.js";
