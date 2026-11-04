// @necro/oracle — unit tests for the Moon detector (task 24.1).
//
// TEST-FIRST: these tests are written against the detectMoon API described in
// design.md ("detectMoon — XVIII The Moon (Complexity)") and requirements
// R14.1–R14.6 BEFORE the real implementation exists (task 24.2). moon.ts
// currently exports a throwing stub, so every behavioural test here is EXPECTED
// TO BE RED until 24.2 replaces the stub with the real algorithm.
//
// detectMoon is a pure, synchronous Detector. It counts every file's line count
// (> 1000 lines → a "large file"), computes each python file's maximum nesting
// depth from PRE-PARSED trees in opts.trees (it never calls parsePython and
// skips any python path listed in opts.parseErrors), and counts confusion
// markers (TODO/FIXME/HACK/XXX, case-insensitive; a line matching several
// markers is counted once) per file. These tests mirror what runReading
// (task 30) does for the detector: build a snapshot with
// buildSnapshotFromFileMap, then build the trees Map by calling parsePython on
// every python file. The tree-sitter WASM grammar is initialised once in
// vitest.setup.ts's beforeAll (task 10) — no network access (R3.1, R21.5,
// R21.6).
//
// Coverage map:
//   R14.1 count every file's line count (> 1000 lines → large file)
//   R14.2 compute max nesting depth per python file from opts.trees
//   R14.3 count confusion markers per file (multi-marker line counted once)
//   R14.4 >= 2 large files OR any nesting depth > 6 → severity 2 upright
//         (this precedence rule beats the reversed rule)
//   R14.5 exactly 1 large file OR >= 1 file with > 10 confusion markers →
//         severity 1 reversed
//   R14.6 evidence records path + exact line count / depth / marker count;
//         clean repo → null

import { describe, expect, it } from "vitest";

import { parsePython, type Tree } from "../parser/tree-sitter.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import { NecroError } from "../util/errors.js";
import type { CardDraw } from "../registry/schema.js";
import type { DetectorOpts } from "./types.js";

import { detectMoon } from "./moon.js";

// --- test fixtures -------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeef",
  defaultBranch: "main",
};

const NOW = "2025-01-01T00:00:00.000Z";

/**
 * Build the detector inputs the way runReading will: shape the snapshot, then
 * parse each python file into the opts.trees map (skipping oversize/absent
 * content). Any python file that fails to parse is recorded in
 * opts.parseErrors instead of opts.trees. `forceParseErrors` lets a test move
 * a given python path into parseErrors (and out of trees) deterministically,
 * since tree-sitter returns best-effort trees rather than throwing on garbage.
 */
function buildInputs(
  files: Record<string, string>,
  forceParseErrors: readonly string[] = [],
): { snapshot: RepoSnapshot; opts: DetectorOpts } {
  const snapshot = buildSnapshotFromFileMap(REF, files, { createdAt: NOW });

  const trees = new Map<string, Tree>();
  const parseErrors = new Map<string, NecroError>();
  const forced = new Set(forceParseErrors);

  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    const content = snapshot.contents.get(file.path);
    if (content === undefined) continue; // oversize / absent → no tree.
    if (forced.has(file.path)) {
      parseErrors.set(
        file.path,
        new NecroError("FILE_TOO_LARGE", "this scroll is too corrupt to read"),
      );
      continue;
    }
    try {
      trees.set(file.path, parsePython(content));
    } catch (err) {
      parseErrors.set(file.path, err as NecroError);
    }
  }

  const opts: DetectorOpts = { now: NOW, trees, parseErrors };
  return { snapshot, opts };
}

/** Run detectMoon over a path→content file map. */
function moonOf(
  files: Record<string, string>,
  forceParseErrors: readonly string[] = [],
): CardDraw | null {
  const { snapshot, opts } = buildInputs(files, forceParseErrors);
  return detectMoon(snapshot, opts);
}

/** Assert a draw is non-null and return it narrowed. */
function expectDraw(draw: CardDraw | null): CardDraw {
  expect(draw, "expected moon to be drawn").not.toBeNull();
  return draw as CardDraw;
}

/** Concatenated, lower-cased evidence text for substring assertions. */
function evidenceText(draw: CardDraw): string {
  return draw.evidence
    .map((e) => `${e.kind} ${e.path ?? ""} ${e.detail}`.toLowerCase())
    .join(" | ");
}

// A file of exactly `lines` physical lines. Simple, parse-clean python that is
// trivially flat (nesting depth is irrelevant for large-file assertions).
function pyOfLines(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(`x_${i} = ${i}`);
  return out.join("\n");
}

// A deeply nested python file whose maximum nesting depth is `depth` counting
// nodes (each `if` adds one level). `def f():` is the enclosing
// function_definition (counts as one level too), so to exceed the > 6 rule we
// build well past it. Each nested block guards the next.
function pyNested(ifDepth: number): string {
  const lines: string[] = ["def deeply_nested():"];
  let indent = "    ";
  for (let i = 0; i < ifDepth; i++) {
    lines.push(`${indent}if True:`);
    indent += "    ";
  }
  lines.push(`${indent}return 1`);
  return lines.join("\n");
}

// A python file with `markerLines` lines that each carry a confusion marker.
function pyWithMarkers(markerLines: number): string {
  const lines: string[] = ["x = 1"];
  for (let i = 0; i < markerLines; i++) {
    lines.push(`# TODO item number ${i}`);
  }
  lines.push("y = 2");
  return lines.join("\n");
}

// --- R14.4 >= 2 large files → severity 2 upright (precedence) ------------

describe("detectMoon: two files over 1000 lines draw severity 2 upright (R14.1, R14.4)", () => {
  it("draws severity 2 upright when two files each exceed 1000 lines", () => {
    const draw = expectDraw(
      moonOf({
        "big_a.py": pyOfLines(1500),
        "big_b.py": pyOfLines(1200),
      }),
    );

    expect(draw.card).toBe("moon");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });

  it("records the exact line count for each large file in evidence (R14.6)", () => {
    const draw = expectDraw(
      moonOf({
        "big_a.py": pyOfLines(1500),
        "big_b.py": pyOfLines(1200),
      }),
    );

    const text = evidenceText(draw);
    // Both offending paths and their exact line counts must appear.
    expect(text).toContain("big_a.py");
    expect(text).toContain("big_b.py");
    expect(text).toContain("1500");
    expect(text).toContain("1200");
  });

  it("counts large files of any language, not just python (R14.1)", () => {
    // Line-count large-file detection is language-agnostic (counts all lines).
    const draw = expectDraw(
      moonOf({
        "big.py": pyOfLines(1500),
        "data.txt": Array.from({ length: 1100 }, (_, i) => `line ${i}`).join(
          "\n",
        ),
      }),
    );

    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });
});

// --- R14.4 any nesting depth > 6 → severity 2 upright (precedence) -------

describe("detectMoon: nesting depth greater than 6 draws severity 2 upright (R14.2, R14.4)", () => {
  it("draws severity 2 upright for a python file nested deeper than 6 levels", () => {
    // A function wrapping 7 nested `if` blocks is comfortably past depth 6.
    const draw = expectDraw(moonOf({ "labyrinth.py": pyNested(7) }));

    expect(draw.card).toBe("moon");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });

  it("records the offending path and its nesting depth in evidence (R14.6)", () => {
    const draw = expectDraw(moonOf({ "labyrinth.py": pyNested(7) }));

    const text = evidenceText(draw);
    expect(text).toContain("labyrinth.py");
    // Evidence must speak of depth/nesting for the deeply nested file.
    expect(text).toMatch(/depth|nest/);
  });

  it("takes precedence over the reversed rule even with only one large file", () => {
    // Exactly one large file would normally be reversed (R14.5), but a file
    // nested past depth 6 forces severity 2 upright (R14.4 precedence).
    const draw = expectDraw(
      moonOf({
        "big.py": pyOfLines(1500),
        "labyrinth.py": pyNested(7),
      }),
    );

    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });

  it("does not count nesting depth for a python file in opts.parseErrors (R14.2)", () => {
    // The deeply nested file is forced into parseErrors, so its depth must not
    // be measured. With no large files and no markers either, the result is
    // null — the detector never reaches into parse-failed trees.
    const draw = moonOf({ "labyrinth.py": pyNested(7) }, ["labyrinth.py"]);
    expect(draw).toBeNull();
  });
});

// --- R14.5 exactly 1 large file → severity 1 reversed --------------------

describe("detectMoon: exactly one file over 1000 lines draws severity 1 reversed (R14.5)", () => {
  it("draws severity 1 reversed when a single file exceeds 1000 lines", () => {
    const draw = expectDraw(moonOf({ "big.py": pyOfLines(1500) }));

    expect(draw.card).toBe("moon");
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");
  });

  it("records the single large file's exact line count in evidence (R14.6)", () => {
    const draw = expectDraw(moonOf({ "big.py": pyOfLines(1500) }));

    const text = evidenceText(draw);
    expect(text).toContain("big.py");
    expect(text).toContain("1500");
  });

  it("treats exactly 1000 lines as NOT large (strictly greater than 1000)", () => {
    // 1000 lines is the boundary — the rule is > 1000, so 1000 does not qualify
    // and, with nothing else wrong, the result is null (R14.6).
    const draw = moonOf({ "edge.py": pyOfLines(1000) });
    expect(draw).toBeNull();
  });
});

// --- R14.5 > 10 confusion markers → severity 1 reversed ------------------

describe("detectMoon: more than 10 confusion markers draw severity 1 reversed (R14.3, R14.5)", () => {
  it("draws severity 1 reversed when a file has more than 10 marker lines", () => {
    const draw = expectDraw(moonOf({ "muddy.py": pyWithMarkers(11) }));

    expect(draw.card).toBe("moon");
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");
  });

  it("records the file path and exact marker count in evidence (R14.6)", () => {
    const draw = expectDraw(moonOf({ "muddy.py": pyWithMarkers(11) }));

    const text = evidenceText(draw);
    expect(text).toContain("muddy.py");
    expect(text).toContain("11");
  });

  it("recognises FIXME, HACK and XXX markers case-insensitively (R14.3)", () => {
    // Mix of marker spellings and casings, 11 marker lines total.
    const lines = [
      "x = 1",
      "# fixme lowercase",
      "# FIXME upper",
      "# Hack mixed",
      "# HACK upper",
      "# xxx lower",
      "# XXX upper",
      "value = 2  # todo trailing",
      "# ToDo mixed",
      "# FixMe mixed",
      "# hAcK mixed",
      "# Xxx mixed",
    ];
    expect(moonOf({ "mixed.py": lines.join("\n") })).not.toBeNull();
    const draw = expectDraw(moonOf({ "mixed.py": lines.join("\n") }));
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");
  });

  it("treats exactly 10 marker lines as NOT enough (strictly greater than 10)", () => {
    // 10 marker lines is the boundary — the rule is > 10, so 10 does not
    // qualify and, with nothing else wrong, the result is null.
    const draw = moonOf({ "muddy.py": pyWithMarkers(10) });
    expect(draw).toBeNull();
  });
});

// --- R14.3 a line matching multiple markers is counted once --------------

describe("detectMoon: a line matching multiple markers is counted once (R14.3)", () => {
  it("counts a line carrying both TODO and FIXME as a single marker line", () => {
    // 11 lines each carrying BOTH TODO and FIXME. If multi-marker lines were
    // double-counted the tally would be 22 (and the card would draw), but the
    // correct per-line count is 11 marker lines... which is > 10, so it DOES
    // draw. To isolate the "counted once" rule we instead build 10 lines that
    // each carry two markers: a naive double-count sees 20 (> 10 → draws) but
    // the correct count is 10 (NOT > 10 → null).
    const lines = ["x = 1"];
    for (let i = 0; i < 10; i++) {
      lines.push(`# TODO and FIXME together on line ${i}`);
    }
    lines.push("y = 2");

    // Correct behaviour: 10 marker lines, which is NOT > 10 → null.
    const draw = moonOf({ "doubled.py": lines.join("\n") });
    expect(
      draw,
      "10 multi-marker lines must count as 10, not 20 — so the card is null",
    ).toBeNull();
  });

  it("still counts 11 multi-marker lines as 11 (over the threshold → reversed)", () => {
    // Sanity companion: 11 lines each with two markers must count as 11 marker
    // lines (> 10 → drawn reversed), proving the per-line dedup does not also
    // suppress legitimately-over-threshold files.
    const lines = ["x = 1"];
    for (let i = 0; i < 11; i++) {
      lines.push(`# TODO plus FIXME on line ${i}`);
    }

    const draw = expectDraw(moonOf({ "doubled.py": lines.join("\n") }));
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");

    // The recorded count must be the de-duplicated 11, not 22.
    const text = evidenceText(draw);
    expect(text).toContain("11");
    expect(text).not.toContain("22");
  });
});

// --- R14.6 clean repository → null ---------------------------------------

describe("detectMoon: a clean, small repository returns null (R14.6)", () => {
  it("returns null for small, shallow, marker-free files", () => {
    const draw = moonOf({
      "app.py": "def main():\n    return 1\n",
      "lib.py": pyNested(2), // shallow nesting, well under the depth rule
      "README.md": "# Graveyard\n\nA tidy little repository.\n",
    });

    expect(draw).toBeNull();
  });

  it("returns null for an entirely empty repository", () => {
    const draw = moonOf({});
    expect(draw).toBeNull();
  });
});
