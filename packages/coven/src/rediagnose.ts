// @necro/coven — vitality re-diagnosis via snapshot overlay (design: "Vitality
// re-diagnosis"). PURE module: it imports @necro/oracle (runReading,
// computeVitality, computeVitalityDelta, CARD_REGISTRY, and the snapshot /
// reading / draw types) and the local models only — no adapters, no side
// effects beyond the oracle's own parser initialisation inside `runReading`.
//
// Responsibility: given the completed pre-resurrection `Reading`, the summoned
// `RepoSnapshot`, and the per-file results, overlay every validated+changed
// `After_Content` into a COPY of the snapshot, re-divine it with the SAME
// spread, and report the vitality movement:
//
//   - overlay: for each validated file whose `after` differs from `before`,
//     replace `snapshot.contents[path]` with `after` and update that path's
//     `files[]` entry `size` (UTF-8 byte length) and `sha` (FNV-1a 32-bit, 8
//     hex) exactly as `buildSnapshotFromFileMap` computes them, so the overlay
//     snapshot is indistinguishable from one summoned at the resurrected
//     commit. The original snapshot is never mutated (R6.1).
//   - re-reading: `runReading(overlaySnapshot, { spreadKind: input.spread,
//     now: input.now })` with the same spread as the original reading (R6.1).
//   - vitality: `beforeVitality = computeVitality(reading.draws)`,
//     `afterVitality = computeVitality(postReading.draws)` (R6.2),
//     `vitalityDelta = computeVitalityDelta(before, after)` (R6.3).
//   - changed cards: the symmetric difference over `(presence, severity,
//     orientation)` between the two draw sets; `improved` is true when the
//     card's contribution to vitality (`weight × severity`) drops, which
//     includes a card that disappears entirely (R6.4).
//   - failure: if the post-reading rejects, preserve the pre-reading, set
//     `afterVitality`/`vitalityDelta` to `null`, and surface a
//     `REDIAGNOSIS_FAILED` error for that step WITHOUT discarding the produced
//     `File_Result`s (R6.5).

import {
  CARD_REGISTRY,
  computeVitality,
  computeVitalityDelta,
  runReading,
  type CardDraw,
  type CardId,
  type FileEntry,
  type Reading,
  type RepoSnapshot,
} from "@necro/oracle";

import { covenError, type ChangedCard, type FileResult, type RitualInput } from "./models.js";

// ---------------------------------------------------------------------------
// Snapshot overlay helpers — kept byte-for-byte consistent with the oracle's
// `buildSnapshotFromFileMap` so an overlaid file is scored identically to one
// summoned fresh at the resurrected commit. Those helpers are module-private in
// the oracle builder (not exported), so they are reproduced here verbatim.
// ---------------------------------------------------------------------------

const UTF8_ENCODER = new TextEncoder();

/** UTF-8 byte length of a string (matches `FileEntry.size` in the builder). */
function byteLength(s: string): number {
  return UTF8_ENCODER.encode(s).length;
}

/**
 * Deterministic FNV-1a 32-bit content hash rendered as 8 hex chars — the exact
 * algorithm `buildSnapshotFromFileMap` uses for `FileEntry.sha`, so an overlaid
 * entry's sha is what the builder would have produced for the same content.
 */
function contentSha(content: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build a COPY of `snapshot` with the validated, changed `After_Content`s
 * overlaid. The source snapshot is never mutated: `contents` is cloned into a
 * fresh Map, and `files` into a fresh array with each changed path's entry
 * replaced (size + sha recomputed). Only files that are `validated` AND whose
 * `after` differs from `before` are overlaid — a not-validated or unchanged
 * file leaves the original content in place.
 */
function overlaySnapshot(snapshot: RepoSnapshot, files: readonly FileResult[]): RepoSnapshot {
  // The validated+changed content for each path we must overlay.
  const overlays = new Map<string, string>();
  for (const file of files) {
    if (!file.validated) continue;
    if (file.after === file.before) continue;
    overlays.set(file.path, file.after);
  }

  // A fresh contents Map so the original snapshot's Map is untouched.
  const contents = new Map(snapshot.contents);
  for (const [path, after] of overlays) {
    contents.set(path, after);
  }

  // A fresh files[] with each overlaid path's size/sha recomputed. Entries for
  // untouched paths are carried through by reference (they are not mutated).
  const fileEntries: FileEntry[] = snapshot.files.map((entry) => {
    const after = overlays.get(entry.path);
    if (after === undefined) return entry;
    return { ...entry, size: byteLength(after), sha: contentSha(after) };
  });

  return {
    ...snapshot,
    files: fileEntries,
    contents,
  };
}

// ---------------------------------------------------------------------------
// Changed-card computation (R6.4).
// ---------------------------------------------------------------------------

/** A draw's contribution to the vitality penalty: `weight × severity`. */
function contribution(draw: CardDraw): number {
  const def = CARD_REGISTRY.get(draw.card as CardId);
  const weight = def === undefined ? 0 : def.weight;
  return weight * draw.severity;
}

/**
 * The changed-card set: the symmetric difference over `(presence, severity,
 * orientation)` between the two draw sets. A card present in exactly one
 * reading is `added`/`removed`; a card present in both whose severity or
 * orientation differs is reported once with the `severity`/`orientation`
 * change kind (severity takes precedence when both differ). `improved` is true
 * when the card's vitality contribution drops after resurrection — a removed
 * card (contribution → 0) is always an improvement.
 *
 * Exported for property testing (task 9.5 / Property 7): the changed-card set
 * is a pure function of the two draw sets, so the property drives it directly
 * with generated `CardDraw[]` pairs rather than through the full `rediagnose`
 * pipeline (which would re-divine an overlaid snapshot and so could not control
 * the `after` draws independently of the `before`).
 */
export function changedCards(
  before: readonly CardDraw[],
  after: readonly CardDraw[],
): ChangedCard[] {
  const beforeByCard = new Map<string, CardDraw>();
  for (const draw of before) beforeByCard.set(draw.card, draw);
  const afterByCard = new Map<string, CardDraw>();
  for (const draw of after) afterByCard.set(draw.card, draw);

  // Deterministic iteration order: every card that appears in either reading,
  // sorted by card id so the reported set is stable across runs.
  const cards = new Set<string>([...beforeByCard.keys(), ...afterByCard.keys()]);
  const sorted = [...cards].sort();

  const changes: ChangedCard[] = [];
  for (const card of sorted) {
    const b = beforeByCard.get(card);
    const a = afterByCard.get(card);

    if (b !== undefined && a === undefined) {
      // Present before, gone after — contribution drops to 0, so improved.
      changes.push({ card, change: "removed", improved: contribution(b) > 0 });
      continue;
    }
    if (b === undefined && a !== undefined) {
      // Appeared after resurrection — a regression unless weightless.
      changes.push({ card, change: "added", improved: contribution(a) < 0 });
      continue;
    }
    // Present in both. `b`/`a` are defined here.
    if (b === undefined || a === undefined) continue; // unreachable; narrows types
    if (b.severity !== a.severity) {
      changes.push({
        card,
        change: "severity",
        improved: contribution(a) < contribution(b),
      });
      continue;
    }
    if (b.orientation !== a.orientation) {
      changes.push({
        card,
        change: "orientation",
        improved: contribution(a) < contribution(b),
      });
      continue;
    }
    // Identical presence, severity, and orientation — not a changed card.
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Public result + entry point.
// ---------------------------------------------------------------------------

/**
 * The outcome of re-diagnosis. On success `afterVitality`/`vitalityDelta` are
 * numbers, `postReading` is the re-divined Reading, `changedCards` is the draw
 * difference, and `error` is `null`. On post-reading failure (R6.5)
 * `afterVitality`/`vitalityDelta` are `null`, `changedCards` is empty,
 * `postReading` is `null`, and `error` is a `REDIAGNOSIS_FAILED` NecroError the
 * runner surfaces as the re-diagnosis step's `Error_Line` — the caller keeps
 * its already-produced `File_Result`s regardless.
 */
export interface RediagnoseResult {
  readonly beforeVitality: number;
  readonly afterVitality: number | null;
  readonly vitalityDelta: number | null;
  readonly changedCards: readonly ChangedCard[];
  readonly postReading: Reading | null;
  readonly error: ReturnType<typeof covenError> | null;
}

/**
 * Re-diagnose repository vitality after a resurrection by overlaying the
 * validated `After_Content`s into a copy of the summoned snapshot and
 * re-divining it with the same spread (design: "Vitality re-diagnosis").
 *
 * `beforeVitality` is always computed from the pre-resurrection `reading.draws`
 * and is returned on both the success and failure paths. On the failure path a
 * `REDIAGNOSIS_FAILED` error is returned (not thrown) so the runner can surface
 * it for the re-diagnosis step without discarding the `File_Result`s (R6.5).
 */
export async function rediagnose(
  input: RitualInput,
  files: readonly FileResult[],
): Promise<RediagnoseResult> {
  const beforeVitality = computeVitality(input.reading.draws);

  let postReading: Reading;
  try {
    const overlay = overlaySnapshot(input.snapshot, files);
    postReading = await runReading(overlay, {
      spreadKind: input.spread,
      now: input.now,
    });
  } catch (cause) {
    // R6.5: preserve the pre-reading, null out after/delta, and surface a
    // typed REDIAGNOSIS_FAILED error for this step. File_Results are untouched
    // (the caller keeps them).
    return {
      beforeVitality,
      afterVitality: null,
      vitalityDelta: null,
      changedCards: [],
      postReading: null,
      error: covenError(
        "REDIAGNOSIS_FAILED",
        "The second reading would not settle.\nThe rites held, but the cards refuse a verdict.",
        cause,
      ),
    };
  }

  const afterVitality = computeVitality(postReading.draws);
  const vitalityDelta = computeVitalityDelta(beforeVitality, afterVitality);

  return {
    beforeVitality,
    afterVitality,
    vitalityDelta,
    changedCards: changedCards(input.reading.draws, postReading.draws),
    postReading,
    error: null,
  };
}
