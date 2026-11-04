// Task 16.2: property test P23 for the metadata mapper.
// Test-first: fails until src/repo-meta.ts exists (task 16.3).
import { RepoMetaSchema } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbMetaCase, type MetaCase } from "../test/arbitraries.js";
import { mapRepoMeta, type MetaInputs } from "./repo-meta.js";
import { GhRepoSchema } from "./schemas/github.js";

const DAY = 86_400_000;
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function toInputs(c: MetaCase): MetaInputs {
  const repo = GhRepoSchema.parse({
    name: c.repo.name,
    full_name: `${c.repo.owner}/${c.repo.name}`,
    owner: { login: c.repo.owner },
    default_branch: "main",
    private: false,
    archived: c.repo.archived,
    pushed_at: c.repo.pushedAt?.text ?? null,
    stargazers_count: 0,
    open_issues_count: c.repo.openIssues,
    license: c.repo.license,
  });
  const pulls: MetaInputs["pulls"] =
    c.pulls.status === "ok"
      ? {
          status: "ok",
          value: { count: c.pulls.value.count, oldestCreatedAt: c.pulls.value.oldest?.text ?? null },
        }
      : c.pulls;
  const release: MetaInputs["release"] =
    c.release.status === "ok"
      ? { status: "ok", value: { publishedAt: c.release.value.published?.text ?? null } }
      : c.release;
  return { repo, pulls, release, nowMs: c.nowMs };
}

describe("P23 (R4.1, R4.2, R4.3, R4.4, R4.5, R4.7): metadata mapping", () => {
  // Feature: 02-github-summoner, Property 23: Metadata mapping
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7**
  it("maps any repo/pulls/release/nowMs combination per the field rules", () => {
    fc.assert(
      fc.property(arbMetaCase, (c) => {
        const { meta, degradedFields } = mapRepoMeta(toInputs(c));

        expect(RepoMetaSchema.safeParse(meta).success).toBe(true);
        expect(meta.isArchived).toBe(c.repo.archived);

        // License (R4.2)
        const expectedLicense =
          c.repo.license === null
            ? null
            : c.repo.license.spdx_id === null || c.repo.license.spdx_id === "NOASSERTION"
              ? "NOASSERTION"
              : c.repo.license.spdx_id;
        expect(meta.licenseKey).toBe(expectedLicense);

        // pushedAt (R4.1)
        if (c.repo.pushedAt === null) expect(meta.pushedAt).toBeNull();
        else {
          expect(meta.pushedAt).toMatch(ISO_Z);
          expect(Date.parse(meta.pushedAt!)).toBe(c.repo.pushedAt.ms);
        }

        // Pull requests (R4.3, R4.4, R4.5, R4.7)
        const prCount = c.pulls.status === "ok" ? c.pulls.value.count : 0;
        expect(meta.openPRCount).toBe(prCount);
        expect(meta.openIssueCount).toBe(Math.max(0, c.repo.openIssues - prCount));
        const oldest = c.pulls.status === "ok" ? c.pulls.value.oldest : null;
        if (oldest === null) expect(meta.oldestOpenPRAgeDays).toBeNull();
        else expect(meta.oldestOpenPRAgeDays).toBe(Math.max(0, Math.floor((c.nowMs - oldest.ms) / DAY)));

        // Release (R4.7)
        const published = c.release.status === "ok" ? c.release.value.published : null;
        if (published === null) expect(meta.latestReleaseAt).toBeNull();
        else {
          expect(meta.latestReleaseAt).toMatch(ISO_Z);
          expect(Date.parse(meta.latestReleaseAt!)).toBe(published.ms);
        }

        // Degraded fields: only degraded outcomes, pulls before release
        const expectedDegraded = [
          ...(c.pulls.status === "degraded" ? ["pulls"] : []),
          ...(c.release.status === "degraded" ? ["release"] : []),
        ];
        expect(degradedFields).toEqual(expectedDegraded);
      }),
      { numRuns: 200 },
    );
  });
});
