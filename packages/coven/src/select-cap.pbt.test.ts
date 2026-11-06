// packages/coven/src/select-cap.pbt.test.ts
//
// Property 2 (design: "Candidate_File selection rule") — selection ordering and
// the per-run cap. For a bare target over a reading whose py2-classified `.py`
// files number `n`, `selectCandidates`:
//
//   - processes the ascending-by-path prefix of length min(n, 50) (R1.5 / R2.6)
//   - reports a deferred count of max(0, n - 50) via a single skip-note (R2.6)
//   - excludes any file over the 1 MB per-file limit, before the cap, with a
//     skip-note that names the skipped file (R2.5)
//
// `n` here is the count of *eligible* (under-limit) py2 files: the size guard
// runs first, so an oversize py2 file never counts toward the cap. The expected
// prefix, deferred count, and oversize set are all derived by the generator
// (`arbSelectionCapCase`) *by construction*, never by re-running the production
// rule, so a regression in `select.ts` is caught rather than mirrored.
//
// fast-check runs 1000 cases (testing steering: 1000 for selection
// properties); the seed is printed on failure. No network / LLM / sandbox.
//
// Validates: Requirements 1.5, 2.5, 2.6

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Reading, RepoSnapshot } from "@necro/oracle";

import { MAX_CANDIDATES, selectCandidates } from "./select.js";
import {
  arbSelectionCapCase,
  type SelectionCapCase,
} from "../test/arbitraries.js";

/** Selection PBTs run 1000 cases (testing steering). */
const NUM_RUNS = 1000;

/** The sized-but-pre-cap eligible count a case produces. */
function eligibleCount(c: SelectionCapCase): number {
  return c.eligiblePaths.length;
}

describe("P2 (R1.5, R2.5, R2.6): selection ordering and the per-run cap", () => {
  it("processes the ascending-by-path prefix of length min(n, 50)", () => {
    fc.assert(
      fc.property(arbSelectionCapCase, (c) => {
        const { candidates } = selectCandidates(c.snapshot, c.reading, {
          kind: "bare",
        });
        const paths = candidates.map((cf) => cf.path);

        const n = eligibleCount(c);
        const expectedLen = Math.min(n, MAX_CANDIDATES);

        // Length is exactly min(n, 50).
        expect(paths.length).toBe(expectedLen);
        // The kept files are the ascending-by-path prefix of the eligible set.
        expect(paths).toEqual(c.expectedCandidates);
        // That prefix is itself ascending and duplicate-free.
        expect([...paths]).toEqual([...paths].sort());
        expect(new Set(paths).size).toBe(paths.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reports a deferred count of max(0, n - 50) via a skip-note", () => {
    fc.assert(
      fc.property(arbSelectionCapCase, (c) => {
        const { skipNotes } = selectCandidates(c.snapshot, c.reading, {
          kind: "bare",
        });

        const expectedDeferred = c.expectedDeferred;

        // A deferred-count skip-note exists iff something was deferred.
        const deferralNotes = skipNotes.filter((note) =>
          /deferred to a/.test(note),
        );

        if (expectedDeferred > 0) {
          expect(deferralNotes).toHaveLength(1);
          const note = deferralNotes[0]!;
          // The note reports the exact deferred count and the processed cap.
          expect(note).toContain(`${expectedDeferred} deferred`);
          expect(note).toContain(`Processing ${MAX_CANDIDATES} files`);
        } else {
          expect(deferralNotes).toHaveLength(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("excludes each over-1-MB file with a naming skip-note", () => {
    fc.assert(
      fc.property(arbSelectionCapCase, (c) => {
        const { candidates, skipNotes } = selectCandidates(
          c.snapshot,
          c.reading,
          { kind: "bare" },
        );
        const paths = new Set(candidates.map((cf) => cf.path));

        for (const oversize of c.oversizePaths) {
          // The oversize file is never a candidate.
          expect(paths.has(oversize)).toBe(false);
          // A size skip-note names the excluded file and the 1 MB limit.
          // Match the exact `Skipped <path>:` token (not a bare substring):
          // one oversize path can be a substring of another (e.g. "__.py" ⊂
          // "1__.py"), so a naive `includes(path)` would over-match.
          const named = skipNotes.filter(
            (note) =>
              note.includes(`Skipped ${oversize}:`) &&
              note.includes("exceeds the 1 MB file limit"),
          );
          expect(named).toHaveLength(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Regression (seed 2137281368): two oversize paths where one is a substring
  // of the other ("__.py" is a suffix of "1__.py"). A naive `note.includes(path)`
  // match over-counted the skip-notes for the shorter path; the exact
  // `Skipped <path>:` token keeps each file's skip-note uniquely attributed.
  it("attributes a distinct size skip-note to each of two nested oversize paths", () => {
    const ref = {
      owner: "o",
      name: "r",
      sha: "0".repeat(40),
      defaultBranch: "main",
    };
    const oversize = ["1__.py", "__.py"] as const;
    const eligible = ["a.py", "b.py"] as const;

    const snapshot: RepoSnapshot = {
      ref,
      files: [
        { path: "a.py", size: 10, lang: "python", sha: "00000000" },
        { path: "b.py", size: 10, lang: "python", sha: "00000000" },
        { path: "1__.py", size: 1_000_001, lang: "python", sha: "00000000" },
        { path: "__.py", size: 1_000_001, lang: "python", sha: "00000000" },
      ],
      meta: {
        pushedAt: null,
        isArchived: false,
        openIssueCount: 0,
        openPRCount: 0,
        oldestOpenPRAgeDays: null,
        latestReleaseAt: null,
        licenseKey: null,
      },
      manifests: [],
      contents: new Map([
        ["a.py", "# a\n"],
        ["b.py", "# b\n"],
        ["1__.py", "# oversize\n"],
        ["__.py", "# oversize\n"],
      ]),
      oversizeFiles: [],
      truncated: false,
      createdAt: "2020-01-01T00:00:00.000Z",
    };

    const reading: Reading = {
      id: crypto.randomUUID(),
      repo: ref,
      draws: [
        {
          card: "judgement",
          severity: 1,
          orientation: "reversed",
          evidence: [...eligible, ...oversize].map((path) => ({
            kind: "print_statement" as const,
            path,
            line: 1,
            detail: "legacy print statement",
            source: "static" as const,
          })),
          summary: "",
          grimoires: [],
        },
      ],
      spread: [],
      vitality: 100,
      createdAt: "2020-01-01T00:00:00.000Z",
      engineVersion: "0.0.0",
      errors: [],
    };

    const { candidates, skipNotes } = selectCandidates(snapshot, reading, {
      kind: "bare",
    });
    const paths = candidates.map((c) => c.path);

    // Only the two eligible files survive; both oversize files are excluded.
    expect(paths).toEqual(["a.py", "b.py"]);
    for (const p of oversize) {
      const named = skipNotes.filter(
        (note) =>
          note.includes(`Skipped ${p}:`) &&
          note.includes("exceeds the 1 MB file limit"),
      );
      expect(named).toHaveLength(1);
    }
  });
});
