// @necro/ui-crt — CRT design system components: Screen, Terminal, Card, Spread*, EvidenceScroll, SigilRitual
export const UI_CRT_VERSION = "0.0.0";

// Protocol types — the shapes shared with the readings API (types only).
export type {
  ApiPort,
  DemoBundle,
  DemoPort,
  LoversFunction,
  LoversModelOverrides,
  LoversPair,
  LoversParam,
  LoversPhase,
  LoversPlan,
  LoversProgress,
  LoversProgressEvent,
  LoversRequestArgs,
  LoversResponse,
  LoversReturns,
  LoversTypeMapEntry,
  LoversUsageAggregate,
  LoversUsageByModel,
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
  PatchDownloadPort,
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
  LOVERS_PHASE_VOICE,
  PHASE_VOICE,
  PRE_BINDING_PHRASE,
  PRE_READING_PHRASE,
  PRE_RESURRECTION_PHRASE,
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

// Sound cues — the four core Visual_Layer one-shots and the pure gate that
// decides when they may play (reuses `soundActivity`; no audio side effect).
export { SOUND_CUES, soundCueAllowed } from "./sound/sound-cue.js";
export type { SoundCue } from "./sound/sound-cue.js";

// Ambient Resurrection hum — the pure gate for the OPTIONAL low continuous
// drone that plays only while the rot-then-rebirth animation is actively
// playing, sound is on, and motion is full (visual-necromancy task 21.1). The
// lazy engine's `ambient(on)` plays it; this gate makes the decision.
export { ambientHumActive } from "./sound/ambient-hum.js";
export type { AmbientHumInput } from "./sound/ambient-hum.js";

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

// Boot schedule — the pure elapsed-time → step-index map for the Boot_Sequence
// (no clock; `use-boot` supplies the elapsed time through FramePort).
export {
  BOOT_BUDGET_MS,
  BOOT_STEP_MS,
  BOOT_TOTAL_MS,
  bootStepAt,
} from "./motion/boot-schedule.js";
export { CARD_FLIP_MS, cardRevealSchedule } from "./motion/card-reveal.js";
export type { CardRevealStep } from "./motion/card-reveal.js";
export { decaySequence } from "./motion/decay.js";
export { GLITCH_MAX_DURATION_MS, glitchProfile } from "./motion/glitch.js";
export type { GlitchParams } from "./motion/glitch.js";

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
  KeyOp,
  ModelTierArg,
  ResurrectTarget,
  SpreadArg,
} from "./command/types.js";
export { MAX_ENTRY_LENGTH } from "./command/types.js";
// `MODEL_ID_RE` is the single source of truth for the safe OpenRouter model-id
// pattern; task 11's server request schema (`apps/web`) reuses it so the client
// and server validate the SAME pattern (lovers-binding R25.7).
export { MODEL_ID_RE, parseCommand } from "./command/parse.js";
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
export { renderNoPython, renderSummary } from "./render/summary.js";
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
export { rot } from "./render/rot.js";
export {
  renderFileResult,
  renderFileResults,
} from "./render/resurrect-diff.js";
export {
  BOOT_LOGO_TEXT_EQUIVALENT,
  BOOT_STEP_COUNT,
  bootFrame,
  bootFrameKind,
  type BootFrame,
  type BootFrameKind,
} from "./render/boot.js";

// ASCII tarot cards — the pure ASCII_Card_Renderer and the shared Card_Back.
// The illustration table (`render/ascii-art.ts`) is passed in, never imported
// here, so this barrel stays clear of the lazy art chunk.
export {
  ART_ROWS,
  CARD_COLS,
  CARD_ROWS,
  asciiCard,
  asciiCardBack,
} from "./render/ascii-card.js";
export type {
  AsciiCard,
  CardArt,
  CardArtTable,
} from "./render/ascii-card.js";

// ASCII illustration table — bespoke per-CardId motifs. The heavy table
// (`CARD_ART`, `GENERIC_ART`, `artFor`) is intentionally NOT re-exported from
// this barrel: a static re-export would pull it into the first-render graph and
// defeat the chunk split. Callers reach the table only through `loadCardArt`,
// whose dynamic `import("./ascii-art.js")` lives in its own loader module so the
// table ships in its own lazy chunk, outside the first terminal render (R11.4).
export { loadCardArt } from "./render/load-card-art.js";
export type { LoadedCardArt } from "./render/load-card-art.js";

// Landing (oracle-landing-polish) — the strict 4-shade DMG Asset_Palette, the
// single source of truth that `landing/landing.css` mirrors on `--dmg-0..3` and
// the palette-purity property test asserts against. Distinct from the Spec 03
// phosphor chrome tokens above.
export { DMG_PALETTE, type DmgShade } from "./landing/palette.js";

// Landing (oracle-landing-polish) — the pure LEGACY REPOS table and the pure
// selection model the DMG `Landing` list is driven by. The three authored
// rows + the ENTER affordance, plus the cursor model (`move`/`selectedRow`/
// `activate`) that maps a row to its summon-read / focus-input effect.
export {
  ENTER_ANY_LABEL,
  LEGACY_REPOS,
  LANDING_ROWS,
  LegacyRepoSchema,
  type LandingRow,
  type LegacyRepo,
} from "./landing/repos.js";
export { activate, move, selectedRow } from "./landing/selection.js";
export type { ActivateResult, SelectionState } from "./landing/selection.js";

// Oracle-voice copy for the LEGACY REPOS list's empty / fetch-failure states
// (R19.5, R19.6, R19.7): a legitimate zero-repo result shows the empty-state
// message; a fetch failure routes to the matching in-world error copy.
export {
  LANDING_EMPTY_COPY,
  LANDING_FETCH_NETWORK_COPY,
  LANDING_FETCH_RATE_LIMIT_COPY,
  MAX_COLUMNS,
  MAX_MYSTICAL_WORDS,
  emptyListCopy,
} from "./landing/oracle-copy.js";
export type { EmptyReason, OracleCopy } from "./landing/oracle-copy.js";

// Landing (oracle-landing-polish) — the pure visibility predicate that gates
// the whole Landing region plus the HUD / preview view-models the screen-only
// `HudBar` / `PreviewWindow` render (label + SOUL hearts + PY2 curse; Seer
// availability + 3 card backs + the selected ORACLE SAYS line).
export {
  ENTER_ORACLE_SAYS,
  PREVIEW_CARD_BACKS,
  SOUL_HEARTS,
  hudModel,
  landingVisible,
  previewModel,
  soulSourceHudModel,
} from "./landing/landing-model.js";
export type {
  HudModel,
  PreviewModel,
  SoulSourceHudModel,
  SoulsSpent,
} from "./landing/landing-model.js";

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

// Demo — the fixed Demo_Catalog, the Demo_Name validation pattern, and the
// fixed Demo_Seed used to make every Visual_Layer animation deterministic.
export { DEMO_CATALOG, DEMO_NAME_PATTERN, DEMO_SEED } from "./demo/catalog.js";
export type { DemoCatalogEntry } from "./demo/catalog.js";

// Demo seeding — the pure seed-resolution the Visual_Layer feeds to the
// Glitch_Effect corruption and the Rot_Transform (`DEMO_SEED` in Demo mode, a
// deterministic per-reading/ritual seed otherwise).
export { isDemoSession, resolveSeed } from "./session/demo-seed.js";

// Visual reading selectors — the pure view of the current reading's drawn
// cards the Visual_Layer card overlay draws (order-preserving, log stays
// authoritative; visual-necromancy task 16.1).
export {
  currentVisualReading,
  loversEligible,
  visualCardIndex,
  visualCards,
  type VisualCard,
} from "./session/visual-reading.js";

// Session reducer — the pure state machine driving the Terminal. `step` and
// `initialState` are the only runtime exports; the SessionState / Action /
// Effect / InflightRequest shapes are types the UI layer and tests consume.
export { initialState } from "./session/state.js";
export type {
  Action,
  BootState,
  CardRevealState,
  Effect,
  InflightRequest,
  RevealState,
  SessionModelOverrides,
  SessionState,
  SoulKeyStatus,
  SoulSource,
} from "./session/state.js";
export { step } from "./session/reducer.js";

// Sound loader — the production SoundLoaderPort. The engine itself stays a
// separate lazy chunk behind `loadEngine`; engine.ts is never barrelled.
export { loadEngine } from "./sound/load-engine.js";

// CRT design tokens — the single source of truth the stylesheet mirrors.
export {
  CRT_AFTERGLOW_MS,
  CRT_BG,
  CRT_BURNING_AMBER,
  CRT_ERROR,
  CRT_FG,
  CRT_FG_DIM,
  CRT_FLICKER_CYCLES_PER_S,
  CRT_FLICKER_DEPTH,
  CRT_FLIP_MS,
  CRT_FOCUS,
  CRT_GLITCH_MAX_MS,
  CRT_GLOW_ALPHA,
  CRT_GLOW_RADIUS_PX,
  CRT_ROT_FRAME_MIN_MS,
  CRT_SCANLINE_ALPHA,
  CRT_SCANLINE_PERIOD_PX,
  CRT_SHAKE_MS,
  CRT_STILL_DEAD,
} from "./tokens.js";

// React components — the CRT design system. `Terminal` is the live terminal;
// the rest are the screen chrome and the block/spread/evidence renderers.
export { Terminal, type TerminalProps } from "./components/Terminal.js";
// The port-driven resurrection result-view mount (oracle-landing-polish, Part B
// bug 2). It mounts the concrete `apps/web` `ResurrectionResult` lazily through
// the `resurrectView` port so that chunk stays live and off the initial route,
// falling back to the plain inline DOWNLOAD PATCH button when no port is wired.
export {
  ResurrectResultView,
  type ResurrectResultViewProps,
} from "./components/ResurrectResultView.js";
// The port-driven DMG Lovers split-view mount (lovers-binding task 14.4). It
// mounts the concrete `apps/web` `LoversView` lazily through the `loversView`
// port so that chunk stays live and off the initial route; the authoritative
// result summary stays in the Output_Log.
export {
  LoversResultView,
  type LoversResultViewProps,
} from "./components/LoversResultView.js";
export { Screen, type ScreenProps } from "./components/Screen.js";
export {
  OutputLog,
  type OutputLogProps,
} from "./components/OutputLog.js";
export {
  OutputBlockView,
  type OutputBlockViewProps,
} from "./components/OutputBlockView.js";
export {
  BOOT_SKIP_HINT,
  BootOverlay,
  type BootOverlayProps,
} from "./components/BootOverlay.js";
export {
  AsciiCardView,
  type AsciiCardViewProps,
} from "./components/AsciiCardView.js";
export {
  CardReveal,
  type CardRevealProps,
} from "./components/CardReveal.js";
export {
  RotOverlay,
  type RotOverlayProps,
} from "./components/RotOverlay.js";
export {
  VitalityCounter,
  type VitalityCounterProps,
} from "./components/VitalityCounter.js";
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
// Soul_Source HUD indicator (lovers-binding task 10.6, R24.4, D.6): the
// always-present terminal-chrome line stating the active Soul_Source, driven by
// `soulSourceHudModel(state)`, with the documented souls-spent attribution seam.
export {
  SoulSourceHud,
  type SoulSourceHudProps,
} from "./components/SoulSourceHud.js";
export {
  ROT_FRAME_COUNT,
  RotReveal,
  type RotRevealProps,
} from "./components/RotReveal.js";

// Hooks — the browser-facing adapters that drive the pure reducer and motion.
export {
  useTerminal,
  SOUND_UNAVAILABLE_MESSAGE,
  type TerminalController,
  type UseTerminalOptions,
} from "./hooks/use-terminal.js";
export { useMotion, type MotionSignal } from "./hooks/use-motion.js";
export {
  useBoot,
  type BootPhase,
  type UseBootOptions,
} from "./hooks/use-boot.js";
export { useReveal, type UseRevealOptions } from "./hooks/use-reveal.js";
export {
  useSound,
  type UseSoundOptions,
  type SoundCueRequest,
} from "./hooks/use-sound.js";
export {
  useBackgroundTheme,
  type UseBackgroundThemeOptions,
} from "./hooks/use-background-theme.js";
export {
  MIN_ROT_FRAME_MS,
  useRot,
  type UseRotOptions,
  type UseRotResult,
} from "./hooks/use-rot.js";
export {
  MIN_COUNT_FRAME_MS,
  useCountUp,
  type UseCountUpOptions,
  type UseCountUpResult,
} from "./hooks/use-count-up.js";

// Resurrection vitality — render inputs (types only) and the Vitality_Delta /
// changed-card renderer for the terminal resurrection result view (task 14.9).
export type {
  ChangedCard,
  ChangedCardKind,
  VitalityResult,
} from "./protocol.js";
export { renderResurrectVitality } from "./render/resurrect-vitality.js";

// ── Arcana_Visions (Spec 06) — the pixel-art presentation layer ──────────────
// An additive skin over Spec 05: pure modules (integer scale, manifest loader,
// motion zones, ritual timeline, pixel-card model, background theme) plus the
// screen-only React components. The Web Audio engine stays a separate lazy
// chunk reached ONLY through `loadBackgroundTheme`'s dynamic import — the
// engine impl is never barrelled here, so it never enters the first terminal
// render graph (R8.9, R11.2; mirrors the `loadEngine` split above).

// Integer scale — the largest whole-number display factor for a logical size.
export { integerScale } from "./arcana/integer-scale.js";
export type { Size } from "./arcana/integer-scale.js";

// Manifest loader — validate the committed asset manifest at the boundary and
// distil it to the trusted `id -> ArcanaAsset` view the app consumes.
export {
  DIAGNOSIS_CARD_IDS,
  ManifestBandsSchema,
  ManifestImageSchema,
  ManifestSchema,
  loadManifest,
} from "./arcana/manifest.js";
export type { ArcanaAsset, ManifestImage } from "./arcana/manifest.js";

// Motion zones — the authored Motion_Zone_Table, the Flash_Limit helper, and
// the pure validator the PixelCard runtime guard and the property test use.
export {
  MOTION_ZONES,
  luminanceChangesPerSecond,
  validateMotionZone,
} from "./arcana/motion-zones.js";
export type {
  Bands,
  MotionEffect,
  MotionZone,
  MotionZoneIssue,
  Rect,
} from "./arcana/motion-zones.js";

// Ritual timeline — the pure Resurrection_Ritual phase schedule (no clock) and
// its 3 s total ceiling.
export { RITUAL_TOTAL_MS, ritualTimeline } from "./arcana/ritual-timeline.js";
export type {
  RitualOpts,
  RitualPhase,
  RitualStep,
} from "./arcana/ritual-timeline.js";

// Pixel-card model — the display model one Pixel_Card renders, and the
// screen-reader alt-text builder.
export { cardAltText, pixelCardModel } from "./arcana/pixel-card-model.js";
export type { PixelCardModel } from "./arcana/pixel-card-model.js";

// Background theme — the pure chiptune composer, its peak-gain measure, and the
// pure gate that decides when the theme may play (mirrors `soundCueAllowed`).
export {
  backgroundThemeActive,
  composeTheme,
  peakGain,
} from "./sound/background-theme.js";
export type { ThemeScore, ThemeVoice } from "./sound/background-theme.js";

// Background theme engine — ONLY the port shape, the engine interface, and the
// gain ceiling are surfaced. `createBackgroundThemeEngine` (the Web Audio impl)
// is deliberately NOT re-exported here: a static re-export would pull the
// synthesis engine into the first-render graph and defeat the chunk split.
// Callers reach the engine only through `loadBackgroundTheme`, whose dynamic
// `import("./background-theme-engine.js")` keeps it in its own lazy chunk,
// outside the first terminal render (R8.9, R11.2).
export { MAX_THEME_GAIN } from "./sound/background-theme-engine.js";
export type {
  BackgroundThemeEngine,
  BackgroundThemeLoaderPort,
} from "./sound/background-theme-engine.js";

// Background theme loader — the production BackgroundThemeLoaderPort. The engine
// itself stays a separate lazy chunk behind this loader's string-literal
// dynamic import; the engine module is never barrelled.
export { loadBackgroundTheme } from "./sound/load-background-theme.js";

// Arcana React components — the screen-only pixel-art views: a single card, a
// spread row, the fullscreen inspector, the Resurrection_Ritual wrapper, and
// the Seer landing portrait.
export { PixelCard, type PixelCardProps } from "./components/PixelCard.js";
export {
  SpreadPixelView,
  type SpreadPixelViewProps,
} from "./components/SpreadPixelView.js";
export {
  FullscreenCardView,
  type FullscreenCardViewProps,
} from "./components/FullscreenCardView.js";
export {
  NecronomiconRitual,
  type NecronomiconRitualProps,
} from "./components/NecronomiconRitual.js";
export {
  SeerPortrait,
  type SeerPortraitProps,
} from "./components/SeerPortrait.js";

// Landing (oracle-landing-polish) — the screen-only DMG LEGACY REPOS list: a
// `role="listbox"` of `role="option"` rows reflecting the parent's
// `selectedIndex`, with the decorative ▶ cursor kept out of the accessible
// name and hover/click selection + activation.
export {
  LegacyRepoList,
  type LegacyRepoListProps,
} from "./components/LegacyRepoList.js";

// Landing (oracle-landing-polish) — the screen-only DMG HUD bar and hint bar.
// Both are presentational: `HudBar` renders the fixed label + SOUL hearts (one
// text accessible label, decorative glyphs) + PY2 curse from `hudModel`;
// `HintBar` renders the fixed key-binding hint strip.
export { HudBar, type HudBarProps } from "./components/HudBar.js";
export { HINT_BAR_TEXT, HintBar } from "./components/HintBar.js";

// Landing (oracle-landing-polish) — the screen-only DMG PREVIEW window: the
// reused pixel `SeerPortrait` (shown whenever the landing is visible — the
// Part B bug-1 fix), three face-down eye/moon Card_Backs (never a pentagram),
// and the ORACLE SAYS line, all in the strict 4-shade DMG palette.
export {
  PreviewWindow,
  type PreviewWindowProps,
} from "./components/PreviewWindow.js";

// Landing (oracle-landing-polish) — the screen-only DMG Landing region that
// composes the HUD, the LEGACY REPOS list, the PREVIEW window and the hint bar.
// Gated by `landingVisible(state)` (returns `null` otherwise); owns the local
// selection cursor and the root-scoped keydown handler that never steals the
// NECRO> input's keys. Mounted inside `<Terminal>` in task 9.2.
export { Landing, type LandingProps } from "./components/Landing.js";
