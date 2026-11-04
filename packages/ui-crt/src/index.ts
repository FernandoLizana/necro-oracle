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
  SpreadArg,
} from "./command/types.js";
export { MAX_ENTRY_LENGTH } from "./command/types.js";
export { parseCommand } from "./command/parse.js";
export { printCommand } from "./command/print.js";
