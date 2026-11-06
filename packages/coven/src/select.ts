// @necro/coven — Candidate_File selection from reading evidence (design:
// "Candidate_File selection rule"). PURE module: no adapters, no side effects.
// It may import @necro/oracle only (for the Reading / RepoSnapshot / Evidence
// types); here it needs only those types and the local models.
//
// The rule (R2.1): a Candidate_File is a distinct `.py` path referenced by the
// evidence of Card_Draws whose detector classified the file as Python 2. The
// Judgement detector (`detectors/judgement.ts`) is the source of that
// classification — it emits one `Evidence` item per py2 construct kind with
// `source === "static"`, the construct `kind`, a `path`, and a 1-based `line`.
// A draw is "python-2-classified" for a given `.py` path when it carries such a
// static, py2-construct evidence item for that path. No new detection is done
// here; selection reads the reading the oracle already produced.
//
// The three targets scope that set (design + R1.2/R1.3/R1.4, R2.2):
//   - bare  ⇒ every py2 `.py` path, ascending by path, capped at 50 (R1.4/R2.6)
//   - card  ⇒ only the py2 `.py` paths that card's draws flagged (R1.2/R2.2)
//   - file  ⇒ the single exact py2 `.py` path (R1.3)
//
// Then the size/cap guards apply, in order (R2.5/R2.6):
//   - a path whose snapshot content exceeds 1 MB is excluded with a skip-note
//     naming it (R2.5)
//   - over the 50-file cap, the ascending prefix of 50 is kept and a skip-note
//     reports the deferred remainder (R1.5/R2.6)
//
// And a repo over 50 MB or 5,000 files is rejected up front with an
// `Error_Line`-mapped NecroError, before any candidate is derived (R2.7) — no
// file is touched. The function is otherwise side-effect-free and returns the
// candidate set plus the skip-notes so the runner can stream them.

import type { Evidence, Reading, RepoSnapshot } from "@necro/oracle";
import {
  covenError,
  type CandidateFile,
  type ResurrectTarget,
} from "./models.js";

// ---------------------------------------------------------------------------
// Limits (design: "Candidate_File selection rule", R2.5/R2.6/R2.7).
// ---------------------------------------------------------------------------

/** Per-file size limit: a Candidate_File over 1 MB is excluded (R2.5). */
const MAX_FILE_BYTES = 1_000_000;

/** Per-run file cap: at most 50 files are processed per Ritual (R1.4/R2.6). */
export const MAX_CANDIDATES = 50;

/** Repository size ceiling: over 50 MB the repo is rejected (R2.7). */
const MAX_REPO_BYTES = 50_000_000;

/** Repository file-count ceiling: over 5,000 files the repo is rejected (R2.7). */
const MAX_REPO_FILES = 5_000;

/**
 * The Python 2 construct kinds the Judgement detector emits as static evidence
 * (`detectors/judgement.ts` `CONSTRUCT_KINDS`). Evidence carrying one of these
 * kinds, with `source === "static"` and a `.py` path, marks that path as
 * Python-2-classified — the single signal this module reads. Keeping the set
 * explicit (rather than "any static evidence on a `.py` path") keeps selection
 * aligned with what the detector actually classified as py2, so an unrelated
 * static evidence item on a `.py` file never pulls it into a Ritual.
 */
const PY2_CONSTRUCT_KINDS: ReadonlySet<string> = new Set([
  "print_statement",
  "exec_statement",
  "except_comma",
  "ne_operator",
  "long_integer",
  "legacy_octal",
  "backtick_repr",
]);

// ---------------------------------------------------------------------------
// Result shape.
// ---------------------------------------------------------------------------

/**
 * The outcome of selection: the resolved, ascending-by-path Candidate_Files
 * (already size- and cap-filtered) and the oracle-voice skip-notes the runner
 * should stream as `Skip_Note_Line`s. An empty `candidates` with no skip-notes
 * is a valid, non-error outcome (R2.4 / R1.7) — the runner reports it as a
 * "no py2 files" `Result_Line`.
 */
export interface SelectionResult {
  readonly candidates: readonly CandidateFile[];
  readonly skipNotes: readonly string[];
}

// ---------------------------------------------------------------------------
// py2 classification of a single evidence item.
// ---------------------------------------------------------------------------

/**
 * True when `ev` is a Python-2-classified static construct on a `.py` path.
 * This is the one predicate that decides whether a path is a candidate: a
 * `source === "static"` item whose `kind` is a known py2 construct and whose
 * `path` is a non-empty `.py` file.
 */
function isPy2Evidence(ev: Evidence): ev is Evidence & { path: string } {
  return (
    ev.source === "static" &&
    PY2_CONSTRUCT_KINDS.has(ev.kind) &&
    typeof ev.path === "string" &&
    ev.path.endsWith(".py")
  );
}

// ---------------------------------------------------------------------------
// Flagged-path accumulation.
// ---------------------------------------------------------------------------

/**
 * Walk the reading's draws and build a map from each py2-classified `.py` path
 * to the sorted, de-duplicated set of card ids whose draws flagged it. Only
 * draws (optionally restricted to `cardFilter`) contribute, and only through
 * `isPy2Evidence`. The map's keys are exactly the distinct py2 paths the scope
 * admits; `flaggedBy` becomes the `CandidateFile.flaggedBy` provenance.
 */
function flaggedPaths(
  reading: Reading,
  cardFilter?: string,
): Map<string, string[]> {
  const byPath = new Map<string, Set<string>>();

  for (const draw of reading.draws) {
    if (cardFilter !== undefined && draw.card !== cardFilter) continue;
    for (const ev of draw.evidence) {
      if (!isPy2Evidence(ev)) continue;
      let cards = byPath.get(ev.path);
      if (cards === undefined) {
        cards = new Set<string>();
        byPath.set(ev.path, cards);
      }
      cards.add(draw.card);
    }
  }

  // Freeze provenance into a sorted array per path for deterministic output.
  const out = new Map<string, string[]>();
  for (const [path, cards] of byPath) {
    out.set(path, [...cards].sort());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Size / repo guards.
// ---------------------------------------------------------------------------

/**
 * Reject a repository that is too large to resurrect within budget (R2.7):
 * over `MAX_REPO_BYTES` total file bytes or over `MAX_REPO_FILES` files. The
 * thrown `NecroError` carries the reused oracle `DOWNLOAD_TOO_LARGE` code (an
 * `Error_Line`-mapped code) and an oracle-voice message; the runner maps it to
 * a terminal `Error_Line` and touches no file (the check runs before any
 * candidate is derived).
 */
function assertRepoWithinLimits(snapshot: RepoSnapshot): void {
  const fileCount = snapshot.files.length;
  const totalBytes = snapshot.files.reduce((sum, f) => sum + f.size, 0);

  if (fileCount > MAX_REPO_FILES || totalBytes > MAX_REPO_BYTES) {
    throw covenError(
      "DOWNLOAD_TOO_LARGE",
      // oracle-voice: one mystical line, then the actionable technical fact.
      "This crypt is too vast; the rite cannot encircle it.\n" +
        `Repository exceeds the limit (${fileCount} files, ` +
        `${totalBytes} bytes); max 5000 files or 50 MB.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Candidate assembly.
// ---------------------------------------------------------------------------

/**
 * Build a `CandidateFile` for `path` from the snapshot, or `null` with a
 * skip-note appended when the file is over the 1 MB per-file limit (R2.5). The
 * reported `sizeBytes` prefers the snapshot's recorded file size and falls back
 * to the byte length of the content; `before` is the snapshot content (or an
 * empty string if the content is absent, which cannot exceed the limit).
 */
function toCandidate(
  path: string,
  flaggedBy: string[],
  snapshot: RepoSnapshot,
  skipNotes: string[],
): CandidateFile | null {
  const before = snapshot.contents.get(path) ?? "";
  const fileEntry = snapshot.files.find((f) => f.path === path);
  const sizeBytes =
    fileEntry?.size ?? Buffer.byteLength(before, "utf8");

  if (sizeBytes > MAX_FILE_BYTES) {
    // oracle-voice: one mystical line, then the actionable technical fact.
    skipNotes.push(
      "Too heavy a corpse to lift; it stays in the ground.\n" +
        `Skipped ${path}: ${sizeBytes} bytes exceeds the 1 MB file limit.`,
    );
    return null;
  }

  return { path, before, sizeBytes, flaggedBy };
}

// ---------------------------------------------------------------------------
// Public selection entry point.
// ---------------------------------------------------------------------------

/**
 * Resolve the Candidate_Files for a Ritual from a completed reading and a
 * parsed `ResurrectTarget`, applying the selection rule and the size/cap
 * guards in order. Pure: it reads the snapshot and reading only and returns the
 * candidate set plus any skip-notes. The caller is responsible for handling a
 * `card` target that matches no draw in the reading (R2.3 / R1.8) — that guard
 * belongs to the route/runner, which already knows the reading's card set;
 * here a non-matching card id simply yields zero candidates.
 *
 * Throws `NecroError("DOWNLOAD_TOO_LARGE", ...)` when the repository exceeds
 * the supported size (R2.7), before deriving any candidate.
 */
export function selectCandidates(
  snapshot: RepoSnapshot,
  reading: Reading,
  target: ResurrectTarget,
): SelectionResult {
  // R2.7 — reject an oversize repository first; no file is touched.
  assertRepoWithinLimits(snapshot);

  const skipNotes: string[] = [];

  // Scope the py2 path set to the target.
  const cardFilter = target.kind === "card" ? target.card : undefined;
  const flagged = flaggedPaths(reading, cardFilter);

  // Ascending-by-path ordering is the canonical processing order (R1.4/R2.6);
  // it also fixes the file-path exact-match lookup and cap prefix.
  let orderedPaths = [...flagged.keys()].sort();

  if (target.kind === "file") {
    // R1.3 — the single exact py2 match (or none).
    orderedPaths = flagged.has(target.path) ? [target.path] : [];
  }

  // Apply the per-file size guard (R2.5), preserving ascending order.
  const sized: CandidateFile[] = [];
  for (const path of orderedPaths) {
    const candidate = toCandidate(
      path,
      flagged.get(path) ?? [],
      snapshot,
      skipNotes,
    );
    if (candidate !== null) sized.push(candidate);
  }

  // Apply the per-run cap (R1.5/R2.6) — keep the ascending prefix of 50, defer
  // the rest with a single skip-note reporting the deferred count.
  let candidates = sized;
  if (sized.length > MAX_CANDIDATES) {
    const deferred = sized.length - MAX_CANDIDATES;
    candidates = sized.slice(0, MAX_CANDIDATES);
    // oracle-voice: one mystical line, then the actionable technical fact.
    skipNotes.push(
      "The circle holds only fifty souls at a time.\n" +
        `Processing ${MAX_CANDIDATES} files; ${deferred} deferred to a ` +
        `later rite.`,
    );
  }

  return { candidates, skipNotes };
}
