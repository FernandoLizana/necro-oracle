// Task 16.1 (test-first; fails until 16.3 creates ./repo-meta.ts).
// Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.7, R4.9.
//
// Assumed API (design.md "Repository metadata mapper"):
//   mapRepoMeta(inputs: MetaInputs): MappedMeta                      (pure, no I/O, no clock reads)
//   MetaInputs = {
//     repo: GhRepo | null,
//     pulls:   OptionalOutcome<{ count: number; oldestCreatedAt: string | null }>,
//     release: OptionalOutcome<{ publishedAt: string | null }>,
//     nowMs: number,
//   }
//   OptionalOutcome<T> = { status: "ok"; value: T } | { status: "absent" }
//                      | { status: "degraded"; cause: DegradedCause }
//   MappedMeta = { meta: RepoMeta; degradedFields: readonly ("pulls" | "release")[] }
//
// Notes:
//   - The `Link: rel="last"` page parsing happens upstream (GitHubClient, per_page=1, so the last
//     page number IS the open PR count; no Link header with one item means count 1). The mapper
//     receives the resulting `count`; the Link cases below pin that mapping (37 from a rel="last"
//     page, 1 for a single PR without Link) and that the count is passed through unchanged.
//   - `absent` (404 / failed zod) is neutral and NOT listed; `degraded` is neutral AND listed,
//     always ordered pulls before release.
//   - Fixtures from packages/github/fixtures/api/<case>/repo.json are parsed with GhRepoSchema.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RepoMetaSchema } from "@necro/oracle";
import { GhRepoSchema, type GhRepo } from "./schemas/github.js";
import { mapRepoMeta, type MetaInputs, type OptionalOutcome } from "./repo-meta.js";

const DAY = 86_400_000;
const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api");

function loadRepo(fixture: string): GhRepo {
  return GhRepoSchema.parse(JSON.parse(readFileSync(path.join(API, fixture, "repo.json"), "utf8")));
}

const NOW = Date.parse("2024-01-31T00:00:00Z");

type Pulls = MetaInputs["pulls"];
type Release = MetaInputs["release"];

const absent = { status: "absent" } as const;
const noPulls: Pulls = { status: "ok", value: { count: 0, oldestCreatedAt: null } };
const pullsOf = (count: number, oldestCreatedAt: string | null): Pulls => ({
  status: "ok",
  value: { count, oldestCreatedAt },
});
const releaseOf = (publishedAt: string | null): Release => ({ status: "ok", value: { publishedAt } });
const degraded: OptionalOutcome<never> = { status: "degraded", cause: "timeout" } as OptionalOutcome<never>;

function run(over: Partial<MetaInputs> & { fixture?: string } = {}) {
  const { fixture, ...rest } = over;
  const inputs: MetaInputs = {
    repo: loadRepo(fixture ?? "success"),
    pulls: noPulls,
    release: absent,
    nowMs: NOW,
    ...rest,
  };
  return mapRepoMeta(inputs);
}

describe("mapRepoMeta repo-derived fields (R4.1, R4.2, R4.3)", () => {
  it("maps an archived repo", () => {
    const { meta } = run({ fixture: "archived" });
    expect(meta.isArchived).toBe(true);
    expect(meta.pushedAt).toBe("2019-03-14T09:26:53.000Z");
  });

  it("maps a non-archived repo with an SPDX license", () => {
    const { meta } = run();
    expect(meta.isArchived).toBe(false);
    expect(meta.licenseKey).toBe("MIT");
  });

  it("maps a missing license to null", () => {
    expect(run({ fixture: "no-license" }).meta.licenseKey).toBeNull();
  });

  it("maps NOASSERTION to NOASSERTION", () => {
    expect(run({ fixture: "noassertion" }).meta.licenseKey).toBe("NOASSERTION");
  });

  it("maps a license object with null spdx_id to NOASSERTION", () => {
    const repo = { ...loadRepo("success"), license: { spdx_id: null } };
    expect(mapRepoMeta({ repo, pulls: noPulls, release: absent, nowMs: NOW }).meta.licenseKey).toBe("NOASSERTION");
  });

  it("normalizes an offset pushed_at to UTC ISO ending in Z", () => {
    const repo = { ...loadRepo("success"), pushed_at: "2019-03-14T11:26:53+02:00" };
    expect(mapRepoMeta({ repo, pulls: noPulls, release: absent, nowMs: NOW }).meta.pushedAt).toBe(
      "2019-03-14T09:26:53.000Z",
    );
  });
});

describe("mapRepoMeta release (R4.3, R4.7, R4.9)", () => {
  it("normalizes published_at to UTC ISO", () => {
    const { meta, degradedFields } = run({ release: releaseOf("2018-12-25T01:00:00+01:00") });
    expect(meta.latestReleaseAt).toBe("2018-12-25T00:00:00.000Z");
    expect(degradedFields).toEqual([]);
  });

  it("release 404 (absent) gives null and is not listed", () => {
    const { meta, degradedFields } = run({ release: absent });
    expect(meta.latestReleaseAt).toBeNull();
    expect(degradedFields).toEqual([]);
  });

  it("release degraded gives null and lists release", () => {
    const { meta, degradedFields } = run({ release: degraded });
    expect(meta.latestReleaseAt).toBeNull();
    expect(degradedFields).toEqual(["release"]);
  });
});

describe("mapRepoMeta pull requests (R4.4, R4.5, R4.7, R4.9)", () => {
  it("zero open PRs: count 0, age null, issues equal the raw count", () => {
    const { meta, degradedFields } = run({ pulls: pullsOf(0, null) });
    expect(meta.openPRCount).toBe(0);
    expect(meta.oldestOpenPRAgeDays).toBeNull();
    expect(meta.openIssueCount).toBe(3);
    expect(degradedFields).toEqual([]);
  });

  it("count taken from a Link rel=\"last\" page number subtracts from open issues", () => {
    const repo = { ...loadRepo("success"), open_issues_count: 50 };
    const { meta } = mapRepoMeta({
      repo,
      pulls: pullsOf(37, "2024-01-01T00:00:00Z"),
      release: absent,
      nowMs: NOW,
    });
    expect(meta.openPRCount).toBe(37);
    expect(meta.openIssueCount).toBe(13);
  });

  it("single PR without a Link header counts as 1", () => {
    const { meta } = run({ pulls: pullsOf(1, "2024-01-21T00:00:00Z") });
    expect(meta.openPRCount).toBe(1);
    expect(meta.openIssueCount).toBe(2);
  });

  it("clamps openIssueCount at 0 when PRs exceed the raw count", () => {
    const { meta } = run({ pulls: pullsOf(10, "2024-01-01T00:00:00Z") });
    expect(meta.openIssueCount).toBe(0);
  });

  it("oldest PR age is whole days, floored", () => {
    const created = new Date(NOW - (10 * DAY + 5 * 3_600_000)).toISOString();
    expect(run({ pulls: pullsOf(2, created) }).meta.oldestOpenPRAgeDays).toBe(10);
  });

  it("oldest PR created in the future clamps age to 0", () => {
    const created = new Date(NOW + 3 * DAY).toISOString();
    expect(run({ pulls: pullsOf(1, created) }).meta.oldestOpenPRAgeDays).toBe(0);
  });

  it("pulls absent gives neutral values and is not listed", () => {
    const { meta, degradedFields } = run({ pulls: absent });
    expect(meta.openPRCount).toBe(0);
    expect(meta.oldestOpenPRAgeDays).toBeNull();
    expect(meta.openIssueCount).toBe(3);
    expect(degradedFields).toEqual([]);
  });

  it("pulls degraded: openIssueCount equals the raw count, age null, lists pulls", () => {
    const { meta, degradedFields } = run({ pulls: degraded });
    expect(meta.openPRCount).toBe(0);
    expect(meta.oldestOpenPRAgeDays).toBeNull();
    expect(meta.openIssueCount).toBe(3);
    expect(degradedFields).toEqual(["pulls"]);
  });

  it("both degraded gives [\"pulls\", \"release\"] in that order", () => {
    const { degradedFields } = run({ pulls: degraded, release: degraded });
    expect(degradedFields).toEqual(["pulls", "release"]);
  });
});

describe("mapRepoMeta schema conformance (R4.1)", () => {
  it.each(["success", "archived", "no-license", "noassertion"])("output for %s passes RepoMetaSchema", (fx) => {
    const { meta } = run({
      fixture: fx,
      pulls: pullsOf(2, "2019-02-01T12:00:00Z"),
      release: releaseOf("2018-12-25T00:00:00Z"),
    });
    expect(RepoMetaSchema.safeParse(meta).success).toBe(true);
  });

  it("fully degraded output still passes RepoMetaSchema", () => {
    const { meta } = run({ pulls: degraded, release: degraded });
    expect(RepoMetaSchema.safeParse(meta).success).toBe(true);
  });

  it("null repo yields neutral repo-derived defaults that pass the schema", () => {
    const { meta } = mapRepoMeta({ repo: null, pulls: absent, release: absent, nowMs: NOW });
    expect(meta).toEqual({
      pushedAt: null,
      isArchived: false,
      openIssueCount: 0,
      openPRCount: 0,
      oldestOpenPRAgeDays: null,
      latestReleaseAt: null,
      licenseKey: null,
    });
    expect(RepoMetaSchema.safeParse(meta).success).toBe(true);
  });
});
