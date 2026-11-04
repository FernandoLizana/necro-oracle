// @necro/oracle — unit tests for the Hermit detector (task 20.1).
//
// TEST-FIRST: these tests are written against the detectHermit API described in
// design.md ("detectHermit — IX The Hermit (Missing Documentation)") and
// requirements R10.1–R10.5 BEFORE the real implementation exists (task 20.2).
// hermit.ts currently exports a throwing stub, so every behavioural test here
// is EXPECTED TO BE RED until 20.2 replaces the stub with the real algorithm.
//
// detectHermit is a pure, synchronous Detector. It reads README files from
// snapshot.contents and computes docstring coverage from PRE-PARSED trees in
// opts.trees (it never calls parsePython itself), skipping any python path
// listed in opts.parseErrors and recording a parse-error evidence item for it.
// These tests mirror what runReading (task 30) does for the detector: build a
// snapshot with buildSnapshotFromFileMap, then build the trees Map by calling
// parsePython on every python file. The tree-sitter WASM grammar is initialised
// once in vitest.setup.ts's beforeAll (task 10) — no network access (R3.1,
// R21.5, R21.6).
//
// Coverage map:
//   R10.1 root README matched case-insensitively (no "/" in path), first
//         lexicographic match used
//   R10.2 no root README → severity 2 upright
//   R10.3 README < 200 bytes OR missing every keyword → severity 1 reversed,
//         with evidence indicating which sub-condition triggered
//   R10.4 docstring coverage < 0.25 with >= 4 public symbols → coverage
//         evidence item (regardless of orientation); unparseable py file →
//         parse-error evidence item + excluded from coverage denominator
//   R10.5 healthy README + adequate coverage (or < 4 public symbols) → null

import { describe, expect, it } from "vitest";

import { parsePython, type Tree } from "../parser/tree-sitter.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import { NecroError } from "../util/errors.js";
import type { CardDraw } from "../registry/schema.js";
import type { DetectorOpts } from "./types.js";

import { detectHermit } from "./hermit.js";

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

/** Run detectHermit over a path→content file map. */
function hermitOf(
  files: Record<string, string>,
  forceParseErrors: readonly string[] = [],
): CardDraw | null {
  const { snapshot, opts } = buildInputs(files, forceParseErrors);
  return detectHermit(snapshot, opts);
}

/** Assert a draw is non-null and return it narrowed. */
function expectDraw(draw: CardDraw | null): CardDraw {
  expect(draw, "expected hermit to be drawn").not.toBeNull();
  return draw as CardDraw;
}

// A README that comfortably clears both the 200-byte and keyword thresholds.
const HEALTHY_README = [
  "# Graveyard",
  "",
  "A small but well-tended project kept alive against all odds.",
  "",
  "## Usage",
  "",
  "Import the module and call its functions. Everything you need to get",
  "productive lives in this document, including worked examples and the",
  "full public surface of the library so nobody has to guess.",
  "",
  "## More",
  "",
  "Padding so the byte length sits comfortably above two hundred bytes and",
  "the keyword check has real prose to chew on before it makes a decision.",
  "",
].join("\n");

/**
 * A python file with public top-level functions/classes, `documented` of them
 * carrying a docstring as the first statement. Used to tune docstring coverage.
 */
function pyWithSymbols(total: number, documented: number): string {
  const lines: string[] = [];
  for (let i = 0; i < total; i++) {
    lines.push(`def public_fn_${i}(x):`);
    if (i < documented) {
      lines.push(`    """Docstring for public_fn_${i}."""`);
    }
    lines.push("    return x");
    lines.push("");
  }
  return lines.join("\n");
}

// --- R10.2 no root README → severity 2 upright --------------------------

describe("detectHermit: no root README draws severity 2 upright (R10.2)", () => {
  it("draws severity 2 upright when the repository has no README at all", () => {
    const draw = expectDraw(
      hermitOf({ "app.py": "x = 1\n", "src/lib.py": "y = 2\n" }),
    );

    expect(draw.card).toBe("hermit");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
    expect(draw.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores a README that lives in a subdirectory (not at the root)", () => {
    // A README nested under docs/ is NOT a root README (R10.1: no "/" in path),
    // so the card is still drawn severity 2 upright.
    const draw = expectDraw(
      hermitOf({
        "docs/README.md": HEALTHY_README,
        "app.py": "x = 1\n",
      }),
    );

    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });
});

// --- R10.1 root README matched case-insensitively -----------------------

describe("detectHermit: root README is matched case-insensitively (R10.1)", () => {
  it("recognises a healthy README spelled with unconventional casing", () => {
    // "ReAdMe.MD" at the root must be recognised as the README (case-insensitive).
    const draw = hermitOf({
      "ReAdMe.MD": HEALTHY_README,
      "app.py": 'def f():\n    """doc"""\n    return 1\n',
    });

    // Healthy README + only one public symbol (< 4) → null (R10.5).
    expect(draw).toBeNull();
  });

  it("recognises a bare README with no extension at the root", () => {
    const draw = hermitOf({
      README: HEALTHY_README,
      "app.py": 'def f():\n    """doc"""\n    return 1\n',
    });
    expect(draw).toBeNull();
  });
});

// --- R10.3 short README → severity 1 reversed, sub-condition evidence ----

describe("detectHermit: short README is reversed with sub-condition evidence (R10.3)", () => {
  it("draws severity 1 reversed when the README is under 200 bytes", () => {
    // A tiny README that nonetheless contains a keyword ("usage"), so only the
    // byte-length sub-condition can be responsible for the draw.
    const tiny = "# Tiny\n\nusage: run it.\n";
    expect(Buffer.byteLength(tiny, "utf8")).toBeLessThan(200);

    const draw = expectDraw(hermitOf({ "README.md": tiny, "app.py": "x = 1\n" }));

    expect(draw.card).toBe("hermit");
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");

    // Evidence must indicate the byte-length / size sub-condition (R10.3).
    const detail = draw.evidence.map((e) => e.detail.toLowerCase()).join(" | ");
    expect(detail).toMatch(/200|byte|short|small/);
  });
});

// --- R10.3 missing keywords → severity 1 reversed -----------------------

describe("detectHermit: keyword-less README is reversed with sub-condition evidence (R10.3)", () => {
  it("draws severity 1 reversed when a long README lacks every keyword", () => {
    // Well over 200 bytes but contains none of install/usage/getting started/
    // quickstart, so only the keyword sub-condition can trigger the draw.
    const noKeywords = [
      "# Graveyard",
      "",
      "This project tells a long and winding story about tombstones, moonlight,",
      "and the quiet patience of code that waits to be read. It rambles for a",
      "while to be sure it clears the two hundred byte threshold comfortably,",
      "yet it never once explains how to set anything up or run a single thing.",
      "",
    ].join("\n");
    expect(Buffer.byteLength(noKeywords, "utf8")).toBeGreaterThanOrEqual(200);
    expect(noKeywords.toLowerCase()).not.toMatch(
      /install|usage|getting started|quickstart/,
    );

    const draw = expectDraw(
      hermitOf({ "README.md": noKeywords, "app.py": "x = 1\n" }),
    );

    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");

    // Evidence must indicate the missing-keyword sub-condition (R10.3).
    const detail = draw.evidence.map((e) => e.detail.toLowerCase()).join(" | ");
    expect(detail).toMatch(/keyword|install|usage|getting started|quickstart/);
  });
});

// --- R10.4 low docstring coverage → coverage evidence item --------------

describe("detectHermit: low docstring coverage adds a coverage evidence item (R10.4)", () => {
  it("adds a docstring-coverage evidence item when coverage < 0.25 with >= 4 public symbols", () => {
    // 8 public top-level functions, only 1 documented → ratio 0.125 < 0.25 with
    // >= 4 public symbols. README is short so the card is also drawn (reversed),
    // but the coverage evidence item must be present regardless of orientation.
    const draw = expectDraw(
      hermitOf({
        "README.md": "# Tiny\n\nusage.\n", // short → card drawn reversed
        "lib.py": pyWithSymbols(8, 1),
      }),
    );

    // A coverage-specific evidence item must be present (R10.4).
    const coverageItem = draw.evidence.find((e) =>
      /docstring|coverage/i.test(`${e.kind} ${e.detail}`),
    );
    expect(
      coverageItem,
      "expected a docstring-coverage evidence item",
    ).toBeDefined();
  });

  it("does NOT add a coverage evidence item when fewer than 4 public symbols exist", () => {
    // Only 3 public symbols, none documented (ratio 0 < 0.25) but < 4 symbols,
    // so no coverage evidence item is added. README is short so the card is
    // still drawn reversed — we assert only the absence of a coverage item.
    const draw = expectDraw(
      hermitOf({
        "README.md": "# Tiny\n\nusage.\n",
        "lib.py": pyWithSymbols(3, 0),
      }),
    );

    const coverageItem = draw.evidence.find((e) =>
      /docstring|coverage/i.test(`${e.kind} ${e.detail}`),
    );
    expect(coverageItem).toBeUndefined();
  });
});

// --- R10.4 unparseable python file → parse-error evidence + excluded -----

describe("detectHermit: unparseable python file yields parse-error evidence and is excluded from coverage (R10.4)", () => {
  it("records a parse-error evidence item for a file in opts.parseErrors", () => {
    // broken.py is forced into opts.parseErrors; good.py holds 4 public symbols,
    // all documented (ratio 1.0). With broken.py excluded, coverage stays at
    // 1.0 and no coverage item is warranted — but a parse-error item must exist.
    const draw = expectDraw(
      hermitOf(
        {
          "README.md": "# Tiny\n\nusage.\n", // short → card drawn reversed
          "good.py": pyWithSymbols(4, 4),
          "broken.py": "def (:::\n",
        },
        ["broken.py"],
      ),
    );

    // A parse-error evidence item referencing broken.py must be present (R10.4).
    const parseItem = draw.evidence.find(
      (e) =>
        e.path === "broken.py" || /parse|unparse|corrupt/i.test(`${e.kind} ${e.detail}`),
    );
    expect(parseItem, "expected a parse-error evidence item").toBeDefined();
  });

  it("excludes the unparseable file's symbols from the coverage denominator", () => {
    // good.py: 4 public symbols, all documented → ratio 1.0 on its own.
    // broken.py would contribute many UNdocumented symbols and drag the ratio
    // below 0.25 IF it were counted — but it is in opts.parseErrors and must be
    // excluded. With only good.py counted, coverage is 1.0 so NO coverage
    // evidence item is added.
    const draw = expectDraw(
      hermitOf(
        {
          "README.md": "# Tiny\n\nusage.\n",
          "good.py": pyWithSymbols(4, 4),
          "broken.py": pyWithSymbols(20, 0), // would crater coverage if counted
        },
        ["broken.py"],
      ),
    );

    const coverageItem = draw.evidence.find((e) =>
      /docstring|coverage/i.test(`${e.kind} ${e.detail}`),
    );
    expect(
      coverageItem,
      "coverage item should be absent because broken.py is excluded",
    ).toBeUndefined();
  });
});

// --- R10.5 healthy README + adequate coverage → null --------------------

describe("detectHermit: healthy README and adequate coverage returns null (R10.5)", () => {
  it("returns null for a healthy README (>= 200 bytes, has 'usage') and good docstrings", () => {
    // README clears both thresholds; 4 public symbols all documented → ratio
    // 1.0 >= 0.25. Nothing to report → null.
    expect(Buffer.byteLength(HEALTHY_README, "utf8")).toBeGreaterThanOrEqual(200);
    expect(HEALTHY_README.toLowerCase()).toMatch(/usage/);

    const draw = hermitOf({
      "README.md": HEALTHY_README,
      "lib.py": pyWithSymbols(4, 4),
    });

    expect(draw).toBeNull();
  });

  it("returns null when the README is healthy and fewer than 4 public symbols exist", () => {
    // Healthy README; only 2 public symbols (< 4) so the coverage rule never
    // fires even though neither is documented → null (R10.5).
    const draw = hermitOf({
      "README.md": HEALTHY_README,
      "lib.py": pyWithSymbols(2, 0),
    });

    expect(draw).toBeNull();
  });
});
