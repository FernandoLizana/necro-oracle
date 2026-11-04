// src/detectors/temperance.test.ts
//
// Unit tests (test-first) for detectTemperance — XIV The Temperance (No CI /
// Dead CI). The implementation (temperance.ts, task 22.2) is a throwing stub,
// so these tests are EXPECTED RED until that task lands.
//
// Design API (design.md "detectTemperance"):
//   detectTemperance: Detector  // (snapshot, opts) => CardDraw | null
//
// Detection algorithm (design.md / R12.1–R12.5):
//   1. Scan for CI configuration files:
//        - GitHub Actions: any .yml / .yaml directly under .github/workflows/
//          (path depth check: EXACTLY 3 segments — .github/workflows/<file>;
//          anything nested deeper does NOT count).
//        - Travis CI: .travis.yml or .travis.yaml at repo root.
//        - CircleCI: .circleci/config.yml
//        - Jenkins: Jenkinsfile at repo root
//        - Azure Pipelines: azure-pipelines.yml at repo root
//   2. Classify each found file by provider.
//   3. Rules:
//        - No CI files at all          → severity 2, upright, single
//          kind:"no-ci-found" evidence item.
//        - Only Travis files (no other provider) → severity 1, reversed.
//        - >= 1 non-Travis provider present → null.
//   Evidence: one item per detected CI path annotated with its provider name
//   ("github-actions", "travis-ci", "circleci", "jenkins", "azure-pipelines").
//
// DetectorOpts fields used: none (Temperance reads only the snapshot's files).
//
// Covers: R12.1, R12.2, R12.3, R12.4, R12.5

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { DetectorOpts } from "./types.js";
import { detectTemperance } from "./temperance.js";

// --- Fixtures -------------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeefcafe",
  defaultBranch: "main",
};

const NOW = "2026-11-03T12:00:00.000Z";

/** Build a snapshot from a plain file map (contents are irrelevant to CI detection). */
function snapshotWith(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { createdAt: NOW });
}

/** DetectorOpts bag; Temperance uses none of these, but the shape is complete. */
function opts(): DetectorOpts {
  return {
    now: NOW,
    trees: new Map(),
    parseErrors: new Map(),
  };
}

// --- R12.2: no CI files → severity 2 upright, kind:"no-ci-found" ----------

describe("detectTemperance (R12.2, R12.5): no CI → severity 2 upright", () => {
  it("draws severity 2 upright with a single kind:'no-ci-found' evidence item", () => {
    const snapshot = snapshotWith({
      "README.md": "# project\n",
      "src/app.py": "print('hi')\n",
      "requirements.txt": "flask\n",
    });

    const draw = detectTemperance(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("temperance");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");

    // Exactly one evidence item, with kind "no-ci-found" and the canonical
    // detail from R12.5.
    expect(draw?.evidence).toHaveLength(1);
    const ev = draw?.evidence[0];
    expect(ev?.kind).toBe("no-ci-found");
    expect(ev?.detail).toBe("no CI configuration detected");
  });

  it("treats a file nested deeper than one level under .github/workflows/ as NOT GitHub Actions", () => {
    // .github/workflows/sub/x.yml is TWO levels under workflows/ → not a CI
    // file (R12.1 depth check: exactly .github/workflows/<file>). With no other
    // CI present, this is a no-CI repo → severity 2 upright.
    const snapshot = snapshotWith({
      ".github/workflows/sub/x.yml": "name: nested\n",
      "src/app.py": "print('hi')\n",
    });

    const draw = detectTemperance(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
    expect(draw?.evidence).toHaveLength(1);
    expect(draw?.evidence[0]?.kind).toBe("no-ci-found");
  });

  it("does not treat a repo with zero files as having CI", () => {
    const snapshot = snapshotWith({});

    const draw = detectTemperance(snapshot, opts());

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
    expect(draw?.evidence[0]?.kind).toBe("no-ci-found");
  });
});

// --- R12.3: Travis-only → severity 1 reversed -----------------------------

describe("detectTemperance (R12.3, R12.5): Travis-only → severity 1 reversed", () => {
  it("draws severity 1 reversed when only .travis.yml is present", () => {
    const snapshot = snapshotWith({
      ".travis.yml": "language: python\n",
      "src/app.py": "print('hi')\n",
    });

    const draw = detectTemperance(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("temperance");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");

    // Evidence lists the Travis path annotated with the travis-ci provider name.
    expect(draw?.evidence).toHaveLength(1);
    const ev = draw?.evidence[0];
    expect(ev?.path).toBe(".travis.yml");
    const annotation = `${ev?.kind ?? ""} ${ev?.detail ?? ""}`;
    expect(annotation).toMatch(/travis-ci/);
  });

  it("also recognises the .travis.yaml spelling as Travis", () => {
    const snapshot = snapshotWith({
      ".travis.yaml": "language: python\n",
    });

    const draw = detectTemperance(snapshot, opts());

    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
    expect(draw?.evidence[0]?.path).toBe(".travis.yaml");
  });
});

// --- R12.4: any non-Travis provider → null --------------------------------

describe("detectTemperance (R12.4): any non-Travis provider → null", () => {
  it("returns null when a GitHub Actions workflow is present (exactly one level deep)", () => {
    const snapshot = snapshotWith({
      ".github/workflows/ci.yml": "name: ci\n",
      "src/app.py": "print('hi')\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });

  it("recognises a .yaml GitHub Actions workflow directly under workflows/", () => {
    const snapshot = snapshotWith({
      ".github/workflows/release.yaml": "name: release\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });

  it("returns null for CircleCI config", () => {
    const snapshot = snapshotWith({
      ".circleci/config.yml": "version: 2.1\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });

  it("returns null for a root Jenkinsfile", () => {
    const snapshot = snapshotWith({
      Jenkinsfile: "pipeline {}\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });

  it("returns null for an Azure Pipelines file", () => {
    const snapshot = snapshotWith({
      "azure-pipelines.yml": "trigger: main\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });

  it("returns null when Travis AND a non-Travis provider coexist (non-Travis wins)", () => {
    // R12.4: at least one non-Travis file present → null, regardless of Travis.
    const snapshot = snapshotWith({
      ".travis.yml": "language: python\n",
      ".github/workflows/ci.yml": "name: ci\n",
    });

    expect(detectTemperance(snapshot, opts())).toBeNull();
  });
});

// --- R12.5: evidence lists paths + provider names -------------------------

describe("detectTemperance (R12.5): evidence lists paths + provider names", () => {
  it("emits one evidence item per detected CI path with its provider name", () => {
    // Two Travis-root spellings is unusual, so exercise multiple Travis files to
    // confirm one evidence item per detected path. Both are Travis, so this is
    // still Travis-only → severity 1 reversed.
    const snapshot = snapshotWith({
      ".travis.yml": "language: python\n",
      ".travis.yaml": "language: python\n",
    });

    const draw = detectTemperance(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
    expect(draw?.evidence).toHaveLength(2);

    const paths = (draw?.evidence ?? []).map((e) => e.path).sort();
    expect(paths).toEqual([".travis.yaml", ".travis.yml"]);

    // Every evidence item carries the travis-ci provider annotation somewhere
    // discoverable (kind or detail) and reports a static source.
    for (const ev of draw?.evidence ?? []) {
      const annotation = `${ev.kind} ${ev.detail}`;
      expect(annotation).toMatch(/travis-ci/);
      expect(ev.source).toBe("static");
    }
  });
});
