// packages/coven/src/select.test.ts
//
// Example-based unit tests for `selectCandidates` (task 8.1) covering the
// selection *guard* cases the Property 1 generator deliberately steers around
// (packages/coven/src/select.pbt.test.ts keeps its py2 path count under the cap
// and its files under 1 MB). Three guards are pinned here:
//
//   - Unknown / non-matching card id ⇒ zero candidates, no error (R2.3 / R1.8).
//     `select.ts`'s own doc is explicit: a `card` target whose id matches no
//     draw simply yields an empty candidate set; the "card not in the reading"
//     *rejection* belongs to the route/runner (tested in 13.4), not here. So
//     this asserts selectCandidates' actual behaviour: empty, no throw.
//   - A target that resolves to zero candidate files ⇒ empty `candidates`, no
//     skip-notes, no error (R1.7 / R2.4). The runner turns this into a
//     `Result_Line` ("no py2 files"); selection must not treat it as an error.
//   - A repository over 50 MB or 5,000 files ⇒ throws a `NecroError`
//     (code `DOWNLOAD_TOO_LARGE`) *before* any candidate is derived (R2.7).
//
// Fixtures are hand-crafted and self-contained (no shared arbitraries, no
// network / LLM / sandbox): a tiny runtime `RepoSnapshot` built from a file map
// and a `Reading` whose draws carry (or lack) py2 static evidence. The oversize
// repo is constructed directly so its `files[].size` can exceed the limits
// without the file-map builder's own per-file / file-count filtering.
//
// Validates: Requirements 1.7, 1.8, 2.3, 2.4, 2.7

import {
  NecroError,
  buildSnapshotFromFileMap,
  type CardDraw,
  type Evidence,
  type FileEntry,
  type Reading,
  type RepoMeta,
  type RepoRef,
  type RepoSnapshot,
} from "@necro/oracle";
import { describe, expect, it } from "vitest";

import { selectCandidates } from "./select.js";
import type { ResurrectTarget } from "./models.js";

// ---------------------------------------------------------------------------
// Fixture helpers — the smallest schema-valid snapshot / reading selection reads.
// ---------------------------------------------------------------------------

const REF: RepoRef = {
  owner: "graveyard",
  name: "dead-repo",
  sha: "0".repeat(40),
  defaultBranch: "main",
};

const META: RepoMeta = {
  pushedAt: null,
  isArchived: false,
  openIssueCount: 0,
  openPRCount: 0,
  oldestOpenPRAgeDays: null,
  latestReleaseAt: null,
  licenseKey: null,
};

const CREATED_AT = "2024-01-01T00:00:00.000Z";

/** A py2-classified static evidence item on a `.py` path (what selection reads). */
function py2Evidence(path: string): Evidence {
  return {
    kind: "print_statement",
    path,
    line: 1,
    detail: "legacy print statement",
    source: "static",
  };
}

/** A minimal draw for `card` carrying `evidence`. */
function draw(card: string, evidence: Evidence[]): CardDraw {
  return {
    card: card as CardDraw["card"],
    severity: 1,
    orientation: "reversed",
    evidence,
    summary: "",
    grimoires: [],
  };
}

/** A Reading over the given draws (every other field is a harmless default). */
function reading(draws: CardDraw[]): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repo: REF,
    draws,
    spread: [],
    vitality: 100,
    createdAt: CREATED_AT,
    engineVersion: "0.0.0",
    errors: [],
  };
}

/** A runtime snapshot from a path→content map (files stay far under 1 MB). */
function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, {
    meta: META,
    createdAt: CREATED_AT,
  });
}

// ---------------------------------------------------------------------------
// R2.3 / R1.8 — unknown / non-matching card id ⇒ zero candidates, no error.
// ---------------------------------------------------------------------------

describe("selectCandidates (R2.3, R1.8): unknown / non-matching card target", () => {
  it("yields zero candidates and no skip-notes when the card id matches no draw", () => {
    // The reading flags one py2 file under `judgement`, but the target names a
    // different card. select.ts scopes to that card's draws → nothing matches.
    const snapshot = snapshotOf({ "legacy.py": "print 'x'\n" });
    const r = reading([draw("judgement", [py2Evidence("legacy.py")])]);
    const target: ResurrectTarget = { kind: "card", card: "death" };

    const result = selectCandidates(snapshot, r, target);

    expect(result.candidates).toEqual([]);
    expect(result.skipNotes).toEqual([]);
  });

  it("yields zero candidates for a card id that is not a real card at all", () => {
    // A completely unknown id is treated the same way: it simply matches no
    // draw. (Rejecting an id not in the reading's card set is the route's job,
    // tested in 13.4; selectCandidates never throws for it.)
    const snapshot = snapshotOf({ legacy: "print 'x'\n", "a.py": "print 1\n" });
    const r = reading([draw("judgement", [py2Evidence("a.py")])]);
    const target: ResurrectTarget = { kind: "card", card: "not_a_card" };

    const result = selectCandidates(snapshot, r, target);

    expect(result.candidates).toEqual([]);
    expect(result.skipNotes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R1.7 / R2.4 — a target resolving to zero candidate files is a clean,
// non-error outcome (the runner maps it to a "no py2 files" Result_Line).
// ---------------------------------------------------------------------------

describe("selectCandidates (R1.7, R2.4): zero-candidate targets are not errors", () => {
  it("bare target over a reading with no py2 evidence ⇒ empty, no skip-notes, no throw", () => {
    // The only draw carries non-py2 evidence (a non-static source), so no path
    // is py2-classified; a bare run selects nothing but must not error.
    const snapshot = snapshotOf({ "clean.py": "print(1)\n" });
    const nonPy2: Evidence = {
      kind: "dependency_stale",
      path: "clean.py",
      line: 1,
      detail: "not a py2 construct",
      source: "github",
    };
    const r = reading([draw("tower", [nonPy2])]);

    const result = selectCandidates(snapshot, r, { kind: "bare" });

    expect(result.candidates).toEqual([]);
    expect(result.skipNotes).toEqual([]);
  });

  it("file target naming a path that is not py2-classified ⇒ empty, no skip-notes", () => {
    // `other.py` exists and is py2; the file target names `clean.py`, which is
    // present in the snapshot but carries no py2 evidence → zero candidates.
    const snapshot = snapshotOf({
      "clean.py": "print(1)\n",
      "other.py": "print 2\n",
    });
    const r = reading([draw("judgement", [py2Evidence("other.py")])]);
    const target: ResurrectTarget = { kind: "file", path: "clean.py" };

    const result = selectCandidates(snapshot, r, target);

    expect(result.candidates).toEqual([]);
    expect(result.skipNotes).toEqual([]);
  });

  it("file target naming a path absent from the reading entirely ⇒ empty", () => {
    const snapshot = snapshotOf({ "present.py": "print 1\n" });
    const r = reading([draw("judgement", [py2Evidence("present.py")])]);
    const target: ResurrectTarget = { kind: "file", path: "ghost.py" };

    const result = selectCandidates(snapshot, r, target);

    expect(result.candidates).toEqual([]);
    expect(result.skipNotes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R2.7 — an oversize repository is rejected before any candidate is derived.
//
// The snapshot is built directly (not via buildSnapshotFromFileMap, which caps
// files at 5,000 and drops >1 MB files) so `files[].size` can be set past the
// limits selectCandidates enforces.
// ---------------------------------------------------------------------------

/** A FileEntry with an explicit byte size (content is irrelevant to the guard). */
function fileEntry(path: string, size: number): FileEntry {
  return { path, size, lang: "python", sha: "deadbeef" };
}

/** A snapshot carrying the given file entries directly (bypassing the builder). */
function rawSnapshot(files: FileEntry[]): RepoSnapshot {
  return {
    ref: REF,
    files,
    meta: META,
    manifests: [],
    contents: new Map<string, string>(),
    oversizeFiles: [],
    truncated: false,
    createdAt: CREATED_AT,
  };
}

describe("selectCandidates (R2.7): oversize repository is rejected up front", () => {
  it("throws NecroError(DOWNLOAD_TOO_LARGE) when total bytes exceed 50 MB", () => {
    // One (hypothetical) 51 MB file — over the 50 MB ceiling.
    const snapshot = rawSnapshot([fileEntry("huge.py", 51_000_000)]);
    const r = reading([draw("judgement", [py2Evidence("huge.py")])]);

    let thrown: unknown;
    try {
      selectCandidates(snapshot, r, { kind: "bare" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(NecroError);
    expect((thrown as NecroError).code).toBe("DOWNLOAD_TOO_LARGE");
    // An oracle-voice userMessage is set (one line, then the technical fact).
    expect((thrown as NecroError).userMessage.length).toBeGreaterThan(0);
  });

  it("throws NecroError(DOWNLOAD_TOO_LARGE) when the file count exceeds 5,000", () => {
    // 5,001 tiny files — over the file-count ceiling, under the byte ceiling.
    const files = Array.from({ length: 5_001 }, (_, i) =>
      fileEntry(`f${i}.py`, 10),
    );
    const snapshot = rawSnapshot(files);
    const r = reading([draw("judgement", [py2Evidence("f0.py")])]);

    expect(() => selectCandidates(snapshot, r, { kind: "bare" })).toThrow(
      NecroError,
    );
  });

  it("rejects before deriving candidates (a file target is never resolved)", () => {
    // Even a file target that would otherwise match is rejected first: the
    // repo-size guard runs before any selection work (R2.7, "before any
    // candidate is derived").
    const snapshot = rawSnapshot([fileEntry("huge.py", 60_000_000)]);
    const r = reading([draw("judgement", [py2Evidence("huge.py")])]);

    expect(() =>
      selectCandidates(snapshot, r, { kind: "file", path: "huge.py" }),
    ).toThrow(NecroError);
  });

  it("does not throw at exactly the limits (50 MB total, 5,000 files)", () => {
    // Boundary: `> MAX_REPO_BYTES` and `> MAX_REPO_FILES` are strict, so a repo
    // sitting exactly at 50 MB over 5,000 files is accepted.
    const files = Array.from({ length: 5_000 }, (_, i) =>
      fileEntry(`g${i}.py`, 10_000),
    );
    const snapshot = rawSnapshot(files); // 5,000 files, 50,000,000 bytes exactly
    const r = reading([]); // no draws ⇒ zero candidates, but no throw

    const result = selectCandidates(snapshot, r, { kind: "bare" });

    expect(result.candidates).toEqual([]);
  });
});
