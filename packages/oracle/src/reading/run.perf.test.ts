// @necro/oracle — performance + zero-network check for runReading (task 36).
//
// This test satisfies two non-functional requirements from the design:
//
//   R21.1 — First reading latency budget: a reading over a repository of
//           <= 500 files completes within 5000 ms p50. We build a ~500-file
//           snapshot (a realistic mix of small Python files, a few manifests,
//           and a README), run runReading several times with a fixed clock,
//           collect wall-clock durations with performance.now(), take the
//           median, and assert it is <= 5000 ms.
//
//   R21.2 — Zero outbound network: the oracle package makes no network calls by
//           construction (all external data — registry freshness, OSV, repo
//           meta — is injected as parameters). We assert this defensively by
//           monkey-patching globalThis.fetch to throw if ever called, counting
//           invocations, and asserting the counter stays 0 across every run.
//           (Node http/https are out of scope here: the oracle never imports
//           them, and the fetch stub is a pure, browser-safe guard.)
//
//   No secrets required — the test reads no env vars / tokens. runReading takes
//   a RepoSnapshot plus injected registryData/osvData only; nothing in this
//   path consults process.env. The fetch stub covers the network side; this
//   comment documents the secrets side.
//
// The tree-sitter WASM grammar is initialised once in vitest.setup.ts's
// beforeAll (task 10) — no network access there either (R3.1, R21.5, R21.6).
// The run count is kept modest so the perf test itself stays fast.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoMeta } from "../snapshot/types.js";
import type { RegistryData, RegistryEntry, OsvData } from "../detectors/types.js";

import { runReading } from "./run.js";
import type { ReadingOpts } from "./run.js";

// --- fixed inputs --------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard-500",
  sha: "cafef00ddeadbeef",
  defaultBranch: "main",
};

/** Fixed instant — the reading's createdAt is driven by this, never the clock. */
const NOW = "2025-01-01T00:00:00.000Z";

/** Neutral-ish repo metadata: an active, unarchived repo with a license. */
const META: RepoMeta = {
  pushedAt: "2024-12-15T00:00:00.000Z",
  isArchived: false,
  openIssueCount: 2,
  openPRCount: 1,
  oldestOpenPRAgeDays: 30,
  latestReleaseAt: "2024-11-01T00:00:00.000Z",
  licenseKey: "MIT",
};

const OPTS_BASE: Omit<ReadingOpts, "registryData" | "osvData"> = {
  spreadKind: "necropsy",
  now: NOW,
};

// --- a ~500-file snapshot ------------------------------------------------

/**
 * Build a realistic, small <= 500-file map: a mix of tiny Python modules (most
 * clean py3, a handful with simple legacy constructs), a couple of manifests, a
 * README, and a scattering of non-Python files. Every file is deliberately
 * small to keep the parse+detect work representative of a lightweight repo.
 */
function buildFiveHundredFiles(): Record<string, string> {
  const files: Record<string, string> = {};

  // A root README so the Hermit detector has something to chew on.
  files["README.md"] =
    "# graveyard-500\n\n" +
    "A synthetic performance fixture.\n\n" +
    "## Installation\n\npip install graveyard-500\n\n" +
    "## Usage\n\nImport it and call run().\n";

  // A couple of manifests exercised by the manifest parser + Tower/Judgement.
  files["requirements.txt"] = ["requests>=2.0", "six==1.16.0", "pyyaml"].join("\n") + "\n";
  files["setup.py"] =
    "from setuptools import setup\n\n" +
    "setup(\n" +
    "    name='graveyard-500',\n" +
    "    install_requires=['requests', 'six', 'pyyaml'],\n" +
    "    python_requires='>=3.8',\n" +
    "    classifiers=['Programming Language :: Python :: 3'],\n" +
    ")\n";

  // ~470 tiny Python modules under a package tree. Most are clean py3; a small
  // fraction carry simple content so the detectors do real-ish work.
  const PY_COUNT = 470;
  for (let i = 0; i < PY_COUNT; i++) {
    const idx = String(i).padStart(4, "0");
    const path = `pkg/mod_${idx}.py`;
    // Keep every module small and valid Python 3.
    files[path] =
      `"""Module ${idx}."""\n\n` +
      `def value_${idx}():\n` +
      `    """Return a constant."""\n` +
      `    return ${i}\n\n\n` +
      `def double_${idx}(x):\n` +
      `    """Double the input."""\n` +
      `    return x * 2\n`;
  }

  // A few test files so the Wheel detector sees tests present.
  files["tests/test_basic.py"] =
    "def test_value():\n    assert True\n";
  files["tests/test_more.py"] =
    "def test_more():\n    assert 1 + 1 == 2\n";

  // A pytest config so a test runner is detected.
  files["pytest.ini"] = "[pytest]\n";

  // A handful of non-Python files to round out the mix.
  files["src/app.js"] = "export function run() { return 42; }\n";
  files["index.html"] = "<!doctype html><title>graveyard</title>\n";
  files["LICENSE"] = "MIT License\n\nCopyright (c) 2025\n";

  return files;
}

/** Injected registry freshness for the Tower detector (no network needed). */
function buildRegistryData(): RegistryData {
  const entry = (
    name: string,
    over: Partial<RegistryEntry> = {},
  ): RegistryEntry => ({
    name,
    latestVersion: "9.9.9",
    yanked: false,
    isDeprecated: false,
    py2Only: false,
    publishedAt: "2024-10-01T00:00:00.000Z",
    ...over,
  });

  const data: RegistryData = new Map();
  data.set("requests", entry("requests", { latestVersion: "2.32.3" }));
  data.set("six", entry("six", { latestVersion: "1.16.0" }));
  data.set("pyyaml", entry("pyyaml", { latestVersion: "6.0.2" }));
  return data;
}

/** Injected OSV vulnerabilities for the Devil detector — empty by design. */
const OSV_DATA: OsvData = [];

// --- fetch guard: assert zero outbound network (R21.2) -------------------

let originalFetch: typeof globalThis.fetch | undefined;
let fetchCallCount = 0;

beforeEach(() => {
  fetchCallCount = 0;
  originalFetch = globalThis.fetch;
  // Any call to fetch during a reading is a contract violation: count it and
  // throw so it surfaces loudly rather than silently succeeding.
  globalThis.fetch = (() => {
    fetchCallCount += 1;
    throw new Error(
      "network call detected during runReading — the oracle must be pure (R21.2)",
    );
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
  }
});

// --- the performance + zero-network test ---------------------------------

describe("R21.1, R21.2: runReading performance and zero-network", () => {
  it("completes a <=500-file reading within 5000 ms p50 with zero network calls", async () => {
    const files = buildFiveHundredFiles();
    const registryData = buildRegistryData();
    const opts: ReadingOpts = {
      ...OPTS_BASE,
      registryData,
      osvData: OSV_DATA,
    };

    // Sanity: the fixture must be <= 500 files (R21.1 scope).
    const fileCount = Object.keys(files).length;
    expect(fileCount).toBeLessThanOrEqual(500);

    // Measure p50 latency across a modest number of runs. Each run rebuilds the
    // snapshot (buildSnapshotFromFileMap is pure and cheap) and divines it.
    const RUNS = 5;
    const durations: number[] = [];
    let lastVitality = -1;
    for (let run = 0; run < RUNS; run++) {
      const snapshot = buildSnapshotFromFileMap(REF, files, {
        meta: META,
        createdAt: NOW,
      });

      const start = performance.now();
      const reading = await runReading(snapshot, opts);
      const elapsed = performance.now() - start;
      durations.push(elapsed);

      // Each run must produce a well-formed, deterministic-vitality reading.
      expect(reading.createdAt).toBe(NOW);
      expect(Number.isInteger(reading.vitality)).toBe(true);
      if (lastVitality === -1) {
        lastVitality = reading.vitality;
      } else {
        expect(reading.vitality).toBe(lastVitality);
      }
    }

    // Median (p50): sort ascending and take the middle sample.
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;

    // Surface the measured median for the task report.
    console.log(
      `[perf] runReading over ${fileCount} files: median=${median.toFixed(1)}ms ` +
        `durations=[${sorted.map((d) => d.toFixed(1)).join(", ")}]ms`,
    );

    // R21.1: p50 latency budget. The CI margin is generous but the assertion
    // itself holds the 5000 ms p50 bound.
    expect(median).toBeLessThanOrEqual(5000);

    // R21.2: no outbound network call occurred across any run.
    expect(fetchCallCount).toBe(0);
  });
});
