// Pure repository metadata mapper. No I/O, no clock reads (nowMs is injected).
// Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.7, R4.9.
import type { RepoMeta } from "@necro/oracle";
import type { DegradedCause, DegradedField } from "./http-failure.js";
import type { GhRepo } from "./schemas/github.js";
import { daysBetween, isoFromMs, parseIsoMs } from "./time.js";

export type OptionalOutcome<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "absent" }
  | { readonly status: "degraded"; readonly cause: DegradedCause };

export interface MetaInputs {
  readonly repo: GhRepo | null;
  readonly pulls: OptionalOutcome<{ count: number; oldestCreatedAt: string | null }>;
  readonly release: OptionalOutcome<{ publishedAt: string | null }>;
  readonly nowMs: number;
}

export interface MappedMeta {
  readonly meta: RepoMeta;
  readonly degradedFields: readonly DegradedField[];
}

function normalizeIso(s: string | null): string | null {
  if (s === null) return null;
  const ms = parseIsoMs(s);
  return ms === null ? null : isoFromMs(ms);
}

export function mapRepoMeta(inputs: MetaInputs): MappedMeta {
  const { repo, pulls, release, nowMs } = inputs;

  const prCount = pulls.status === "ok" ? pulls.value.count : 0;
  const oldestMs =
    pulls.status === "ok" && pulls.value.oldestCreatedAt !== null
      ? parseIsoMs(pulls.value.oldestCreatedAt)
      : null;

  const licenseKey =
    repo === null || repo.license === null
      ? null
      : repo.license.spdx_id === null || repo.license.spdx_id === ""
        ? "NOASSERTION"
        : repo.license.spdx_id;

  const meta: RepoMeta = {
    pushedAt: repo === null ? null : normalizeIso(repo.pushed_at),
    isArchived: repo === null ? false : repo.archived,
    openIssueCount: repo === null ? 0 : Math.max(0, repo.open_issues_count - prCount),
    openPRCount: prCount,
    oldestOpenPRAgeDays: oldestMs === null ? null : daysBetween(oldestMs, nowMs),
    latestReleaseAt: release.status === "ok" ? normalizeIso(release.value.publishedAt) : null,
    licenseKey,
  };

  const degradedFields: DegradedField[] = [];
  if (pulls.status === "degraded") degradedFields.push("pulls");
  if (release.status === "degraded") degradedFields.push("release");

  return { meta, degradedFields };
}
