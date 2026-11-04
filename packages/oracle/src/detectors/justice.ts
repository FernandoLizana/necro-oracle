// src/detectors/justice.ts
//
// XI — The Justice (Missing License) detector.
//
// A pure, synchronous Detector that assesses whether a repository is legally
// usable. It reads only `snapshot.files` (to find license files at the repo
// root) and `snapshot.meta.licenseKey` (the SPDX identifier, "NOASSERTION", or
// null observed from the GitHub license API). It never network/WASM/sandbox
// calls, and it NEVER proposes, selects, or suggests a specific license — the
// owner alone chooses the law that governs their code.
//
// See design.md ("detectJustice — XI The Justice (Missing License)") and
// requirements R13.1–R13.6:
//   R13.1 scan for license files at the repo ROOT only (no "/" in path),
//         matching filenames case-insensitively against: license, license.md,
//         license.txt, license.rst, copying, copying.md, unlicense.
//   R13.2 no license file + valid key → severity 2 upright.
//   R13.3 licenseKey "NOASSERTION" or null (regardless of files) → severity 2
//         upright; R13.3 takes PRECEDENCE over R13.2 and R13.5.
//   R13.4 exactly one license file + valid key → null.
//   R13.5 > 1 distinct license file + valid key → severity 1 reversed.
//   R13.6 evidence reports ONLY the detected license file paths (relative to
//         the repo root) and the observed licenseKey value; never suggests a
//         license.
//
// `DetectorOpts` fields used: none.

import type { CardDraw, Evidence } from "../registry/schema.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

/**
 * Recognised root license filenames (R13.1), lower-cased for case-insensitive
 * matching. Matching is done against the full path, which must contain no
 * directory separator (root only).
 */
const LICENSE_FILENAMES: ReadonlySet<string> = new Set([
  "license",
  "license.md",
  "license.txt",
  "license.rst",
  "copying",
  "copying.md",
  "unlicense",
]);

/**
 * Collect the distinct license file paths at the repository root, in the order
 * they first appear in `snapshot.files`. A path counts only if it has no
 * directory separator (root only, R13.1) and its lower-cased form is one of the
 * recognised license filenames. Distinctness is by the original path string.
 */
function collectRootLicensePaths(snapshot: RepoSnapshot): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const file of snapshot.files) {
    const { path } = file;
    if (path.includes("/")) {
      continue; // not at the repo root
    }
    if (!LICENSE_FILENAMES.has(path.toLowerCase())) {
      continue; // not a recognised license filename
    }
    if (seen.has(path)) {
      continue; // already counted this exact path
    }
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * The observed-key evidence detail, surfacing the raw `licenseKey` value.
 *
 * The `detail` text deliberately avoids the substring "license" so that, in the
 * missing-license case, evidence surfaces ONLY the observed key value and no
 * phantom "LICENSE" path (R13.6). The key value itself is reported verbatim.
 */
function keyEvidence(licenseKey: string | null): Evidence {
  const observed = licenseKey === null ? "null" : licenseKey;
  return {
    kind: "spdx-key",
    detail: `observed SPDX key: ${observed}`,
    source: "static",
  };
}

/** One evidence item per detected license file path (R13.6). */
function pathEvidence(paths: readonly string[]): Evidence[] {
  return paths.map((path) => ({
    kind: "license-file",
    path,
    detail: `license file at repository root: ${path}`,
    source: "static",
  }));
}

export const detectJustice: Detector = (
  snapshot: RepoSnapshot,
): CardDraw | null => {
  const licenseKey = snapshot.meta.licenseKey;
  const licensePaths = collectRootLicensePaths(snapshot);

  const keyIsAmbiguous = licenseKey === null || licenseKey === "NOASSERTION";

  // R13.3 (PRECEDENCE): an ambiguous key — "NOASSERTION" or null — draws
  // severity 2 upright regardless of whether license files are present.
  if (keyIsAmbiguous) {
    return {
      card: "justice",
      severity: 2,
      orientation: "upright",
      evidence: [keyEvidence(licenseKey), ...pathEvidence(licensePaths)],
      summary:
        "No law governs this code. The observed license key is " +
        `${licenseKey === null ? "absent (null)" : "'NOASSERTION'"}, so the ` +
        "repository has no clear, usable license.",
      grimoires: [],
    };
  }

  // From here the key is a valid SPDX identifier (not null, not NOASSERTION).

  // R13.2: a valid key but no license file at the root → severity 2 upright.
  if (licensePaths.length === 0) {
    return {
      card: "justice",
      severity: 2,
      orientation: "upright",
      evidence: [keyEvidence(licenseKey)],
      summary:
        "No law governs this code. A license key " +
        `('${licenseKey}') is claimed, but no license file sits at the ` +
        "repository root.",
      grimoires: [],
    };
  }

  // R13.4: a valid key and exactly one license file → the law is clear → null.
  if (licensePaths.length === 1) {
    return null;
  }

  // R13.5: a valid key but more than one distinct license file → the law is
  // written in conflicting tongues → severity 1 reversed.
  return {
    card: "justice",
    severity: 1,
    orientation: "reversed",
    evidence: [keyEvidence(licenseKey), ...pathEvidence(licensePaths)],
    summary:
      "The law is written in two tongues. A license key " +
      `('${licenseKey}') is claimed, but ${licensePaths.length} distinct ` +
      "license files were found at the repository root: " +
      `${licensePaths.join(", ")}.`,
    grimoires: [],
  };
};
