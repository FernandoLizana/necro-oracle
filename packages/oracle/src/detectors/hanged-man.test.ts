// src/detectors/hanged-man.test.ts
//
// Unit tests (test-first) for detectHangedMan — XII The Hanged Man
// (Stagnation). The implementation (hanged-man.ts, task 21.2) is a throwing
// stub, so these tests are EXPECTED RED until that task lands.
//
// Design API (design.md "detectHangedMan"):
//   detectHangedMan: Detector  // (snapshot, opts) => CardDraw | null
//
// Algorithm (priority order):
//   1. Validate snapshot.meta against RepoMetaSchema → throw
//      NecroError(INVALID_REPO_META) if invalid.                        (R11.1)
//   2. pushedAtAge = whole days between opts.now and meta.pushedAt
//      (null → infinity).
//   3. meta.isArchived === true                      → severity 2, upright  (R11.2)
//   4. !isArchived && pushedAtAge > 730 && openIssueCount >= 3
//                                                     → severity 2, upright  (R11.3)
//   5. neither upright && ( pushedAtAge in (183,730] OR
//      (openPRCount >= 3 && oldestOpenPRAgeDays >= 180) )
//                                                     → severity 1, reversed (R11.4)
//   6. pushedAtAge <= 183 && !isArchived && openPRCount < 3  → null          (R11.5)
//   Evidence: pushedAt (or "unknown"), isArchived, openIssueCount,
//   openPRCount, computed age in whole days.                             (R11.6)
//   Uses opts.now only — never Date.now().
//
// Covers: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6

import { describe, expect, it } from "vitest";

import { NecroError } from "../util/errors.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoMeta, RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { DetectorOpts } from "./types.js";
import { detectHangedMan } from "./hanged-man.js";

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

/** Build a snapshot carrying an explicit RepoMeta (file map is irrelevant here). */
function snapshotWith(repoMeta: RepoMeta): RepoSnapshot {
  return buildSnapshotFromFileMap(
    REF,
    { "README.md": "# graveyard\n" },
    { meta: repoMeta, createdAt: NOW },
  );
}

/** DetectorOpts bag; Hanged Man reads only `now`. */
function opts(now: string = NOW): DetectorOpts {
  return { now, trees: new Map(), parseErrors: new Map() };
}

// --- R11.2: archived → severity 2 upright ---------------------------------

describe("detectHangedMan (R11.2): archived repo → severity 2 upright", () => {
  it("draws severity 2 upright when meta.isArchived is true", () => {
    const snapshot = snapshotWith(meta({ isArchived: true }));

    const draw = detectHangedMan(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("hanged_man");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("archived takes precedence over the R11.3 upright staleness rule", () => {
    // Also satisfies R11.3 (old push + open issues) and R11.4 (aging PRs), but
    // archived short-circuits to severity 2 upright regardless.
    const snapshot = snapshotWith(
      meta({
        isArchived: true,
        pushedAt: daysBeforeNow(800),
        openIssueCount: 9,
        openPRCount: 5,
        oldestOpenPRAgeDays: 400,
      }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw?.card).toBe("hanged_man");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });
});

// --- R11.3: stale + open issues → severity 2 upright ----------------------

describe("detectHangedMan (R11.3): > 730 days + >= 3 open issues → severity 2 upright", () => {
  it("draws severity 2 upright for an 800-day-old push with 3 open issues", () => {
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt: daysBeforeNow(800),
        openIssueCount: 3,
      }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("does not fire R11.3 when the push is old but open issues are < 3", () => {
    // 800 days old but only 2 open issues → not severity 2; still reversed via
    // the (183, 730] range... except 800 > 730, so range does NOT apply either.
    // With no aging PRs this falls through to null.
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt: daysBeforeNow(800),
        openIssueCount: 2,
        openPRCount: 0,
      }),
    );

    const draw = detectHangedMan(snapshot, opts());

    // Not an upright severity-2 draw (the R11.3 conjunction is unmet).
    expect(draw?.severity).not.toBe(2);
  });
});

// --- R11.4: reversed ranges → severity 1 reversed -------------------------

describe("detectHangedMan (R11.4): slowing activity → severity 1 reversed", () => {
  it("draws severity 1 reversed when pushedAtAge is inside (183, 730]", () => {
    const snapshot = snapshotWith(
      meta({ isArchived: false, pushedAt: daysBeforeNow(365) }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("hanged_man");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("includes 730 days (upper bound inclusive) in the reversed range", () => {
    const snapshot = snapshotWith(
      meta({ isArchived: false, pushedAt: daysBeforeNow(730) }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("draws severity 1 reversed when openPRCount >= 3 && oldestOpenPRAgeDays >= 180", () => {
    // Recent push (within 183 days) so the range branch is inactive; the aging
    // open-PR branch alone drives the reversed draw.
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt: daysBeforeNow(30),
        openPRCount: 3,
        oldestOpenPRAgeDays: 180,
      }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });
});

// --- R11.5: active repo → null --------------------------------------------

describe("detectHangedMan (R11.5): active repo → null", () => {
  it("returns null for a recent push (<= 183 days), not archived, few open PRs", () => {
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt: daysBeforeNow(30),
        openIssueCount: 1,
        openPRCount: 1,
        oldestOpenPRAgeDays: 10,
      }),
    );

    expect(detectHangedMan(snapshot, opts())).toBeNull();
  });

  it("treats the 183-day boundary as still active (lower bound exclusive)", () => {
    // Exactly 183 days → <= 183 → active → null (range is exclusive of 183).
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt: daysBeforeNow(183),
        openPRCount: 0,
      }),
    );

    expect(detectHangedMan(snapshot, opts())).toBeNull();
  });
});

// --- R11.6: evidence fields present ---------------------------------------

describe("detectHangedMan (R11.6): evidence records the stagnation signals", () => {
  it("includes pushedAt, isArchived, open counts, and the computed age", () => {
    const pushedAt = daysBeforeNow(800);
    const snapshot = snapshotWith(
      meta({
        isArchived: false,
        pushedAt,
        openIssueCount: 4,
        openPRCount: 2,
      }),
    );

    const draw = detectHangedMan(snapshot, opts());

    expect(draw).not.toBeNull();
    expect(draw?.evidence.length).toBeGreaterThan(0);

    const allDetail = (draw?.evidence ?? []).map((e) => e.detail).join(" ");
    // The pushedAt value is surfaced.
    expect(allDetail).toContain(pushedAt);
    // The archived flag is reported.
    expect(allDetail.toLowerCase()).toContain("archived");
    // The open counts are reported.
    expect(allDetail).toMatch(/\b4\b/); // openIssueCount
    expect(allDetail).toMatch(/\b2\b/); // openPRCount
    // The computed age in whole days is reported.
    expect(allDetail).toContain("800");
  });

  it('reports "unknown" for pushedAt when it is null (archived draw)', () => {
    const snapshot = snapshotWith(
      meta({ isArchived: true, pushedAt: null }),
    );

    const draw = detectHangedMan(snapshot, opts());

    const allDetail = (draw?.evidence ?? []).map((e) => e.detail).join(" ");
    expect(allDetail.toLowerCase()).toContain("unknown");
  });
});

// --- R11.1: invalid meta → NecroError(INVALID_REPO_META) ------------------

describe("detectHangedMan (R11.1): invalid meta → NecroError(INVALID_REPO_META)", () => {
  it("throws INVALID_REPO_META when meta fails RepoMetaSchema validation", () => {
    const snapshot = snapshotWith(meta({ isArchived: false }));
    // Corrupt the meta after construction: openIssueCount must be a
    // non-negative integer; a negative value fails RepoMetaSchema.
    (snapshot as { meta: unknown }).meta = {
      pushedAt: null,
      isArchived: false,
      openIssueCount: -1,
      openPRCount: 0,
      oldestOpenPRAgeDays: null,
      latestReleaseAt: null,
      licenseKey: null,
    };

    expect(() => detectHangedMan(snapshot, opts())).toThrow(NecroError);
    try {
      detectHangedMan(snapshot, opts());
      expect.unreachable("detectHangedMan should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("INVALID_REPO_META");
    }
  });

  it("throws INVALID_REPO_META when a required meta field is missing", () => {
    const snapshot = snapshotWith(meta());
    // Remove a required field (isArchived) entirely.
    (snapshot as { meta: unknown }).meta = {
      pushedAt: null,
      openIssueCount: 0,
      openPRCount: 0,
      oldestOpenPRAgeDays: null,
      latestReleaseAt: null,
      licenseKey: null,
    };

    try {
      detectHangedMan(snapshot, opts());
      expect.unreachable("detectHangedMan should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("INVALID_REPO_META");
    }
  });
});

// --- opts.now discipline: detector relies on opts.now, never Date.now() ---

describe("detectHangedMan: honours opts.now rather than the system clock", () => {
  it("classifies staleness relative to opts.now, not the real time", () => {
    // pushedAt is 365 days before NOW → reversed under opts.now === NOW.
    const pushedAt = daysBeforeNow(365);
    const snapshot = snapshotWith(meta({ isArchived: false, pushedAt }));

    // Supplying an opts.now EARLIER than pushedAt would make the age tiny or
    // negative, so a detector that respected opts.now (and not Date.now())
    // would classify the repo as active → null. We assert that moving opts.now
    // changes the verdict, proving the detector reads opts.now.
    const activeOpts = opts(pushedAt); // now === pushedAt → age 0 → active
    expect(detectHangedMan(snapshot, activeOpts)).toBeNull();

    // And with opts.now === NOW the same snapshot draws reversed.
    const draw = detectHangedMan(snapshot, opts(NOW));
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });
});
