// src/detectors/star.ts
//
// XVII — The Star (Hope and Strengths) detector.
//
// A pure, synchronous Detector that counts a repository's surviving virtues.
// It computes a strength score 0–5 (one point per factor) from the snapshot's
// files, contents and meta, judged against `opts.now` (never the system clock):
//
//   1. A valid root license file (same rule as detectJustice R13.1) AND
//      meta.licenseKey is neither "NOASSERTION" nor null.
//   2. >= 1 test file (same patterns as detectWheel R9.1).
//   3. >= 1 CI config file (same rules as detectTemperance R12.1).
//   4. A root README whose UTF-8 byte length >= 200 AND which mentions
//      install / usage / getting started / quickstart (case-insensitive).
//   5. meta.pushedAt is no more than 365 whole days before opts.now
//      (null pushedAt contributes 0; 365 days exactly still scores).
//
// Orientation rules:
//   - Score >= 3 → severity 2, upright.      (R15.2)
//   - Score 1 or 2 → severity 1, reversed.   (R15.3)
//   - Score 0 → null.                        (R15.4)
//
// Evidence (R15.5): EXACTLY one item per factor (five total, even when the card
// is drawn), each naming the factor, carrying a "true"/"false" contributed
// literal in its detail, and reporting the observed value. Source "static".
//
// DetectorOpts fields used: `now`.
//
// Covers: R15.1, R15.2, R15.3, R15.4, R15.5

import type { CardDraw, Evidence } from "../registry/schema.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

/** Inclusive recency window for the push factor, in whole days (R15.1 factor 5). */
const MAX_PUSH_AGE_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/** Minimum README size, in UTF-8 bytes, before it counts as a strength. */
const MIN_README_BYTES = 200;

// --- factor 1: valid root license file (detectJustice R13.1) --------------

/** Root-only, case-insensitive license filenames (matches detectJustice R13.1). */
const LICENSE_NAMES: readonly string[] = [
  "license",
  "license.md",
  "license.txt",
  "license.rst",
  "copying",
  "copying.md",
  "unlicense",
];

/** True when a path has no "/" — i.e. it lives at the repository root. */
function isRootPath(path: string): boolean {
  return !path.includes("/");
}

/**
 * A license strength requires BOTH a root license file (R13.1 rule) AND a
 * licenseKey that is neither "NOASSERTION" nor null.
 */
function hasValidLicense(snapshot: RepoSnapshot): boolean {
  const key = snapshot.meta.licenseKey;
  if (key === null || key === "NOASSERTION") return false;
  return snapshot.files.some(
    (file) =>
      isRootPath(file.path) && LICENSE_NAMES.includes(file.path.toLowerCase()),
  );
}

// --- factor 2: >= 1 test file (detectWheel R9.1) --------------------------

function filenameLooksLikeTest(path: string): boolean {
  const slash = path.lastIndexOf("/");
  const filename = slash === -1 ? path : path.slice(slash + 1);
  if (/^test_.+\.py$/.test(filename)) return true;
  if (/.+_test\.py$/.test(filename)) return true;
  if (/.+\.spec\.(ts|tsx|js|jsx)$/.test(filename)) return true;
  return false;
}

function parentDirIsTests(path: string): boolean {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return false;
  const dirPath = path.slice(0, slash);
  const parentSlash = dirPath.lastIndexOf("/");
  const parentSegment =
    parentSlash === -1 ? dirPath : dirPath.slice(parentSlash + 1);
  return parentSegment === "tests" || parentSegment === "test";
}

function isTestFile(path: string): boolean {
  return filenameLooksLikeTest(path) || parentDirIsTests(path);
}

// --- factor 3: >= 1 CI config file (detectTemperance R12.1) ---------------

function isCiConfigPath(path: string): boolean {
  // GitHub Actions: exactly `.github/workflows/<file>` with a YAML extension.
  const segments = path.split("/");
  if (
    segments.length === 3 &&
    segments[0] === ".github" &&
    segments[1] === "workflows" &&
    /\.ya?ml$/i.test(segments[2] ?? "")
  ) {
    return true;
  }
  if (path === ".travis.yml" || path === ".travis.yaml") return true;
  if (path === ".circleci/config.yml") return true;
  if (path === "Jenkinsfile") return true;
  if (path === "azure-pipelines.yml") return true;
  return false;
}

// --- factor 4: healthy root README ----------------------------------------

/** Case-insensitive root README filenames we recognise. */
const README_NAMES: readonly string[] = [
  "readme",
  "readme.md",
  "readme.rst",
  "readme.txt",
  "readme.adoc",
];

/** Documentation keywords a healthy README is expected to contain. */
const README_KEYWORDS: readonly string[] = [
  "install",
  "usage",
  "getting started",
  "quickstart",
];

function findRootReadme(snapshot: RepoSnapshot): string | undefined {
  const matches = snapshot.files
    .map((file) => file.path)
    .filter(
      (path) => isRootPath(path) && README_NAMES.includes(path.toLowerCase()),
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return matches[0];
}

/** True when a root README exists with >= 200 bytes AND a doc keyword. */
function hasHealthyReadme(snapshot: RepoSnapshot): boolean {
  const readmePath = findRootReadme(snapshot);
  if (readmePath === undefined) return false;
  const content = snapshot.contents.get(readmePath) ?? "";
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength < MIN_README_BYTES) return false;
  const lower = content.toLowerCase();
  return README_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// --- factor 5: recent push (relative to opts.now) -------------------------

/**
 * True when meta.pushedAt is a parseable timestamp no more than 365 whole days
 * before `now`. Null (or unparseable) pushedAt contributes 0. The comparison
 * uses `now` only — never Date.now().
 */
function hasRecentPush(snapshot: RepoSnapshot, now: string): boolean {
  const pushedAt = snapshot.meta.pushedAt;
  if (pushedAt === null) return false;
  const pushedMs = Date.parse(pushedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(pushedMs) || Number.isNaN(nowMs)) return false;
  const ageDays = (nowMs - pushedMs) / MS_PER_DAY;
  return ageDays <= MAX_PUSH_AGE_DAYS;
}

// --- detector -------------------------------------------------------------

export const detectStar: Detector = (
  snapshot: RepoSnapshot,
  opts,
): CardDraw | null => {
  // Evaluate each factor and capture its observed value for evidence.
  const licenseContributed = hasValidLicense(snapshot);
  const observedLicense =
    snapshot.meta.licenseKey === null
      ? "null"
      : String(snapshot.meta.licenseKey);

  const testContributed = snapshot.files.some((f) => isTestFile(f.path));
  const testCount = snapshot.files.filter((f) => isTestFile(f.path)).length;

  const ciContributed = snapshot.files.some((f) => isCiConfigPath(f.path));
  const ciCount = snapshot.files.filter((f) => isCiConfigPath(f.path)).length;

  const readmeContributed = hasHealthyReadme(snapshot);
  const readmePath = findRootReadme(snapshot);
  const readmeBytes =
    readmePath === undefined
      ? 0
      : Buffer.byteLength(snapshot.contents.get(readmePath) ?? "", "utf8");

  const pushContributed = hasRecentPush(snapshot, opts.now);
  const observedPush = snapshot.meta.pushedAt ?? "null";

  const score =
    (licenseContributed ? 1 : 0) +
    (testContributed ? 1 : 0) +
    (ciContributed ? 1 : 0) +
    (readmeContributed ? 1 : 0) +
    (pushContributed ? 1 : 0);

  // EXACTLY one evidence item per factor (five total), each naming the factor,
  // a "true"/"false" contributed literal, and the observed value (R15.5).
  const evidence: Evidence[] = [
    {
      kind: "strength:license",
      detail: `license: contributed=${licenseContributed}; observed licenseKey=${observedLicense}`,
      source: "static",
    },
    {
      kind: "strength:tests",
      detail: `tests: contributed=${testContributed}; observed test file count=${testCount}`,
      source: "static",
    },
    {
      kind: "strength:ci",
      detail: `ci: contributed=${ciContributed}; observed CI config count=${ciCount}`,
      source: "static",
    },
    {
      kind: "strength:readme",
      detail: `readme: contributed=${readmeContributed}; observed README byte length=${readmeBytes}`,
      source: "static",
    },
    {
      kind: "strength:push",
      detail: `recent push: contributed=${pushContributed}; observed pushedAt=${observedPush}`,
      source: "static",
    },
  ];

  // R15.4: no strengths → the Star does not rise → null.
  if (score === 0) return null;

  // R15.2: score >= 3 → severity 2 upright. R15.3: score 1 or 2 → severity 1 reversed.
  if (score >= 3) {
    return {
      card: "star",
      severity: 2,
      orientation: "upright",
      evidence,
      summary: `The Star rises: ${score} of five strengths endure in this repository.`,
      grimoires: [],
    };
  }

  return {
    card: "star",
    severity: 1,
    orientation: "reversed",
    evidence,
    summary: `The Star flickers faintly: only ${score} of five strengths remain.`,
    grimoires: [],
  };
};
