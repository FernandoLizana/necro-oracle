// packages/coven/src/select.pbt.test.ts
//
// Property 1 (design: "Candidate_File selection rule") — candidate selection
// matches the reading evidence. The Candidate_Files `selectCandidates` returns
// are exactly the distinct Python-2-classified `.py` paths the target scopes
// to, with no path appearing twice:
//
//   - bare target ⇒ every distinct py2 `.py` path (R1.4 / R2.1)
//   - card target ⇒ only the py2 `.py` paths that card's draws flagged
//     (R1.2 / R2.2), and an unmatched card id ⇒ zero candidates
//   - file target ⇒ the single exact py2 `.py` path, or none (R1.3)
//
// The expected set is derived by the generator *by construction*
// (`arbSelectionCase`), never by re-running the production rule, so a
// regression in `select.ts` is caught rather than mirrored. Noise is woven in
// (non-py2 static evidence on `.py` files, non-static evidence, and py2-kind
// static evidence on non-`.py` paths) so the property also pins the classifier
// predicate, not just the shape of the answer.
//
// fast-check runs 1000 cases (testing steering: 1000 for selection properties);
// the seed is printed on failure. No network / LLM / sandbox is touched.
//
// Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { selectCandidates } from "./select.js";
import {
  arbCardTarget,
  arbSelectionCase,
  type SelectionCase,
} from "../test/arbitraries.js";

/** Selection PBTs run 1000 cases (testing steering). */
const NUM_RUNS = 1000;

/** Sorted, de-duplicated selected paths — the shape every assertion compares. */
function selectedPaths(
  snapshot: SelectionCase["snapshot"],
  reading: SelectionCase["reading"],
  target: Parameters<typeof selectCandidates>[2],
): string[] {
  const { candidates } = selectCandidates(snapshot, reading, target);
  return candidates.map((c) => c.path);
}

describe("P1 (R1.2, R1.3, R1.4, R2.1, R2.2): candidate selection matches the reading evidence", () => {
  it("bare target selects exactly the distinct py2 .py paths (no duplicates)", () => {
    fc.assert(
      fc.property(arbSelectionCase, (c) => {
        const paths = selectedPaths(c.snapshot, c.reading, { kind: "bare" });

        // No path appears twice.
        expect(new Set(paths).size).toBe(paths.length);
        // The selected set equals the known distinct py2 `.py` paths.
        expect([...paths].sort()).toEqual([...c.py2Paths].sort());
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  });

  it("card target selects exactly that card's py2 .py paths (no duplicates)", () => {
    fc.assert(
      fc.property(arbSelectionCase, arbCardTarget, (c, target) => {
        // `target` is a card target; its card id may or may not match a draw.
        const card = (target as { kind: "card"; card: string }).card;
        const paths = selectedPaths(c.snapshot, c.reading, target);

        const expected = c.py2PathsByCard.get(card) ?? [];

        expect(new Set(paths).size).toBe(paths.length);
        expect([...paths].sort()).toEqual([...expected].sort());
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  });

  it("file target selects the single exact py2 .py path, else none", () => {
    fc.assert(
      fc.property(arbSelectionCase, fc.nat(), (c, pick) => {
        // Pick a target path: usually a real py2 path (exact match ⇒ selected),
        // sometimes a path that is not py2-classified (⇒ zero candidates).
        const py2 = c.py2Paths;
        const candidatesForPick =
          py2.length > 0
            ? [...py2, `${py2[0] ?? "x"}.not-a-candidate`]
            : ["definitely/not/here.py"];
        const path = candidatesForPick[pick % candidatesForPick.length]!;

        const paths = selectedPaths(c.snapshot, c.reading, {
          kind: "file",
          path,
        });

        const expected = py2.includes(path) ? [path] : [];

        expect(new Set(paths).size).toBe(paths.length);
        expect(paths).toEqual(expected);
      }),
      { numRuns: NUM_RUNS, verbose: true },
    );
  });
});
