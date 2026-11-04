// @necro/oracle — unit tests for the Death detector (task 18.1).
//
// TEST-FIRST: these tests are written against the detectDeath API described in
// design.md ("detectDeath — XIII The Death (Dead Code)") and requirements
// R8.1–R8.5 BEFORE the real implementation exists (task 18.2). death.ts
// currently exports a throwing stub, so every assertion here is EXPECTED TO BE
// RED until 18.2 replaces the stub with the real detection algorithm.
//
// detectDeath is a pure, synchronous Detector that builds an intra-repository
// import graph from PRE-PARSED trees in opts.trees (it never calls parsePython
// itself) and skips any path listed in opts.parseErrors. These tests mirror
// what runReading (task 30) does for the detector: build a snapshot with
// buildSnapshotFromFileMap, populate snapshot.manifests via parseAllManifests,
// and build the trees Map by calling parsePython on every python file. The
// tree-sitter WASM grammar is initialised once in vitest.setup.ts's beforeAll
// (task 10) — no network access (R3.1, R21.5, R21.6).
//
// Coverage map:
//   R8.1 build intra-repo import graph; unresolved modules excluded (external)
//   R8.2 >= 1 unreachable module (not an entrypoint candidate) → severity 2
//        upright, up to 20 module paths ordered lexicographically
//   R8.3 >= 5 unused public top-level symbols → severity 2, up to 20 evidence
//        items ordered by file path then line, each with name/path/line
//   R8.4 large commented-out valid-Python blocks (>= 5 lines) → severity 1
//        reversed when no unreachable modules, else additional evidence at sev 2
//   R8.5 nothing found → null
//   entrypoint candidates (__main__.py, manage.py, wsgi.py, asgi.py, app.py,
//        run.py, entry-point listed) are NEVER flagged as unreachable

import { describe, expect, it } from "vitest";

import { parseAllManifests } from "../parser/manifest.js";
import { parsePython, type Tree } from "../parser/tree-sitter.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { NecroError } from "../util/errors.js";
import type { CardDraw } from "../registry/schema.js";
import type { DetectorOpts } from "./types.js";

import { detectDeath } from "./death.js";

// --- test fixtures -------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeef",
  defaultBranch: "main",
};

const NOW = "2025-01-01T00:00:00.000Z";

/**
 * Build the detector inputs the way runReading will: shape the snapshot, parse
 * every manifest into snapshot.manifests, then parse each python file into the
 * opts.trees map (skipping oversize/absent content). Any python file that fails
 * to parse is recorded in opts.parseErrors instead of opts.trees.
 */
function buildInputs(files: Record<string, string>): {
  snapshot: RepoSnapshot;
  opts: DetectorOpts;
} {
  const snapshot = buildSnapshotFromFileMap(REF, files, { createdAt: NOW });
  // Populate manifests exactly as runReading does before invoking detectors
  // (detectDeath consults entry-point fields of setup.py / pyproject.toml).
  snapshot.manifests = parseAllManifests(snapshot);

  const trees = new Map<string, Tree>();
  const parseErrors = new Map<string, NecroError>();

  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    const content = snapshot.contents.get(file.path);
    if (content === undefined) continue; // oversize / absent → no tree.
    try {
      trees.set(file.path, parsePython(content));
    } catch (err) {
      parseErrors.set(file.path, err as NecroError);
    }
  }

  const opts: DetectorOpts = { now: NOW, trees, parseErrors };
  return { snapshot, opts };
}

/** Run detectDeath over a path→content file map. */
function deathOf(files: Record<string, string>): CardDraw | null {
  const { snapshot, opts } = buildInputs(files);
  return detectDeath(snapshot, opts);
}

/** Assert a draw is non-null and return it narrowed. */
function expectDraw(draw: CardDraw | null): CardDraw {
  expect(draw, "expected death to be drawn").not.toBeNull();
  return draw as CardDraw;
}

// A valid-Python commented-out block of >= 5 consecutive comment lines. Each
// line, once the leading "# " is stripped, forms a block that parses cleanly.
const COMMENTED_OUT_BLOCK = [
  "# def resurrect(corpse):",
  "#     bones = corpse.gather()",
  "#     for bone in bones:",
  "#         bone.reassemble()",
  "#     return corpse.animate()",
  "",
].join("\n");

// --- R8.2 unreachable modules → severity 2 upright ----------------------

describe("detectDeath: unreachable modules draw severity 2 upright (R8.2)", () => {
  it("flags an orphan module never imported by any other file", () => {
    // app.py is an entrypoint candidate that imports helpers (reachable).
    // orphan.py is never imported by anyone and is not an entrypoint → dead.
    const draw = expectDraw(
      deathOf({
        "app.py": "import helpers\n\nhelpers.run()\n",
        "helpers.py": "def run():\n    return 1\n",
        "orphan.py": "def ghost():\n    return 0\n",
      }),
    );

    expect(draw.card).toBe("death");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");

    // The orphan module path must appear in the evidence.
    const paths = draw.evidence.map((e) => e.path).filter(Boolean);
    expect(paths).toContain("orphan.py");
    // The reachable modules and the entrypoint must NOT be flagged unreachable.
    expect(paths).not.toContain("helpers.py");
    expect(paths).not.toContain("app.py");
  });

  it("lists up to 20 unreachable module paths ordered lexicographically", () => {
    // 25 orphan modules, plus an app.py entrypoint that imports one helper so
    // the import graph is non-trivial. None of the orphans import each other.
    const files: Record<string, string> = {
      "app.py": "import helpers\n\nhelpers.run()\n",
      "helpers.py": "def run():\n    return 1\n",
    };
    for (let i = 0; i < 25; i++) {
      const name = `z_orphan_${String(i).padStart(2, "0")}`;
      files[`${name}.py`] = `def f_${i}():\n    return ${i}\n`;
    }

    const draw = expectDraw(deathOf(files));
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");

    // Only unreachable-module evidence paths, capped at 20.
    const modulePaths = draw.evidence
      .filter((e) => e.path !== undefined && e.path.startsWith("z_orphan_"))
      .map((e) => e.path as string);

    expect(modulePaths.length).toBeLessThanOrEqual(20);
    expect(modulePaths.length).toBeGreaterThan(0);

    // Whatever subset is reported must be sorted lexicographically.
    const sorted = [...modulePaths].sort((a, b) => a.localeCompare(b));
    expect(modulePaths).toEqual(sorted);
  });
});

// --- entrypoint candidates are never flagged as unreachable -------------

describe("detectDeath: entrypoint candidates are never unreachable", () => {
  it("returns null when the only un-imported files are entrypoint candidates", () => {
    // Every file here is an entrypoint candidate by name and none is imported
    // by another. They must all be exempt from the unreachable-module rule, so
    // with no unused symbols and no commented blocks the draw is null (R8.5).
    const draw = deathOf({
      "__main__.py": "import lib\n\nlib.go()\n",
      "manage.py": "import lib\n\nlib.go()\n",
      "wsgi.py": "application = None\n",
      "asgi.py": "application = None\n",
      "app.py": "import lib\n\nlib.go()\n",
      "run.py": "import lib\n\nlib.go()\n",
      "lib.py": "def go():\n    return 1\n",
    });

    expect(draw).toBeNull();
  });
});

// --- R8.3 >= 5 unused top-level symbols → severity 2 --------------------

describe("detectDeath: >= 5 unused top-level symbols draw severity 2 (R8.3)", () => {
  it("draws severity 2 upright with per-symbol evidence (name/path/line)", () => {
    // A single module interconnected via an entrypoint so there are no
    // unreachable modules, yet it defines many public top-level symbols that
    // are never referenced by name in any other file.
    const dead = [
      "def alpha():", // line 1
      "    return 1",
      "def bravo():", // line 3
      "    return 2",
      "def charlie():", // line 5
      "    return 3",
      "def delta():", // line 7
      "    return 4",
      "def echo():", // line 9
      "    return 5",
      "def foxtrot():", // line 11
      "    return 6",
      "",
    ].join("\n");

    const draw = expectDraw(
      deathOf({
        // app.py imports dead so dead.py is reachable (not an unreachable
        // module); the symbols inside it are still never referenced by name.
        "app.py": "import dead\n",
        "dead.py": dead,
      }),
    );

    expect(draw.card).toBe("death");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");

    // Symbol evidence items reference dead.py with a symbol name and line.
    const symbolEvidence = draw.evidence.filter(
      (e) => e.path === "dead.py" && typeof e.line === "number",
    );
    expect(symbolEvidence.length).toBeGreaterThanOrEqual(5);
    expect(symbolEvidence.length).toBeLessThanOrEqual(20);

    // Each symbol evidence item names the symbol somewhere in its detail.
    const details = symbolEvidence.map((e) => e.detail).join(" ");
    expect(details).toContain("alpha");

    // Ordered by file path then line: lines are non-decreasing for dead.py.
    const lines = symbolEvidence.map((e) => e.line as number);
    const sortedLines = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sortedLines);
  });
});

// --- R8.4 commented-out valid-Python block → severity 1 reversed --------

describe("detectDeath: commented-out code blocks (R8.4)", () => {
  it("draws severity 1 reversed when blocks exist but no unreachable modules", () => {
    // app.py is an entrypoint that imports helpers (reachable); helpers.py is
    // imported (reachable). No unreachable modules and < 5 unused symbols, but
    // app.py carries a large commented-out valid-Python block.
    const appWithBlock = ["import helpers", "", COMMENTED_OUT_BLOCK, "helpers.run()", ""].join(
      "\n",
    );

    const draw = expectDraw(
      deathOf({
        "app.py": appWithBlock,
        "helpers.py": "def run():\n    return 1\n",
      }),
    );

    expect(draw.card).toBe("death");
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");

    // Evidence records the file path of the commented-out block.
    const paths = draw.evidence.map((e) => e.path).filter(Boolean);
    expect(paths).toContain("app.py");
  });

  it("keeps severity 2 and adds blocks as extra evidence when a module is unreachable", () => {
    // orphan.py is unreachable (severity 2 upright) AND also contains a large
    // commented-out block — R8.4 says the block becomes additional evidence,
    // not a downgrade to severity 1.
    const orphanWithBlock = ["def ghost():", "    return 0", "", COMMENTED_OUT_BLOCK].join("\n");

    const draw = expectDraw(
      deathOf({
        "app.py": "import helpers\n\nhelpers.run()\n",
        "helpers.py": "def run():\n    return 1\n",
        "orphan.py": orphanWithBlock,
      }),
    );

    // Unreachable module dominates: severity stays 2 upright.
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");

    // Both the unreachable-module path and the commented-block path are present.
    const paths = draw.evidence.map((e) => e.path).filter(Boolean);
    expect(paths).toContain("orphan.py");
  });
});

// --- R8.5 nothing found → null ------------------------------------------

describe("detectDeath: returns null for a clean interconnected repo (R8.5)", () => {
  it("returns null when every module is reachable and no dead signals exist", () => {
    // A small, fully interconnected repo: app.py (entrypoint) imports core,
    // core imports util; every public symbol is referenced across files and
    // there are no large commented-out blocks.
    const draw = deathOf({
      "app.py": "import core\n\ncore.start()\n",
      "core.py": ["import util", "", "def start():", "    return util.helper()", ""].join("\n"),
      "util.py": ["def helper():", "    return 42", ""].join("\n"),
    });

    expect(draw).toBeNull();
  });
});
