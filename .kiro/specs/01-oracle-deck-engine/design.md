# Design Document: Oracle Deck Engine (`packages/oracle`)

## Overview

The Oracle Deck Engine is the deterministic, pure-TypeScript core of the Necro-Oracle. It accepts a `RepoSnapshot` and produces an evidence-backed tarot `Reading`: a set of `CardDraw` objects, a positional spread, and a vitality score. No network calls, no LLM calls, no side effects — every function is deterministic given the same inputs. LLMs in the coven layer interpret the evidence; this package only produces it.

The package ships two entry points:
- `@necro/oracle` (`src/index.ts`) — browser-safe main entry. No Node.js `fs` imports.
- `@necro/oracle/node` (`src/node.ts`) — Node-only entry. Exports `buildSnapshotFromDirectory`.

---

## Architecture

### Monorepo dependency graph

```
oracle  ←  grimoires  ←  coven  ←  (web, cli, mcp-server, action)
                                       ↑
                              adapters injected via ports
                         (sandbox, github, llm, voice)
```

`@necro/oracle` has **no runtime dependencies** on any adapter package. Adapters inject data through parameters (`registryData`, `osvData`, `GitHubSnapshotBuilder`). `packages/oracle` is the only package that `packages/grimoires` fixers may import, and it must never import from `packages/grimoires`, `packages/coven`, or any adapter.

### Module map inside `packages/oracle/src/`

```
src/
  index.ts                   — main entry point (re-exports all public API, browser-safe)
  node.ts                    — Node-only entry (re-exports buildSnapshotFromDirectory)
  registry/
    cards.ts                 — CARD_REGISTRY constant, getCard(), CardDefinition schema
    schema.ts                — zod schemas for all shared types
  snapshot/
    types.ts                 — RepoRef, FileEntry, RepoMeta, RepoSnapshot zod schemas
    builder-file-map.ts      — buildSnapshotFromFileMap()
    builder-directory.ts     — buildSnapshotFromDirectory() (Node-only; imported by node.ts)
  parser/
    tree-sitter.ts           — parsePython(), queryPython(), hasLegacyPythonNodes() (lazy WASM init)
    manifest.ts              — parseAllManifests(), detectPythonVersion(), ParsedDependency
  detectors/
    judgement.ts             — The XX — Dead Runtime
    tower.ts                 — The XVI — Rotting Dependencies
    devil.ts                 — The XV — Security Sins
    death.ts                 — The XIII — Dead Code
    wheel.ts                 — The X — No Tests
    hermit.ts                — The IX — Missing Docs
    hanged-man.ts            — The XII — Stagnation
    temperance.ts            — The XIV — No CI
    justice.ts               — The XI — Missing License
    moon.ts                  — The XVIII — Complexity
    star.ts                  — The XVII — Hope
    world.ts                 — The XXI — Destiny (computeWorldDraw only)
  spread/
    assign.ts                — assignSpread(), SpreadPosition, SHA-seeded tiebreak
  scoring/
    vitality.ts              — computeVitality(), computeVitalityDelta()
  reading/
    run.ts                   — runReading() (the single async orchestrator)
  util/
    mask.ts                  — maskSecret()
    errors.ts                — NecroError, error code constants
```

### Component diagram

```mermaid
graph TD
    subgraph "packages/oracle (pure)"
        IDX["src/index.ts (main entry)"]
        NODE["src/node.ts (node entry)"]

        REG["registry/cards.ts<br/>CARD_REGISTRY, getCard"]
        SCH["registry/schema.ts<br/>Zod schemas"]

        SNAP_FM["snapshot/builder-file-map.ts<br/>buildSnapshotFromFileMap"]
        SNAP_DIR["snapshot/builder-directory.ts<br/>buildSnapshotFromDirectory"]

        TS["parser/tree-sitter.ts<br/>parsePython, queryPython<br/>hasLegacyPythonNodes"]
        MAN["parser/manifest.ts<br/>parseAllManifests<br/>detectPythonVersion"]

        DET_J["detectors/judgement.ts"]
        DET_T["detectors/tower.ts"]
        DET_D["detectors/devil.ts"]
        DET_DE["detectors/death.ts"]
        DET_W["detectors/wheel.ts"]
        DET_H["detectors/hermit.ts"]
        DET_HM["detectors/hanged-man.ts"]
        DET_TE["detectors/temperance.ts"]
        DET_JU["detectors/justice.ts"]
        DET_M["detectors/moon.ts"]
        DET_S["detectors/star.ts"]
        DET_WO["detectors/world.ts"]

        SPREAD["spread/assign.ts<br/>assignSpread"]
        VIT["scoring/vitality.ts<br/>computeVitality"]
        RUN["reading/run.ts<br/>runReading"]
        MASK["util/mask.ts<br/>maskSecret"]
        ERR["util/errors.ts<br/>NecroError"]
    end

    IDX --> REG
    IDX --> SCH
    IDX --> SNAP_FM
    IDX --> TS
    IDX --> MAN
    IDX --> DET_J & DET_T & DET_D & DET_DE & DET_W & DET_H & DET_HM & DET_TE & DET_JU & DET_M & DET_S & DET_WO
    IDX --> SPREAD
    IDX --> VIT
    IDX --> RUN
    IDX --> MASK
    IDX --> ERR

    NODE --> SNAP_DIR

    RUN --> MAN
    RUN --> DET_J & DET_T & DET_D & DET_DE & DET_W & DET_H & DET_HM & DET_TE & DET_JU & DET_M & DET_S
    RUN --> SPREAD
    RUN --> VIT

    TS --> ERR
    SNAP_DIR --> ERR
    REG --> ERR
```

---

## Data Models

All runtime data passes through zod schemas at boundaries. The schemas below are the authoritative definitions; TypeScript types are inferred with `z.infer<typeof Schema>`.

### Core primitive schemas

```typescript
// src/registry/schema.ts

import { z } from "zod";

// --- CardId ---
export const CardIdSchema = z.enum([
  "judgement",
  "tower",
  "devil",
  "death",
  "wheel",
  "hermit",
  "hanged_man",
  "temperance",
  "justice",
  "moon",
  "star",
  "world",
]);
export type CardId = z.infer<typeof CardIdSchema>;

// --- Severity ---
export const SeveritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type Severity = z.infer<typeof SeveritySchema>;

// --- Evidence ---
export const EvidenceSchema = z.object({
  kind: z.string().min(1),
  path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  detail: z.string(),
  source: z.enum(["static", "github", "osv", "registry", "sandbox"]),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// --- CardDefinition (registry entry) ---
export const CardDefinitionSchema = z.object({
  id: z.string().min(1).max(40).describe("Snake_case card identifier"),
  numeral: z.string().min(1).describe("Roman numeral (e.g. 'XX', 'XVI')"),
  name: z.string().min(1).max(60).describe("Display name"),
  uprightMeaning: z.string().min(1).max(500).describe("Technical upright description"),
  reversedMeaning: z.string().min(1).max(500).describe("Technical reversed description"),
  weight: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Vitality penalty weight; 0 for star and world"),
  linkedGrimoireIds: z
    .array(z.string().min(1).max(40))
    .max(20)
    .describe("Grimoire ids that can address this card"),
});
export type CardDefinition = z.infer<typeof CardDefinitionSchema>;

// --- CardDraw ---
export const CardDrawSchema = z.object({
  card: CardIdSchema,
  severity: SeveritySchema,
  orientation: z.enum(["upright", "reversed"]),
  evidence: z.array(EvidenceSchema),
  summary: z.string().describe("Short deterministic text, no LLM"),
  narration: z.string().optional().describe("LLM-written oracle voice narration; absent in oracle package"),
  grimoires: z.array(z.string()).describe("Grimoire ids applicable to this draw"),
});
export type CardDraw = z.infer<typeof CardDrawSchema>;

// --- SpreadPosition ---
export const SpreadPositionSchema = z.object({
  position: z.number().int().min(1).describe("1-based position index in spread"),
  label: z.string().describe("Position name, e.g. 'The Corpse'"),
  draw: CardDrawSchema.nullable().describe("Null when void position"),
  description: z.string().optional().describe("Void sentinel description when draw is null"),
});
export type SpreadPosition = z.infer<typeof SpreadPositionSchema>;

// --- NecroError ---
export const NecroErrorCodeSchema = z.enum([
  "REGISTRY_INVALID",
  "CARD_NOT_FOUND",
  "PARSER_INIT_FAILED",
  "FILE_TOO_LARGE",
  "INVALID_QUERY_PATTERN",
  "SNAPSHOT_DIR_NOT_FOUND",
  "INVALID_REPO_META",
  "DETECTOR_FAILED",
]);
export type NecroErrorCode = z.infer<typeof NecroErrorCodeSchema>;

export class NecroError extends Error {
  readonly code: NecroErrorCode;
  readonly userMessage: string;  // Oracle-voice message shown to users
  override readonly cause?: unknown;

  constructor(code: NecroErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "NecroError";
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

// --- Verdict (for computeWorldDraw) ---
export const GateIdSchema = z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]);

export const VerdictSchema = z.object({
  status: z.enum(["REVIVED", "UNDEAD", "STILL_DEAD"]),
  passedGates: z.array(GateIdSchema),
  failedGates: z.array(GateIdSchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;
```

### Snapshot schemas

```typescript
// src/snapshot/types.ts

import { z } from "zod";

// --- RepoRef ---
export const RepoRefSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  sha: z.string().min(1),
  defaultBranch: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

// --- FileEntry ---
export const LangSchema = z.enum(["python", "js", "ts", "html", "other"]);
export type Lang = z.infer<typeof LangSchema>;

export const FileEntrySchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative().describe("File size in bytes"),
  lang: LangSchema,
  sha: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

// --- RepoMeta ---
export const RepoMetaSchema = z.object({
  pushedAt: z.string().nullable().describe("ISO 8601 UTC string or null"),
  isArchived: z.boolean(),
  openIssueCount: z.number().int().nonnegative(),
  openPRCount: z.number().int().nonnegative(),
  oldestOpenPRAgeDays: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Age in whole days of oldest open PR, or null"),
  latestReleaseAt: z.string().nullable().describe("ISO 8601 UTC string or null"),
  licenseKey: z
    .string()
    .nullable()
    .describe("SPDX identifier, 'NOASSERTION', or null if absent"),
});
export type RepoMeta = z.infer<typeof RepoMetaSchema>;

// --- Oversize file evidence item (subset of Evidence) ---
export const OversizeFileItemSchema = z.object({
  kind: z.literal("file_skipped"),
  path: z.string(),
  detail: z.literal("too large to divine"),
  source: z.literal("static"),
});
export type OversizeFileItem = z.infer<typeof OversizeFileItemSchema>;

// --- RepoSnapshot ---
// Note: `contents` is a Map<string, string> at runtime (keyed by file path → file text).
// In test fixtures and serialized form (buildSnapshotFromFileMap input), it is
// Record<string, string>. The zod schema validates the plain-object form;
// buildSnapshotFromFileMap converts it to a Map internally.
export const RepoSnapshotSchema = z.object({
  ref: RepoRefSchema,
  files: z.array(FileEntrySchema),
  meta: RepoMetaSchema,
  manifests: z.array(z.unknown()).describe("Parsed manifests; typed as Manifest[] in manifest.ts"),
  // contents is runtime Map<string, string>; validated indirectly through builder functions
  oversizeFiles: z.array(OversizeFileItemSchema),
  truncated: z.boolean(),
  createdAt: z.string().describe("ISO 8601 UTC string set at snapshot construction time"),
});
// The runtime type adds the contents Map:
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema> & {
  contents: Map<string, string>;
};

// --- GitHubSnapshotBuilder interface ---
export interface GitHubSnapshotBuilder {
  build(ref: RepoRef): Promise<RepoSnapshot>;
}
```

### Manifest and dependency schemas

```typescript
// src/parser/manifest.ts (partial schema section)

import { z } from "zod";

export const ParsedDependencySchema = z.object({
  name: z.string().min(1),
  versionSpec: z.string().describe("Raw specifier as written, e.g. '>=1.2', or '' when absent"),
  extras: z.array(z.string()).describe("Package extras, e.g. ['security'], empty array when absent"),
});
export type ParsedDependency = z.infer<typeof ParsedDependencySchema>;

export const PythonVersionSignalSchema = z.enum([
  "py2_only",
  "py3_only",
  "straddling",
  "unknown",
]);
export type PythonVersionSignal = z.infer<typeof PythonVersionSignalSchema>;

export const ManifestKindSchema = z.enum([
  "requirements_txt",
  "setup_py",
  "pyproject_toml",
  "pipfile",
  "package_json",
]);

export const ManifestSchema = z.object({
  path: z.string(),
  kind: ManifestKindSchema,
  parsed: z.boolean(),
  parseError: z.string().optional(),
  dependencies: z.array(ParsedDependencySchema),
  raw: z.record(z.unknown()).optional().describe("Kind-specific parsed data"),
});
export type Manifest = z.infer<typeof ManifestSchema>;
```

### Registry data and OSV data shapes

```typescript
// These types are defined in adapter packages and passed as parameters.
// The oracle package defines only the minimal shape it needs.

// RegistryData — pre-fetched dependency freshness from PyPI/npm
export interface RegistryEntry {
  name: string;
  latestVersion: string;              // latest published version string
  yanked: boolean;                    // package is yanked/deprecated
  isDeprecated: boolean;
  py2Only: boolean;                   // only supports Python 2 per classifiers
  publishedAt: string;                // ISO 8601 UTC
}
export type RegistryData = Map<string, RegistryEntry>; // key: normalized package name

// OsvData — pre-fetched vulnerability data
export interface OsvVulnerability {
  id: string;                         // CVE or GHSA id
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  affectedPackage: string;
  affectedVersionRange: string;
}
export type OsvData = OsvVulnerability[];
```

### Reading schemas

```typescript
// src/reading/run.ts (schema section)

import { z } from "zod";
import { CardDrawSchema, SpreadPositionSchema } from "../registry/schema.js";
import { RepoRefSchema } from "../snapshot/types.js";

export const SpreadKindSchema = z.enum(["fates", "necropsy", "celtic"]);
export type SpreadKind = z.infer<typeof SpreadKindSchema>;

export const ReadingOptsSchema = z.object({
  spreadKind: SpreadKindSchema.default("necropsy"),
  registryData: z.instanceof(Map).optional().describe("Pre-fetched dep freshness for Tower detector"),
  osvData: z.array(z.unknown()).optional().describe("Pre-fetched OSV vulnerabilities for Devil detector"),
  now: z.string().describe("ISO 8601 UTC string; used by all time-sensitive detectors. Never call Date.now() inside detectors."),
});
export type ReadingOpts = z.infer<typeof ReadingOptsSchema>;

export const ReadingSchema = z.object({
  id: z.string().uuid().describe("UUID v4"),
  repo: RepoRefSchema,
  draws: z.array(CardDrawSchema),
  spread: z.array(SpreadPositionSchema),
  vitality: z.number().int().min(0).max(100),
  createdAt: z.string().describe("ISO 8601 UTC string; always equals opts.now, never the system clock"),
  engineVersion: z.string().describe("Version from package.json"),
  errors: z.array(z.object({
    code: z.string(),
    userMessage: z.string(),
    cardId: z.string().optional(),
  })).describe("Errors from individual detectors; empty when all succeed"),
});
export type Reading = z.infer<typeof ReadingSchema>;
```

---

## Components and Interfaces

The following are all public exports through `packages/oracle/src/index.ts` (and `src/node.ts` for the Node entry).

```typescript
// ============================================================
// Shared opts type passed to every detector
// ============================================================
export interface DetectorOpts {
  registryData?: RegistryData;             // Tower detector
  osvData?: OsvData;                       // Devil detector
  now: string;                             // ISO 8601 UTC — time-sensitive detectors (Hanged Man, Star)
  trees: ReadonlyMap<string, Tree>;        // Pre-parsed trees: path → Tree, for all .py files
  parseErrors: ReadonlyMap<string, NecroError>; // path → error for any .py file that failed to parse
}

// Canonical detector function type — pure, synchronous, no network, no WASM calls
export type Detector = (
  snapshot: RepoSnapshot,
  opts: DetectorOpts
) => CardDraw | null;

// ============================================================
// Registry  (src/registry/cards.ts)
// ============================================================
export const CARD_REGISTRY: ReadonlyMap<CardId, CardDefinition>;
export function getCard(id: CardId): CardDefinition;
  // throws NecroError { code: "CARD_NOT_FOUND" } for unrecognized id

// ============================================================
// Snapshot builders
// Main entry point only:
// ============================================================
export interface SnapshotFromFileMapOpts {
  meta?: RepoMeta;     // defaults to a neutral RepoMeta (isArchived: false, all counts 0, nulls)
  createdAt: string;   // ISO 8601 UTC — required; builder never reads the system clock
}

export function buildSnapshotFromFileMap(
  ref: RepoRef,
  files: Record<string, string>,   // path → content
  opts: SnapshotFromFileMapOpts
): RepoSnapshot;

// Node-only entry point (src/node.ts) — NOT on main index:
// export function buildSnapshotFromDirectory(
//   dir: string,
//   opts: SnapshotFromFileMapOpts
// ): Promise<RepoSnapshot>;
//   // rejects with NecroError { code: "SNAPSHOT_DIR_NOT_FOUND" } if path missing
//   // Both builders require an explicit createdAt; they never call Date.now() or new Date().

export interface GitHubSnapshotBuilder {
  build(ref: RepoRef): Promise<RepoSnapshot>;
}

// ============================================================
// Tree-sitter parser  (src/parser/tree-sitter.ts)
// ============================================================
export type Tree = import("web-tree-sitter").Tree;
export type QueryMatch = import("web-tree-sitter").QueryMatch;

export function initParser(): Promise<void>;
  // Must be called once before any parsePython call (runReading does this automatically).
  // Idempotent: second call returns a resolved promise immediately.
  // throws NecroError { code: "PARSER_INIT_FAILED" } if WASM fails to load.

export function parsePython(source: string): Tree;
  // SYNCHRONOUS. Requires initParser() to have resolved first.
  // throws NecroError { code: "PARSER_INIT_FAILED" } if called before initParser() resolves.
  // throws NecroError { code: "FILE_TOO_LARGE" } if source byte length > 1_048_576.
  // Returns best-effort partial Tree for invalid UTF-8 (never throws on bad bytes).

export function queryPython(tree: Tree, sexpPattern: string): QueryMatch[];
  // throws NecroError { code: "INVALID_QUERY_PATTERN" } for invalid S-expression

export function hasLegacyPythonNodes(tree: Tree): boolean;
  // Returns true if tree contains any of the 7 py2 legacy construct indicators: `print_statement`, `exec_statement`, `except_clause` with comma child, `comparison_operator` with `<>` token, `integer` node matching `/[Ll]$/`, `integer` node matching `/^0[0-7]+$/`, or any node (including `ERROR` nodes) whose text starts with a backtick `` ` ``.

// ============================================================
// Manifest parser  (src/parser/manifest.ts)
// ============================================================
export function parseAllManifests(snapshot: RepoSnapshot): Manifest[];
export function detectPythonVersion(manifests: Manifest[]): PythonVersionSignal;

// ============================================================
// Detectors — all pure, synchronous, no network
// ============================================================
export const detectJudgement: Detector;    // XX  — Dead Runtime
export const detectTower: Detector;        // XVI — Rotting Dependencies
export const detectDevil: Detector;        // XV  — Security Sins
export const detectDeath: Detector;        // XIII — Dead Code
export const detectWheel: Detector;        // X   — No Tests
export const detectHermit: Detector;       // IX  — Missing Docs
export const detectHangedMan: Detector;    // XII — Stagnation
export const detectTemperance: Detector;   // XIV — No CI
export const detectJustice: Detector;      // XI  — Missing License
export const detectMoon: Detector;         // XVIII — Complexity
export const detectStar: Detector;         // XVII — Hope

// World is not a standard detector — it operates on a verdict, not a snapshot
export function computeWorldDraw(
  verdict: Verdict,
  vitalityDelta: number
): CardDraw | null;

// ============================================================
// Spread engine  (src/spread/assign.ts)
// ============================================================
export function assignSpread(
  draws: CardDraw[],
  kind: SpreadKind,
  sha: string
): SpreadPosition[];

// ============================================================
// Vitality scoring  (src/scoring/vitality.ts)
// ============================================================
export function computeVitality(draws: CardDraw[]): number;
  // Returns integer in [0, 100]
export function computeVitalityDelta(before: number, after: number): number;
  // Returns after - before

// ============================================================
// Reading orchestrator  (src/reading/run.ts)
// ============================================================
export function runReading(
  snapshot: RepoSnapshot,
  opts: ReadingOpts
): Promise<Reading>;
  // Only async entry point in the package

// ============================================================
// Secret masking  (src/util/mask.ts)
// ============================================================
export function maskSecret(value: string): string;
  // value.length >= 4 → value.slice(0, 4) + "****"
  // value.length < 4  → "****"
```

---

## Sequence Diagrams

### Diagram 1: `runReading` execution flow

```mermaid
sequenceDiagram
    participant C as Caller
    participant R as runReading
    participant I as initParser
    participant TS as parsePython (sync)
    participant M as parseAllManifests
    participant D as Detectors (×11)
    participant S as assignSpread
    participant V as computeVitality

    C->>R: runReading(snapshot, opts)
    R->>I: await initParser()
    I-->>R: void (WASM ready)

    R->>R: collect all .py files from snapshot
    loop for each .py file path
        R->>TS: parsePython(content)  [sync]
        alt parse succeeds
            TS-->>R: Tree
            R->>R: trees.set(path, tree)
        else throws NecroError (FILE_TOO_LARGE or partial)
            R->>R: parseErrors.set(path, error)
        end
    end

    R->>M: parseAllManifests(snapshot)
    M-->>R: manifests[]
    R->>R: attach manifests to snapshot

    R->>R: build DetectorOpts { ...opts, trees, parseErrors }

    par concurrent detector execution (Promise.allSettled)
        R->>D: detectJudgement(snapshot, detectorOpts)
        R->>D: detectTower(snapshot, detectorOpts)
        R->>D: detectDevil(snapshot, detectorOpts)
        R->>D: detectDeath(snapshot, detectorOpts)
        R->>D: detectWheel(snapshot, detectorOpts)
        R->>D: detectHermit(snapshot, detectorOpts)
        R->>D: detectHangedMan(snapshot, detectorOpts)
        R->>D: detectTemperance(snapshot, detectorOpts)
        R->>D: detectJustice(snapshot, detectorOpts)
        R->>D: detectMoon(snapshot, detectorOpts)
        R->>D: detectStar(snapshot, detectorOpts)
    end

    alt detector returns CardDraw | null
        D-->>R: result
    else detector throws
        D-->>R: Error
        R->>R: push NecroError(DETECTOR_FAILED) to errors[]
    end

    R->>R: filter non-null draws
    R->>S: assignSpread(draws, opts.spreadKind, snapshot.ref.sha)
    S-->>R: SpreadPosition[]
    R->>V: computeVitality(draws)
    V-->>R: number (0–100)
    R->>R: assemble Reading (createdAt = opts.now)
    R-->>C: Reading
```

### Diagram 2: WASM parser initialization (lazy singleton)

```mermaid
sequenceDiagram
    participant RA as runReading
    participant I as initParser
    participant W as web-tree-sitter WASM

    Note over I: Module loaded; parserSingleton = null; initPromise = null

    RA->>I: await initParser()
    I->>I: initPromise === null? YES → create initPromise
    I->>W: Parser.init() + Language.load(grammar.wasm)

    alt WASM loads successfully
        W-->>I: parser ready
        I->>I: parserSingleton = parser (singleton stored)
        I-->>RA: void

        Note over RA: parsePython is now safe to call synchronously

        RA->>RA: parsePython(source) [sync — parserSingleton !== null]
    else WASM fails
        W-->>I: Error
        I->>I: initPromise = null  (allows retry on next call)
        I-->>RA: throws NecroError(PARSER_INIT_FAILED)
    end

    Note over I: Subsequent runReading calls
    RA->>I: await initParser()
    I->>I: parserSingleton !== null → return resolved promise immediately
    I-->>RA: void (instant)
```

---

## Detector Design Details

All detectors share the signature `(snapshot: RepoSnapshot, opts: DetectorOpts) => CardDraw | null`. They are purely synchronous and make no network calls; all external data (including pre-parsed trees) arrives through `opts`. The `opts.trees` map provides pre-parsed `Tree` objects for every `.py` file in the snapshot (populated by `runReading` before detectors are called). Files that failed to parse appear in `opts.parseErrors` and should be skipped by detectors.

### `detectJudgement` — XX The Judgement (Dead Runtime)

**Detection algorithm:**
1. Collect all Python files from `snapshot.files` where `lang === "python"`.
2. Exclude files whose `path` contains any of: `/vendor/`, `/.tox/`, `/node_modules/`, `/site-packages/`.
3. For each remaining Python file, look up the pre-parsed tree via `opts.trees.get(path)`. If the path is in `opts.parseErrors`, skip it (it could not be parsed) and do not count it as evidence. Call `hasLegacyPythonNodes(tree)` on the retrieved tree.
4. `hasLegacyPythonNodes` checks for (returning `true` on any match):
   - Named node type `print_statement`
   - Named node type `exec_statement`
   - `comparison_operator` node with a direct child token whose text is `"<>"`
   - `integer` node whose text matches `/[Ll]$/` (long literal, e.g. `10L`)
   - `integer` node whose text matches `/^0[0-7]+$/` (legacy octal, e.g. `0777`)
   - (g) cursor-walk for any node whose text starts and ends with a single backtick character `` ` `` (Python 2 backrepr, e.g. `` `x` ``). **NOTE:** tree-sitter-python may produce an `ERROR` node rather than a structured node for backtick repr expressions. Therefore, also check `ERROR` nodes whose text starts with a backtick character. Match both: named nodes whose `.text` starts with `` ` `` and `ERROR` nodes whose `.text` starts with `` ` ``.
5. Collect evidence: for each detected construct type, record the `path` and `line` of the **first occurrence** of that type.
6. Call `detectPythonVersion(snapshot.manifests)` to check manifest signals.
7. Also check `.travis.yml` content for `python: 2.7` or `python: "2.7"` lines.

**Orientation rules:**
- If snapshot has `six` import, `from __future__ import` statements, or `2to3` shims alongside py2 syntax → **severity 1, reversed** ("straddling"). This takes precedence over all other rules.
- Else if manifests signal `py2_only` → **severity 3, upright** (burning).
- Else (py2 syntax found but no manifest constraint) → **severity 2, upright**.

**Null return:** when no Python files exist (no `.py` extension after exclusions) and no Python manifests are present.

**`DetectorOpts` fields used:** `trees`, `parseErrors`.

**Tree-sitter node types:** `print_statement`, `exec_statement`, `comparison_operator`, `integer`. Backtick repr via cursor walk — match both named nodes and `ERROR` nodes whose `.text` starts with `` ` ``.

---

### `detectTower` — XVI The Tower (Rotting Dependencies)

**Detection algorithm:**
1. If no dependency files in `snapshot.manifests`, return `null`.
2. For each `ParsedDependency` across all manifests:
   a. Look up `opts.registryData?.get(normalizedName)`.
   b. If no entry, skip (R6.7).
   c. Check: yanked, deprecated, py2-only classifiers → broken.
   d. Check: semver major version comparison — parse `entry.latestVersion` and installed `versionSpec`; if ≥ 2 majors behind → broken.
   e. Check: empty `versionSpec` or exactly 1 major behind but still installable → drifted.
3. If any broken dependency found → **severity 2, upright**.
4. Else if any drifted dependency found (and no broken) → **severity 1, reversed**.
5. Otherwise → `null`.

**Evidence:** one item per affected dependency with `name`, `versionSpec`, and `detail` describing the staleness reason.

**Orientation rule:** upright = broken/yanked/≥2 majors; reversed = unpinned/1 major behind.

**`DetectorOpts` fields used:** `registryData`.

**Major version determination:** for `1.x.y`, major = `1`; for `0.x.y`, major = `x` (leftmost non-zero segment).

---

### `detectDevil` — XV The Devil (Security Sins)

**Detection algorithm:**
1. For each Python file in the snapshot, look up `opts.trees.get(path)` (skip files in `opts.parseErrors`) and run tree-sitter queries for the following dangerous call patterns:
   - `eval(` — any call to `eval`
   - `exec(` — any call to `exec` as a function (not `exec_statement` which is py2 syntax)
   - `pickle.loads(` — attribute call `pickle.loads`
   - `yaml.load(` without a `Loader=` keyword argument
   - `subprocess` calls with `shell=True` keyword argument
   - `os.system(` — attribute call `os.system`
   - `requests.get` / `urllib` calls with `verify=False`
   - `md5` or `sha1` where variable/function name contains `password`, `passwd`, `credential`, `secret`, `token`, `api_key`, `apikey` (case-insensitive)
2. For each Python file, scan for secret-like strings:
   - AWS access key ID: `/AKIA[0-9A-Z]{16}/`
   - Private key headers: `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----`
   - High-entropy assignment: identifier containing `secret`, `password`, `token`, `api_key`, `apikey` (case-insensitive) assigned a quoted string of ≥ 8 characters
3. If `opts.osvData` is provided, add one `Evidence` item per vulnerability with `kind: "osv"`, `detail` = CVE/GHSA id + severity level, `source: "osv"`.
4. **Mask all secret values**: call `maskSecret(rawValue)` immediately before assigning to `Evidence.detail`. Original value must not be stored.
5. Separate findings by location: production code vs. test/example paths (`**/tests/**`, `test_*.py`, `*_test.py`, `**/conftest.py`, `**/examples/**`).

**Orientation rules:**
- Dangerous patterns or secrets in **production code** (not in test/example paths) → **severity 2, upright**.
- Dangerous patterns **exclusively in test/example paths** → **severity 1, reversed**.
- No patterns and no OSV vulns → `null`.

**`DetectorOpts` fields used:** `osvData`.

**Safety net:** after building all evidence, apply `maskSecret` to any `Evidence.detail` matching `/AKIA[0-9A-Z]{16}/` or private key header patterns (R20.3).

---

### `detectDeath` — XIII The Death (Dead Code)

**Detection algorithm:**
1. Build an intra-repository import graph by iterating `opts.trees` (skipping paths in `opts.parseErrors`):
   - Extract `import X` and `from X import Y` statements from each tree.
   - Resolve module names to file paths using standard Python module-to-path conversion.
   - Modules that cannot be resolved to a snapshot file are external; exclude from dead-code analysis.
2. Find unreachable modules: files that are never imported by any other file in the snapshot and are not entrypoint candidates. Entrypoint candidates: `__main__.py`, `manage.py`, `wsgi.py`, `asgi.py`, `app.py`, `run.py`, or files listed in `setup.py`/`pyproject.toml` entry point fields.
3. If ≥ 1 unreachable module → collect up to 20 paths ordered lexicographically.
4. Find unused top-level symbols: build a name-reference index; find public functions/classes (names not starting with `_`) defined in one file but never referenced by name in any other file.
5. Find large commented-out code blocks: scan each file for runs of ≥ 5 consecutive comment lines (`#`). Strip the leading `# ` from each line and check if the block parses as valid Python with tree-sitter. If so, record path and starting line number.

**Orientation rules:**
- ≥ 1 unreachable module **or** ≥ 5 unused symbols → **severity 2, upright**.
- No unreachable modules but commented-out code blocks found → **severity 1, reversed**.
- Nothing found → `null`.
- If both unreachable modules and commented-out blocks exist, severity stays 2; blocks are additional evidence.

**`DetectorOpts` fields used:** none.

---

### `detectWheel` — X The Wheel of Fortune (No Tests)

**Detection algorithm:**
1. Count test files by matching against (deduplicated):
   - Filename matches `test_*.py` or `*_test.py`
   - File is directly under a directory named `tests/` or `test/` at any depth
   - Filename matches `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`
2. Check for runner configuration files:
   - `pytest.ini` at repo root
   - `setup.cfg` containing a `[tool:pytest]` section (detect by section header presence in content)
   - `tox.ini` at repo root
   - `pyproject.toml` containing `[tool.pytest.ini_options]` or `[tool.pytest]` section
   - `jest.config.js`, `jest.config.ts`, `jest.config.mjs`, `jest.config.cjs` at any path
   - `.mocharc.js`, `.mocharc.cjs`, `.mocharc.yaml`, `.mocharc.yml`, `.mocharc.json`, `.mocharc.jsonc`

**Orientation rules:**
- Zero test files → **severity 2, upright**.
- Test files exist but no runner config found → **severity 1, reversed**.
- Test files exist and ≥ 1 runner config found → `null`.

**Evidence:** exact test file count, up to 10 test file paths (lexicographic), names of detected runner config files.

**`DetectorOpts` fields used:** none.

---

### `detectHermit` — IX The Hermit (Missing Documentation)

**Detection algorithm:**
1. Scan for README at repo root: match filenames (no `/` in path) case-insensitively against `readme`, `readme.md`, `readme.rst`, `readme.txt`, `readme.adoc`. Take the first lexicographic match.
2. If no README → **severity 2, upright**.
3. If README found:
   a. Read content from `snapshot.contents`.
   b. If content byte length < 200 **or** content does not contain `install`, `usage`, `getting started`, or `quickstart` (case-insensitive) → **severity 1, reversed** with evidence indicating which sub-condition triggered.
4. Compute docstring coverage by looking up each Python file's tree from `opts.trees` (skip files in `opts.parseErrors`): count public top-level functions and classes (names not starting with `_`). Check if first statement is a string literal (docstring node). Ratio = docstrings / total. If ratio < 0.25 and ≥ 4 public symbols exist → add docstring-coverage evidence item (regardless of card orientation).
5. If README satisfies both conditions and docstring coverage ≥ 0.25 (or < 4 public symbols) → `null`.

**`DetectorOpts` fields used:** none.

---

### `detectHangedMan` — XII The Hanged Man (Stagnation)

**Detection algorithm:**
1. Validate `snapshot.meta` against `RepoMetaSchema`; throw `NecroError(INVALID_REPO_META)` if invalid.
2. Compute `pushedAtAge` = difference in whole days between `opts.now` and `meta.pushedAt` (null treated as infinity).
3. Rules in priority order:
   - If `meta.isArchived === true` → **severity 2, upright**.
   - If `!meta.isArchived` and `pushedAtAge > 730` and `meta.openIssueCount >= 3` → **severity 2, upright**.
   - If neither upright condition applies and (`pushedAtAge` in range `(183, 730]` inclusive of 730, exclusive of 183) **or** (`meta.openPRCount >= 3` and `meta.oldestOpenPRAgeDays >= 180`) → **severity 1, reversed**.
   - If `pushedAtAge <= 183` and `!meta.isArchived` and `meta.openPRCount < 3` → `null`.

**Evidence:** `pushedAt` (or `"unknown"` if null), `isArchived`, `openIssueCount`, `openPRCount`, computed age in whole days.

**`DetectorOpts` fields used:** `now`.

---

### `detectTemperance` — XIV The Temperance (No CI / Dead CI)

**Detection algorithm:**
1. Scan for CI configuration files:
   - GitHub Actions: any `.yml` or `.yaml` file directly under `.github/workflows/` (path depth check: exactly 3 segments — `.github/workflows/<file>`)
   - Travis CI: `.travis.yml` or `.travis.yaml` at repo root (no `/` before the dot)
   - CircleCI: `.circleci/config.yml`
   - Jenkins: `Jenkinsfile` at repo root
   - Azure Pipelines: `azure-pipelines.yml` at repo root
2. Classify each found file by provider.
3. Rules:
   - No CI files at all → **severity 2, upright** with `kind: "no-ci-found"` evidence.
   - Only Travis CI files found (no GitHub Actions, CircleCI, Jenkins, Azure) → **severity 1, reversed**.
   - At least one non-Travis file found → `null`.

**Evidence:** list of all CI config paths with provider name. When none found, a single item with `kind: "no-ci-found"`.

**`DetectorOpts` fields used:** none.

---

### `detectJustice` — XI The Justice (Missing License)

**Detection algorithm:**
1. Scan for license files at repo root (no `/` in path), case-insensitive: `license`, `license.md`, `license.txt`, `license.rst`, `copying`, `copying.md`, `unlicense`.
2. Count distinct matches.
3. Check `snapshot.meta.licenseKey`.
4. Rules (R13.3 takes precedence):
   - `licenseKey` is `"NOASSERTION"` or `null` → **severity 2, upright** (regardless of license files).
   - `licenseKey` valid and 0 license files → **severity 2, upright**.
   - `licenseKey` valid and exactly 1 license file → `null`.
   - `licenseKey` valid and > 1 license files → **severity 1, reversed**.

**Evidence:** detected license file paths (relative to repo root), `licenseKey` value observed.

**`DetectorOpts` fields used:** none.

---

### `detectMoon` — XVIII The Moon (Complexity)

**Detection algorithm:**
1. Check every file in snapshot for line count > 1,000 (count all lines).
2. For each Python file, use `opts.trees.get(path)` (skip files in `opts.parseErrors`) to compute maximum nesting depth: walk the tree counting nested `function_definition`, `class_definition`, `if_statement`, `for_statement`, `while_statement`, `with_statement`, `try_statement` nodes. Track max depth.
3. For each file, count confusion markers: scan lines for `TODO`, `FIXME`, `HACK`, `XXX` (case-insensitive, as whole words or `# TODO`-style prefixes). A line matching multiple markers counts once. If > 10 such lines → record path and count.
4. Rules:
   - ≥ 2 files exceed 1,000 lines **or** any file has nesting depth > 6 → **severity 2, upright** (R14.4 takes precedence).
   - R14.4 does not apply and (exactly 1 file > 1,000 lines **or** ≥ 1 file with > 10 confusion markers) → **severity 1, reversed**.
   - Nothing found → `null`.

**`DetectorOpts` fields used:** none.

**Tree-sitter node types:** `function_definition`, `class_definition`, `if_statement`, `for_statement`, `while_statement`, `with_statement`, `try_statement`.

---

### `detectStar` — XVII The Star (Hope)

**Detection algorithm:**
Compute strength score (0–5), one point each:
1. Valid license file found (same rules as `detectJustice` R13.1) with `licenseKey` not `"NOASSERTION"` and not `null`.
2. ≥ 1 test file found (same patterns as `detectWheel` R9.1).
3. ≥ 1 CI config file found (same rules as `detectTemperance` R12.1).
4. README whose byte length ≥ 200 and contains `install`, `usage`, `getting started`, or `quickstart` (case-insensitive).
5. `meta.pushedAt` is a timestamp no more than 365 days before `opts.now` (if `meta.pushedAt` is null → 0 points).

**Orientation rules:**
- Score ≥ 3 → **severity 2, upright**.
- Score 1 or 2 → **severity 1, reversed**.
- Score 0 → `null`.

**Evidence:** one item per factor with factor name, whether it contributed (boolean), observed value.

**`DetectorOpts` fields used:** `now`.

---

## Spread Assignment Algorithm

### `assignSpread(draws, kind, sha) → SpreadPosition[]`

The function is pure and deterministic. The same `(draws, kind, sha)` triple always produces the same result.

### SHA-seeded tiebreaking

Use a djb2-style hash of the `sha` string to produce a stable 32-bit seed:

```typescript
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep as uint32
  }
  return h;
}
```

When two draws tie on `severity × weight`, break the tie by sorting them using `djb2(sha + draw.card)`. This produces a deterministic, per-sha ordering without a full PRNG.

### Fates spread (3 positions)

| Position | Label      | Selection rule |
|----------|------------|----------------|
| 1        | Past       | Draw with the highest "history signal": prefer `hanged_man`, then `temperance`, then earliest-drawn card |
| 2        | Present    | Most severe current affliction (highest `severity × weight`, SHA-seeded tiebreak) |
| 3        | Future     | Highest projected-risk draw: prefer `tower`, then `devil`, then next-highest `severity × weight` |

### Necropsy spread (5 positions)

| Position | Label       | Selection rule |
|----------|-------------|----------------|
| 1        | The Corpse  | Highest `severity × weight` (SHA-seeded tiebreak) |
| 2        | The Wound   | Second highest `severity × weight` |
| 3        | The Shadow  | `devil` if drawn; otherwise third highest `severity × weight` |
| 4        | The Hope    | `star` if drawn; otherwise void |
| 5        | The Call    | `judgement` if drawn and `linkedGrimoireIds.length > 0`; otherwise void with description `"no ritual can be performed"` |

### Celtic Cross spread (10 positions)

| Position | Label             |
|----------|-------------------|
| 1        | Present           |
| 2        | Crossing          |
| 3        | Foundation        |
| 4        | Recent Past       |
| 5        | Crown             |
| 6        | Near Future       |
| 7        | Self              |
| 8        | Environment       |
| 9        | Hopes and Fears   |
| 10       | Outcome           |

Assignment follows §3A.2 semantics from DESIGN.md. Cards are assigned greedily by `severity × weight` to positions in the order listed, with SHA-seeded tiebreaking. Positions with no candidate draw receive the void sentinel.

### No-duplicate guarantee

Maintain a `Set<CardId>` of already-assigned card ids. Before placing a draw into a position, check the set; if the card id is already present, skip to the next candidate. This guarantees R17.7.

### Void position sentinel

```typescript
const VOID_POSITION = (label: string): SpreadPosition => ({
  position: /* index */,
  label,
  draw: null,
  description: "This position holds no card — the void is a sign.",
});
```

For the Necropsy "The Call" position with no ritual candidate, the description is overridden to `"no ritual can be performed — here is why"`.

---

## Error Handling

### `NecroError` codes

| Code | Where thrown | Condition |
|------|--------------|-----------|
| `REGISTRY_INVALID` | `registry/cards.ts` at module load | Any card fails zod validation, or two cards share an `id` or `numeral` |
| `CARD_NOT_FOUND` | `getCard()` | Requested `CardId` not in registry |
| `PARSER_INIT_FAILED` | `parser/tree-sitter.ts` | `web-tree-sitter` WASM initialization fails |
| `FILE_TOO_LARGE` | `parsePython()` | Source byte length > 1,048,576 |
| `INVALID_QUERY_PATTERN` | `queryPython()` | S-expression query string is syntactically invalid |
| `SNAPSHOT_DIR_NOT_FOUND` | `buildSnapshotFromDirectory()` | Directory path does not exist or is not accessible |
| `INVALID_REPO_META` | `detectHangedMan()` | `snapshot.meta` fails `RepoMetaSchema` validation |
| `DETECTOR_FAILED` | `runReading()` | Any individual detector throws an unhandled error |

### Per-detector error isolation in `runReading`

```typescript
const detectorResults = await Promise.allSettled([
  Promise.resolve().then(() => detectJudgement(snapshot, opts)),
  Promise.resolve().then(() => detectTower(snapshot, opts)),
  // ... all 11 detectors
]);

const draws: CardDraw[] = [];
const errors: ReadingError[] = [];

for (const [i, result] of detectorResults.entries()) {
  if (result.status === "fulfilled") {
    if (result.value !== null) draws.push(result.value);
  } else {
    errors.push(
      new NecroError(
        "DETECTOR_FAILED",
        `The ${DETECTOR_NAMES[i]} seer encountered an error and could not finish their reading.`,
        result.reason
      )
    );
  }
}
```

The `Promise.allSettled` pattern ensures all detectors run to completion regardless of individual failures.

### WASM init failure path

If `Parser.init()` or `Language.load()` throws during initialization:
1. The `initPromise` is rejected with a `NecroError(PARSER_INIT_FAILED)`.
2. The `initPromise` is reset to `null` so the next call retries initialization (allows recovery if WASM loads were transiently unavailable).
3. If `initParser()` throws `PARSER_INIT_FAILED`, `runReading` propagates this error directly (the entire reading fails, not just individual detectors), because without the parser, tree-sitter-dependent detectors cannot run at all.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: P1 (R17.8, R19.1) Determinism

*For any* `RepoSnapshot`, `ReadingOpts` (with a fixed `now` string), calling `runReading` twice with the same inputs produces an identical `Reading` (same draws, same spread, same vitality).

**Validates: Requirements 17.8, 19.1**

### Property 2: P2 (R19.4, R21.8) Detector never throws

*For any* valid `RepoSnapshot` (including snapshots with empty files, binary content, or files at the maximum size), every detector function returns `CardDraw | null` and never propagates an unhandled exception outside `runReading` — all errors are captured in `Reading.errors`.

**Validates: Requirements 19.4, 21.8**

### Property 3: P3 (R2.1, R5.4) Evidence paths exist in snapshot

*For any* `Reading` produced by `runReading`, every `Evidence` item whose `path` field is set must have that path present as a key in `snapshot.contents`.

**Validates: Requirements 2.1, 5.4**

### Property 4: P4 (R5.1–R5.3) Severity/orientation consistency

*For any* `CardDraw` in a reading: if `severity === 1` then `orientation === "reversed"`; if `severity === 2` or `severity === 3` then `orientation === "upright"`. A draw with `severity === 0` must never appear in the `draws` array (it would have been filtered as null).

**Validates: Requirements 5.2, 5.3, 6.2, 6.3, 9.2, 9.3**

### Property 5: P5 (R17.7) No duplicate card in spread

*For any* `(draws, kind, sha)` triple, the `SpreadPosition[]` returned by `assignSpread` contains no `CardId` more than once across all non-null `draw` fields.

**Validates: Requirements 17.7**

### Property 6: P6 (R17.3) Primary position holds most severe

*For any* necropsy spread result with at least one drawn card, the draw at position 1 ("The Corpse") has a `severity × weight` product greater than or equal to that of every other filled position (ties broken by SHA seed). Weight comes from `CARD_REGISTRY`.

**Validates: Requirements 17.3**

### Property 7: P7 (R18.1–R18.3) Vitality monotonic

*For any* two draw arrays `D` and `D'` where every card in `D'` has a `severity` ≤ the corresponding card's `severity` in `D` (same cards, lower or equal severities), `computeVitality(D') >= computeVitality(D)`.

**Validates: Requirements 18.1, 18.2, 18.3**

### Property 8: P8 (R20.2, R20.3) Secret masking — no raw secrets in evidence

*For any* `Reading` produced by `runReading`, no `Evidence.detail` string matches `/AKIA[0-9A-Z]{16}/` or either private key header pattern. The devil detector never emits an unmasked secret value.

**Validates: Requirements 20.2, 20.3**

### Property 9: P9 (R20.1, R20.4) Secret masking length invariant

*For any* string `s` of length ≥ 4, `maskSecret(s)` has exactly 8 characters (4 preserved chars + 4 asterisks). *For any* string `s` of length < 4, `maskSecret(s) === "****"`.

**Validates: Requirements 20.1, 20.4**

### Property 10: P10 (R18.1, R18.4, R18.5) Vitality bounds

*For any* array of `CardDraw` objects (including empty arrays, arrays with high-severity cards, and arrays with only zero-weight cards), `computeVitality` always returns an integer in the closed interval `[0, 100]`.

**Validates: Requirements 18.1, 18.4, 18.5**

### Property 11: P11 (R17.2, R17.3, R17.4) Spread count invariant

*For any* valid `(draws, kind, sha)` triple: `assignSpread(draws, "fates", sha)` always returns exactly 3 `SpreadPosition` objects; `assignSpread(draws, "necropsy", sha)` always returns exactly 5; `assignSpread(draws, "celtic", sha)` always returns exactly 10.

**Validates: Requirements 17.2, 17.3, 17.4**

### Property 12: P12 (R2.7) Snapshot file cap enforced

*For any* `Record<string, string>` with more than 5,000 keys (after applying the 1 MB per-file size filter), `buildSnapshotFromFileMap` always returns a snapshot where `truncated === true` and `files.length <= 5000`.

**Validates: Requirements 2.7**

### Property 13: P13 (R2.6) Oversize files skipped

*For any* file map where one or more entries have content exceeding 1,048,576 bytes, those file paths are absent from `snapshot.contents` and present in `snapshot.oversizeFiles` with `kind: "file_skipped"`.

**Validates: Requirements 2.6**

### Property 14: P14 (R18.3, R1.2) Registry weight consistency

*For any* `CardDraw` array where `star` and `world` draws are the only draws, `computeVitality` returns `100` (because their weights are 0). *For any* draw with a card whose weight > 0 and severity > 0, the vitality result is strictly less than 100.

**Validates: Requirements 18.3, 1.2**

### Property 15: P15 (R3.7) hasLegacyPythonNodes is false for clean Python 3

*For any* string that is syntactically valid Python 3 and contains none of the 7 legacy construct types (no `print_statement`, `exec_statement`, `<>` token, long literal, legacy octal, or backtick repr), `hasLegacyPythonNodes(parsePython(source))` returns `false`.

**Validates: Requirements 3.7**

---

## Testing Strategy

### Unit tests (`*.test.ts`)

One test file per module, colocated next to the source:

| Test file | What it covers |
|-----------|---------------|
| `registry/cards.test.ts` | All 12 cards present; field constraints; `getCard` happy/sad path; duplicate id/numeral throws |
| `snapshot/builder-file-map.test.ts` | File map → snapshot with explicit `createdAt` and `meta`; size filter; 5000 file cap; lang detection by extension; `createdAt` equals the supplied value (builder never calls `Date.now()`) |
| `snapshot/builder-directory.test.ts` | Directory exists; missing directory throws `SNAPSHOT_DIR_NOT_FOUND` |
| `parser/manifest.test.ts` | `requirements*.txt` parsing; `setup.py` AST (non-executing); `pyproject.toml`; `Pipfile`; `package.json`; invalid content returns `parsed: false`; `detectPythonVersion` priority order |
| `detectors/judgement.test.ts` | py2 syntax → drawn; py2-only manifests → severity 3; straddling → reversed; no Python → null |
| `detectors/tower.test.ts` | Yanked deps → severity 2; unpinned → severity 1; clean → null; missing registry entry → skipped |
| `detectors/devil.test.ts` | `eval` in prod → severity 2; secret masking; OSV vulns → evidence; test-only patterns → reversed |
| `detectors/death.test.ts` | Unreachable module; unused symbols; commented-out code blocks |
| `detectors/wheel.test.ts` | Zero tests → severity 2; tests but no config → reversed; tests + config → null |
| `detectors/hermit.test.ts` | No README; short README; keyword missing; docstring coverage below 0.25 |
| `detectors/hanged-man.test.ts` | Archived → severity 2; > 730 days + issues; reversed ranges; active → null |
| `detectors/temperance.test.ts` | No CI; Travis-only → reversed; GitHub Actions present → null |
| `detectors/justice.test.ts` | NOASSERTION → severity 2; null licenseKey; multiple license files; clean → null |
| `detectors/moon.test.ts` | ≥ 2 large files; nesting > 6; confusion markers; clean → null |
| `detectors/star.test.ts` | All 5 factors present → severity 2; partial → reversed; none → null |
| `detectors/world.test.ts` | REVIVED → upright; UNDEAD → reversed; STILL_DEAD → null |
| `spread/assign.test.ts` | Fates/necropsy/celtic counts; no-duplicate guarantee; same sha same result; void fill |
| `scoring/vitality.test.ts` | Formula; empty → 100; clamped at 0; `computeVitalityDelta` |
| `util/mask.test.ts` | Length ≥ 4 → first 4 + `****`; length < 4 → `****`; AWS pattern masked |
| `reading/run.test.ts` | Happy path end-to-end; detector error isolation; errors array populated |

**Constraints:** no network calls, no LLM calls. All tests use the real `web-tree-sitter` WASM parser, initialized once via the Vitest setup file. No mock parser or parser factory is needed. Tests for `parsePython` directly exercise the real grammar.

### Property-based tests (`*.pbt.test.ts`)

Use `fast-check` with default `numRuns: 200` (increase to 1000 for spread, vitality, and masking).

**Required arbitraries** in `packages/oracle/test/arbitraries.ts`:
- `arbRepoRef` — generates valid `RepoRef` objects
- `arbFileEntry` — generates valid `FileEntry` with correct lang from extension
- `arbRepoMeta` — generates valid `RepoMeta` including all R11.1 fields
- `arbRepoSnapshot` — composes the above; generates 0–200 files with random content strings
- `arbCardDraw` — generates valid `CardDraw` with consistent severity/orientation
- `arbCardDrawArray` — 0–12 draws, no duplicate card ids
- `arbSha` — hex string of 40 characters
- `arbPythonSource` — generates small Python 3 source strings with no py2 constructs (for P15)
- `arbLargeFileMap` — file maps with > 5000 entries (for P12)

**Property test files:**

| File | Properties covered |
|------|--------------------|
| `reading/run.pbt.test.ts` | P1 (determinism), P2 (never throws), P3 (evidence paths) |
| `registry/cards.pbt.test.ts` | P4 (severity/orientation consistency), P14 (weight consistency) |
| `spread/assign.pbt.test.ts` | P5 (no duplicates), P6 (primary position), P11 (spread count) |
| `scoring/vitality.pbt.test.ts` | P7 (monotonic), P10 (bounds) |
| `util/mask.pbt.test.ts` | P8 (no raw secrets), P9 (length invariant) |
| `snapshot/builder-file-map.pbt.test.ts` | P12 (file cap), P13 (oversize skip) |
| `parser/tree-sitter.pbt.test.ts` | P15 (clean py3 → false) |

Each property test follows the project naming convention:
```typescript
describe("P1 (R17.8, R19.1): same snapshot + opts → identical Reading", () => { ... });
```

### Golden fixtures

Located at `packages/oracle/fixtures/`:

```
fixtures/
  py2-only/
    snapshot.json        — file map with print_statement, exec_statement, py2-only classifiers
    expected-reading.json — judgement severity 3 upright, tower present, etc.
  straddling/
    snapshot.json        — py2 syntax + six imports + __future__
    expected-reading.json — judgement severity 1 reversed
  no-tests/
    snapshot.json        — Python project, no test files, no runner config
    expected-reading.json — wheel severity 2 upright
  no-license/
    snapshot.json        — NOASSERTION licenseKey, no license file
    expected-reading.json — justice severity 2 upright
  archived/
    snapshot.json        — isArchived: true, pushed long ago
    expected-reading.json — hanged_man severity 2 upright
  clean/
    snapshot.json        — modern Python 3, tests present, CI, license, README
    expected-reading.json — star upright; all diagnostic cards null
  secrets/
    snapshot.json        — AWS key in source, yaml.load without Loader
    expected-reading.json — devil severity 2; evidence detail masked
```

Each `snapshot.json` contains a serialized file map `Record<string, string>`, a `RepoRef`, a `RepoMeta`, and a `createdAt` ISO 8601 UTC string. The golden test calls `buildSnapshotFromFileMap(ref, files, { meta, createdAt: '2026-11-03T12:00:00Z' })`, then `runReading(snapshot, { spreadKind: 'necropsy', now: '2026-11-03T12:00:00Z' })` (no LLM — the oracle package has none), and asserts the result deep-equals `expected-reading.json` excluding only `id` (a UUID generated fresh per run). `createdAt` is deterministic because it equals `opts.now`, so it is included in the comparison.

### WASM test strategy

`web-tree-sitter` runs in Node 22 / Vitest without a browser. The grammar `.wasm` file is loaded from `node_modules/tree-sitter-python/tree-sitter-python.wasm` using a file:// URL — no network required.

**Setup:** Create `packages/oracle/vitest.setup.ts`:
```typescript
import { initParser } from "../src/index.js";

// Initialize the real WASM parser once before all tests in this package.
// This runs in the Vitest worker process and is fast (< 200 ms) because
// the .wasm file is on disk.
beforeAll(async () => {
  await initParser();
});
```

Register it in `packages/oracle/vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

All unit tests for detectors, tree-sitter functions, and `runReading` use the real initialized parser with no mocking needed. There is no `MockParserFactory`.

`_resetParserForTests()` is NOT exported from `index.ts`. It is only used in integration tests that need to test the cold-init path (e.g. testing `PARSER_INIT_FAILED` when WASM is unavailable). These are tagged `@integration` and run via `pnpm --filter @necro/oracle test:integration`.

### Bundle size verification

The 50 KB gzipped limit for the main entry (R21.7) is verified with a Vitest fixture:

1. Add `@size-limit/preset-small-lib` (or a Vite bundle plugin) to the oracle package dev dependencies.
2. Add a `size-limit` config in `package.json`:
   ```json
   "size-limit": [{ "path": "dist/index.js", "limit": "50 KB", "gzip": true }]
   ```
3. Run `pnpm size` as part of `pnpm build` output verification. This is an automated CI check, not a Vitest test, so it does not pollute unit test output.
4. The Node-only `dist/node.js` entry is exempt (R21.7).
