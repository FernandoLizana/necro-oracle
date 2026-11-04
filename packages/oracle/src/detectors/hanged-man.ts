// src/detectors/hanged-man.ts
//
// XII — The Hanged Man (Stagnation) detector.
//
// A pure, synchronous Detector that reads the repository metadata recorded on
// the snapshot (last push, archived flag, open issue / PR counts, oldest open
// PR age) and draws The Hanged Man when a project hangs suspended — abandoned,
// stale, or merely slowing. It consults no files and no parsed trees; the only
// clock it may read is `opts.now` (never `Date.now()`), so that a reading is a
// deterministic function of the snapshot and the supplied instant.
//
// Detection (design.md "detectHangedMan — XII The Hanged Man (Stagnation)"):
//   1. Validate snapshot.meta against RepoMetaSchema → throw
//      NecroError(INVALID_REPO_META) on failure (R11.1).
//   2. pushedAtAge = whole days between opts.now and meta.pushedAt
//      (null pushedAt → Infinity).
//   3. Rules in priority order:
//      - meta.isArchived === true                         → severity 2, upright (R11.2)
//      - !isArchived && pushedAtAge > 730 && openIssueCount >= 3
//                                                          → severity 2, upright (R11.3)
//      - neither upright && ( pushedAtAge in (183, 730] OR
//        (openPRCount >= 3 && oldestOpenPRAgeDays >= 180) )
//                                                          → severity 1, reversed (R11.4)
//      - otherwise (active / insufficient signal)          → null             (R11.5)
//   Evidence: pushedAt (or "unknown"), isArchived, openIssueCount, openPRCount,
//   computed age in whole days (R11.6).
//
// Covers: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6

import { NecroError } from "../util/errors.js";
import { RepoMetaSchema } from "../snapshot/types.js";
import type { Evidence, CardDraw } from "../registry/schema.js";
import type { Detector, DetectorOpts } from "./types.js";
import type { RepoMeta, RepoSnapshot } from "../snapshot/types.js";

const MS_PER_DAY = 86_400_000;

/** Whole days between `now` and `pushedAt`; null pushedAt → Infinity. */
function pushedAtAgeDays(now: string, pushedAt: string | null): number {
  if (pushedAt === null) return Infinity;
  return Math.floor((Date.parse(now) - Date.parse(pushedAt)) / MS_PER_DAY);
}

/**
 * Build the shared evidence vector: every stagnation signal is surfaced so the
 * draw can explain itself regardless of which rule fired (R11.6). The age item
 * reports the computed whole-day age ("unknown" when pushedAt is null).
 */
function buildEvidence(meta: RepoMeta, age: number): Evidence[] {
  const pushedAtText = meta.pushedAt ?? "unknown";
  const ageText = Number.isFinite(age) ? String(age) : "unknown";
  return [
    {
      kind: "last-push",
      detail: `last pushed at ${pushedAtText} (${ageText} whole days before the reading)`,
      source: "github",
    },
    {
      kind: "archived-flag",
      detail: `repository archived: ${meta.isArchived ? "archived (true)" : "not archived (false)"}`,
      source: "github",
    },
    {
      kind: "open-issues",
      detail: `openIssueCount: ${meta.openIssueCount}`,
      source: "github",
    },
    {
      kind: "open-prs",
      detail: `openPRCount: ${meta.openPRCount}; oldestOpenPRAgeDays: ${
        meta.oldestOpenPRAgeDays ?? "unknown"
      }`,
      source: "github",
    },
  ];
}

export const detectHangedMan: Detector = (
  snapshot: RepoSnapshot,
  opts: DetectorOpts,
): CardDraw | null => {
  // R11.1 — the metadata is untrusted at this boundary; validate it first.
  const parsed = RepoMetaSchema.safeParse(snapshot.meta);
  if (!parsed.success) {
    throw new NecroError(
      "INVALID_REPO_META",
      "The Hanged Man cannot read a corrupted fate; the repository's omens are malformed.",
      parsed.error,
    );
  }
  const meta = parsed.data;

  const age = pushedAtAgeDays(opts.now, meta.pushedAt);
  const evidence = buildEvidence(meta, age);

  // R11.2 — an archived repository hangs, fully suspended. Highest priority.
  if (meta.isArchived === true) {
    return {
      card: "hanged_man",
      severity: 2,
      orientation: "upright",
      evidence,
      summary:
        "The repository is archived; The Hanged Man hangs upright over abandoned work.",
      grimoires: [],
    };
  }

  // R11.3 — long-dead push with unanswered issues: abandoned in all but name.
  if (age > 730 && meta.openIssueCount >= 3) {
    return {
      card: "hanged_man",
      severity: 2,
      orientation: "upright",
      evidence,
      summary: `No push in ${age} days with ${meta.openIssueCount} open issues; The Hanged Man hangs upright.`,
      grimoires: [],
    };
  }

  // R11.4 — slowing activity: a push inside (183, 730], or a backlog of aging
  // open pull requests. The card hangs reversed — latent, not yet dead.
  const inStaleRange = age > 183 && age <= 730;
  const agingPRs =
    meta.openPRCount >= 3 &&
    meta.oldestOpenPRAgeDays !== null &&
    meta.oldestOpenPRAgeDays >= 180;
  if (inStaleRange || agingPRs) {
    return {
      card: "hanged_man",
      severity: 1,
      orientation: "reversed",
      evidence,
      summary:
        "Activity is slowing — a stale push or a backlog of aging pull requests; The Hanged Man hangs reversed.",
      grimoires: [],
    };
  }

  // R11.5 — recent push, not archived, few open PRs: the project still breathes.
  return null;
};
