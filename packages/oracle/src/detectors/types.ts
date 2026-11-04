// src/detectors/types.ts
//
// Shared types for the snapshot detectors (the detectors barrel). Every
// detector is a pure, synchronous function that receives a RepoSnapshot plus
// the DetectorOpts bag of injected data and pre-parsed trees, and returns a
// CardDraw or null. Detectors never perform network, WASM, or sandbox calls —
// all external data (registry freshness, OSV vulnerabilities, repo meta, and
// the pre-parsed tree-sitter trees) arrives through `opts`.

import type { Tree } from "../parser/tree-sitter.js";
import type { NecroError } from "../util/errors.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { CardDraw } from "../registry/schema.js";

// ============================================================
// Registry data and OSV data shapes
// ------------------------------------------------------------
// These shapes are produced by adapter packages and injected into the oracle
// as parameters. The oracle package defines only the minimal shape it needs.
// ============================================================

/** Pre-fetched dependency freshness from PyPI/npm, consumed by the Tower detector. */
export interface RegistryEntry {
  name: string;
  latestVersion: string; // latest published version string
  yanked: boolean; // package is yanked/deprecated
  isDeprecated: boolean;
  py2Only: boolean; // only supports Python 2 per classifiers
  publishedAt: string; // ISO 8601 UTC
}

/** Pre-fetched registry data, keyed by normalized package name. */
export type RegistryData = Map<string, RegistryEntry>;

/** Pre-fetched vulnerability record, consumed by the Devil detector. */
export interface OsvVulnerability {
  id: string; // CVE or GHSA id
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  affectedPackage: string;
  affectedVersionRange: string;
}

/** Pre-fetched OSV vulnerabilities. */
export type OsvData = OsvVulnerability[];

// ============================================================
// Shared opts type passed to every detector
// ============================================================

export interface DetectorOpts {
  registryData?: RegistryData; // Tower detector
  osvData?: OsvData; // Devil detector
  now: string; // ISO 8601 UTC — time-sensitive detectors (Hanged Man, Star)
  trees: ReadonlyMap<string, Tree>; // Pre-parsed trees: path → Tree, for all .py files
  parseErrors: ReadonlyMap<string, NecroError>; // path → error for any .py file that failed to parse
}

// Canonical detector function type — pure, synchronous, no network, no WASM calls
export type Detector = (
  snapshot: RepoSnapshot,
  opts: DetectorOpts,
) => CardDraw | null;
