// src/reading/run.ts
//
// Reading schemas and ReadingOpts for the Oracle Deck Engine. A Reading is the
// top-level result of divining a repository snapshot: the drawn cards, the
// assigned spread, the computed vitality, and any per-detector errors.
//
// Note: this file currently defines only the schema section. The runReading
// orchestrator is added in task 30.2.

import { z } from "zod";
import { CardDrawSchema, SpreadPositionSchema } from "../registry/schema.js";
import { RepoRefSchema } from "../snapshot/types.js";

export const SpreadKindSchema = z.enum(["fates", "necropsy", "celtic"]);
export type SpreadKind = z.infer<typeof SpreadKindSchema>;

export const ReadingOptsSchema = z.object({
  spreadKind: SpreadKindSchema.default("necropsy"),
  registryData: z
    .instanceof(Map)
    .optional()
    .describe("Pre-fetched dep freshness for Tower detector"),
  osvData: z
    .array(z.unknown())
    .optional()
    .describe("Pre-fetched OSV vulnerabilities for Devil detector"),
  now: z
    .string()
    .describe(
      "ISO 8601 UTC string; used by all time-sensitive detectors. Never call Date.now() inside detectors."
    ),
});
export type ReadingOpts = z.infer<typeof ReadingOptsSchema>;

export const ReadingSchema = z.object({
  id: z.string().uuid().describe("UUID v4"),
  repo: RepoRefSchema,
  draws: z.array(CardDrawSchema),
  spread: z.array(SpreadPositionSchema),
  vitality: z.number().int().min(0).max(100),
  createdAt: z
    .string()
    .describe(
      "ISO 8601 UTC string; always equals opts.now, never the system clock"
    ),
  engineVersion: z.string().describe("Version from package.json"),
  errors: z
    .array(
      z.object({
        code: z.string(),
        userMessage: z.string(),
        cardId: z.string().optional(),
      })
    )
    .describe("Errors from individual detectors; empty when all succeed"),
});
export type Reading = z.infer<typeof ReadingSchema>;

// ============================================================
// runReading orchestrator (task 30.2)
// ------------------------------------------------------------
// The single async orchestrator of the oracle package. Per design.md
// ("Reading orchestrator" + "Diagram 1: runReading execution flow") it:
//   1. awaits initParser() once (propagating PARSER_INIT_FAILED as a
//      whole-reading failure),
//   2. parses every .py file exactly once into `trees` (FILE_TOO_LARGE and
//      other NecroErrors land in `parseErrors`),
//   3. runs parseAllManifests and attaches the result to the snapshot,
//   4. builds DetectorOpts and runs the eleven snapshot detectors via
//      Promise.allSettled — a throwing detector lands a NecroError in
//      Reading.errors while the others complete,
//   5. filters null draws, assigns the spread, and computes vitality,
//   6. assembles the Reading with id = crypto.randomUUID(), createdAt =
//      opts.now (never the system clock), engineVersion from a module constant
//      that mirrors package.json.
//
// Design API: runReading(snapshot: RepoSnapshot, opts: ReadingOpts): Promise<Reading>
//
// _Requirements: R19.1, R19.2, R19.3, R19.4, R19.5, R21.8_
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Tree } from "../parser/tree-sitter.js";
import { initParser, parsePython } from "../parser/tree-sitter.js";
import { parseAllManifests } from "../parser/manifest.js";
import { assignSpread } from "../spread/assign.js";
import { computeVitality } from "../scoring/vitality.js";
import type { CardDraw } from "../registry/schema.js";
import type {
  Detector,
  DetectorOpts,
  OsvData,
  RegistryData,
} from "../detectors/types.js";
import { detectJudgement } from "../detectors/judgement.js";
import { detectTower } from "../detectors/tower.js";
import { detectDevil } from "../detectors/devil.js";
import { detectDeath } from "../detectors/death.js";
import { detectWheel } from "../detectors/wheel.js";
import { detectHermit } from "../detectors/hermit.js";
import { detectHangedMan } from "../detectors/hanged-man.js";
import { detectTemperance } from "../detectors/temperance.js";
import { detectJustice } from "../detectors/justice.js";
import { detectMoon } from "../detectors/moon.js";
import { detectStar } from "../detectors/star.js";
import { NecroError } from "../util/errors.js";

/**
 * Engine version, mirroring `packages/oracle/package.json`'s `version`. Kept as
 * a hardcoded module constant (not read via `fs`) so that `src/reading/run.ts`
 * — re-exported from the browser-safe main entry (`src/index.ts`) — never pulls
 * a Node `fs` import into the main bundle, and so there is no circular import
 * through `src/index.ts`.
 */
const ENGINE_VERSION = "0.0.0";

/** The eleven snapshot detectors, in a fixed order (world is excluded). */
const SNAPSHOT_DETECTORS: readonly Detector[] = [
  detectJudgement,
  detectTower,
  detectDevil,
  detectDeath,
  detectWheel,
  detectHermit,
  detectHangedMan,
  detectTemperance,
  detectJustice,
  detectMoon,
  detectStar,
];

/** Parallel human-readable seer names, used only in DETECTOR_FAILED messages. */
const DETECTOR_NAMES: readonly string[] = [
  "Judgement",
  "Tower",
  "Devil",
  "Death",
  "Wheel",
  "Hermit",
  "Hanged Man",
  "Temperance",
  "Justice",
  "Moon",
  "Star",
];

/**
 * Divine a repository snapshot into a full Reading: run every snapshot detector
 * over the pre-parsed trees and injected data, lay the drawn cards into the
 * requested spread, and score the repository's vitality.
 *
 * Deterministic for a fixed `(snapshot, opts)` save for the fresh `id` minted
 * per run. A failing detector is isolated into `Reading.errors` and never
 * propagates; only a parser initialisation failure rejects the whole reading.
 */
export async function runReading(
  snapshot: RepoSnapshot,
  opts: ReadingOpts,
): Promise<Reading> {
  // 1. Initialise the parser once. A PARSER_INIT_FAILED rejection is a
  //    whole-reading failure — let it propagate.
  await initParser();

  // 2. Parse every Python file exactly once. Successful parses land in `trees`;
  //    NecroErrors (FILE_TOO_LARGE etc.) land in `parseErrors`.
  const trees = new Map<string, Tree>();
  const parseErrors = new Map<string, NecroError>();
  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    const content = snapshot.contents.get(file.path);
    if (content === undefined) continue;
    try {
      trees.set(file.path, parsePython(content));
    } catch (err) {
      if (err instanceof NecroError) {
        parseErrors.set(file.path, err);
      } else {
        throw err;
      }
    }
  }

  // 3. Parse all manifests and attach them to the snapshot — detectors read
  //    `snapshot.manifests`.
  snapshot.manifests = parseAllManifests(snapshot);

  // 4. Build the shared DetectorOpts. registryData/osvData are only assigned
  //    when defined (exactOptionalPropertyTypes is on, so the keys must stay
  //    absent — not set to undefined — when the caller omits them).
  const detectorOpts: DetectorOpts = { now: opts.now, trees, parseErrors };
  if (opts.registryData !== undefined) {
    detectorOpts.registryData = opts.registryData as RegistryData;
  }
  if (opts.osvData !== undefined) {
    detectorOpts.osvData = opts.osvData as OsvData;
  }

  // 5. Run the eleven snapshot detectors concurrently, isolating each so a
  //    throw cannot abort the others.
  const settled = await Promise.allSettled(
    SNAPSHOT_DETECTORS.map((detector) =>
      Promise.resolve().then(() => detector(snapshot, detectorOpts)),
    ),
  );

  // 6. Collect non-null draws; map rejections into Reading.errors.
  const draws: CardDraw[] = [];
  const errors: Reading["errors"] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value !== null) draws.push(result.value);
      return;
    }
    const name = DETECTOR_NAMES[index] ?? "unknown";
    const failure = new NecroError(
      "DETECTOR_FAILED",
      `The ${name} seer collapsed mid-reading; its card is lost to the void.`,
      result.reason,
    );
    errors.push({ code: failure.code, userMessage: failure.userMessage });
  });

  // 7. Lay the spread and score vitality.
  const spread = assignSpread(draws, opts.spreadKind, snapshot.ref.sha);
  const vitality = computeVitality(draws);

  // 8. Assemble the Reading. `globalThis.crypto.randomUUID()` is available in
  //    Node 22 and browsers, keeping the main entry Node-`fs`-free.
  const reading: Reading = {
    id: globalThis.crypto.randomUUID(),
    repo: snapshot.ref,
    draws,
    spread,
    vitality,
    createdAt: opts.now,
    engineVersion: ENGINE_VERSION,
    errors,
  };

  // 9. Validate the assembled Reading for safety. The Reading carries no
  //    `contents` Map, so parse is cheap and strict.
  return ReadingSchema.parse(reading);
}
