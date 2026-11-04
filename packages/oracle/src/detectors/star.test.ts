// src/detectors/star.test.ts
//
// Unit tests (test-first) for detectStar — XVII The Star (Hope and Strengths).
// The implementation (star.ts, task 25.2) is a throwing stub, so these tests
// are EXPECTED RED until that task lands.
//
// Design API (design.md "detectStar — XVII The Star (Hope)"):
//   detectStar: Detector  // (snapshot, opts) => CardDraw | null
//
// Algorithm — compute a strength score 0–5, one point each:
//   1. Valid license file found (same rules as detectJustice R13.1) AND
//      meta.licenseKey is not "NOASSERTION" and not null.
//   2. >= 1 test file (same patterns as detectWheel R9.1: test_*.py, *_test.py,
//      files under a `tests`/`test` dir, *.spec.{ts,tsx,js,jsx}).
//   3. >= 1 CI config file (same rules as detectTemperance R12.1:
//      .github/workflows/<file>.y[a]ml, .travis.yml, .circleci/config.yml,
//      Jenkinsfile, azure-pipelines.yml).
//   4. README whose byte length >= 200 AND contains install / usage /
//      getting started / quickstart (case-insensitive).
//   5. meta.pushedAt is a timestamp no more than 365 days before opts.now
//      (null pushedAt → 0 points for this factor).
//
// Orientation rules:
//   - Score >= 3 → severity 2, upright.      (R15.2)
//   - Score 1 or 2 → severity 1, reversed.   (R15.3)
//   - Score 0 → null.                        (R15.4)
//
// Evidence (R15.5): one item per factor, carrying the factor name, whether it
// contributed (boolean), and the observed value. Uses opts.now only — never
// Date.now().
//
// Covers: R15.1, R15.2, R15.3, R15.4, R15.5

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoMeta, RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { DetectorOpts } from "./types.js";
import { detectStar } from "./star.js";

// --- Fixtures -------------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeefcafe",
  defaultBranch: "main",
};

/** Fixed reference instant — the only clock the detector may consult. */
const NOW = "2026-11-03T12:00:00.000Z";
const MS_PER_DAY = 86_400_000;

/** An ISO timestamp exactly `days` whole days before NOW. */
function daysBeforeNow(days: number): string {
  return new Date(Date.parse(NOW) - days * MS_PER_DAY).toISOString();
}

/** A README that is >= 200 bytes and contains the "usage" keyword. */
const HEALTHY_README =
  "# graveyard\n\n" +
  "A small, resurrected project.\n\n" +
  "## Usage\n\n" +
  "Run the tool against any repository to divine its fate. " +
  "This paragraph exists only to push the README comfortably past the " +
  "two-hundred-byte threshold the Star detector requires before it will " +
  "count the documentation as a strength.\n";

/** The MIT license file body (content is irrelevant; presence + key matter). */
const LICENSE_BODY = "MIT License\n\nPermission is hereby granted...\n";

/** A neutral, schema-valid RepoMeta; overrides tweak individual fields. */
function meta(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    pushedAt: null,
    isArchived: false,
    openIssueCount: 0,
    openPRCount: 0,
    oldestOpenPRAgeDays: null,
    latestReleaseAt: null,
    licenseKey: null,
    ...overrides,
  };
}

/** Build a snapshot from a file map + explicit meta, pinning createdAt to NOW. */
function snapshotWith(
  files: Record<string, string>,
  repoMeta: RepoMeta,
): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, {
    meta: repoMeta,
    createdAt: NOW,
  });
}

/** DetectorOpts bag; Star reads only `now`. */
function opts(now: string = NOW): DetectorOpts {
  return { now, trees: new Map(), parseErrors: new Map() };
}

// Factor file maps, composable into partial-score snapshots.
const LICENSE_FILES = { LICENSE: LICENSE_BODY };
const TEST_FILES = { "tests/test_core.py": "def test_x():\n    assert True\n" };
const CI_FILES = { ".github/workflows/ci.yml": "name: CI\n" };
const README_FILES = { "README.md": HEALTHY_README };

/** Meta that scores the recent-push factor (30 days before NOW). */
const RECENT_PUSH = daysBeforeNow(30);
/** Meta licenseKey that scores the license factor. */
const VALID_LICENSE_KEY = "MIT";

// --- R15.1 / R15.2: all five factors present → score 5 severity 2 upright --

describe("detectStar (R15.1, R15.2): all five strengths → severity 2 upright", () => {
  it("scores 5 and draws severity 2 upright when every factor is present", () => {
    const snapshot = snapshotWith(
      { ...LICENSE_FILES, ...TEST_FILES, ...CI_FILES, ...README_FILES },
      meta({ pushedAt: RECENT_PUSH, licenseKey: VALID_LICENSE_KEY }),
    );

    const draw = detectStar(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("star");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- R15.2: exactly 3 factors → severity 2 upright (boundary) -------------

describe("detectStar (R15.2): score exactly 3 → severity 2 upright", () => {
  it("draws severity 2 upright with license + tests + CI only (no README, old push)", () => {
    const snapshot = snapshotWith(
      { ...LICENSE_FILES, ...TEST_FILES, ...CI_FILES },
      // Old push (> 365 days) and no valid licenseKey-free README: still 3 pts.
      meta({ pushedAt: daysBeforeNow(400), licenseKey: VALID_LICENSE_KEY }),
    );

    const draw = detectStar(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- R15.3: score 1 or 2 → severity 1 reversed ----------------------------

describe("detectStar (R15.3): score 1 or 2 → severity 1 reversed", () => {
  it("draws severity 1 reversed when exactly one factor is present (recent push)", () => {
    // Only the recent-push factor scores; everything else is absent.
    const snapshot = snapshotWith({}, meta({ pushedAt: RECENT_PUSH }));

    const draw = detectStar(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("star");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("draws severity 1 reversed when exactly two factors are present (tests + CI)", () => {
    const snapshot = snapshotWith(
      { ...TEST_FILES, ...CI_FILES },
      meta({ pushedAt: null, licenseKey: null }),
    );

    const draw = detectStar(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });
});

// --- R15.4: score 0 → null ------------------------------------------------

describe("detectStar (R15.4): no strengths → null", () => {
  it("returns null when no factor contributes", () => {
    // No license file / key, no tests, no CI, no README, null pushedAt.
    const snapshot = snapshotWith(
      { "src/app.py": "x = 1\n" },
      meta({ pushedAt: null, licenseKey: null }),
    );

    expect(detectStar(snapshot, opts())).toBeNull();
  });
});

// --- R15.1 (factor 5): null pushedAt contributes 0 ------------------------

describe("detectStar (R15.1): null pushedAt contributes 0 to the score", () => {
  it("does not count the recent-push factor when meta.pushedAt is null", () => {
    // Two scoring factors (tests + CI) → reversed. Adding a null pushedAt must
    // not bump the score; a THIRD point would flip it to upright.
    const snapshot = snapshotWith(
      { ...TEST_FILES, ...CI_FILES },
      meta({ pushedAt: null }),
    );

    const draw = detectStar(snapshot, opts());

    // Still score 2 → reversed (null pushedAt added nothing).
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");

    // The recent-push factor's evidence item reports it did not contribute.
    const pushEvidence = (draw?.evidence ?? []).find((e) =>
      /push/i.test(e.detail) || /push/i.test(e.kind),
    );
    expect(pushEvidence).toBeDefined();
    expect(pushEvidence?.detail.toLowerCase()).toContain("false");
  });

  it("counts the recent-push factor when pushedAt is within 365 days of opts.now", () => {
    // Exactly 365 days → within the window (inclusive) → scores.
    const snapshot = snapshotWith({}, meta({ pushedAt: daysBeforeNow(365) }));

    const draw = detectStar(snapshot, opts());

    // One factor → reversed (recent push alone).
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("does not count a push older than 365 days before opts.now", () => {
    const snapshot = snapshotWith({}, meta({ pushedAt: daysBeforeNow(400) }));

    // Old push is the only potential factor and it does not score → null.
    expect(detectStar(snapshot, opts())).toBeNull();
  });
});

// --- R15.5: one evidence item per factor, with name / contributed / value -

describe("detectStar (R15.5): one evidence item per factor", () => {
  it("emits exactly five evidence items, each naming the factor, a contributed boolean, and an observed value", () => {
    // Mixed scorecard: license (yes), tests (yes), CI (no), README (no),
    // recent push (yes) → score 3 → upright, but evidence must still enumerate
    // all five factors including the ones that did not contribute.
    const snapshot = snapshotWith(
      { ...LICENSE_FILES, ...TEST_FILES },
      meta({ pushedAt: RECENT_PUSH, licenseKey: VALID_LICENSE_KEY }),
    );

    const draw = detectStar(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.evidence).toHaveLength(5);

    // Each evidence item mentions its factor, a contributed boolean, and a
    // value. We assert factor coverage by matching the five factor names and
    // that each item carries a true/false contribution marker.
    const evidence = draw?.evidence ?? [];
    const haystacks = evidence.map((e) =>
      `${e.kind} ${e.detail}`.toLowerCase(),
    );

    const factorMatchers: readonly RegExp[] = [
      /licen[cs]e/, // license factor
      /test/, // test-file factor
      /\bci\b|continuous integration|workflow/, // CI factor
      /readme/, // README factor
      /push/, // recent-push factor
    ];
    for (const matcher of factorMatchers) {
      expect(
        haystacks.some((h) => matcher.test(h)),
        `expected an evidence item matching ${matcher}`,
      ).toBe(true);
    }

    // Every evidence item states whether its factor contributed.
    for (const item of evidence) {
      expect(item.detail.toLowerCase()).toMatch(/\b(true|false)\b/);
    }

    // The contributed factors (license, tests, push) report true; the absent
    // ones (CI, README) report false.
    const trueCount = evidence.filter((e) =>
      /\btrue\b/.test(e.detail.toLowerCase()),
    ).length;
    const falseCount = evidence.filter((e) =>
      /\bfalse\b/.test(e.detail.toLowerCase()),
    ).length;
    expect(trueCount).toBe(3);
    expect(falseCount).toBe(2);
  });
});

// --- opts.now discipline: detector relies on opts.now, never Date.now() ---

describe("detectStar: honours opts.now rather than the system clock", () => {
  it("classifies the recent-push factor relative to opts.now", () => {
    // pushedAt is 365 days before NOW. With opts.now === NOW the push is within
    // the window → the single factor scores → reversed draw. Advancing opts.now
    // far past NOW would make the push age exceed 365 days → factor drops → the
    // only strength vanishes → null, proving opts.now drives the decision.
    const pushedAt = daysBeforeNow(365);
    const snapshot = snapshotWith({}, meta({ pushedAt }));

    // opts.now === NOW: push within 365 days → reversed.
    const nearDraw = detectStar(snapshot, opts(NOW));
    expect(nearDraw?.severity).toBe(1);
    expect(nearDraw?.orientation).toBe("reversed");

    // opts.now a year later: push now ~730 days old → factor drops → null.
    const laterNow = new Date(Date.parse(NOW) + 365 * MS_PER_DAY).toISOString();
    expect(detectStar(snapshot, opts(laterNow))).toBeNull();
  });
});
