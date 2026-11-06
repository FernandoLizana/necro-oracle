// @necro/coven — the Demo_Mode fixture loader (design: "Demo mode"; R14.1,
// R14.6). NODE-ONLY module: it reads the graveyard fixtures from disk with
// `node:fs/promises`, so it is re-exported EXCLUSIVELY from the package's
// "./node" subpath (never `src/index.ts`) to keep the browser-safe barrel free
// of any `fs` import. The fixture FS read belongs here, at the edge/composition
// seam — NOT inside the pure `LocalCovenRunner`, which stays fixture- and
// path-agnostic (it receives a ready `RitualInput`).
//
// `loadDemoRitualInput` builds a complete `RitualInput` for the `lich-py2`
// demo (R14.1): it reads `demo.json` (ref + meta), `registry.json` (Tower dep
// freshness), and `osv.json` (Devil vulnerabilities), builds the `RepoSnapshot`
// from `repo/` via the oracle's Node directory builder, overrides the neutral
// ref with the graveyard identity so the spread seed (`ref.sha`) is stable, and
// runs the REAL oracle `runReading` to produce the completed `Reading` the
// Ritual resurrects against. Every fixture read is deterministic and offline.
//
// Any missing or unreadable required fixture — a deleted file, a bad JSON body,
// or an absent `repo/` directory — is collapsed into the canonical typed
// `demoFixtureMissingError` (`DEMO_FIXTURE_MISSING`, R14.6); the route surfaces
// it as a terminal `Error_Line`. The underlying cause is attached for
// server-side logging but never named in the oracle-voice `userMessage`.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  runReading,
  type OsvVulnerability,
  type RegistryEntry,
  type RepoMeta,
  type RepoRef,
  type SpreadKind,
} from "@necro/oracle";
import { buildSnapshotFromDirectory } from "@necro/oracle/node";

import type { RitualInput, ResurrectTarget } from "../models.js";
import { PYTHON2_TO_PYTHON3 } from "../registry.js";
import { demoFixtureMissingError } from "./errors.js";

/** The graveyard fixture directory the demo Ritual loads (R14.1). */
export const LICH_PY2_FIXTURE = "lich-py2";

/** The shape of the `lich-py2` `demo.json` manifest (ref identity + meta). */
interface DemoManifest {
  readonly sha: string;
  readonly defaultBranch: string;
  readonly meta: RepoMeta;
}

/** Options for {@link loadDemoRitualInput}. */
export interface LoadDemoRitualInputOptions {
  /**
   * Absolute path to the `fixtures/graveyard` directory. The loader joins
   * `<fixturesRoot>/lich-py2/...` beneath it. Supplied by the composition root
   * (the route) so this module never hard-codes a repo-relative path.
   */
  readonly fixturesRoot: string;
  /**
   * The resurrect target to run the demo for. Defaults to a bare run (all py2
   * candidates), which is what the `lich-py2` demo is authored for.
   */
  readonly target?: ResurrectTarget;
  /**
   * The spread of the in-scope reading. Defaults to `"necropsy"` (the oracle's
   * own default), the five-card spread the demo golden is pinned against.
   */
  readonly spread?: SpreadKind;
  /**
   * The fixed ISO clock for the demo. Used as both the snapshot `createdAt` and
   * the reading `now`, so repeated demo runs are byte-identical (R14.5).
   */
  readonly now: string;
}

/** Read and JSON-parse one fixture file, or throw DEMO_FIXTURE_MISSING (R14.6). */
async function readFixtureJson<T>(path: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    // Missing or unreadable file (R14.6).
    throw demoFixtureMissingError(cause);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    // Present but corrupt JSON is "unreadable" for our purposes (R14.6).
    throw demoFixtureMissingError(cause);
  }
}

/**
 * Build the complete {@link RitualInput} for the `lich-py2` Demo_Mode Ritual
 * (R14.1). Reads the fixture manifest, dep registry, and OSV list, builds the
 * snapshot from `repo/`, pins the graveyard ref so the spread seed is stable,
 * and runs the real oracle to produce the in-scope `Reading`. The returned
 * input carries `demo: true` so `RitualResult.demo` is set downstream.
 *
 * @throws NecroError `DEMO_FIXTURE_MISSING` if any required fixture file or the
 *   `repo/` directory is missing or unreadable (R14.6).
 */
export async function loadDemoRitualInput(
  options: LoadDemoRitualInputOptions,
): Promise<RitualInput> {
  const { fixturesRoot, now } = options;
  const target: ResurrectTarget = options.target ?? { kind: "bare" };
  const spread: SpreadKind = options.spread ?? "necropsy";

  const fixtureDir = join(fixturesRoot, LICH_PY2_FIXTURE);

  const demo = await readFixtureJson<DemoManifest>(join(fixtureDir, "demo.json"));
  const registry = await readFixtureJson<RegistryEntry[]>(
    join(fixtureDir, "registry.json"),
  );
  const osv = await readFixtureJson<OsvVulnerability[]>(
    join(fixtureDir, "osv.json"),
  );
  const registryData = new Map(registry.map((entry) => [entry.name, entry]));

  // Build the snapshot from `repo/`. A missing/unreadable repo directory raises
  // the oracle's SNAPSHOT_DIR_NOT_FOUND; map it to DEMO_FIXTURE_MISSING so the
  // demo surface speaks one code for every absent-fixture cause (R14.6).
  let snapshot;
  try {
    snapshot = await buildSnapshotFromDirectory(join(fixtureDir, "repo"), {
      createdAt: now,
      meta: demo.meta,
    });
  } catch (cause) {
    throw demoFixtureMissingError(cause);
  }

  // Override the neutral ref the directory builder synthesises with the
  // graveyard identity BEFORE runReading — the spread seed uses `ref.sha`, so
  // this pins the demo spread (R14.5).
  const ref: RepoRef = {
    owner: "graveyard",
    name: LICH_PY2_FIXTURE,
    sha: demo.sha,
    defaultBranch: demo.defaultBranch,
  };
  snapshot.ref = ref;

  const reading = await runReading(snapshot, {
    spreadKind: spread,
    registryData,
    osvData: osv,
    now,
  });

  return {
    pairId: PYTHON2_TO_PYTHON3,
    snapshot,
    reading,
    target,
    spread,
    now,
    demo: true,
  };
}
