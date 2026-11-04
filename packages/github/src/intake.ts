// @necro/github: repository reference parsing (pure; no network, clock or env).
// Requirements: R1.1-R1.11, R7.2.
import { z } from "zod";
import { summonerError, SummonerError } from "./errors.js";
import type { GitHubClient } from "./github-client.js";
import { classifyFailure } from "./http-failure.js";
import { GhCommitSchema, GhRepoSchema, type GhRepo, type ResolvedRepoRefSchema } from "./schemas/github.js";

export type RepoRef = z.infer<typeof ResolvedRepoRefSchema>;

export interface IntakeDeps {
  readonly client: GitHubClient;
}

export interface ParsedRepoRef {
  readonly host: "github.com";
  readonly owner: string;
  readonly name: string;
  readonly ref: string | null;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const SHA40_RE = /^[0-9a-fA-F]{40}$/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const MAX_INPUT = 2048;
const MAX_REF = 255;

function validSegment(s: string): boolean {
  return NAME_RE.test(s) && s !== "." && s !== "..";
}

function validRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > MAX_REF) return false;
  if (/[\s\x00-\x1f\x7f\\?*[~^:]/.test(ref)) return false;
  if (ref.includes("..")) return false;
  if (ref.startsWith("-") || ref.startsWith("/")) return false;
  return true;
}

export const ParsedRepoRefSchema: z.ZodType<ParsedRepoRef> = z.object({
  host: z.literal("github.com"),
  owner: z.string().refine(validSegment),
  name: z.string().refine(validSegment),
  ref: z.string().refine(validRef).nullable(),
});

function reject(reason: string): SummonerError {
  return summonerError("INVALID_REPO_URL", { reason });
}

/** Pure. Throws SummonerError { code: "INVALID_REPO_URL" } with a reason code; never echoes input. */
export function parseRepoRef(input: string): ParsedRepoRef {
  // 1. type and length
  if (typeof input !== "string") throw reject("empty");
  if (input.length > MAX_INPUT) throw reject("bad-characters");
  // 2. trim, strip trailing slashes
  let s = input.trim();
  if (s.length === 0) throw reject("empty");
  s = s.replace(/\/+$/, "");
  if (s.length === 0) throw reject("empty");

  let owner: string;
  let rawName: string;
  let rawRef: string | null = null;

  if (SCHEME_RE.test(s)) {
    // 4. URL form
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw reject("unsupported-path");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw reject("bad-scheme");
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") throw reject("foreign-host");
    if (url.username !== "" || url.password !== "") throw reject("has-credentials");
    if (url.port !== "") throw reject("foreign-host");
    const segs = url.pathname.split("/").slice(1);
    while (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
    const [o, r, tree, ...refSegs] = segs;
    if (o === undefined || o === "") throw reject("missing-owner");
    if (r === undefined || r === "") throw reject("missing-name");
    if (segs.length === 2) {
      // plain owner/repo
    } else if (tree === "tree" && refSegs.length > 0) {
      try {
        rawRef = refSegs.map((x) => decodeURIComponent(x)).join("/");
      } catch {
        throw reject("bad-ref");
      }
    } else {
      throw reject("unsupported-path");
    }
    owner = o;
    rawName = r;
  } else {
    // 5. shorthand
    const idx = s.search(/[#@]/);
    const head = idx === -1 ? s : s.slice(0, idx);
    if (idx !== -1) rawRef = s.slice(idx + 1);
    const parts = head.split("/");
    if (parts.length !== 2) {
      throw reject(parts.length < 2 ? "missing-name" : "unsupported-path");
    }
    const [o, r] = parts as [string, string];
    if (o === "") throw reject("missing-owner");
    if (r === "") throw reject("missing-name");
    owner = o;
    rawName = r;
  }

  // 6. strip one trailing .git
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (name === "") throw reject("missing-name");

  // 7. validate owner / name
  if (!validSegment(owner) || !validSegment(name)) throw reject("bad-characters");

  // 8. validate ref
  let ref: string | null = null;
  if (rawRef !== null) {
    if (!validRef(rawRef)) throw reject("bad-ref");
    ref = SHA40_RE.test(rawRef) ? rawRef.toLowerCase() : rawRef;
  }

  // 9.
  return { host: "github.com", owner, name, ref };
}

const encodeRefPath = (ref: string): string => ref.split("/").map(encodeURIComponent).join("/");

/**
 * Resolves a parsed reference to an immutable RepoRef plus the validated repo payload.
 * Call 1: repo (canonical identity, privacy). Call 2: commit (ref or default branch).
 */
export async function resolveRefDetailed(
  parsed: ParsedRepoRef,
  deps: IntakeDeps,
): Promise<{ ref: RepoRef; repo: GhRepo }> {
  const { client } = deps;
  const { data: repo } = await client.getJson(
    `/repos/${parsed.owner}/${parsed.name}`,
    GhRepoSchema as unknown as z.ZodType<GhRepo>,
    {
      endpoint: "repo",
      repo: { owner: parsed.owner, name: parsed.name },
      repoProven: false,
      optional: false,
      allowRepoRedirect: true,
    },
  );

  const owner = repo.owner.login;
  const name = repo.name;

  if (repo.private) {
    const outcome = classifyFailure(
      { kind: "private-payload" },
      { endpoint: "repo", repo: { owner, name }, repoProven: false, optional: false, allowRepoRedirect: false },
      0,
    );
    if (outcome instanceof SummonerError) throw outcome;
    throw summonerError("REPO_PRIVATE", { owner, name });
  }

  const target = parsed.ref ?? repo.default_branch;
  // `ref` is read by classifyFailure (REF_NOT_FOUND) via the client's spread of ctx.
  const commitCtx = {
    endpoint: "commit",
    repo: { owner, name },
    repoProven: true,
    optional: false,
    allowRepoRedirect: false,
    ref: target,
  } as const;
  const { data: commit } = await client.getJson(
    `/repos/${owner}/${name}/commits/${encodeRefPath(target)}`,
    GhCommitSchema,
    commitCtx,
  );

  if (parsed.ref !== null && SHA40_RE.test(parsed.ref) && commit.sha !== parsed.ref.toLowerCase()) {
    throw summonerError("VALIDATION_FAILED", {
      what: "A commit response",
      where: "GitHub API",
      reason: "sha-mismatch",
    });
  }

  return { ref: { owner, name, sha: commit.sha, defaultBranch: repo.default_branch }, repo };
}

export async function resolveRef(parsed: ParsedRepoRef, deps: IntakeDeps): Promise<RepoRef> {
  return (await resolveRefDetailed(parsed, deps)).ref;
}
