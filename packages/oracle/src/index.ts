// @necro/oracle — deck registry, detectors, spreads, vitality (pure, no adapters)
//
// This is the browser-safe main entry. It must never import Node `fs` APIs or
// the Node-only `src/node.ts` builder — those are reachable only via the
// "./node" subpath export. Keeping this barrel free of any `node:`/`fs` import
// is what guarantees the terminal web bundle stays browser-safe (R2.3, R21.3).
export const ORACLE_VERSION = "0.0.0";

// --- Core primitive schemas and types (registry/schema) -------------------
export {
  CardIdSchema,
  SeveritySchema,
  EvidenceSchema,
  CardDefinitionSchema,
  CardDrawSchema,
  SpreadPositionSchema,
  GateIdSchema,
  VerdictSchema,
  type CardId,
  type Severity,
  type Evidence,
  type CardDefinition,
  type CardDraw,
  type SpreadPosition,
  type GateId,
  type Verdict,
} from "./registry/schema.js";

// --- Card registry (registry/cards) ---------------------------------------
export { CARD_REGISTRY, getCard } from "./registry/cards.js";

// --- Snapshot types and schemas (snapshot/types) --------------------------
export {
  RepoRefSchema,
  LangSchema,
  FileEntrySchema,
  RepoMetaSchema,
  OversizeFileItemSchema,
  RepoSnapshotSchema,
  type RepoRef,
  type Lang,
  type FileEntry,
  type RepoMeta,
  type OversizeFileItem,
  type RepoSnapshot,
  type GitHubSnapshotBuilder,
} from "./snapshot/types.js";

// --- Browser-safe snapshot builder (file-map only) ------------------------
// NOTE: buildSnapshotFromDirectory is intentionally NOT exported here — it is
// Node-only and lives behind the "./node" subpath (src/node.ts).
export {
  buildSnapshotFromFileMap,
  type SnapshotFromFileMapOpts,
} from "./snapshot/builder-file-map.js";

// --- Tree-sitter parser (parser/tree-sitter) ------------------------------
export {
  initParser,
  parsePython,
  parseJavascript,
  queryPython,
  hasLegacyPythonNodes,
  type Tree,
  type QueryMatch,
} from "./parser/tree-sitter.js";

// --- Manifest parsing (parser/manifest) -----------------------------------
export {
  parseAllManifests,
  detectPythonVersion,
  ParsedDependencySchema,
  ManifestSchema,
  ManifestKindSchema,
  PythonVersionSignalSchema,
  type ParsedDependency,
  type Manifest,
  type ManifestKind,
  type PythonVersionSignal,
} from "./parser/manifest.js";

// --- Detector shared types (detectors/types) ------------------------------
export {
  type Detector,
  type DetectorOpts,
  type RegistryEntry,
  type RegistryData,
  type OsvVulnerability,
  type OsvData,
} from "./detectors/types.js";

// --- The eleven snapshot detectors ----------------------------------------
export { detectJudgement } from "./detectors/judgement.js";
export { detectTower } from "./detectors/tower.js";
export { detectDevil } from "./detectors/devil.js";
export { detectDeath } from "./detectors/death.js";
export { detectWheel } from "./detectors/wheel.js";
export { detectHermit } from "./detectors/hermit.js";
export { detectHangedMan } from "./detectors/hanged-man.js";
export { detectTemperance } from "./detectors/temperance.js";
export { detectJustice } from "./detectors/justice.js";
export { detectMoon } from "./detectors/moon.js";
export { detectStar } from "./detectors/star.js";

// --- The World (destiny) draw (detectors/world) ---------------------------
export { computeWorldDraw } from "./detectors/world.js";

// --- Spread engine (spread/assign) ----------------------------------------
// Only `assignSpread` is exported here. `SpreadKind`/`SpreadKindSchema` are
// re-exported from ./reading/run.js below as the single canonical source to
// avoid a duplicate-export name collision (assign.ts also defines SpreadKind).
export { assignSpread } from "./spread/assign.js";

// --- Vitality scoring (scoring/vitality) ----------------------------------
export { computeVitality, computeVitalityDelta } from "./scoring/vitality.js";

// --- Reading orchestrator and schemas (reading/run) -----------------------
// Canonical source of SpreadKind / SpreadKindSchema.
export {
  runReading,
  SpreadKindSchema,
  ReadingOptsSchema,
  ReadingSchema,
  type SpreadKind,
  type ReadingOpts,
  type Reading,
} from "./reading/run.js";

// --- Secret masking utility (util/mask) -----------------------------------
export { maskSecret } from "./util/mask.js";

// --- Typed errors (util/errors) -------------------------------------------
export {
  NecroError,
  NecroErrorCodeSchema,
  type NecroErrorCode,
} from "./util/errors.js";
