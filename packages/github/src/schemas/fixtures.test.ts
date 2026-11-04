// Fixture validation test (task 10.3; fixtures are authored in 10.4).
// Requirements: R2.5, R4.1, R5.8, R9.4.
//
// Layout contract for 10.4:
//   fixtures/api/<case>/{repo,commit,pulls,release}.json        2xx bodies
//   fixtures/api/<case>/<name>.<status>.json                    non-2xx bodies (e.g. release.404.json)
//   fixtures/registry/pypi/<case>.json
//   fixtures/registry/npm/<case>.json
//   fixtures/registry/osv/batch*.json  (batch response) and any other name (vuln detail)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { describe, expect, it } from "vitest";
import {
  GhCommitSchema,
  GhErrorBodySchema,
  GhPullsSchema,
  GhReleaseSchema,
  GhRepoSchema,
} from "./github.js";
import { NpmDocSchema, NpmVersionSchema } from "./npm.js";
import { OsvBatchResponseSchema, OsvVulnSchema } from "./osv.js";
import { PypiDocSchema } from "./pypi.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const API = path.join(FIXTURES, "api");
const REGISTRY = path.join(FIXTURES, "registry");

const API_SCHEMAS: Record<string, ZodTypeAny> = {
  repo: GhRepoSchema,
  commit: GhCommitSchema,
  pulls: GhPullsSchema,
  release: GhReleaseSchema,
};

const REQUIRED_API_CASES = [
  "success",
  "archived",
  "no-license",
  "noassertion",
  "no-releases",
  "rename-redirect",
  "private",
  "empty-repository",
];

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function jsonFiles(dir: string): string[] {
  return listDir(dir).filter((f) => f.endsWith(".json"));
}

const apiCases = listDir(API);

describe("fixtures/api (R4.1, R2.5, R9.4)", () => {
  it("covers every required case", () => {
    expect(apiCases).toEqual(expect.arrayContaining(REQUIRED_API_CASES));
  });

  describe.each(apiCases)("case %s", (name) => {
    const dir = path.join(API, name);
    const files = jsonFiles(dir);

    it("has a repo payload (2xx or error)", () => {
      expect(files.some((f) => /^repo(\.\d{3})?\.json$/.test(f))).toBe(true);
    });

    it.each(files)("%s parses against its schema", (file) => {
      const m = /^(repo|commit|pulls|release)(?:\.(\d{3}))?\.json$/.exec(file);
      expect(m, `unexpected fixture file name: ${file}`).not.toBeNull();
      const kind = m![1]!;
      const status = m![2];
      const schema = status ? GhErrorBodySchema : API_SCHEMAS[kind]!;
      const result = schema.safeParse(readJson(path.join(dir, file)));
      expect(result.success, result.success ? "" : result.error.message).toBe(true);
    });
  });

  it("encodes the distinguishing property of each case", () => {
    const repo = (c: string) => {
      const f = path.join(API, c, "repo.json");
      return existsSync(f) ? GhRepoSchema.parse(readJson(f)) : undefined;
    };
    expect(repo("success")?.archived).toBe(false);
    expect(repo("archived")?.archived).toBe(true);
    expect(repo("no-license")?.license).toBeNull();
    expect(repo("noassertion")?.license?.spdx_id).toBe("NOASSERTION");
    expect(repo("private")?.private).toBe(true);
    expect(repo("success")?.private).toBe(false);
    expect(existsSync(path.join(API, "no-releases", "release.404.json"))).toBe(true);
    expect(existsSync(path.join(API, "empty-repository", "commit.409.json"))).toBe(true);
    // rename: the payload's canonical identity is what callers must use
    expect(repo("rename-redirect")).toBeDefined();
  });
});

describe("fixtures/registry/pypi (R5.8, R9.4)", () => {
  const files = jsonFiles(path.join(REGISTRY, "pypi"));
  it("has at least one fixture", () => expect(files.length).toBeGreaterThan(0));
  it.each(files)("%s parses", (file) => {
    const r = PypiDocSchema.safeParse(readJson(path.join(REGISTRY, "pypi", file)));
    expect(r.success, r.success ? "" : r.error.message).toBe(true);
  });
  it("includes a py2-only package", () => {
    const f = path.join(REGISTRY, "pypi", "py2-only.json");
    expect(existsSync(f)).toBe(true);
    const c = PypiDocSchema.parse(readJson(f)).info.classifiers;
    expect(c.some((x) => /^Programming Language :: Python :: 2(\.|$| )/.test(x))).toBe(true);
    expect(c.some((x) => /^Programming Language :: Python :: 3(\.|$| )/.test(x))).toBe(false);
  });
});

describe("fixtures/registry/npm (R5.8, R9.4)", () => {
  const files = jsonFiles(path.join(REGISTRY, "npm"));
  it("has at least one fixture", () => expect(files.length).toBeGreaterThan(0));
  it.each(files)("%s parses", (file) => {
    const doc = NpmDocSchema.safeParse(readJson(path.join(REGISTRY, "npm", file)));
    expect(doc.success, doc.success ? "" : doc.error.message).toBe(true);
    if (doc.success) {
      const v = NpmVersionSchema.safeParse(doc.data.versions[doc.data["dist-tags"].latest]);
      expect(v.success, "versions[latest] must parse").toBe(true);
    }
  });
  it("includes a deprecated package", () => {
    const f = path.join(REGISTRY, "npm", "deprecated.json");
    expect(existsSync(f)).toBe(true);
    const doc = NpmDocSchema.parse(readJson(f));
    const v = NpmVersionSchema.parse(doc.versions[doc["dist-tags"].latest]);
    expect(v.deprecated).toBeTruthy();
  });
});

describe("fixtures/registry/osv (R5.8, R9.4)", () => {
  const dir = path.join(REGISTRY, "osv");
  const files = jsonFiles(dir);
  const isBatch = (f: string) => f.startsWith("batch");
  const batches = files.filter(isBatch);
  const details = files.filter((f) => !isBatch(f));

  it("has a batch fixture and a detail fixture", () => {
    expect(batches.length).toBeGreaterThan(0);
    expect(details.length).toBeGreaterThan(0);
  });
  it.each(files)("%s parses", (file) => {
    const schema: ZodTypeAny = isBatch(file) ? OsvBatchResponseSchema : OsvVulnSchema;
    const r = schema.safeParse(readJson(path.join(dir, file)));
    expect(r.success, r.success ? "" : r.error.message).toBe(true);
  });
  it("includes a detail with aliases", () => {
    const withAliases = details.filter(
      (f) => (OsvVulnSchema.parse(readJson(path.join(dir, f))).aliases ?? []).length > 0,
    );
    expect(withAliases.length).toBeGreaterThan(0);
  });
});
