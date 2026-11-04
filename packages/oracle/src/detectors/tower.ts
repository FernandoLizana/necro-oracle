// src/detectors/tower.ts
//
// The Tower (XVI — Rotting Dependencies) detector.
//
// A pure, synchronous Detector that consumes only `opts.registryData` (no
// network, R6.6/R21.2) and the snapshot's parsed manifests. For each parsed
// dependency across all manifests it looks up the injected registry entry
// (keyed by lowercased name). A dependency is:
//   - broken  if yanked / deprecated / py2-only, OR installed is >= 2 majors
//             behind the latest known release;
//   - drifted if its versionSpec is empty (unpinned) OR exactly 1 major behind.
// A dependency with no registry entry is skipped entirely (R6.7: no evidence,
// not a staleness signal).
//
// Any broken dependency → severity 2, upright. Otherwise any drifted
// dependency → severity 1, reversed. Otherwise → null. One Evidence item per
// affected dependency, source "registry", with detail naming the dependency,
// its versionSpec as written, and the staleness reason.
//
// "major version" = the leftmost non-zero segment: for "1.x.y" major = 1; for
// "0.x.y" major = x.
//
// Covers: R6.1, R6.2, R6.3, R6.4, R6.5, R6.6, R6.7

import type { Evidence } from "../registry/schema.js";
import type { Manifest } from "../parser/manifest.js";
import { getCard } from "../registry/cards.js";
import type { Detector, RegistryEntry } from "./types.js";

/**
 * Extract the leftmost non-zero numeric segment of a version string as its
 * "major" version. "1.2.3" → 1, "0.3.0" → 3, "0.0.5" → 5. Returns null when no
 * non-zero numeric segment is present (e.g. "0", "", or an unparseable spec).
 */
function leftmostNonZeroMajor(version: string): number | null {
  // Pull out dotted numeric segments in order; ignore trailing non-numeric
  // noise (e.g. "1.2.0rc1" → [1, 2, 0]).
  const segments = version.match(/\d+/g);
  if (segments === null) return null;
  for (const seg of segments) {
    const n = Number.parseInt(seg, 10);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

/**
 * Strip leading comparison / compatibility operators from a raw versionSpec and
 * return the bare version number, or null when none is present (unpinned).
 * Handles specifiers like "==1.2", ">=3.0", "~=2.1", "^8.1.0", ">1,<2".
 */
function installedVersionFromSpec(versionSpec: string): string | null {
  const trimmed = versionSpec.trim();
  if (trimmed.length === 0) return null;
  // Take the first version-looking token after any operator characters.
  const match = /\d[\w.]*/.exec(trimmed);
  return match === null ? null : match[0];
}

export const detectTower: Detector = (snapshot, opts) => {
  // R6.1: no dependency manifests → null.
  const manifests = snapshot.manifests as Manifest[];
  if (manifests.length === 0) return null;

  // R6.6: registry freshness is injected; with nothing to look up, nothing can
  // be judged stale.
  const registryData = opts.registryData;
  if (registryData === undefined) return null;

  const brokenEvidence: Evidence[] = [];
  const driftedEvidence: Evidence[] = [];

  for (const manifest of manifests) {
    for (const dep of manifest.dependencies) {
      const normalizedName = dep.name.toLowerCase();
      const entry: RegistryEntry | undefined = registryData.get(normalizedName);
      // R6.7: a dependency absent from the registry is skipped — no evidence.
      if (entry === undefined) continue;

      const specLabel =
        dep.versionSpec.trim().length === 0 ? "(unpinned)" : dep.versionSpec;

      // --- broken checks (R6.2) ---
      if (entry.yanked) {
        brokenEvidence.push(
          towerEvidence(`${dep.name} ${specLabel} is yanked from the registry`),
        );
        continue;
      }
      if (entry.isDeprecated) {
        brokenEvidence.push(
          towerEvidence(`${dep.name} ${specLabel} is deprecated`),
        );
        continue;
      }
      if (entry.py2Only) {
        brokenEvidence.push(
          towerEvidence(`${dep.name} ${specLabel} is Python 2-only`),
        );
        continue;
      }

      // --- major version comparison ---
      const installed = installedVersionFromSpec(dep.versionSpec);
      const installedMajor =
        installed === null ? null : leftmostNonZeroMajor(installed);
      const latestMajor = leftmostNonZeroMajor(entry.latestVersion);

      if (installedMajor !== null && latestMajor !== null) {
        const behind = latestMajor - installedMajor;
        if (behind >= 2) {
          // >= 2 majors behind → broken (R6.2).
          brokenEvidence.push(
            towerEvidence(
              `${dep.name} ${specLabel} is ${behind} major versions behind ${entry.latestVersion}`,
            ),
          );
          continue;
        }
        if (behind === 1) {
          // exactly 1 major behind → drifted (R6.3).
          driftedEvidence.push(
            towerEvidence(
              `${dep.name} ${specLabel} is 1 major version behind ${entry.latestVersion}`,
            ),
          );
          continue;
        }
      }

      // --- unpinned → drifted (R6.3) ---
      if (dep.versionSpec.trim().length === 0) {
        driftedEvidence.push(
          towerEvidence(`${dep.name} (unpinned) has no version constraint`),
        );
        continue;
      }

      // Otherwise the dependency is clean — no evidence.
    }
  }

  const card = getCard("tower");

  // R6.2/R6.4: any broken → severity 2 upright.
  if (brokenEvidence.length > 0) {
    return {
      card: "tower",
      severity: 2,
      orientation: "upright",
      evidence: brokenEvidence,
      summary: `${brokenEvidence.length} broken or abandoned ${
        brokenEvidence.length === 1 ? "dependency" : "dependencies"
      }`,
      grimoires: [...card.linkedGrimoireIds],
    };
  }

  // R6.3: any drifted (and none broken) → severity 1 reversed.
  if (driftedEvidence.length > 0) {
    return {
      card: "tower",
      severity: 1,
      orientation: "reversed",
      evidence: driftedEvidence,
      summary: `${driftedEvidence.length} drifting ${
        driftedEvidence.length === 1 ? "dependency" : "dependencies"
      }`,
      grimoires: [...card.linkedGrimoireIds],
    };
  }

  // R6.4: clean → null.
  return null;
};

/**
 * Build a single Tower Evidence item for an affected dependency (R6.5). The
 * dependency name and its versionSpec as written are embedded in `detail`.
 */
function towerEvidence(detail: string): Evidence {
  return {
    kind: "stale-dependency",
    detail,
    source: "registry",
  };
}
