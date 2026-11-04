// @necro/github: the only module that builds headers or touches FetchPort for GitHub hosts.
// Requirements: R2.5, R2.6, R2.8, R2.9, R2.10, R4.8, R4.9, R6.2, R6.3, R6.4, R6.5, R7.8.
// Design: "GitHub client". Part A: headersFor, getJson, restCallCount. Part B (task 18.5): openTarball, externalRequest.
import type { z } from "zod";
import {
  CODELOAD_HOST,
  EXTERNAL_HOSTS,
  GITHUB_API_HOST,
  GITHUB_AUTH_HOSTS,
  MAX_REST_JSON_BYTES,
  REST_CALL_BUDGET,
  TIMEOUT_EXTERNAL_MS,
  TIMEOUT_REST_MS,
  TIMEOUT_TARBALL_MS,
} from "./constants.js";
import { redactSecrets, summonerError, SummonerError } from "./errors.js";
import { classifyFailure, type DegradedOutcome, type Failure } from "./http-failure.js";
import { FetchTransportError, type FetchPort, type FetchResponse, type SummonerDeps } from "./ports.js";
import { GithubTokenSchema } from "./schemas/github.js";

export type { DegradedOutcome } from "./http-failure.js";

export interface GitHubClientOptions {
  readonly userAgent?: string;
  readonly timeouts?: Partial<{ restMs: number; tarballMs: number }>;
}

/** Structurally compatible with the RequestContext of http-failure.ts. */
export interface RequestContext {
  readonly endpoint: "repo" | "commit" | "pulls" | "release" | "tarball";
  readonly repo: { readonly owner: string; readonly name: string };
  /** true once the repo endpoint has returned 200 for this operation. */
  readonly repoProven: boolean;
  /** true ONLY for the Optional_REST_Calls (pulls, release). */
  readonly optional: boolean;
  /** true ONLY for the first GET /repos/{owner}/{repo} of an operation (D2). */
  readonly allowRepoRedirect: boolean;
}

export type OptionalJsonResult<T> =
  | { readonly status: "ok"; readonly data: T; readonly headers: Readonly<Record<string, string>> }
  | { readonly status: "absent" }
  | DegradedOutcome;

export interface JsonResult<T> {
  readonly data: T;
  readonly headers: Readonly<Record<string, string>>;
}

const DEFAULT_USER_AGENT = "necro-oracle";
const API_VERSION = "2022-11-28";
const FOLLOWED_REDIRECTS: ReadonlySet<number> = new Set([301, 307, 308]);
const SAFE_PATH_RE = /^\/[\x21-\x7e]*$/;

function refusal(reason: string): SummonerError {
  return summonerError("VALIDATION_FAILED", { what: "A request", where: "host policy", reason });
}

/**
 * Pure. Builds request headers and enforces the host allow-list (SSRF guard).
 * Authorization is added only on https, default port, host exactly github.com or api.github.com.
 */
export function headersFor(
  url: string,
  token: string | undefined,
  userAgent: string = DEFAULT_USER_AGENT,
): Record<string, string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw refusal("invalid-url");
  }
  if (u.protocol !== "https:") throw refusal("scheme-not-allowed");
  if (u.port !== "") throw refusal("port-not-allowed");
  if (u.username !== "" || u.password !== "") throw refusal("credentials-in-url");

  const host = u.hostname;
  const headers: Record<string, string> = { "User-Agent": userAgent };
  if (GITHUB_AUTH_HOSTS.has(host)) {
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
  } else if (host !== CODELOAD_HOST && !EXTERNAL_HOSTS.has(host)) {
    throw refusal("host-not-allowed");
  }
  if (host === GITHUB_API_HOST) {
    headers["Accept"] = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = API_VERSION;
  }
  return headers;
}

function cancelBody(res: FetchResponse): void {
  if (res.body !== null) res.body.cancel().catch(() => undefined);
}

/** Absolute https://api.github.com (default port) location, else undefined. */
function apiRedirectTarget(res: FetchResponse): string | undefined {
  const loc = res.headers["location"];
  if (loc === undefined) return undefined;
  try {
    const u = new URL(loc);
    if (u.protocol !== "https:" || u.hostname !== GITHUB_API_HOST || u.port !== "") return undefined;
    if (u.username !== "" || u.password !== "") return undefined;
    return loc;
  } catch {
    return undefined;
  }
}

type ReadResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

async function readJsonCapped(res: FetchResponse): Promise<ReadResult> {
  if (res.body === null) return { ok: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REST_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false };
  }
}

/** One instance per summon/build operation. */
export class GitHubClient {
  private readonly deps: SummonerDeps;
  private readonly userAgent: string;
  private readonly restMs: number;
  protected readonly tarballMs: number;
  private calls = 0;

  constructor(deps: SummonerDeps, opts: GitHubClientOptions = {}) {
    this.deps = deps;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.restMs = opts.timeouts?.restMs ?? TIMEOUT_REST_MS;
    this.tarballMs = opts.timeouts?.tarballMs ?? TIMEOUT_TARBALL_MS;
  }

  /** REST_Calls sent to api.github.com by this client. */
  get restCallCount(): number {
    return this.calls;
  }

  getJson<T>(
    path: string,
    schema: z.ZodType<T>,
    ctx: RequestContext & { readonly optional: false },
  ): Promise<JsonResult<T>>;
  getJson<T>(
    path: string,
    schema: z.ZodType<T>,
    ctx: RequestContext & { readonly optional: true },
  ): Promise<OptionalJsonResult<T>>;
  async getJson<T>(
    path: string,
    schema: z.ZodType<T>,
    ctx: RequestContext,
  ): Promise<JsonResult<T> | OptionalJsonResult<T>> {
    if (!SAFE_PATH_RE.test(path) || path.startsWith("//")) throw refusal("path-not-allowed");
    const firstUrl = `https://${GITHUB_API_HOST}${path}`;
    const token = this.readToken();

    let url = firstUrl;
    let followed = false;
    for (;;) {
      let res: FetchResponse;
      try {
        res = await this.send(url, token, ctx);
      } catch (e) {
        if (e instanceof TransportOutcome) return this.settle(e.outcome, ctx);
        throw e;
      }

      if (res.status >= 200 && res.status <= 299) {
        const read = await readJsonCapped(res);
        const parsed = read.ok ? schema.safeParse(read.value) : undefined;
        if (parsed?.success === true) {
          return ctx.optional
            ? { status: "ok", data: parsed.data, headers: res.headers }
            : { data: parsed.data, headers: res.headers };
        }
        return this.settle(classifyFailure({ kind: "invalid-body" }, this.classCtx(ctx, token), this.deps.clock.nowMs()), ctx);
      }

      cancelBody(res);

      if (
        !followed &&
        ctx.allowRepoRedirect &&
        !ctx.optional &&
        ctx.endpoint === "repo" &&
        FOLLOWED_REDIRECTS.has(res.status)
      ) {
        const target = apiRedirectTarget(res);
        if (target !== undefined) {
          followed = true;
          url = target;
          continue;
        }
      }

      const failure: Failure = { kind: "http", status: res.status, headers: res.headers };
      return this.settle(classifyFailure(failure, this.classCtx(ctx, token), this.deps.clock.nowMs()), ctx);
    }
  }

  private classCtx(ctx: RequestContext, token: string | undefined): RequestContext & { authenticated: boolean } {
    return { ...ctx, authenticated: token !== undefined };
  }

  /** Throw errors; return absent/degraded for optional contexts. */
  private settle<T>(
    outcome: ReturnType<typeof classifyFailure>,
    ctx: RequestContext,
  ): OptionalJsonResult<T> {
    if (outcome instanceof SummonerError) throw outcome;
    if (!ctx.optional) {
      throw summonerError("VALIDATION_FAILED", {
        what: "A response",
        where: "GitHub API",
        reason: "unexpected-status",
      });
    }
    return outcome;
  }

  private readToken(): string | undefined {
    const raw = this.deps.env.get("GITHUB_TOKEN");
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (!GithubTokenSchema.safeParse(trimmed).success) throw summonerError("AUTH_INVALID");
    return trimmed;
  }

  /** Budget guard, header policy, counted fetch. Transport failures become classified outcomes. */
  private async send(url: string, token: string | undefined, ctx: RequestContext): Promise<FetchResponse> {
    if (this.calls >= REST_CALL_BUDGET) throw refusal("rest-budget-exceeded");
    const headers = headersFor(url, token, this.userAgent);
    this.calls += 1;
    try {
      return await this.deps.fetch({
        url,
        method: "GET",
        headers,
        timeoutMs: this.restMs,
        redirect: "manual",
      });
    } catch (e) {
      const error = redactedTransportError(e, token);
      const outcome = classifyFailure({ kind: "transport", error }, this.classCtx(ctx, token), this.deps.clock.nowMs());
      throw new TransportOutcome(outcome);
    }
  }

  /**
   * Opens the source archive. Not a REST_Call (does not count against the budget).
   * No token: direct codeload URL, no redirects. Token: api.github.com with Bearer, then at most
   * one redirect to https://codeload.github.com (default port), followed WITHOUT Authorization.
   */
  async openTarball(
    ref: { readonly owner: string; readonly name: string; readonly sha: string },
    signal?: AbortSignal,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentLength: number | null }> {
    if (!TARBALL_SEGMENT_RE.test(ref.owner) || ref.owner === "." || ref.owner === "..") {
      throw refusal("bad-owner");
    }
    if (!TARBALL_SEGMENT_RE.test(ref.name) || ref.name === "." || ref.name === "..") {
      throw refusal("bad-name");
    }
    if (!SHA40_RE.test(ref.sha)) throw refusal("bad-sha");
    const token = this.readToken();

    const ctx = {
      endpoint: "tarball" as const,
      repo: { owner: ref.owner, name: ref.name },
      repoProven: false,
      optional: false,
      allowRepoRedirect: false,
      authenticated: token !== undefined,
    };

    if (token === undefined) {
      const url = `https://${CODELOAD_HOST}/${ref.owner}/${ref.name}/tar.gz/${ref.sha}`;
      const res = await this.tarballFetch(url, undefined, signal, ctx);
      return this.finishTarball(res, ctx);
    }

    const apiUrl = `https://${GITHUB_API_HOST}/repos/${ref.owner}/${ref.name}/tarball/${ref.sha}`;
    const first = await this.tarballFetch(apiUrl, token, signal, ctx);
    if (first.status >= 200 && first.status <= 299) return this.finishTarball(first, ctx);
    if (!TARBALL_REDIRECTS.has(first.status)) return this.finishTarball(first, ctx);

    cancelBody(first);
    const target = codeloadRedirectTarget(first);
    if (target === undefined) throw refusal("redirect-refused");

    const second = await this.tarballFetch(target, undefined, signal, ctx);
    return this.finishTarball(second, ctx);
  }

  private async tarballFetch(
    url: string,
    token: string | undefined,
    signal: AbortSignal | undefined,
    ctx: RequestContext & { authenticated: boolean },
  ): Promise<FetchResponse> {
    const headers = headersFor(url, token, this.userAgent);
    try {
      return await this.deps.fetch({
        url,
        method: "GET",
        headers,
        timeoutMs: this.tarballMs,
        redirect: "manual",
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (e) {
      const error = redactedTransportError(e, token ?? this.readToken());
      const outcome = classifyFailure(
        { kind: "transport", error },
        { ...ctx, endpoint: "tarball" },
        this.deps.clock.nowMs(),
      );
      if (outcome instanceof SummonerError) throw outcome;
      throw refusal("unexpected-outcome");
    }
  }

  /** Final response: 2xx yields the stream; anything else is refused (3xx) or classified. */
  private finishTarball(
    res: FetchResponse,
    ctx: RequestContext & { authenticated: boolean },
  ): { body: ReadableStream<Uint8Array>; contentLength: number | null } {
    if (res.status >= 200 && res.status <= 299) {
      if (res.body === null) throw refusal("empty-body");
      const raw = res.headers["content-length"]?.trim();
      const contentLength = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
      return { body: res.body, contentLength };
    }
    cancelBody(res);
    if (res.status >= 300 && res.status <= 399) throw refusal("redirect-refused");
    const outcome = classifyFailure(
      { kind: "http", status: res.status, headers: res.headers },
      { ...ctx, endpoint: "tarball" },
      this.deps.clock.nowMs(),
    );
    if (outcome instanceof SummonerError) throw outcome;
    throw refusal("unexpected-status");
  }
}

const TARBALL_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
const SHA40_RE = /^[0-9a-fA-F]{40}$/;
const TARBALL_REDIRECTS: ReadonlySet<number> = new Set([301, 302, 307, 308]);

/** Absolute https://codeload.github.com (default port, no credentials) location, else undefined. */
function codeloadRedirectTarget(res: FetchResponse): string | undefined {
  const loc = res.headers["location"];
  if (loc === undefined) return undefined;
  try {
    const u = new URL(loc);
    if (u.protocol !== "https:" || u.hostname !== CODELOAD_HOST || u.port !== "") return undefined;
    if (u.username !== "" || u.password !== "") return undefined;
    return loc;
  } catch {
    return undefined;
  }
}

/**
 * Transport failure with the live token redacted from message and stack (R6.5). The adapter's
 * original error (which may echo request headers) is never attached.
 */
function redactedTransportError(e: unknown, token: string | undefined): FetchTransportError {
  const secrets = token === undefined ? [] : [token];
  const kind = e instanceof FetchTransportError ? e.kind : "network";
  const message = e instanceof Error ? e.message : "fetch failed";
  return new FetchTransportError(kind, redactSecrets(message, secrets));
}

/** Internal carrier so a degraded transport outcome can unwind from send(). */
class TransportOutcome extends Error {
  constructor(readonly outcome: ReturnType<typeof classifyFailure>) {
    super("transport outcome");
  }
}

/** Part B (task 18.5). */
export async function externalRequest(
  deps: { readonly fetch: FetchPort },
  url: string,
  opts: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<FetchResponse> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw refusal("invalid-url");
  }
  if (u.protocol !== "https:") throw refusal("scheme-not-allowed");
  if (u.port !== "") throw refusal("port-not-allowed");
  if (u.username !== "" || u.password !== "") throw refusal("credentials-in-url");
  if (!EXTERNAL_HOSTS.has(u.hostname)) throw refusal("host-not-allowed");

  const requested = opts.timeoutMs;
  const timeoutMs =
    requested !== undefined && Number.isFinite(requested) && requested > 0
      ? Math.min(requested, TIMEOUT_EXTERNAL_MS)
      : TIMEOUT_EXTERNAL_MS;

  return deps.fetch({
    url,
    method: "GET",
    headers: headersFor(url, undefined),
    timeoutMs,
    redirect: "manual",
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}
