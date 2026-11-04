// src/snapshot/builder-file-map.pbt.test.ts
//
// Property tests (task 8.3) for `buildSnapshotFromFileMap` — the browser-safe
// snapshot builder.
//
// Property 12: Snapshot file cap enforced.
//   When more than 5000 files survive the size filter, the builder keeps at
//   most 5000 (the first 5000 in lexicographic path order) and sets
//   `truncated === true`. More generally, `truncated` is exactly
//   `(keptCount > 5000)` where `keptCount` is the number of files that survive
//   the 1 MB size filter.
//
// Property 13: Oversize files skipped.
//   Every entry whose UTF-8 byte length exceeds 1 MB is absent from `contents`
//   (and `files`) and present in `oversizeFiles` with the exact shape
//   { kind: "file_skipped", path, detail: "too large to divine", source: "static" }.
//   Small files survive into `contents`.
//
// These are pure, synchronous, no-network properties (R21.5, R21.6). fast-check
// prints the shrunk counterexample and seed on failure by default.
//
// Validates: Requirements R2.6, R2.7 / Properties: P12, P13

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  arbLargeFileMap,
  arbRepoRef,
  type RepoRefShape,
} from "../../test/arbitraries.js";
import { buildSnapshotFromFileMap } from "./builder-file-map.js";
import type { RepoRef } from "./types.js";

/** Fixed, deterministic createdAt — the builder never reads the clock. */
const CREATED_AT = "2026-11-03T12:00:00.000Z";

/** Per-file size limit in bytes (R2.6). Exactly this size is kept. */
const ONE_MB = 1_048_576;

/** Maximum number of files retained after the size filter (R2.7). */
const MAX_FILES = 5000;

const UTF8_ENCODER = new TextEncoder();
function byteLength(s: string): number {
  return UTF8_ENCODER.encode(s).length;
}

/** The local arbitrary RepoRefShape is structurally the exported RepoRef. */
function asRepoRef(ref: RepoRefShape): RepoRef {
  return ref;
}

describe("P12 (R2.7): snapshot file cap enforced", () => {
  // Property 12 — Validates: Requirements R2.7 / Properties: P12
  //
  // For large file maps (> 5000 entries, all small), the builder must keep
  // exactly 5000 files and flag truncation. Generation of > 5000-entry maps is
  // moderately expensive, so numRuns is lowered to 50 (>= 50 per task).
  it("> 5000 small files ⇒ truncated === true and files.length === 5000", () => {
    fc.assert(
      fc.property(arbLargeFileMap, arbRepoRef, (files, ref) => {
        const snapshot = buildSnapshotFromFileMap(asRepoRef(ref), files, {
          createdAt: CREATED_AT,
        });

        expect(snapshot.truncated).toBe(true);
        expect(snapshot.files.length).toBeLessThanOrEqual(MAX_FILES);
        expect(snapshot.files).toHaveLength(MAX_FILES);
        expect(snapshot.contents.size).toBe(MAX_FILES);

        // The retained set is the first MAX_FILES paths in lexicographic order.
        const expected = Object.keys(files).sort().slice(0, MAX_FILES);
        expect(snapshot.files.map((f) => f.path)).toEqual(expected);
      }),
      { numRuns: 50 },
    );
  });

  // For file maps of varying size (all small so none are filtered), truncated
  // must equal (keptCount > MAX_FILES). We generate counts straddling the cap.
  it("truncated === (keptCount > 5000) for varying file-map sizes", () => {
    const arbSizedFileMap = fc
      .integer({ min: 0, max: MAX_FILES + 50 })
      .chain((count) =>
        fc
          .array(fc.string({ maxLength: 8 }), {
            minLength: count,
            maxLength: count,
          })
          .map((contents) => {
            const map: Record<string, string> = {};
            for (let i = 0; i < contents.length; i++) {
              map[`src/file_${String(i).padStart(5, "0")}.py`] =
                contents[i] ?? "";
            }
            return map;
          }),
      );

    fc.assert(
      fc.property(arbSizedFileMap, arbRepoRef, (files, ref) => {
        const keptCount = Object.keys(files).length; // all small → all kept
        const snapshot = buildSnapshotFromFileMap(asRepoRef(ref), files, {
          createdAt: CREATED_AT,
        });

        expect(snapshot.truncated).toBe(keptCount > MAX_FILES);
        expect(snapshot.files.length).toBe(Math.min(keptCount, MAX_FILES));
      }),
      { numRuns: 50 },
    );
  });
});

describe("P13 (R2.6): oversize files skipped", () => {
  // Property 13 — Validates: Requirements R2.6 / Properties: P13
  //
  // A file map mixing small files with some entries strictly over 1 MB. The
  // oversize entries must be absent from `contents`/`files` and present in
  // `oversizeFiles` with the exact evidence shape; the small files survive.

  /** A small (<= 1 MB) file: a short path + short content. */
  const arbSmallFile: fc.Arbitrary<[string, string]> = fc.tuple(
    fc
      .array(
        fc
          .string({ minLength: 1, maxLength: 8 })
          .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
          .filter((s) => s.length > 0 && s !== "." && s !== ".."),
        { minLength: 1, maxLength: 3 },
      )
      .map((segs) => segs.join("/") + ".py"),
    fc.string({ maxLength: 64 }),
  );

  /**
   * An oversize file: a distinct path + content strictly over 1 MB. The content
   * generator produces a string of ONE_MB + 1 .. ONE_MB + 16 ASCII bytes so the
   * UTF-8 byte length is guaranteed to exceed the limit while keeping memory
   * bounded.
   */
  const arbOversizeFile: fc.Arbitrary<[string, string]> = fc.tuple(
    fc
      .array(
        fc
          .string({ minLength: 1, maxLength: 8 })
          .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
          .filter((s) => s.length > 0 && s !== "." && s !== ".."),
        { minLength: 1, maxLength: 3 },
      )
      .map((segs) => segs.join("/") + ".big.py"),
    fc
      .integer({ min: ONE_MB + 1, max: ONE_MB + 16 })
      .map((n) => "a".repeat(n)),
  );

  it("oversize entries absent from contents, present in oversizeFiles; small files kept", () => {
    const arbMixed = fc
      .tuple(
        fc.uniqueArray(arbSmallFile, {
          minLength: 0,
          maxLength: 8,
          selector: ([p]) => p,
        }),
        fc.uniqueArray(arbOversizeFile, {
          minLength: 1,
          maxLength: 3,
          selector: ([p]) => p,
        }),
      )
      // Combine into a single map; ".big.py" suffix keeps the two sets disjoint.
      .map(([small, big]) => {
        const files: Record<string, string> = {};
        for (const [p, c] of small) files[p] = c;
        for (const [p, c] of big) files[p] = c;
        return {
          files,
          smallPaths: small
            .map(([p]) => p)
            .filter((p) => !files[p]!.length || byteLength(files[p]!) <= ONE_MB),
          oversizePaths: big.map(([p]) => p),
        };
      });

    fc.assert(
      fc.property(arbMixed, arbRepoRef, ({ files, oversizePaths }, ref) => {
        const snapshot = buildSnapshotFromFileMap(asRepoRef(ref), files, {
          createdAt: CREATED_AT,
        });

        for (const path of oversizePaths) {
          // Absent from contents and the file entries.
          expect(snapshot.contents.has(path)).toBe(false);
          expect(snapshot.files.some((f) => f.path === path)).toBe(false);
          // Present in oversizeFiles with the exact evidence shape (R2.6).
          expect(snapshot.oversizeFiles).toContainEqual({
            kind: "file_skipped",
            path,
            detail: "too large to divine",
            source: "static",
          });
        }

        // Every small file (<= 1 MB) survives into contents and files.
        for (const path of Object.keys(files)) {
          if (oversizePaths.includes(path)) continue;
          if (byteLength(files[path]!) > ONE_MB) continue;
          expect(snapshot.contents.get(path)).toBe(files[path]);
          expect(snapshot.files.some((f) => f.path === path)).toBe(true);
        }

        // oversizeFiles contains exactly the oversize entries (no extras).
        expect(snapshot.oversizeFiles).toHaveLength(oversizePaths.length);
      }),
      { numRuns: 200 },
    );
  });

  // --- Regression examples (permanent counterexamples) -------------------
  //
  // When a counterexample is found by a property above, record it here as a
  // named example test so it is checked forever after. None found yet.
});
