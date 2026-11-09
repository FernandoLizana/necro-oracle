// @necro/oracle — unit tests for the Judgement detector (task 14.1).
//
// TEST-FIRST: these tests are written against the detectJudgement API described
// in design.md ("detectJudgement — XX The Judgement (Dead Runtime)") and
// requirements R5.1–R5.6 BEFORE the real implementation exists (task 14.2).
// judgement.ts currently exports a throwing stub, so every test here is
// EXPECTED TO BE RED until 14.2 replaces the stub with the real detection
// algorithm.
//
// detectJudgement is a pure, synchronous Detector that consumes PRE-PARSED
// trees from opts.trees (it never calls parsePython itself) and skips any path
// listed in opts.parseErrors. These tests therefore mirror what runReading
// (task 30) does for the detector: build a snapshot with
// buildSnapshotFromFileMap, populate snapshot.manifests via parseAllManifests,
// and build the trees Map by calling parsePython on every python file. The
// tree-sitter WASM grammar is initialised once in vitest.setup.ts's beforeAll
// (task 10) — no network access (R3.1, R21.5, R21.6).
//
// Coverage map:
//   R5.1 py2 syntax (print_statement, etc.) in python files → judgement drawn
//   R5.2 py2-only manifests (classifiers / python_requires) → severity 3 upright
//   R5.3 six / __future__ / 2to3 straddling alongside py2 syntax → severity 1
//        reversed; PRECEDENCE over R5.2
//   R5.4 one Evidence item per construct type, path + line of first occurrence
//   R5.5 no python files AND no python manifests → null
//   R5.6 linkedGrimoireIds = ["py2to3","pyproject","lovers-js"] (asserted via grimoires)
//   exclusions: files under vendor/.tox/node_modules/site-packages ignored

import { describe, expect, it } from "vitest";

import { parseAllManifests } from "../parser/manifest.js";
import { parsePython, type Tree } from "../parser/tree-sitter.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { NecroError } from "../util/errors.js";
import type { CardDraw } from "../registry/schema.js";
import type { DetectorOpts } from "./types.js";

import { detectJudgement } from "./judgement.js";

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
  // Populate manifests exactly as runReading does before invoking detectors.
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

/** Run detectJudgement over a path→content file map. */
function judgementOf(files: Record<string, string>): CardDraw | null {
  const { snapshot, opts } = buildInputs(files);
  return detectJudgement(snapshot, opts);
}

/** Assert a draw is non-null and return it narrowed. */
function expectDraw(draw: CardDraw | null): CardDraw {
  expect(draw, "expected judgement to be drawn").not.toBeNull();
  return draw as CardDraw;
}

// A setup.py whose Trove classifiers restrict the package to Python 2 only.
const PY2_ONLY_SETUP_PY = [
  "from setuptools import setup",
  "setup(",
  '    name="relic",',
  '    version="0.1.0",',
  "    classifiers=[",
  '        "Programming Language :: Python :: 2",',
  '        "Programming Language :: Python :: 2.7",',
  "    ],",
  ")",
  "",
].join("\n");

// --- R5.1 py2 syntax → judgement drawn ----------------------------------

describe("detectJudgement: py2 syntax draws the card (R5.1)", () => {
  it("draws judgement at severity 2 upright for a bare py2 print statement", () => {
    const draw = expectDraw(judgementOf({ "app.py": 'print "hello, dead world"\n' }));

    expect(draw.card).toBe("judgement");
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
    expect(draw.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("sets linkedGrimoireIds via grimoires = ['py2to3','pyproject','lovers-js'] (R5.6; lovers reachability)", () => {
    const draw = expectDraw(judgementOf({ "app.py": 'print "legacy"\n' }));
    expect(draw.grimoires).toEqual(["py2to3", "pyproject", "lovers-js"]);
  });
});

// --- R5.2 py2-only manifests → severity 3 upright -----------------------

describe("detectJudgement: py2-only manifests burn at severity 3 (R5.2)", () => {
  it("severity 3 upright when py2-only setup.py classifiers accompany py2 syntax", () => {
    const draw = expectDraw(
      judgementOf({
        "setup.py": PY2_ONLY_SETUP_PY,
        "app.py": 'print "legacy runtime"\n',
      }),
    );

    expect(draw.severity).toBe(3);
    expect(draw.orientation).toBe("upright");
  });
});

// --- R5.3 straddling → severity 1 reversed, PRECEDENCE over R5.2 ---------

describe("detectJudgement: straddling is reversed and wins over py2-only (R5.3)", () => {
  it("severity 1 reversed when six/__future__ shims accompany py2 syntax", () => {
    const straddlingApp = [
      "from __future__ import print_function",
      "import six",
      "",
      'print "still has a py2 print statement"',
      "",
    ].join("\n");

    const draw = expectDraw(judgementOf({ "app.py": straddlingApp }));

    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");
  });

  it("straddling takes precedence even when py2-only manifests are present", () => {
    const straddlingApp = [
      "from __future__ import print_function",
      "import six",
      "",
      'print "legacy"',
      "",
    ].join("\n");

    const draw = expectDraw(
      judgementOf({
        "setup.py": PY2_ONLY_SETUP_PY, // would otherwise force severity 3 upright
        "app.py": straddlingApp,
      }),
    );

    // Precedence of R5.3 over R5.2: reversed straddling wins.
    expect(draw.severity).toBe(1);
    expect(draw.orientation).toBe("reversed");
  });
});

// --- R5.4 evidence: one item per construct type, first-occurrence path+line

describe("detectJudgement: evidence records first occurrence per construct (R5.4)", () => {
  it("emits path + line for the first occurrence of a construct type", () => {
    // print_statement first appears on line 3 (1-based) of multi.py.
    const multi = [
      "x = 1", // line 1
      "y = 2", // line 2
      'print "first print"', // line 3 — first print_statement
      'print "second print"', // line 4 — same type, should not add a 2nd item
      "",
    ].join("\n");

    const draw = expectDraw(judgementOf({ "multi.py": multi }));

    const printEvidence = draw.evidence.find((e) => e.path === "multi.py");
    expect(printEvidence, "expected evidence referencing multi.py").toBeDefined();
    expect(printEvidence?.path).toBe("multi.py");
    // First occurrence line is recorded (1-based line 3).
    expect(printEvidence?.line).toBe(3);

    // Only one evidence item for the print_statement construct type even though
    // two print statements exist (R5.4 is per construct type, first occurrence).
    const printItems = draw.evidence.filter(
      (e) => e.path === "multi.py" && e.line === 3,
    );
    expect(printItems.length).toBe(1);
  });

  it("records one evidence item per distinct construct type", () => {
    // Two distinct py2 constructs: a print statement and a long-integer literal.
    const twoKinds = [
      'print "legacy"', // line 1 — print_statement
      "big = 10L", // line 2 — long integer literal
      "",
    ].join("\n");

    const draw = expectDraw(judgementOf({ "two.py": twoKinds }));

    // At least two evidence items — one per construct type (R5.4).
    expect(draw.evidence.length).toBeGreaterThanOrEqual(2);
    // Each evidence item carries a path and a line.
    for (const e of draw.evidence) {
      expect(e.path).toBeDefined();
      expect(typeof e.line).toBe("number");
    }
  });
});

// --- R5.5 no python files AND no python manifests → null ----------------

describe("detectJudgement: returns null without python presence (R5.5)", () => {
  it("returns null for a repository with no python files and no python manifests", () => {
    const draw = judgementOf({
      "README.md": "# A healthy JS project\n",
      "index.js": "export const main = () => 42;\n",
      "package.json": '{ "name": "alive", "version": "1.0.0" }\n',
    });
    expect(draw).toBeNull();
  });
});

// --- exclusions: vendored / toolchain directories are ignored -----------

describe("detectJudgement: excludes vendored/toolchain python files", () => {
  it("ignores py2 syntax under vendor/, .tox/, node_modules/, site-packages/", () => {
    const py2 = 'print "vendored legacy"\n';
    const draw = judgementOf({
      "vendor/legacy/app.py": py2,
      "project/.tox/py27/lib/shim.py": py2,
      "node_modules/pkg/old.py": py2,
      "env/lib/python2.7/site-packages/dep.py": py2,
    });

    // All python files are excluded and there are no python manifests → null.
    expect(draw).toBeNull();
  });

  it("still draws from a non-excluded file even when vendored py2 exists", () => {
    const py2 = 'print "legacy"\n';
    const draw = expectDraw(
      judgementOf({
        "vendor/legacy/app.py": py2, // excluded
        "app.py": py2, // counted
      }),
    );

    // Evidence must come only from the non-excluded file.
    for (const e of draw.evidence) {
      if (e.path !== undefined) {
        expect(e.path.includes("/vendor/") || e.path.startsWith("vendor/")).toBe(
          false,
        );
      }
    }
  });
});
