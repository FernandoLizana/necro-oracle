// src/detectors/wheel.ts
//
// The Wheel of Fortune (X — No Tests) detector.
//
// A pure, synchronous Detector over the snapshot's files (uses no DetectorOpts
// fields). It counts deduplicated test files and detects test-runner config:
//
//   Test files (any of, counted once per path):
//     - filename `test_*.py` or `*_test.py`
//     - a file whose immediate parent directory segment is `tests` or `test`
//       (at any depth)
//     - filename `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`
//
//   Runner config:
//     - `pytest.ini` at repo root
//     - `setup.cfg` whose content contains a `[tool:pytest]` section
//     - `tox.ini` at repo root
//     - `pyproject.toml` whose content contains `[tool.pytest.ini_options]`
//       or `[tool.pytest]`
//     - `jest.config.{js,ts,mjs,cjs}` at any path
//     - `.mocharc.{js,cjs,yaml,yml,json,jsonc}` at any path
//
//   Zero test files            → severity 2, upright  (R9.2)
//   tests but no runner config → severity 1, reversed (R9.3)
//   tests + >= 1 runner config → null                 (R9.4)
//
// Evidence (R9.5): one item carrying the exact test file count, up to 10 test
// file paths (lexicographic, surfaced via Evidence.path), and the names of any
// detected runner config files. Config names are surfaced only when a runner
// config exists — and that case returns null, so config names never leak into a
// drawn card's evidence.
//
// Covers: R9.1, R9.2, R9.3, R9.4, R9.5

import type { Evidence } from "../registry/schema.js";
import { getCard } from "../registry/cards.js";
import type { Detector } from "./types.js";

/** Maximum number of test file paths surfaced as evidence (R9.5). */
const MAX_EVIDENCE_PATHS = 10;

/** True when a path's filename matches a known test-file naming pattern. */
function filenameLooksLikeTest(path: string): boolean {
  const slash = path.lastIndexOf("/");
  const filename = slash === -1 ? path : path.slice(slash + 1);
  // test_*.py or *_test.py (require a non-empty stem around the marker so
  // bare `test_.py` style still matches while lookalikes like `latest.py`,
  // `contest.py`, `attestation.py` do not).
  if (/^test_.+\.py$/.test(filename)) return true;
  if (/.+_test\.py$/.test(filename)) return true;
  // *.spec.{ts,tsx,js,jsx} (require a non-empty stem; `specimen.ts` must not
  // match — it has no `.spec.` segment).
  if (/.+\.spec\.(ts|tsx|js|jsx)$/.test(filename)) return true;
  return false;
}

/** True when the file's immediate parent directory segment is `tests` or `test`. */
function parentDirIsTests(path: string): boolean {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return false; // file at repo root has no parent dir
  const dirPath = path.slice(0, slash);
  const parentSlash = dirPath.lastIndexOf("/");
  const parentSegment = parentSlash === -1 ? dirPath : dirPath.slice(parentSlash + 1);
  return parentSegment === "tests" || parentSegment === "test";
}

/** True when `path` is a test file by any of the recognised patterns. */
function isTestFile(path: string): boolean {
  return filenameLooksLikeTest(path) || parentDirIsTests(path);
}

/** Section-header presence check for the pytest config embedded in a file. */
function containsSection(content: string, header: string): boolean {
  // Match the header at the start of a line (ignoring leading whitespace),
  // tolerant of trailing whitespace before the newline.
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*${escaped}[ \\t]*$`, "m").test(content);
}

/**
 * Collect the names of detected runner-config files. The order is the
 * canonical detection order; each matched file contributes its path.
 */
function detectRunnerConfigs(
  paths: readonly string[],
  contents: ReadonlyMap<string, string>,
): string[] {
  const found: string[] = [];

  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const filename = slash === -1 ? path : path.slice(slash + 1);
    const atRoot = slash === -1;

    // pytest.ini / tox.ini — repo root only.
    if (atRoot && (path === "pytest.ini" || path === "tox.ini")) {
      found.push(path);
      continue;
    }

    // setup.cfg with a [tool:pytest] section (content inspection).
    if (atRoot && path === "setup.cfg") {
      const content = contents.get(path) ?? "";
      if (containsSection(content, "[tool:pytest]")) found.push(path);
      continue;
    }

    // pyproject.toml with [tool.pytest.ini_options] or [tool.pytest].
    if (atRoot && path === "pyproject.toml") {
      const content = contents.get(path) ?? "";
      if (
        containsSection(content, "[tool.pytest.ini_options]") ||
        containsSection(content, "[tool.pytest]")
      ) {
        found.push(path);
      }
      continue;
    }

    // jest.config.{js,ts,mjs,cjs} at any path.
    if (/^jest\.config\.(js|ts|mjs|cjs)$/.test(filename)) {
      found.push(path);
      continue;
    }

    // .mocharc.{js,cjs,yaml,yml,json,jsonc} at any path.
    if (/^\.mocharc\.(js|cjs|yaml|yml|json|jsonc)$/.test(filename)) {
      found.push(path);
      continue;
    }
  }

  return found;
}

export const detectWheel: Detector = (snapshot) => {
  const paths = snapshot.files.map((f) => f.path);

  // Step 1: deduplicated set of test file paths, lexicographically ordered.
  const testPaths = [...new Set(paths.filter(isTestFile))].sort();
  const testCount = testPaths.length;

  const card = getCard("wheel");
  const grimoires = [...card.linkedGrimoireIds];

  // R9.2: zero test files → severity 2, upright.
  if (testCount === 0) {
    const evidence: Evidence[] = [
      {
        kind: "test-coverage",
        detail: "0 test files found; the deck shows no tests at all.",
        source: "static",
      },
    ];
    return {
      card: "wheel",
      severity: 2,
      orientation: "upright",
      evidence,
      summary: "No test files found.",
      grimoires,
    };
  }

  // Tests exist — check for runner configuration.
  const runnerConfigs = detectRunnerConfigs(paths, snapshot.contents);

  // R9.4: tests + >= 1 runner config → null. (Config names are surfaced only
  // here, in the null case, so they never leak into a drawn card's evidence.)
  if (runnerConfigs.length > 0) {
    return null;
  }

  // R9.3: tests but no runner config → severity 1, reversed.
  const evidence: Evidence[] = [
    {
      kind: "test-coverage",
      detail: `${testCount} test ${
        testCount === 1 ? "file" : "files"
      } found, but no test runner configuration is present.`,
      source: "static",
    },
  ];

  // Up to 10 test file paths (lexicographic), surfaced via Evidence.path.
  for (const path of testPaths.slice(0, MAX_EVIDENCE_PATHS)) {
    evidence.push({
      kind: "test-file",
      path,
      detail: `Test file ${path} has no runner to summon it.`,
      source: "static",
    });
  }

  return {
    card: "wheel",
    severity: 1,
    orientation: "reversed",
    evidence,
    summary: `${testCount} test ${
      testCount === 1 ? "file" : "files"
    } without a configured runner.`,
    grimoires,
  };
};
