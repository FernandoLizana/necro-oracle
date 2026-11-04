// src/detectors/temperance.ts
//
// XIV — The Temperance (No CI / Dead CI) detector.
//
// A pure, synchronous Detector that inspects a repository snapshot's file paths
// for continuous-integration configuration and judges the state of its vessel.
// It reads only `snapshot.files` — no trees, no manifests, no injected data —
// and classifies each CI file by provider.
//
// See design.md ("detectTemperance — XIV The Temperance (No CI / Dead CI)")
// and requirements R12.1–R12.5:
//   R12.1 recognise GitHub Actions (exactly `.github/workflows/<file>` with a
//         .yml/.yaml extension — deeper nesting does NOT count), Travis
//         (`.travis.yml`/`.travis.yaml` at root), CircleCI
//         (`.circleci/config.yml`), Jenkins (`Jenkinsfile` at root) and Azure
//         Pipelines (`azure-pipelines.yml` at root).
//   R12.2 no CI files → severity 2 upright with a single kind:"no-ci-found"
//         evidence item.
//   R12.3 only Travis files (no non-Travis provider) → severity 1 reversed.
//   R12.4 at least one non-Travis provider present → null.
//   R12.5 evidence lists every detected CI path annotated with its provider
//         name, source "static".
//
// `DetectorOpts` fields used: none.

import type { CardDraw, Evidence } from "../registry/schema.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

/** Canonical provider identifiers surfaced in evidence annotations (R12.5). */
type Provider =
  | "github-actions"
  | "travis-ci"
  | "circleci"
  | "jenkins"
  | "azure-pipelines";

interface CiFile {
  readonly path: string;
  readonly provider: Provider;
}

/** The canonical, immutable no-CI evidence detail (R12.5). */
const NO_CI_DETAIL = "no CI configuration detected";

/**
 * Classify a single repository path as a CI configuration file for some
 * provider, or `null` if it is not one. The checks follow R12.1 exactly,
 * including the GitHub Actions depth rule (exactly three path segments).
 */
function classifyCiPath(path: string): Provider | null {
  // GitHub Actions: exactly `.github/workflows/<file>` with a YAML extension.
  // Deeper nesting (e.g. `.github/workflows/sub/x.yml`) does NOT count.
  const segments = path.split("/");
  if (
    segments.length === 3 &&
    segments[0] === ".github" &&
    segments[1] === "workflows" &&
    /\.ya?ml$/i.test(segments[2] ?? "")
  ) {
    return "github-actions";
  }

  // Travis CI: `.travis.yml` or `.travis.yaml` at the repo root.
  if (path === ".travis.yml" || path === ".travis.yaml") {
    return "travis-ci";
  }

  // CircleCI: `.circleci/config.yml`.
  if (path === ".circleci/config.yml") {
    return "circleci";
  }

  // Jenkins: `Jenkinsfile` at the repo root.
  if (path === "Jenkinsfile") {
    return "jenkins";
  }

  // Azure Pipelines: `azure-pipelines.yml` at the repo root.
  if (path === "azure-pipelines.yml") {
    return "azure-pipelines";
  }

  return null;
}

export const detectTemperance: Detector = (
  snapshot: RepoSnapshot,
): CardDraw | null => {
  // 1) Scan + classify every file by provider.
  const ciFiles: CiFile[] = [];
  for (const file of snapshot.files) {
    const provider = classifyCiPath(file.path);
    if (provider !== null) {
      ciFiles.push({ path: file.path, provider });
    }
  }

  // 2) No CI files at all → severity 2 upright, single no-ci-found evidence.
  if (ciFiles.length === 0) {
    return {
      card: "temperance",
      severity: 2,
      orientation: "upright",
      evidence: [
        {
          kind: "no-ci-found",
          detail: NO_CI_DETAIL,
          source: "static",
        },
      ],
      summary:
        "No vessel tempers this code. No CI configuration was detected in the " +
        "repository.",
      grimoires: [],
    };
  }

  // 3) At least one non-Travis provider → the vessel still holds → null.
  const hasNonTravis = ciFiles.some((f) => f.provider !== "travis-ci");
  if (hasNonTravis) {
    return null;
  }

  // 4) Only Travis files remain → severity 1 reversed. One evidence item per
  //    detected path, annotated with the travis-ci provider name (R12.5).
  const evidence: Evidence[] = ciFiles.map((f) => ({
    kind: `ci-config:${f.provider}`,
    path: f.path,
    detail: `${f.provider} configuration at ${f.path}`,
    source: "static",
  }));

  return {
    card: "temperance",
    severity: 1,
    orientation: "reversed",
    evidence,
    summary:
      "The old vessel cracked long ago. Only Travis CI configuration remains, " +
      "a service long past its prime.",
    grimoires: [],
  };
};
