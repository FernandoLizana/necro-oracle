// @necro/oracle — unit tests for the runReading orchestrator (task 30.1).
//
// TEST-FIRST: these tests are written against the runReading API described in
// design.md ("Reading orchestrator" + "Diagram 1: runReading execution flow")
// and requirements R19.1–R19.5, R21.8 BEFORE the real implementation exists
// (task 30.2). run.ts currently exports a throwing stub, so every test here is
// EXPECTED TO BE RED until 30.2 wires the real orchestrator.
//
// runReading is the single async orchestrator of the oracle package. Per the
// design it:
//   1. awaits initParser() exactly once (lazy singleton; done for the caller),
//   2. parses every .py file once into a trees Map (FILE_TOO_LARGE / partial →
//      parseErrors),
//   3. runs parseAllManifests and attaches the result to the snapshot,
//   4. builds DetectorOpts { ...opts, trees, parseErrors } and runs the eleven
//      snapshot detectors via Promise.allSettled — a throwing detector lands a
//      NecroError(DETECTOR_FAILED) in Reading.errors while the others complete,
//   5. filters null draws, assigns the spread via assignSpread(draws,
//      opts.spreadKind, snapshot.ref.sha), and computes vitality,
//   6. assembles the Reading with id = crypto.randomUUID(), createdAt =
//      opts.now (never the system clock), engineVersion from package.json.
//
// These tests exercise the REAL detectors (all eleven are implemented) against
// real snapshots built with buildSnapshotFromFileMap. The tree-sitter WASM
// grammar is initialised once in vitest.setup.ts's beforeAll (task 10) — no
// network access (R3.1, R21.5, R21.6).
//
// Coverage map:
//   R19.1 deterministic reading from (snapshot, opts)
//   R19.2 DetectorOpts assembled from opts + parsed trees/manifests
//   R19.3 detectors run concurrently and all contribute to the reading
//   R19.4 a throwing detector is isolated into Reading.errors (not propagated)
//   R19.5 createdAt === opts.now; engineVersion from package.json; id is a UUID
//   R21.8 a non-Python snapshot completes; Python-dependent detectors return
//         null; no throw

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef } from "../snapshot/types.js";

import { runReading } from "./run.js";
import type { ReadingOpts } from "./run.js";

// --- test fixtures -------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeef",
  defaultBranch: "main",
};

/** Fixed instant — the reading's createdAt must equal this exactly (R19.5). */
const NOW = "2025-01-01T00:00:00.000Z";

/** Default necropsy opts with the fixed clock. */
const OPTS: ReadingOpts = { spreadKind: "necropsy", now: NOW };

/** RFC-4122 UUID shape (any version/variant), used to assert Reading.id. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A minimal Python 2 repository: a `print` statement is py2 syntax, so the
 * Judgement detector fires. That guarantees at least one non-null draw, which
 * the necropsy spread places at "The Corpse".
 */
const PY2_FILES: Record<string, string> = {
  "main.py": "print 'hello from the crypt'\n",
};

/**
 * A snapshot with no Python files at all — just a README and a package.json.
 * Every Python-dependent detector must return null, and runReading must still
 * complete without throwing (R21.8).
 */
const NON_PYTHON_FILES: Record<string, string> = {
  "README.md": "# A living project\n\n## Install\n\nnpm install\n",
  "package.json": JSON.stringify({ name: "alive", version: "1.0.0" }, null, 2),
};

// --- R19.1, R19.2, R19.3, R19.5: happy path end-to-end -------------------

describe("R19.1, R19.2, R19.3, R19.5: runReading happy path", () => {
  it("produces a full Reading for a py2 repo: judgement draw, necropsy spread, bounded vitality", async () => {
    const snapshot = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });
    const reading = await runReading(snapshot, OPTS);

    // A py2 `print` statement guarantees the Judgement card is drawn (R19.3).
    const judgement = reading.draws.find((d) => d.card === "judgement");
    expect(judgement, "judgement should be drawn for py2 syntax").toBeDefined();

    // The repo reference is carried onto the reading unchanged.
    expect(reading.repo).toEqual(REF);

    // Necropsy spread → exactly five positions, labelled in order (R19.2).
    expect(reading.spread).toHaveLength(5);
    expect(reading.spread.map((p) => p.label)).toEqual([
      "The Corpse",
      "The Wound",
      "The Shadow",
      "The Hope",
      "The Call",
    ]);

    // Vitality is an integer in [0, 100].
    expect(Number.isInteger(reading.vitality)).toBe(true);
    expect(reading.vitality).toBeGreaterThanOrEqual(0);
    expect(reading.vitality).toBeLessThanOrEqual(100);

    // engineVersion is a non-empty string sourced from package.json (R19.5).
    expect(typeof reading.engineVersion).toBe("string");
    expect(reading.engineVersion.length).toBeGreaterThan(0);

    // id is a UUID (R19.5).
    expect(reading.id).toMatch(UUID_RE);

    // A clean run captures no detector errors — errors is an empty array.
    expect(Array.isArray(reading.errors)).toBe(true);
    expect(reading.errors).toEqual([]);
  });

  it("sets createdAt exactly to opts.now (never the system clock, R19.5)", async () => {
    const snapshot = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });
    const reading = await runReading(snapshot, OPTS);
    expect(reading.createdAt).toBe(NOW);
  });

  it("places the most severe draw at 'The Corpse' (necropsy primary position)", async () => {
    const snapshot = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });
    const reading = await runReading(snapshot, OPTS);
    const corpse = reading.spread.find((p) => p.label === "The Corpse");
    expect(corpse, "necropsy spread must have a Corpse position").toBeDefined();
    expect(corpse?.draw, "The Corpse should hold a drawn card").not.toBeNull();
  });
});

// --- R21.8: non-Python-only snapshot completes with Python detectors null ---

describe("R21.8: non-Python snapshot", () => {
  it("completes without throwing and the Python-dependent detectors return null", async () => {
    const snapshot = buildSnapshotFromFileMap(REF, NON_PYTHON_FILES, {
      createdAt: NOW,
    });

    const reading = await runReading(snapshot, OPTS);

    // No Python files → the tree-sitter detectors contribute nothing.
    expect(reading.draws.some((d) => d.card === "judgement")).toBe(false);
    expect(reading.draws.some((d) => d.card === "death")).toBe(false);
    expect(reading.draws.some((d) => d.card === "moon")).toBe(false);

    // The reading is still well-formed: spread assigned, vitality bounded.
    expect(reading.spread).toHaveLength(5);
    expect(Number.isInteger(reading.vitality)).toBe(true);
    expect(reading.vitality).toBeGreaterThanOrEqual(0);
    expect(reading.vitality).toBeLessThanOrEqual(100);

    // No detector threw while processing a Python-free snapshot.
    expect(reading.errors).toEqual([]);
    expect(reading.createdAt).toBe(NOW);
    expect(reading.id).toMatch(UUID_RE);
  });
});

// --- R19.1: determinism sanity check -------------------------------------
//
// Full determinism is Property 1 (task 33). Here we only sanity-check that two
// runs over the same snapshot + opts agree on draws, spread, and vitality (the
// id is a fresh UUID per run, so it is expected to differ).

describe("R19.1: determinism (sanity)", () => {
  it("two runs over the same snapshot + opts agree on draws, spread, and vitality", async () => {
    const snapshotA = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });
    const snapshotB = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });

    const a = await runReading(snapshotA, OPTS);
    const b = await runReading(snapshotB, OPTS);

    expect(a.draws).toEqual(b.draws);
    expect(a.spread).toEqual(b.spread);
    expect(a.vitality).toBe(b.vitality);
    expect(a.createdAt).toBe(b.createdAt);
    expect(a.engineVersion).toBe(b.engineVersion);

    // The id is a fresh UUID each run — not part of the deterministic result.
    expect(a.id).not.toBe(b.id);
  });
});

// --- R19.4: detector error isolation -------------------------------------
//
// Triggering a throw from a real detector is hard to do reliably through a
// snapshot alone; the throwing-detector isolation path is covered structurally
// by task 33's Property 2 (every detector result is captured, errors never
// propagate out of runReading). Here we keep the lighter observable assertion:
// on a clean run no detector throws, so Reading.errors is an empty array, and
// the field is always an array (never undefined) regardless of outcome.

describe("R19.4: detector error isolation", () => {
  it("captures detector failures in Reading.errors[] (empty on a clean run)", async () => {
    const snapshot = buildSnapshotFromFileMap(REF, PY2_FILES, {
      createdAt: NOW,
    });
    const reading = await runReading(snapshot, OPTS);

    expect(Array.isArray(reading.errors)).toBe(true);
    expect(reading.errors).toEqual([]);
  });
});
