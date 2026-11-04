// @necro/github: GitHubSummoner, the GitHubSnapshotBuilder implementation (task 27.6).
// Requirements: R3.1, R3.7, R3.14, R4.6, R4.8, R8.1-R8.3, R8.6, R8.10-R8.14, R10.4.
// Design: "Summoner and builder", D5 (cache stores SummonResult, shallow copies), D7 (one clock reading).
import {
  buildSnapshotFromFileMap,
  type GitHubSnapshotBuilder,
  type RepoRef,
  type RepoSnapshot,
} from "@necro/oracle";
import type { z } from "zod";
import { GitHubClient } from "./github-client.js";
import { parseRepoRef, ParsedRepoRefSchema, resolveRefDetailed, type ParsedRepoRef } from "./intake.js";
import { classifyFailure, type DegradedField } from "./http-failure.js";
import { summonerError, SummonerError } from "./errors.js";
import type { SummonerDeps } from "./ports.js";
import { mapRepoMeta, type OptionalOutcome } from "./repo-meta.js";
import {
  GhPullsSchema,
  GhReleaseSchema,
  GhRepoSchema,
  ResolvedRepoRefSchema,
  type GhRepo,
} from "./schemas/github.js";
import { cacheKey, effectiveTtlMs, SnapshotCache } from "./snapshot-cache.js";
import { extractTarball, type ExtractionLimits } from "./tar-extract.js";
import { isoFromMs } from "./time.js";

export interface SummonExtras {
  readonly stars: number;
  readonly defaultBranch: string;
  readonly hasWorkflowsDir: boolean;
  readonly degradedFields: DegradedField[];
}

export interface SummonResult {
  readonly snapshot: RepoSnapshot;
  readonly extras: SummonExtras;
  readonly cache: "hit" | "miss";
}

export interface SummonerOptions {
  readonly cache?: { readonly ttlMs?: number; readonly maxEntries?: number };
  readonly limits?: Partial<ExtractionLimits>;
}

const StrictRefSchema = ResolvedRepoRefSchema.strict();

/** Page number of the `rel="last"` link, else null. */
function lastPage(link: string | undefined): number | null {
  if (link === undefined) return null;
  for (const part of link.split(",")) {
    if (!/;\s*rel="?last"?/i.test(part)) continue;
    const m = /<([^>]*)>/.exec(part);
    if (m?.[1] === undefined) continue;
    try {
      const page = new URL(m[1]).searchParams.get("page");
      if (page !== null && /^\d+$/.test(page) && Number(page) > 0) return Number(page);
    } catch {
      // ignore malformed link
    }
  }
  return null;
}

/** Fresh top-level objects so callers cannot mutate the cached entry (D5, R8.10). */
function copyResult(r: SummonResult, cache: "hit" | "miss"): SummonResult {
  return {
    snapshot: { ...r.snapshot, manifests: [...r.snapshot.manifests] },
    extras: { ...r.extras, degradedFields: [...r.extras.degradedFields] },
    cache,
  };
}

interface Operation {
  readonly client: GitHubClient;
  readonly ctl: AbortController;
}

export class GitHubSummoner implements GitHubSnapshotBuilder {
  private readonly cache: SnapshotCache<SummonResult>;
  private readonly inflight = new Map<string, Promise<SummonResult>>();
  private readonly limits: Partial<ExtractionLimits>;

  constructor(
    private readonly deps: SummonerDeps,
    opts: SummonerOptions = {},
  ) {
    this.cache = new SnapshotCache<SummonResult>(deps.clock, opts.cache ?? {});
    this.limits = opts.limits ?? {};
  }

  async build(ref: RepoRef): Promise<RepoSnapshot> {
    return (await this.buildDetailed(ref)).snapshot;
  }

  async buildDetailed(ref: RepoRef): Promise<SummonResult> {
    const parsed = StrictRefSchema.safeParse(ref);
    if (!parsed.success) {
      throw summonerError("VALIDATION_FAILED", { what: "The repository reference", where: "caller", reason: "invalid-ref" });
    }
    const key = cacheKey(ref);
    const hit = this.cache.get(key);
    if (hit !== undefined) return copyResult(hit, "hit");

    let pending = this.inflight.get(key);
    if (pending === undefined) {
      pending = this.run(ref).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, pending);
    }
    const shared = await pending;
    return copyResult(shared, shared.cache);
  }

  /** Parse, resolve (REST calls 1-2), then serve from cache or build reusing the call-1 payload. */
  async summon(input: string | ParsedRepoRef): Promise<SummonResult> {
    const parsed = typeof input === "string" ? parseRepoRef(input) : ParsedRepoRefSchema.parse(input);
    const op = this.newOperation();
    const { ref, repo } = await resolveRefDetailed(parsed, { client: op.client });
    const key = cacheKey(ref);
    const hit = this.cache.get(key);
    if (hit !== undefined) return copyResult(hit, "hit");

    let pending = this.inflight.get(key);
    if (pending === undefined) {
      pending = this.buildFromRepo(ref, repo, op).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, pending);
    }
    const shared = await pending;
    return copyResult(shared, shared.cache);
  }

  /** One client and one abort controller per operation; every request inherits the shared signal. */
  protected newOperation(): Operation {
    const ctl = new AbortController();
    const deps: SummonerDeps = {
      ...this.deps,
      fetch: (req) => this.deps.fetch(req.signal === undefined ? { ...req, signal: ctl.signal } : req),
    };
    return { client: new GitHubClient(deps), ctl };
  }

  private async run(ref: RepoRef): Promise<SummonResult> {
    const op = this.newOperation();
    const { data: repo } = await op.client.getJson(
      `/repos/${ref.owner}/${ref.name}`,
      GhRepoSchema as unknown as z.ZodType<GhRepo>,
      {
        endpoint: "repo",
        repo: { owner: ref.owner, name: ref.name },
        repoProven: false,
        optional: false,
        allowRepoRedirect: false,
      },
    );
    return this.buildFromRepo(ref, repo, op);
  }

  /** Steps after the repo payload is known; reused by `summon` (task 28.7) with a pre-fetched payload. */
  protected async buildFromRepo(ref: RepoRef, repo: GhRepo, op: Operation): Promise<SummonResult> {
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

    const canon = { owner, name, sha: ref.sha, defaultBranch: repo.default_branch };
    const key = cacheKey(canon);
    if (key !== cacheKey(ref)) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return { ...hit, cache: "hit" };
    }

    // D7: ONE clock reading per build.
    const nowMs = this.deps.clock.nowMs();
    const { client, ctl } = op;
    const base = `/repos/${owner}/${name}`;
    const ctx = { repo: { owner, name }, repoProven: true, allowRepoRedirect: false } as const;
    const guard = <T>(p: Promise<T>): Promise<T> =>
      p.catch((e: unknown) => {
        ctl.abort();
        throw e;
      });

    const pullsP = guard(
      client
        .getJson(
          `${base}/pulls?state=open&sort=created&direction=asc&per_page=1`,
          GhPullsSchema as unknown as z.ZodType<{ created_at: string }[]>,
          { ...ctx, endpoint: "pulls", optional: true },
        )
        .then((r): OptionalOutcome<{ count: number; oldestCreatedAt: string | null }> => {
          if (r.status === "ok") {
            const count = lastPage(r.headers["link"]) ?? r.data.length;
            return { status: "ok", value: { count, oldestCreatedAt: r.data[0]?.created_at ?? null } };
          }
          return r.status === "absent" ? { status: "absent" } : { status: "degraded", cause: r.cause };
        }),
    );
    const releaseP = guard(
      client
        .getJson(
          `${base}/releases/latest`,
          GhReleaseSchema as unknown as z.ZodType<{ published_at: string | null }>,
          { ...ctx, endpoint: "release", optional: true },
        )
        .then((r): OptionalOutcome<{ publishedAt: string | null }> => {
          if (r.status === "ok") return { status: "ok", value: { publishedAt: r.data.published_at } };
          return r.status === "absent" ? { status: "absent" } : { status: "degraded", cause: r.cause };
        }),
    );
    const treeP = guard(
      client
        .openTarball(canon, ctl.signal)
        .then(({ body, contentLength }) => extractTarball(body, this.limits, { contentLength })),
    );

    const [pulls, release, tree] = await Promise.all([pullsP, releaseP, treeP]);

    const { meta, degradedFields } = mapRepoMeta({ repo, pulls, release, nowMs });
    const snapshot = buildSnapshotFromFileMap(canon, tree.files, { meta, createdAt: isoFromMs(nowMs) });
    const result: SummonResult = {
      snapshot,
      extras: {
        stars: repo.stargazers_count,
        defaultBranch: repo.default_branch,
        hasWorkflowsDir: tree.hasWorkflowsDir,
        degradedFields: [...degradedFields],
      },
      cache: "miss",
    };
    this.cache.set(key, result, { ttlMs: effectiveTtlMs(this.cache.configuredTtlMs, degradedFields) });
    return result;
  }
}

export function createSummoner(deps: SummonerDeps, opts?: SummonerOptions): GitHubSummoner {
  return new GitHubSummoner(deps, opts);
}
