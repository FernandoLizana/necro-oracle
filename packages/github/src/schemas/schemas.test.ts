// Schema tests (task 10.1). Written test-first: they fail until the schemas exist (task 10.2).
// Validates: Requirements 2.4, 2.5, 2.6, 5.8, 6.5
import { describe, expect, it } from "vitest";
import {
  GhCommitSchema,
  GhErrorBodySchema,
  GhPullsSchema,
  GhReleaseSchema,
  GhRepoSchema,
  GithubTokenSchema,
  OwnerOrNameSchema,
  ResolvedRepoRefSchema,
  Sha40Schema,
} from "./github.js";
import { NpmDocSchema, NpmVersionSchema } from "./npm.js";
import { OsvBatchResponseSchema, OsvVulnSchema } from "./osv.js";
import { PypiDocSchema } from "./pypi.js";

const SHA = "a".repeat(40);
const ISO = "2024-05-01T12:00:00Z";

const validRepo = () => ({
  name: "Repo",
  full_name: "Owner/Repo",
  owner: { login: "Owner" },
  default_branch: "main",
  private: false,
  archived: false,
  pushed_at: ISO,
  stargazers_count: 3,
  open_issues_count: 1,
  license: { spdx_id: "MIT" },
});

describe("Sha40Schema (R2.4, R2.5)", () => {
  it("accepts 40 lowercase hex", () => {
    expect(Sha40Schema.safeParse(SHA).success).toBe(true);
  });
  it.each(["", "A".repeat(40), "a".repeat(39), "a".repeat(41), "g".repeat(40), ` ${"a".repeat(39)}`])(
    "rejects %j",
    (v) => {
      expect(Sha40Schema.safeParse(v).success).toBe(false);
    },
  );
});

describe("ResolvedRepoRefSchema (R2.4)", () => {
  const ok = { owner: "o", name: "n", sha: SHA, defaultBranch: "main" };
  it("accepts a ref with a 40-hex sha", () => {
    expect(ResolvedRepoRefSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a short sha", () => {
    expect(ResolvedRepoRefSchema.safeParse({ ...ok, sha: "abc" }).success).toBe(false);
  });
  it("rejects an empty defaultBranch", () => {
    expect(ResolvedRepoRefSchema.safeParse({ ...ok, defaultBranch: "" }).success).toBe(false);
  });
  it("strips unknown keys", () => {
    const r = ResolvedRepoRefSchema.parse({ ...ok, extra: 1 });
    expect(r).toEqual(ok);
  });
});

describe("OwnerOrNameSchema (R2.4)", () => {
  it.each(["octocat", "my-repo", "a_b.c", "A1"])("accepts %j", (v) => {
    expect(OwnerOrNameSchema.safeParse(v).success).toBe(true);
  });
  it.each(["", ".", "..", "a/b", "a b", "a\n", "é", "a?b"])("rejects %j", (v) => {
    expect(OwnerOrNameSchema.safeParse(v).success).toBe(false);
  });
});

describe("GithubTokenSchema (R6.5)", () => {
  it("accepts a token without whitespace or control chars", () => {
    expect(GithubTokenSchema.safeParse("ghp_abcDEF123").success).toBe(true);
  });
  it.each(["", "a b", "a\tb", "abc\n", "a\r\nX-Evil: 1", "a\x00b", "a\x7fb"])("rejects %j", (v) => {
    expect(GithubTokenSchema.safeParse(v).success).toBe(false);
  });
  it("does not echo the token value in the error", () => {
    const secret = "sec ret";
    const res = GithubTokenSchema.safeParse(secret);
    expect(res.success).toBe(false);
    if (!res.success) expect(JSON.stringify(res.error.issues)).not.toContain(secret);
  });
});

describe("GhRepoSchema (R2.4, R2.5, R2.6)", () => {
  it("accepts a valid repo and strips unknown keys", () => {
    const r = GhRepoSchema.parse({ ...validRepo(), node_id: "x", extra: { a: 1 } });
    expect(r).toEqual(validRepo());
    expect(r).not.toHaveProperty("node_id");
    expect(r).not.toHaveProperty("extra");
  });
  it("rejects a full_name that disagrees with owner.login/name", () => {
    expect(GhRepoSchema.safeParse({ ...validRepo(), full_name: "owner/repo" }).success).toBe(false);
    expect(GhRepoSchema.safeParse({ ...validRepo(), full_name: "Other/Repo" }).success).toBe(false);
  });
  it("rejects an empty default_branch", () => {
    expect(GhRepoSchema.safeParse({ ...validRepo(), default_branch: "" }).success).toBe(false);
  });
  it.each(["name", "full_name", "owner", "default_branch", "private", "archived", "stargazers_count", "open_issues_count"])(
    "rejects a missing %s",
    (k) => {
      const v: Record<string, unknown> = validRepo();
      delete v[k];
      expect(GhRepoSchema.safeParse(v).success).toBe(false);
    },
  );
  it("rejects wrong types and negative or fractional counts", () => {
    expect(GhRepoSchema.safeParse({ ...validRepo(), private: "no" }).success).toBe(false);
    expect(GhRepoSchema.safeParse({ ...validRepo(), stargazers_count: -1 }).success).toBe(false);
    expect(GhRepoSchema.safeParse({ ...validRepo(), open_issues_count: 1.5 }).success).toBe(false);
  });
  it("rejects a malformed pushed_at", () => {
    expect(GhRepoSchema.safeParse({ ...validRepo(), pushed_at: "yesterday" }).success).toBe(false);
  });
  it("transforms null or missing pushed_at to null", () => {
    expect(GhRepoSchema.parse({ ...validRepo(), pushed_at: null }).pushed_at).toBeNull();
    const v: Record<string, unknown> = validRepo();
    delete v.pushed_at;
    expect(GhRepoSchema.parse(v).pushed_at).toBeNull();
  });
  it("license transform: null, missing, and null spdx_id all become null-ish as designed", () => {
    expect(GhRepoSchema.parse({ ...validRepo(), license: null }).license).toBeNull();
    const v: Record<string, unknown> = validRepo();
    delete v.license;
    expect(GhRepoSchema.parse(v).license).toBeNull();
    expect(GhRepoSchema.parse({ ...validRepo(), license: { spdx_id: null } }).license).toEqual({ spdx_id: null });
    expect(GhRepoSchema.parse({ ...validRepo(), license: { spdx_id: "MIT", name: "x" } }).license).toEqual({
      spdx_id: "MIT",
    });
  });
  it("rejects an owner.login with illegal characters", () => {
    const bad = { ...validRepo(), owner: { login: "a/b" }, full_name: "a/b/Repo" };
    expect(GhRepoSchema.safeParse(bad).success).toBe(false);
  });
});

describe("GhCommitSchema (R2.5)", () => {
  it("accepts and strips", () => {
    expect(GhCommitSchema.parse({ sha: SHA, commit: { message: "m" } })).toEqual({ sha: SHA });
  });
  it("rejects a bad or missing sha", () => {
    expect(GhCommitSchema.safeParse({ sha: "XYZ" }).success).toBe(false);
    expect(GhCommitSchema.safeParse({}).success).toBe(false);
  });
});

describe("GhPullsSchema", () => {
  it("accepts an array and strips unknown keys", () => {
    expect(GhPullsSchema.parse([{ created_at: ISO, title: "t" }])).toEqual([{ created_at: ISO }]);
    expect(GhPullsSchema.parse([])).toEqual([]);
  });
  it("accepts offset timestamps", () => {
    expect(GhPullsSchema.safeParse([{ created_at: "2024-05-01T12:00:00+02:00" }]).success).toBe(true);
  });
  it("rejects non-arrays, missing and malformed created_at", () => {
    expect(GhPullsSchema.safeParse({}).success).toBe(false);
    expect(GhPullsSchema.safeParse([{}]).success).toBe(false);
    expect(GhPullsSchema.safeParse([{ created_at: "nope" }]).success).toBe(false);
  });
});

describe("GhReleaseSchema", () => {
  it("accepts a published release and strips unknown keys", () => {
    expect(GhReleaseSchema.parse({ published_at: ISO, tag_name: "v1" })).toEqual({ published_at: ISO });
  });
  it("maps null or missing published_at to null", () => {
    expect(GhReleaseSchema.parse({ published_at: null }).published_at).toBeNull();
    expect(GhReleaseSchema.parse({}).published_at).toBeNull();
  });
  it("rejects a malformed published_at", () => {
    expect(GhReleaseSchema.safeParse({ published_at: "x" }).success).toBe(false);
  });
});

describe("GhErrorBodySchema", () => {
  it("accepts a message, none, and strips unknown keys", () => {
    expect(GhErrorBodySchema.parse({ message: "Not Found", documentation_url: "u" })).toEqual({
      message: "Not Found",
    });
    expect(GhErrorBodySchema.parse({})).toEqual({});
  });
  it("rejects a non-string message", () => {
    expect(GhErrorBodySchema.safeParse({ message: 5 }).success).toBe(false);
  });
});

describe("PypiDocSchema (R5.8)", () => {
  const ok = {
    info: { name: "requests", version: "2.0.0", classifiers: ["A"], yanked: false, summary: "s" },
    urls: [{ upload_time_iso_8601: ISO, url: "u" }],
    extra: 1,
  };
  it("accepts and strips unknown keys", () => {
    const r = PypiDocSchema.parse(ok);
    expect(r).toEqual({
      info: { name: "requests", version: "2.0.0", classifiers: ["A"], yanked: false },
      urls: [{ upload_time_iso_8601: ISO }],
    });
  });
  it("defaults classifiers and urls to []", () => {
    const r = PypiDocSchema.parse({ info: { name: "a", version: "1" } });
    expect(r.info.classifiers).toEqual([]);
    expect(r.urls).toEqual([]);
  });
  it("rejects missing name/version/info and bad upload time", () => {
    expect(PypiDocSchema.safeParse({}).success).toBe(false);
    expect(PypiDocSchema.safeParse({ info: { name: "", version: "1" } }).success).toBe(false);
    expect(PypiDocSchema.safeParse({ info: { name: "a" } }).success).toBe(false);
    expect(
      PypiDocSchema.safeParse({ info: { name: "a", version: "1" }, urls: [{ upload_time_iso_8601: "bad" }] }).success,
    ).toBe(false);
  });
});

describe("NpmDocSchema and NpmVersionSchema (R5.8)", () => {
  const ok = {
    name: "left-pad",
    "dist-tags": { latest: "1.3.0", next: "2.0.0" },
    versions: { "1.3.0": { deprecated: "old" } },
    modified: ISO,
    readme: "x",
  };
  it("accepts and strips unknown keys", () => {
    const r = NpmDocSchema.parse(ok);
    expect(r).toEqual({
      name: "left-pad",
      "dist-tags": { latest: "1.3.0" },
      versions: { "1.3.0": { deprecated: "old" } },
      modified: ISO,
    });
  });
  it("treats modified as optional", () => {
    const { modified: _m, ...rest } = ok;
    expect(NpmDocSchema.safeParse(rest).success).toBe(true);
  });
  it("rejects missing latest tag, versions, or bad modified", () => {
    expect(NpmDocSchema.safeParse({ ...ok, "dist-tags": {} }).success).toBe(false);
    expect(NpmDocSchema.safeParse({ ...ok, "dist-tags": { latest: "" } }).success).toBe(false);
    const { versions: _v, ...noVersions } = ok;
    expect(NpmDocSchema.safeParse(noVersions).success).toBe(false);
    expect(NpmDocSchema.safeParse({ ...ok, modified: "x" }).success).toBe(false);
    expect(NpmDocSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
  });
  it("NpmVersionSchema accepts deprecated string or none and strips unknown keys", () => {
    expect(NpmVersionSchema.parse({ deprecated: "use x", main: "i.js" })).toEqual({ deprecated: "use x" });
    expect(NpmVersionSchema.parse({})).toEqual({});
  });
  it("NpmVersionSchema rejects a non-string deprecated", () => {
    expect(NpmVersionSchema.safeParse({ deprecated: true }).success).toBe(false);
  });
});

describe("OsvBatchResponseSchema (R5.8)", () => {
  it("accepts results with and without vulns, strips unknown keys", () => {
    const r = OsvBatchResponseSchema.parse({
      results: [{ vulns: [{ id: "GHSA-1", modified: "x" }], next_page_token: "t" }, {}],
      extra: 1,
    });
    expect(r).toEqual({ results: [{ vulns: [{ id: "GHSA-1" }], next_page_token: "t" }, {}] });
  });
  it("rejects a missing results array and empty vuln ids", () => {
    expect(OsvBatchResponseSchema.safeParse({}).success).toBe(false);
    expect(OsvBatchResponseSchema.safeParse({ results: [{ vulns: [{ id: "" }] }] }).success).toBe(false);
    expect(OsvBatchResponseSchema.safeParse({ results: [{ vulns: [{}] }] }).success).toBe(false);
  });
});

describe("OsvVulnSchema (R5.8)", () => {
  it("accepts a minimal vuln", () => {
    expect(OsvVulnSchema.parse({ id: "OSV-1" })).toEqual({ id: "OSV-1" });
  });
  it("accepts a full vuln and strips unknown keys", () => {
    const full = {
      id: "OSV-1",
      aliases: ["CVE-1"],
      database_specific: { severity: "HIGH" },
      affected: [
        {
          package: { name: "requests", ecosystem: "PyPI" },
          ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.0" }] }],
          versions: ["1.0"],
          ecosystem_specific: {},
        },
      ],
      summary: "x",
    };
    const r = OsvVulnSchema.parse(full);
    expect(r.affected?.[0]).not.toHaveProperty("ecosystem_specific");
    expect(r).not.toHaveProperty("summary");
    expect(r.aliases).toEqual(["CVE-1"]);
    expect(r.affected?.[0]?.ranges?.[0]?.events).toEqual([{ introduced: "0" }, { fixed: "2.0" }]);
  });
  it("rejects an empty id, wrong aliases type, and non-string event values", () => {
    expect(OsvVulnSchema.safeParse({ id: "" }).success).toBe(false);
    expect(OsvVulnSchema.safeParse({ id: "x", aliases: "CVE" }).success).toBe(false);
    expect(
      OsvVulnSchema.safeParse({ id: "x", affected: [{ ranges: [{ type: "SEMVER", events: [{ fixed: 2 }] }] }] })
        .success,
    ).toBe(false);
  });
});
