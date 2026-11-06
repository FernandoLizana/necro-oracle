// @necro/coven — property tests for unified-patch generation (task 9.2).
//
// Property 9: Patch round-trips and excludes unvalidated files.
//   - the Patch contains exactly the validated AND changed files (R7.7: a file
//     with `validated: false` is excluded; R7.2/unchanged: `before === after`
//     contributes nothing);
//   - applying the Patch to each file's `Before_Content` yields its
//     `After_Content` byte-for-byte (R7.5);
//   - zero validated+changed files ⇒ an empty Patch (R7.4).
//
// No network / LLM / sandbox: `buildPatch` is a pure function and the patch is
// re-applied by a small PURE in-test unified-diff applier (below) rather than
// by shelling out to `git` or `patch`. Per the testing steering, unit/property
// tests touch no subprocess, so a pure applier is the correct way to prove the
// round-trip; it is deliberately independent of `diff.ts`'s internals (it reads
// only the emitted unified-diff text) so a regression in the generator is
// caught rather than mirrored.
//
// fast-check runs 1000 times over `arbFileResultSet`; the seed is printed on
// failure (fast-check prints the failing seed by default).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FileResult } from "./index.js";
import { buildPatch } from "./diff.js";
import { arbFileResult, arbFileResultSet } from "../test/arbitraries.js";

// ---------------------------------------------------------------------------
// A pure, self-contained unified-diff applier.
//
// It parses the multi-file unified diff that `buildPatch` emits and applies the
// hunks for a single target path to that file's `before`, returning the exact
// reconstructed bytes. It understands only the subset `buildPatch` produces:
//   - file sections introduced by "--- a/<path>" / "+++ b/<path>";
//   - a single "@@ -s,n +s,m @@" hunk header per file;
//   - " " context, "-" remove, "+" add rows;
//   - the "\ No newline at end of file" marker, which suppresses the trailing
//     newline for the side it follows.
//
// Reconstruction is done by walking the hunk rows and rebuilding the AFTER
// side: context and add rows contribute a line to the output; remove rows do
// not. A no-newline marker after the last emitted output row means the output
// has no trailing newline; otherwise every output line (including the last) is
// newline-terminated. This mirrors how a real `patch`/`git apply` would
// reconstruct the target, without any process.
// ---------------------------------------------------------------------------

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

interface ParsedFile {
  readonly path: string;
  /** Rows of the single hunk, in order (header excluded). */
  readonly rows: readonly string[];
}

/** Split the whole patch into per-file sections keyed by the "+++ b/<path>". */
function parsePatch(patch: string): Map<string, ParsedFile> {
  const files = new Map<string, ParsedFile>();
  if (patch === "") return files;

  // The patch is "\n"-joined sections with a single trailing "\n"; splitting on
  // "\n" yields every row. A section starts at "--- a/…".
  const allRows = patch.split("\n");
  // `buildPatch` terminates the file with a trailing "\n", so the final split
  // element is an empty string; drop it so it is not mistaken for a hunk row.
  if (allRows.length > 0 && allRows[allRows.length - 1] === "") allRows.pop();

  let i = 0;
  while (i < allRows.length) {
    const row = allRows[i] ?? "";
    if (!row.startsWith("--- a/")) {
      i += 1;
      continue;
    }
    // "--- a/<path>" then "+++ b/<path>" then "@@ … @@" then rows until the
    // next "--- a/" (or end).
    const plusRow = allRows[i + 1] ?? "";
    expect(plusRow.startsWith("+++ b/")).toBe(true);
    const path = plusRow.slice("+++ b/".length);
    const headerRow = allRows[i + 2] ?? "";
    expect(headerRow.startsWith("@@ ")).toBe(true);

    const rows: string[] = [];
    let j = i + 3;
    while (j < allRows.length && !(allRows[j] ?? "").startsWith("--- a/")) {
      rows.push(allRows[j] ?? "");
      j += 1;
    }
    files.set(path, { path, rows });
    i = j;
  }

  return files;
}

/** Reconstruct the AFTER content for one parsed file section. */
function applyFile(parsed: ParsedFile): string {
  const outputLines: string[] = [];
  let trailingNewline = true;

  for (let k = 0; k < parsed.rows.length; k += 1) {
    const row = parsed.rows[k] ?? "";
    if (row === NO_NEWLINE_MARKER) {
      // The marker refers to the immediately preceding emitted side. Because we
      // only ever reconstruct the AFTER side, a marker that follows a context
      // or add row means the AFTER side has no trailing newline. A marker that
      // follows a remove row refers to the BEFORE side and is irrelevant here.
      const prev = parsed.rows[k - 1] ?? "";
      if (prev.startsWith(" ") || prev.startsWith("+")) {
        trailingNewline = false;
      }
      continue;
    }
    const marker = row.charAt(0);
    const text = row.slice(1);
    if (marker === " " || marker === "+") {
      outputLines.push(text);
    }
    // "-" (remove) rows contribute nothing to the AFTER side.
  }

  if (outputLines.length === 0) return "";
  const joined = outputLines.join("\n");
  return trailingNewline ? `${joined}\n` : joined;
}

/** Apply the whole patch to a single file's `before`, returning the rebuilt bytes. */
function applyPatchToFile(patch: string, path: string, before: string): string {
  const files = parsePatch(patch);
  const section = files.get(path);
  // A file not present in the patch is unchanged: its reconstruction is its
  // `before` verbatim.
  if (section === undefined) return before;
  return applyFile(section);
}

// The validated-AND-changed subset: exactly the files P9 says the patch covers.
function patchMembers(files: readonly FileResult[]): readonly FileResult[] {
  return files.filter((f) => f.validated && f.before !== f.after);
}

describe("P9 (R7.4, R7.5, R7.7): patch round-trips and excludes unvalidated files", () => {
  it("the Patch contains exactly the validated+changed files (R7.7)", () => {
    fc.assert(
      fc.property(arbFileResultSet, (files) => {
        const patch = buildPatch(files);
        const present = parsePatch(patch);
        const expected = new Set(patchMembers(files).map((f) => f.path));

        // Same set of paths — no missing member, no extra, no duplicate.
        expect(new Set(present.keys())).toEqual(expected);
        expect(present.size).toBe(expected.size);

        // Spot the exclusions explicitly: a not-validated file never appears,
        // and an unchanged (before === after) file never appears.
        for (const f of files) {
          if (!f.validated || f.before === f.after) {
            expect(present.has(f.path)).toBe(false);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("applying the Patch to each Before_Content yields the After_Content byte-for-byte (R7.5)", () => {
    fc.assert(
      fc.property(arbFileResultSet, (files) => {
        const patch = buildPatch(files);
        for (const f of patchMembers(files)) {
          const rebuilt = applyPatchToFile(patch, f.path, f.before);
          expect(rebuilt).toBe(f.after);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("zero validated+changed files ⇒ an empty Patch (R7.4)", () => {
    // A set with NO validated+changed member must produce exactly "". Restrict
    // the generator to the complement so the implication is exercised directly
    // rather than relying on it arising by chance.
    const arbNoMember = arbFileResultSet.map((files) =>
      files.map((f) =>
        // Force every file to be excluded: either not validated, or unchanged.
        f.validated ? { ...f, after: f.before } : f,
      ),
    );
    fc.assert(
      fc.property(arbNoMember, (files) => {
        expect(patchMembers(files)).toHaveLength(0);
        expect(buildPatch(files)).toBe("");
      }),
      { numRuns: 1000 },
    );
  });

  it("a single validated+changed file round-trips in isolation (R7.5)", () => {
    // A tighter per-file property: for any single validated, changed file, the
    // emitted patch reproduces `after` from `before`. This narrows failures to
    // one file's content without the surrounding set.
    const arbChangedValidated = arbFileResult
      .filter((f) => f.before !== f.after)
      .map((f) => ({ ...f, validated: true }));
    fc.assert(
      fc.property(arbChangedValidated, (file) => {
        const patch = buildPatch([file]);
        expect(patch).not.toBe("");
        expect(applyPatchToFile(patch, file.path, file.before)).toBe(file.after);
      }),
      { numRuns: 1000 },
    );
  });
});
