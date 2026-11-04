// src/detectors/justice.test.ts
//
// Unit tests (test-first) for detectJustice — XI The Justice (Missing License).
// The implementation (justice.ts, task 23.2) is a throwing stub, so these tests
// are EXPECTED RED until that task lands.
//
// Design API (design.md "detectJustice — XI The Justice (Missing License)"):
//   detectJustice: Detector  // (snapshot, opts) => CardDraw | null
//
// Detection algorithm (design.md / R13.1–R13.6):
//   1. Scan for license files at the repo ROOT only (no "/" in the path),
//      matching filenames case-insensitively against:
//        license, license.md, license.txt, license.rst,
//        copying, copying.md, unlicense.
//   2. Count DISTINCT matching filenames.
//   3. Read snapshot.meta.licenseKey (SPDX id, "NOASSERTION", or null).
//   4. Rules (R13.3 takes PRECEDENCE over R13.2 and R13.5):
//        - licenseKey is "NOASSERTION" or null  → severity 2 upright
//          (regardless of whether license files exist).
//        - licenseKey valid + 0 license files   → severity 2 upright.
//        - licenseKey valid + exactly 1 file     → null.
//        - licenseKey valid + > 1 distinct files → severity 1 reversed.
//   Evidence (R13.6): reports ONLY the detected license file paths (relative to
//   the repo root) and the observed licenseKey value. It never proposes,
//   selects, or suggests any specific license.
//
// DetectorOpts fields used: none (Justice reads only snapshot.files +
// snapshot.meta.licenseKey).
//
// Covers: R13.1, R13.2, R13.3, R13.4, R13.5, R13.6

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoMeta, RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { DetectorOpts } from "./types.js";
import { detectJustice } from "./justice.js";

// --- Fixtures -------------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeefcafe",
  defaultBranch: "main",
};

const NOW = "2026-11-03T12:00:00.000Z";

/** A neutral RepoMeta with an overridable licenseKey. */
function metaWithLicenseKey(licenseKey: string | null): RepoMeta {
  return {
    pushedAt: null,
    isArchived: false,
    openIssueCount: 0,
    openPRCount: 0,
    oldestOpenPRAgeDays: null,
    latestReleaseAt: null,
    licenseKey,
  };
}

/** Build a snapshot from a file map with an explicit licenseKey in meta. */
function snapshotWith(
  files: Record<string, string>,
  licenseKey: string | null,
): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, {
    meta: metaWithLicenseKey(licenseKey),
    createdAt: NOW,
  });
}

/** DetectorOpts bag; Justice uses none of these, but the shape is complete. */
function opts(): DetectorOpts {
  return {
    now: NOW,
    trees: new Map(),
    parseErrors: new Map(),
  };
}

/**
 * Assert that no evidence item proposes/suggests/recommends a specific license
 * (R13.6). Evidence may only report detected paths and the observed key.
 */
function expectNoLicenseSuggestion(
  evidence: ReadonlyArray<{ kind: string; detail: string }>,
): void {
  for (const ev of evidence) {
    const text = `${ev.kind} ${ev.detail}`.toLowerCase();
    expect(text).not.toMatch(/suggest|recommend|propose|should (?:use|add)|choose a license/);
  }
}

// --- R13.3: licenseKey NOASSERTION / null → severity 2 upright (PRECEDENCE) --

describe("detectJustice (R13.3): NOASSERTION/null key → severity 2 upright (precedence)", () => {
  it("draws severity 2 upright when licenseKey is 'NOASSERTION' EVEN with a LICENSE file present", () => {
    // Precedence: an ambiguous key wins over the presence of a license file,
    // which would otherwise be exactly-one → null.
    const snapshot = snapshotWith(
      { LICENSE: "MIT License\n\nCopyright...\n", "src/app.py": "print('hi')\n" },
      "NOASSERTION",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("justice");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("draws severity 2 upright when licenseKey is null (no key observed)", () => {
    const snapshot = snapshotWith(
      { "README.md": "# project\n", "src/app.py": "print('hi')\n" },
      null,
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("justice");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("draws severity 2 upright when licenseKey is null even with TWO distinct license files", () => {
    // The null key takes precedence over the >1-file reversed case (R13.5).
    const snapshot = snapshotWith(
      { LICENSE: "...\n", COPYING: "...\n" },
      null,
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- R13.2: no license file + valid key → severity 2 upright --------------

describe("detectJustice (R13.2): valid key + no license file → severity 2 upright", () => {
  it("draws severity 2 upright when a valid SPDX key is observed but no license file exists", () => {
    const snapshot = snapshotWith(
      { "README.md": "# project\n", "src/app.py": "print('hi')\n" },
      "MIT",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("justice");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("does NOT treat a nested license-like path as a root license file", () => {
    // R13.1: only files at the repo root (no "/" in the path) count. A nested
    // docs/LICENSE must be ignored, so with a valid key this is the no-file
    // case → severity 2 upright.
    const snapshot = snapshotWith(
      { "docs/LICENSE": "MIT License\n", "src/app.py": "print('hi')\n" },
      "MIT",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- R13.4: exactly 1 license file + valid key → null ---------------------

describe("detectJustice (R13.4): valid key + exactly one license file → null", () => {
  it("returns null when a single root LICENSE file is present and the key is valid", () => {
    const snapshot = snapshotWith(
      { LICENSE: "MIT License\n\nCopyright...\n", "src/app.py": "print('hi')\n" },
      "MIT",
    );

    expect(detectJustice(snapshot, opts())).toBeNull();
  });

  it("matches license filenames case-insensitively (R13.1) — 'License.TXT' counts", () => {
    const snapshot = snapshotWith(
      { "License.TXT": "MIT License\n" },
      "MIT",
    );

    expect(detectJustice(snapshot, opts())).toBeNull();
  });

  it("recognises 'unlicense' as a license file (single match → null with valid key)", () => {
    const snapshot = snapshotWith(
      { UNLICENSE: "This is free and unencumbered software...\n" },
      "Unlicense",
    );

    expect(detectJustice(snapshot, opts())).toBeNull();
  });
});

// --- R13.5: > 1 distinct license file + valid key → severity 1 reversed ---

describe("detectJustice (R13.5): valid key + more than one distinct license file → severity 1 reversed", () => {
  it("draws severity 1 reversed for a LICENSE + COPYING pair with a valid key", () => {
    const snapshot = snapshotWith(
      { LICENSE: "MIT License\n", COPYING: "GPL text\n", "src/app.py": "print('hi')\n" },
      "MIT",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("justice");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });
});

// --- R13.6: evidence reports only detected paths + observed key -----------

describe("detectJustice (R13.6): evidence reports only detected paths + observed key; never suggests a license", () => {
  it("surfaces each detected license path and the observed key, with no license suggestion (reversed case)", () => {
    const snapshot = snapshotWith(
      { LICENSE: "MIT License\n", COPYING: "GPL text\n" },
      "MIT",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    const evidence = draw?.evidence ?? [];
    // Every evidence item reports a static source.
    for (const ev of evidence) {
      expect(ev.source).toBe("static");
    }

    // Detected license paths are surfaced (via Evidence.path or detail).
    const haystack = evidence
      .map((e) => `${e.path ?? ""} ${e.detail}`)
      .join(" ");
    expect(haystack).toMatch(/LICENSE/);
    expect(haystack).toMatch(/COPYING/);

    // The observed key value is reported somewhere in the evidence.
    expect(haystack).toMatch(/MIT/);

    // R13.6: never proposes/suggests a specific license.
    expectNoLicenseSuggestion(evidence);
  });

  it("reports the observed key and never suggests a license in the missing-license case", () => {
    const snapshot = snapshotWith(
      { "README.md": "# project\n" },
      "NOASSERTION",
    );

    const draw = detectJustice(snapshot, opts());

    expect(draw).not.toBeNull();
    const evidence = draw?.evidence ?? [];
    const haystack = evidence
      .map((e) => `${e.path ?? ""} ${e.detail}`)
      .join(" ");

    // The ambiguous key value is surfaced as the observed signal.
    expect(haystack).toMatch(/NOASSERTION/);
    // No detected license path should be reported (none exist at root).
    expect(haystack).not.toMatch(/LICENSE|COPYING|UNLICENSE/i);

    expectNoLicenseSuggestion(evidence);
  });
});
