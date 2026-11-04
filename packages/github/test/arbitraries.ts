// Reusable fast-check arbitraries for @necro/github (pure; no network).
import fc from "fast-check";
import { paxGlobalEntry, type RawTarEntry } from "../src/testing/raw-tar.js";

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const NAME_CHARS = [...ALNUM, "-", "_", "."];
const HEX = "0123456789abcdefABCDEF".split("");

/** Valid owner or repository name: [A-Za-z0-9_.-]+, not "." / "..", not ending ".git". */
export const arbOwnerOrName: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 39 })
  .map((cs) => cs.join(""))
  .filter((s) => s !== "." && s !== ".." && !s.toLowerCase().endsWith(".git"));

/** One ref path segment: starts alphanumeric, never "." / "..". */
const arbRefSegment: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...ALNUM),
    fc.array(fc.constantFrom(...ALNUM, "-", "_", "."), { maxLength: 15 }),
  )
  .map(([h, t]) => h + t.join(""))
  .filter((s) => !s.includes(".."));

/** Branch/tag-like ref (may contain "/"), already valid per the parser grammar. */
export const arbBranchRef: fc.Arbitrary<string> = fc
  .array(arbRefSegment, { minLength: 1, maxLength: 3 })
  .map((segs) => segs.join("/"));

/** 40-hex sha of any case. */
export const arbSha40Any: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...HEX), { minLength: 40, maxLength: 40 })
  .map((cs) => cs.join(""));

/** Mixed-case rendering of a lowercase host. */
const arbHostCase = (host: string): fc.Arbitrary<string> =>
  fc
    .array(fc.boolean(), { minLength: host.length, maxLength: host.length })
    .map((flags) => [...host].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(""));

const arbWs: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 3 })
  .map((a) => a.join(""));

const arbSlashes: fc.Arbitrary<string> = fc.integer({ min: 0, max: 3 }).map((n) => "/".repeat(n));

export interface GithubUrlCase {
  readonly input: string;
  readonly expected: {
    readonly host: "github.com";
    readonly owner: string;
    readonly name: string;
    readonly ref: string | null;
  };
}

/**
 * Accepted reference forms with their expected parse:
 * shorthand (`o/r`, `o/r#ref`, `o/r@sha`) and URLs (`/o/r`, `/o/r/tree/<ref>`),
 * decorated with whitespace, trailing slashes and an optional `.git` suffix.
 */
export const arbGithubUrl: fc.Arbitrary<GithubUrlCase> = fc
  .record({
    owner: arbOwnerOrName,
    name: arbOwnerOrName,
    form: fc.constantFrom("shorthand", "hash", "at", "url", "tree"),
    branch: arbBranchRef,
    sha: arbSha40Any,
    dotGit: fc.boolean(),
    scheme: fc.constantFrom("http", "https"),
    host: fc.constantFrom("github.com", "www.github.com"),
    leading: arbWs,
    trailing: arbWs,
    slashes: arbSlashes,
  })
  .chain((r) =>
    (r.form === "url" || r.form === "tree" ? arbHostCase(r.host) : fc.constant(r.host)).map(
      (host): GithubUrlCase => {
        const repoPart = r.name + (r.dotGit ? ".git" : "");
        let body: string;
        let ref: string | null = null;
        switch (r.form) {
          case "shorthand":
            body = `${r.owner}/${repoPart}`;
            break;
          case "hash":
            ref = /^[0-9a-fA-F]{40}$/.test(r.branch) ? r.branch.toLowerCase() : r.branch;
            body = `${r.owner}/${repoPart}#${r.branch}`;
            break;
          case "at":
            ref = r.sha.toLowerCase();
            body = `${r.owner}/${repoPart}@${r.sha}`;
            break;
          case "url":
            body = `${r.scheme}://${host}/${r.owner}/${repoPart}`;
            break;
          default:
            ref = r.branch;
            body = `${r.scheme}://${host}/${r.owner}/${repoPart}/tree/${r.branch
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`;
        }
        return {
          input: `${r.leading}${body}${r.slashes}${r.trailing}`,
          expected: { host: "github.com", owner: r.owner, name: r.name, ref },
        };
      },
    ),
  );

// ---------------------------------------------------------------------------
// Failure-model arbitraries (task 11.2 / 11.3, P28)
// ---------------------------------------------------------------------------

export const SUMMONER_ERROR_CODES = [
  "INVALID_REPO_URL",
  "REPO_NOT_FOUND",
  "REPO_PRIVATE",
  "RATE_LIMITED",
  "NETWORK_TIMEOUT",
  "DOWNLOAD_TOO_LARGE",
  "VALIDATION_FAILED",
  "REF_NOT_FOUND",
  "AUTH_INVALID",
  "UPSTREAM_UNAVAILABLE",
] as const;

export type ArbSummonerErrorCode = (typeof SUMMONER_ERROR_CODES)[number];

export const arbSummonerErrorCode: fc.Arbitrary<ArbSummonerErrorCode> = fc.constantFrom(
  ...SUMMONER_ERROR_CODES,
);

/** Secret-shaped token: GitHub-style prefix plus a long alphanumeric tail. */
export const arbSecret: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("ghp_", "gho_", "ghs_", "github_pat_"),
    fc.array(fc.constantFrom(...ALNUM), { minLength: 20, maxLength: 40 }),
  )
  .map(([p, t]) => p + t.join(""));

/** Plain ref (branch/tag-like); never secret-shaped. */
export const arbPlainRef: fc.Arbitrary<string> = arbBranchRef.filter(
  (s) => !/gh[pousr]_|github_pat_|bearer/i.test(s),
);

export const arbService: fc.Arbitrary<string> = fc.constantFrom(
  "GitHub API",
  "GitHub codeload",
  "OSV.dev",
  "PyPI",
);

const arbPlainText: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz 0123456789:-_.".split("")), {
    minLength: 1,
    maxLength: 30,
  })
  .map((cs) => cs.join("").trim() || "x")
  .filter((s) => !/bearer|gh[pousr]_|github_pat_/i.test(s));

export interface ArbErrorContext {
  owner: string;
  name: string;
  ref: string;
  minutes: number;
  limit: "compressed" | "uncompressed" | "entries";
  reason: string;
  service: string;
  httpStatus: number;
  what: string;
  where: string;
}

/** Context valid for a given code (every field present; codes read what they declare). */
export const arbContextFor = (_code: ArbSummonerErrorCode): fc.Arbitrary<ArbErrorContext> =>
  fc.record({
    owner: arbOwnerOrName,
    name: arbOwnerOrName,
    ref: arbPlainRef,
    minutes: fc.integer({ min: 0, max: 120 }),
    limit: fc.constantFrom("compressed", "uncompressed", "entries"),
    reason: arbPlainText,
    service: arbService,
    httpStatus: fc.integer({ min: 500, max: 599 }),
    what: arbPlainText,
    where: arbPlainText,
  });

export interface ErrorCase {
  readonly code: ArbSummonerErrorCode;
  readonly ctx: ArbErrorContext;
  readonly secrets: string[];
  readonly cause: {
    readonly prefix: string;
    readonly suffix: string;
    readonly secretIndex: number;
    readonly name: string;
  } | null;
}

export const arbErrorCase: fc.Arbitrary<ErrorCase> = arbSummonerErrorCode.chain((code) =>
  fc.record({
    code: fc.constant(code),
    ctx: arbContextFor(code),
    secrets: fc.array(arbSecret, { minLength: 1, maxLength: 3 }),
    cause: fc.option(
      fc.record({
        prefix: arbPlainText,
        suffix: arbPlainText,
        secretIndex: fc.nat({ max: 10 }),
        name: fc.constantFrom("Error", "TypeError", "HttpError", "RequestError"),
      }),
      { nil: null },
    ),
  }),
);

// ---------------------------------------------------------------------------
// Foreign-host arbitraries (task 13.3, P2)
// ---------------------------------------------------------------------------

const HOST_LABEL_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

const arbHostLabel: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.array(fc.constantFrom(...HOST_LABEL_CHARS), { maxLength: 8 }),
  )
  .map(([h, t]) => h + t.join(""));

/** Hostname that is never `github.com` or `www.github.com` (any case). */
export const arbForeignHost: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(
      "gitlab.com",
      "bitbucket.org",
      "example.com",
      "github.io",
      "github.com.evil.example",
      "evilgithub.com",
      "api.github.com",
      "gist.github.com",
      "raw.githubusercontent.com",
      "github.co",
      "localhost",
    ),
    fc
      .tuple(arbHostLabel, fc.constantFrom("com", "org", "net", "io", "dev"))
      .map(([l, tld]) => `${l}.${tld}`),
    fc
      .tuple(arbHostLabel, arbHostLabel, fc.constantFrom("com", "org", "net"))
      .map(([a, b, tld]) => `${a}.${b}.${tld}`),
  )
  .filter((h) => {
    const l = h.toLowerCase();
    return l !== "github.com" && l !== "www.github.com";
  });

export interface ForeignHostCase {
  readonly input: string;
  readonly host: string;
}

/** Well-formed `http(s)://<foreign host>/<owner>/<repo>` URLs (optionally with /tree/<ref>). */
export const arbForeignHostUrl: fc.Arbitrary<ForeignHostCase> = fc
  .record({
    host: arbForeignHost,
    scheme: fc.constantFrom("http", "https"),
    owner: arbOwnerOrName,
    name: arbOwnerOrName,
    branch: fc.option(arbBranchRef, { nil: null }),
  })
  .map((r) => ({
    host: r.host,
    input: `${r.scheme}://${r.host}/${r.owner}/${r.name}${r.branch ? `/tree/${r.branch}` : ""}`,
  }));

// ---------------------------------------------------------------------------
// Malformed-reference arbitraries (task 13.4, P3)
// ---------------------------------------------------------------------------

const INVALID_NAME_CHARS = [..."!$*+,;<>=^`{}~()'\"\\|é€☠"];

const arbOnlyWs: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 8 })
  .map((a) => a.join(""));

/** Inputs that are not a well-formed `owner/name` reference (shorthand or github.com URL). */
export const arbMalformedRef: fc.Arbitrary<string> = fc.oneof(
  // empty / whitespace-only
  arbOnlyWs,
  // lacks a repository name
  arbOwnerOrName.map((o) => o),
  arbOwnerOrName.map((o) => `${o}/`),
  arbOwnerOrName.map((o) => `https://github.com/${o}`),
  arbOwnerOrName.map((o) => `https://github.com/${o}/`),
  fc.constantFrom("https://github.com", "https://github.com/", "http://www.github.com/"),
  // owner or name containing a character outside [A-Za-z0-9_.-]
  fc
    .tuple(
      arbOwnerOrName,
      arbOwnerOrName,
      arbOwnerOrName,
      fc.constantFrom(...INVALID_NAME_CHARS),
      fc.boolean(),
    )
    .map(([owner, name, tail, bad, inOwner]) =>
      inOwner ? `${owner}${bad}${tail}/${name}` : `${owner}/${name}${bad}${tail}`,
    ),
  // owner or name equal to "." or ".."
  fc
    .tuple(arbOwnerOrName, fc.constantFrom(".", ".."), fc.boolean())
    .map(([valid, dots, inOwner]) => (inOwner ? `${dots}/${valid}` : `${valid}/${dots}`)),
);

// ---------------------------------------------------------------------------
// Metadata-mapping arbitraries (task 16.2, P23)
// ---------------------------------------------------------------------------

const META_MIN_MS = Date.parse("2005-01-01T00:00:00Z");
const META_MAX_MS = Date.parse("2035-01-01T00:00:00Z");

export interface IsoCase {
  /** ISO 8601 string as GitHub may send it (Z or numeric offset). */
  readonly text: string;
  readonly ms: number;
}

/** ISO 8601 timestamp with whole-second precision, rendered with `Z` or a numeric offset. */
export const arbIsoCase: fc.Arbitrary<IsoCase> = fc
  .record({
    sec: fc.integer({ min: META_MIN_MS / 1000, max: META_MAX_MS / 1000 }),
    offsetMin: fc.constantFrom(0, 0, 60, -300, 330, -90),
  })
  .map(({ sec, offsetMin }) => {
    const ms = sec * 1000;
    if (offsetMin === 0) return { text: new Date(ms).toISOString().replace(".000Z", "Z"), ms };
    const local = new Date(ms + offsetMin * 60_000).toISOString().replace(/\.\d{3}Z$/, "");
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return { text: `${local}${offsetMin < 0 ? "-" : "+"}${hh}:${mm}`, ms };
  });

export interface MetaRepoCase {
  readonly name: string;
  readonly owner: string;
  readonly archived: boolean;
  readonly pushedAt: IsoCase | null;
  readonly openIssues: number;
  readonly license: { spdx_id: string | null } | null;
}

export const arbMetaRepo: fc.Arbitrary<MetaRepoCase> = fc.record({
  name: arbOwnerOrName,
  owner: arbOwnerOrName,
  archived: fc.boolean(),
  pushedAt: fc.option(arbIsoCase, { nil: null }),
  openIssues: fc.integer({ min: 0, max: 5000 }),
  license: fc.option(
    fc.record({
      spdx_id: fc.option(
        fc.constantFrom("MIT", "Apache-2.0", "GPL-3.0", "BSD-3-Clause", "NOASSERTION"),
        { nil: null },
      ),
    }),
    { nil: null },
  ),
});

export type ArbOptional<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "absent" }
  | { readonly status: "degraded"; readonly cause: "http-5xx" | "timeout" | "network" };

const arbOptional = <T>(ok: fc.Arbitrary<T>): fc.Arbitrary<ArbOptional<T>> =>
  fc.oneof(
    { weight: 3, arbitrary: ok.map((value): ArbOptional<T> => ({ status: "ok", value })) },
    { weight: 1, arbitrary: fc.constant<ArbOptional<T>>({ status: "absent" }) },
    {
      weight: 1,
      arbitrary: fc
        .constantFrom("http-5xx", "timeout", "network" as const)
        .map((cause): ArbOptional<T> => ({
          status: "degraded",
          cause: cause as "http-5xx" | "timeout" | "network",
        })),
    },
  );

export interface MetaCase {
  readonly repo: MetaRepoCase;
  readonly nowMs: number;
  readonly pulls: ArbOptional<{ count: number; oldest: IsoCase | null }>;
  readonly release: ArbOptional<{ published: IsoCase | null }>;
}

export const arbMetaCase: fc.Arbitrary<MetaCase> = fc.record({
  repo: arbMetaRepo,
  nowMs: fc.integer({ min: META_MIN_MS, max: META_MAX_MS }),
  pulls: arbOptional(
    fc.oneof(
      fc.constant({ count: 0, oldest: null as IsoCase | null }),
      fc.record({ count: fc.integer({ min: 1, max: 6000 }), oldest: arbIsoCase }),
    ),
  ),
  release: arbOptional(fc.record({ published: fc.option(arbIsoCase, { nil: null }) })),
});

// ---- P29: HTTP and transport failure classification (task 15.2) ----

export type ArbEndpoint = "repo" | "commit" | "tarball" | "pulls" | "release";

export const arbEndpoint: fc.Arbitrary<ArbEndpoint> = fc.constantFrom(
  "repo",
  "commit",
  "tarball",
  "pulls",
  "release",
);

/** Endpoints that are REST calls (tarball excluded). */
export const arbRestEndpoint: fc.Arbitrary<Exclude<ArbEndpoint, "tarball">> = fc.constantFrom(
  "repo",
  "commit",
  "pulls",
  "release",
);

/** Redirect statuses 300-399. */
export const arbRedirectStatus: fc.Arbitrary<number> = fc.integer({ min: 300, max: 399 });

const HANDLED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409, 422, 429, 451]);

/** Statuses with no defined mapping: 2xx (non-200) and 4xx not handled elsewhere. */
export const arbUnexpectedStatus: fc.Arbitrary<number> = fc
  .oneof(fc.integer({ min: 201, max: 299 }), fc.integer({ min: 400, max: 499 }))
  .filter((s) => !HANDLED_STATUSES.has(s));

/** Headers that carry no rate-limit signal (lower-case names). */
export const arbNoRateLimitHeaders: fc.Arbitrary<Record<string, string>> = fc.record(
  {
    "content-type": fc.constantFrom("application/json", "text/plain"),
    "x-ratelimit-remaining": fc.integer({ min: 1, max: 5000 }).map(String),
    server: fc.constantFrom("GitHub.com", "nginx"),
  },
  { requiredKeys: [] },
);

// ---- P21: tar entry paths (task 21.2) ----

export interface TarEntriesCase {
  /** Raw entries for `makeTarGz`, pax global header and root directory first. */
  readonly entries: RawTarEntry[];
  /** Expected repository-relative files after sequential extraction (last write wins). */
  readonly expectedFiles: ReadonlyMap<string, string>;
  /** True iff a non-traversal, non-vendored entry lies under `.github/workflows/`. */
  readonly expectedHasWorkflowsDir: boolean;
}

const TAR_VENDORED = new Set([
  ".git",
  "bower_components",
  "node_modules",
  "site-packages",
  "third_party",
  "vendor",
]);
const TAR_VENDOR_NAMES = [...TAR_VENDORED];
const LOWER_ID = "abcdefghijklmnopqrstuvwxyz0123456789_".split("");

const arbTarSegment: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 2, arbitrary: fc.constantFrom("a", "b", "c") },
    {
      weight: 3,
      arbitrary: fc
        .array(fc.constantFrom(...LOWER_ID), { minLength: 1, maxLength: 8 })
        .map((cs) => cs.join("")),
    },
    { weight: 1, arbitrary: fc.constant("__proto__") },
  )
  .filter((s) => !TAR_VENDORED.has(s));

const arbTarCleanPath: fc.Arbitrary<string> = fc
  .array(arbTarSegment, { minLength: 1, maxLength: 4 })
  .map((segs) => segs.join("/"));

const arbTarText: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghij klmnop\n.#=:-".split("")), { maxLength: 40 })
  .map((cs) => cs.join(""));

interface TarItem {
  readonly entry: RawTarEntry;
  readonly file?: { readonly path: string; readonly content: string };
  readonly workflow?: boolean;
}

/** Sequences of tar entries mixing clean, hostile, linked, special and vendored entries. */
export const arbTarEntries: fc.Arbitrary<TarEntriesCase> = fc
  .record({
    owner: fc.array(fc.constantFrom(...LOWER_ID), { minLength: 1, maxLength: 6 }),
    repo: fc.array(fc.constantFrom(...LOWER_ID), { minLength: 1, maxLength: 6 }),
    sha: arbSha40Any,
    pax: fc.boolean(),
    items: fc.array(
      arbTarCleanPath.chain((path) =>
        fc.record({
          kind: fc.constantFrom(
            "clean",
            "clean",
            "clean",
            "workflow",
            "workflowDir",
            "dir",
            "traversal",
            "absolute",
            "vendored",
            "symlink",
            "hardlink",
            "special",
          ),
          path: fc.constant(path),
          wfName: arbTarSegment,
          content: arbTarText,
          variant: fc.integer({ min: 0, max: 3 }),
          vendor: fc.constantFrom(...TAR_VENDOR_NAMES),
          vendorDepth: fc.integer({ min: 0, max: 1 }),
          special: fc.constantFrom("3", "4", "6"),
        }),
      ),
      { maxLength: 14 },
    ),
  })
  .map((r) => {
    const prefix = `${r.owner.join("")}-${r.repo.join("")}-${r.sha}/`;
    const built: TarItem[] = r.items.map((it): TarItem => {
      switch (it.kind) {
        case "clean":
          return {
            entry: { name: `${prefix}${it.path}`, body: it.content },
            file: { path: it.path, content: it.content },
          };
        case "workflow": {
          const path = `.github/workflows/${it.wfName}.yml`;
          return {
            entry: { name: `${prefix}${path}`, body: it.content },
            file: { path, content: it.content },
            workflow: true,
          };
        }
        case "workflowDir":
          return { entry: { name: `${prefix}.github/workflows/`, typeflag: "5" }, workflow: true };
        case "dir":
          return { entry: { name: `${prefix}${it.path}/`, typeflag: "5" } };
        case "traversal": {
          const names = [
            `${prefix}../${it.path}`,
            `${prefix}${it.wfName}/../../${it.wfName}`,
            `${prefix}a\\..\\${it.path}`,
            `${prefix}.github/workflows/../../${it.wfName}.yml`,
          ];
          return { entry: { name: names[it.variant] ?? names[0]!, body: it.content } };
        }
        case "absolute": {
          const names = [`/${it.path}`, `\\${it.path}`, `C:/${it.path}`, `/${prefix}${it.path}`];
          return { entry: { name: names[it.variant] ?? names[0]!, body: it.content } };
        }
        case "vendored": {
          const path =
            it.vendorDepth === 0 ? `${it.vendor}/${it.wfName}` : `${it.wfName}/${it.vendor}/${it.wfName}`;
          return { entry: { name: `${prefix}${path}`, body: it.content } };
        }
        case "symlink":
          return {
            entry: {
              name: `${prefix}links/${it.path}`,
              typeflag: "2",
              linkname: it.variant % 2 === 0 ? "/etc/passwd" : "../../outside",
            },
          };
        case "hardlink":
          return {
            entry: { name: `${prefix}links/${it.path}`, typeflag: "1", linkname: "README.md" },
          };
        default:
          return { entry: { name: `${prefix}special/${it.path}`, typeflag: it.special } };
      }
    });

    const expectedFiles = new Map<string, string>();
    let expectedHasWorkflowsDir = false;
    for (const b of built) {
      if (b.file) expectedFiles.set(b.file.path, b.file.content);
      if (b.workflow) expectedHasWorkflowsDir = true;
    }
    const entries: RawTarEntry[] = [
      ...(r.pax ? [paxGlobalEntry({ comment: r.sha })] : []),
      { name: prefix, typeflag: "5" },
      ...built.map((b) => b.entry),
    ];
    return { entries, expectedFiles, expectedHasWorkflowsDir };
  });
