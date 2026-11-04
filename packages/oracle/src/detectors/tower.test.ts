// src/detectors/tower.test.ts
//
// Unit tests (test-first) for detectTower — The Tower (XVI — Rotting
// Dependencies). The implementation (tower.ts, task 15.2) is a throwing stub,
// so these tests are EXPECTED RED until that task lands.
//
// Design API (design.md "detectTower"):
//   detectTower: Detector  // (snapshot, opts) => CardDraw | null
//
// Algorithm:
//   1. No dependency manifests → null.
//   2. For each ParsedDependency across all manifests:
//        a. entry = opts.registryData.get(normalizedName); no entry → skip (R6.7).
//        b. broken  = yanked OR isDeprecated OR py2Only OR >= 2 majors behind.
//        c. drifted = empty versionSpec (unpinned) OR exactly 1 major behind.
//   3. any broken  → severity 2, upright.
//   4. else drifted → severity 1, reversed.
//   5. else         → null.
//   "major version" = leftmost non-zero segment (1.x.y → 1; 0.x.y → x).
//   Evidence: one item per affected dependency with name, versionSpec, detail.
//
// Covers: R6.1, R6.2, R6.3, R6.4, R6.5, R6.6, R6.7

import { describe, expect, it } from "vitest";

import { parseAllManifests, type Manifest } from "../parser/manifest.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { DetectorOpts, RegistryData, RegistryEntry } from "./types.js";
import { detectTower } from "./tower.js";

// --- Fixtures -------------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeefcafe",
  defaultBranch: "main",
};

const NOW = "2026-11-03T12:00:00.000Z";

/**
 * Build a snapshot from a file map and attach parsed manifests, mirroring what
 * runReading does before invoking detectors. requirements.txt is parsed without
 * the tree-sitter WASM grammar, so these tests stay fully offline and pure.
 */
function snapshotWith(files: Record<string, string>): RepoSnapshot {
  const snapshot = buildSnapshotFromFileMap(REF, files, { createdAt: NOW });
  const manifests: Manifest[] = parseAllManifests(snapshot);
  snapshot.manifests = manifests;
  return snapshot;
}

/** Assemble a minimal RegistryEntry; overrides tweak the staleness flags. */
function entry(
  name: string,
  latestVersion: string,
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    name,
    latestVersion,
    yanked: false,
    isDeprecated: false,
    py2Only: false,
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Build a RegistryData Map from a list of entries, keyed by (lowercased) name. */
function registry(entries: RegistryEntry[]): RegistryData {
  const map: RegistryData = new Map();
  for (const e of entries) map.set(e.name.toLowerCase(), e);
  return map;
}

/** DetectorOpts bag; Tower only reads registryData, but the shape is complete. */
function opts(registryData?: RegistryData): DetectorOpts {
  const base: DetectorOpts = {
    now: NOW,
    trees: new Map(),
    parseErrors: new Map(),
  };
  // Only attach registryData when present (exactOptionalPropertyTypes is on).
  return registryData === undefined ? base : { ...base, registryData };
}

// --- severity 2, upright: broken dependencies (R6.2) ----------------------

describe("detectTower (R6.2): broken dependencies → severity 2 upright", () => {
  it("draws severity 2 upright for a yanked dependency", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "flask==0.12\n",
    });
    const reg = registry([entry("flask", "0.12", { yanked: true })]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("tower");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("draws severity 2 upright for a deprecated dependency", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "nose==1.3.7\n",
    });
    const reg = registry([entry("nose", "1.3.7", { isDeprecated: true })]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("draws severity 2 upright for a Python 2-only dependency", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "mysql-python==1.2.5\n",
    });
    const reg = registry([entry("mysql-python", "1.2.5", { py2Only: true })]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("draws severity 2 upright when a dependency is >= 2 majors behind", () => {
    // Installed 1.x, latest 3.x → 2 majors behind → broken.
    const snapshot = snapshotWith({
      "requirements.txt": "django==1.11\n",
    });
    const reg = registry([entry("django", "3.2.1")]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("treats leftmost non-zero segment as the major for 0.x versions", () => {
    // Installed 0.1.x, latest 0.3.x → majors (x) differ by 2 → broken.
    const snapshot = snapshotWith({
      "requirements.txt": "tinylib==0.1.0\n",
    });
    const reg = registry([entry("tinylib", "0.3.0")]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("prefers severity 2 upright when both broken and drifted deps exist", () => {
    const snapshot = snapshotWith({
      // requests is yanked (broken); click is unpinned (drifted).
      "requirements.txt": "requests==2.0.0\nclick\n",
    });
    const reg = registry([
      entry("requests", "2.0.0", { yanked: true }),
      entry("click", "8.1.0"),
    ]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- severity 1, reversed: drifted dependencies (R6.3) --------------------

describe("detectTower (R6.3): drifted dependencies → severity 1 reversed", () => {
  it("draws severity 1 reversed for an unpinned dependency", () => {
    // Empty versionSpec (unpinned) and up to date in registry.
    const snapshot = snapshotWith({
      "requirements.txt": "click\n",
    });
    const reg = registry([entry("click", "8.1.0")]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("tower");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("draws severity 1 reversed when a dependency is exactly 1 major behind", () => {
    // Installed 2.x, latest 3.x → exactly 1 major behind → drifted.
    const snapshot = snapshotWith({
      "requirements.txt": "requests==2.28.1\n",
    });
    const reg = registry([entry("requests", "3.0.0")]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });
});

// --- null: clean dependency set (R6.4) ------------------------------------

describe("detectTower (R6.4): clean dependencies → null", () => {
  it("returns null when every dependency is pinned and up to date", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "requests==3.0.0\nclick==8.1.0\n",
    });
    const reg = registry([
      entry("requests", "3.0.0"),
      entry("click", "8.1.0"),
    ]);

    expect(detectTower(snapshot, opts(reg))).toBeNull();
  });
});

// --- R6.7: dependency missing from registryData is skipped ----------------

describe("detectTower (R6.7): dependency absent from registryData is skipped", () => {
  it("does not draw when the only dependency has no registry entry", () => {
    // mysterylib is unpinned, which WOULD be drifted — but it has no registry
    // entry, so it is skipped and must not be treated as a staleness signal.
    const snapshot = snapshotWith({
      "requirements.txt": "mysterylib\n",
    });
    const reg = registry([]); // empty registry

    expect(detectTower(snapshot, opts(reg))).toBeNull();
  });

  it("produces no evidence for a dependency missing from the registry", () => {
    // flask is yanked (broken, drawn); ghostlib has no entry (skipped).
    const snapshot = snapshotWith({
      "requirements.txt": "flask==0.12\nghostlib\n",
    });
    const reg = registry([entry("flask", "0.12", { yanked: true })]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw).not.toBeNull();
    // No evidence should mention the skipped dependency.
    expect(draw?.evidence.some((e) => /ghostlib/i.test(e.detail))).toBe(false);
    // Exactly one affected dependency (flask).
    expect(draw?.evidence).toHaveLength(1);
  });
});

// --- R6.5: evidence carries name / versionSpec / detail -------------------

describe("detectTower (R6.5): evidence records name, versionSpec, detail", () => {
  it("emits one evidence item per affected dependency with the required fields", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "flask==0.12\nnose==1.3.7\n",
    });
    const reg = registry([
      entry("flask", "0.12", { yanked: true }),
      entry("nose", "1.3.7", { isDeprecated: true }),
    ]);

    const draw = detectTower(snapshot, opts(reg));

    expect(draw).not.toBeNull();
    expect(draw?.evidence).toHaveLength(2);
    for (const ev of draw?.evidence ?? []) {
      // name and versionSpec are recorded (per R6.5). They may live on the
      // Evidence as dedicated fields or be embedded in detail; at minimum the
      // dependency name and its versionSpec must be discoverable in the detail.
      expect(typeof ev.detail).toBe("string");
      expect(ev.detail.length).toBeGreaterThan(0);
      expect(ev.source).toBe("registry");
    }
    // The affected dependency names appear across the evidence details.
    const allDetail = (draw?.evidence ?? []).map((e) => e.detail).join(" ");
    expect(allDetail).toMatch(/flask/i);
    expect(allDetail).toMatch(/nose/i);
    // The versionSpec as written is preserved somewhere in the evidence detail.
    expect(allDetail).toContain("0.12");
    expect(allDetail).toContain("1.3.7");
  });
});

// --- R6.1: no dependency manifests → null ---------------------------------

describe("detectTower (R6.1): no dependency manifests → null", () => {
  it("returns null when the snapshot has no manifest files", () => {
    const snapshot = snapshotWith({
      "README.md": "# just docs, no dependencies\n",
      "src/app.py": "print('hi')\n",
    });
    // Sanity: no manifests were parsed.
    expect(snapshot.manifests).toHaveLength(0);

    expect(detectTower(snapshot, opts(registry([])))).toBeNull();
  });

  it("returns null when registryData is entirely absent (undefined)", () => {
    const snapshot = snapshotWith({
      "requirements.txt": "flask==0.12\n",
    });
    // No registryData injected at all → nothing can be looked up → null.
    expect(detectTower(snapshot, opts(undefined))).toBeNull();
  });
});
