// src/landing/repos.ts
//
// Feature: oracle-landing-polish, task 2.1.
//
// The pure LEGACY REPOS table for the DMG Landing_State: the `LegacyRepo` zod
// schema, the three concrete authored rows with their per-repo ORACLE SAYS
// lines (oracle voice, <= 72 columns, ASCII-only), the final "ENTER ANY REPO"
// affordance, and the `LandingRow` discriminated union that the selection model
// walks (design.md §"Pure module: LEGACY REPOS table").
//
// Nothing here reads the DOM, clock, network or storage. Each authored row is
// validated against `LegacyRepoSchema` at module load so a malformed or
// over-long entry fails loudly at import time rather than at render time.

import { z } from "zod";

/** One selectable legacy-repo entry shown in the landing list. */
export const LegacyRepoSchema = z
  .object({
    /** The `owner/repo` summoned when this row is activated. */
    ref: z.string().min(1),
    /** The display label (e.g. "tomaes/pytarl"). */
    label: z.string().min(1),
    /** The DMG tag (e.g. "DUNGEON"). */
    tag: z.string().min(1),
    /** The file-count caption (e.g. "4 FILES"). */
    files: z.string().min(1),
    /** The per-repo ORACLE SAYS line (oracle voice, <= 72 columns). */
    oracleSays: z.string().min(1).max(72),
  })
  .strict();

export type LegacyRepo = z.infer<typeof LegacyRepoSchema>;

/**
 * The three authored repo rows, grounded in the spec. The concrete rows summon
 * + `read fates` when activated; each ORACLE SAYS line is oracle voice, <= 72
 * columns, and ASCII-only.
 */
export const LEGACY_REPOS: readonly LegacyRepo[] = [
  LegacyRepoSchema.parse({
    ref: "tomaes/pytarl",
    label: "tomaes/pytarl",
    tag: "DUNGEON",
    files: "4 FILES",
    oracleSays: "A small dungeon of dead code waits below.",
  }),
  LegacyRepoSchema.parse({
    ref: "ArmstrongJ/robotadventure",
    label: "ArmstrongJ/robotadventure",
    tag: "NOIR MYSTERY",
    files: "21 FILES",
    oracleSays: "A noir mystery, its detective long since gone.",
  }),
  LegacyRepoSchema.parse({
    ref: "neubig/test-repo",
    label: "neubig/test-repo",
    tag: "PY2 SPECIMEN",
    files: "240 FILES",
    oracleSays: "A vast specimen, 240 corpses of Python 2.",
  }),
];

/** The label for the final "enter any repo" affordance row. */
export const ENTER_ANY_LABEL = "> ENTER ANY REPO...";

/**
 * One row in the landing list: either a concrete repo (summon + read fates on
 * activation) or the ENTER row (focus the NECRO> input on activation).
 */
export type LandingRow =
  | { readonly kind: "repo"; readonly repo: LegacyRepo }
  | { readonly kind: "enter"; readonly label: string };

/** The full selectable list: the concrete repos followed by the ENTER row. */
export const LANDING_ROWS: readonly LandingRow[] = [
  ...LEGACY_REPOS.map((repo): LandingRow => ({ kind: "repo", repo })),
  { kind: "enter", label: ENTER_ANY_LABEL },
];
