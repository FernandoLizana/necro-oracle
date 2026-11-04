// @necro/github: pure HTTP and transport failure classifier.
// Requirements: R2.9, R2.11, R4.7, R4.9, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8, R7.9.
// Design: "HTTP and transport failure mapping".
import { sanitizeCause, summonerError, type SummonerError } from "./errors.js";
import type { FetchTransportError } from "./ports.js";

export type FailureEndpoint = "repo" | "commit" | "pulls" | "release" | "tarball";

/** Structural request context; compatible with the RequestContext of github-client.ts. */
export interface RequestContext {
  readonly endpoint: FailureEndpoint;
  readonly repo: { readonly owner: string; readonly name: string };
  readonly repoProven: boolean;
  readonly optional: boolean;
  readonly allowRepoRedirect: boolean;
  /** Whether the request carried a token. */
  readonly authenticated?: boolean;
  /** Requested ref, echoed in REF_NOT_FOUND. */
  readonly ref?: string;
}

export type Failure =
  | {
      readonly kind: "http";
      readonly status: number;
      /** Lower-cased header names. */
      readonly headers: Readonly<Record<string, string>>;
      readonly bodyHint?: string;
    }
  | { readonly kind: "transport"; readonly error: FetchTransportError }
  | { readonly kind: "private-payload" }
  | { readonly kind: "invalid-body" };

export type DegradedField = "pulls" | "release";
export type DegradedCause = "http-5xx" | "timeout" | "network";

export interface DegradedOutcome {
  readonly status: "degraded";
  readonly field: DegradedField;
  readonly cause: DegradedCause;
  readonly httpStatus?: number;
  readonly sanitizedCause: Error;
}

/** Neutral outcome: 404 or a zod failure on an optional call. */
export interface AbsentOutcome {
  readonly status: "absent";
}

export type FailureOutcome = SummonerError | DegradedOutcome | AbsentOutcome;

const RATE_HINT_RE = /rate[\s_-]*limit/i;

function isOptional(endpoint: FailureEndpoint): endpoint is DegradedField {
  return endpoint === "pulls" || endpoint === "release";
}

function minutesFor(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** Wait in whole minutes: Retry-After, else reset instant (when remaining is 0), else 1. */
function waitMinutes(headers: Readonly<Record<string, string>>, nowMs: number): number {
  const ra = headers["retry-after"]?.trim();
  if (ra !== undefined && ra !== "") {
    if (/^\d+$/.test(ra)) return minutesFor(Number(ra) * 1000);
    const dateMs = Date.parse(ra);
    if (Number.isFinite(dateMs)) return minutesFor(dateMs - nowMs);
  }
  if (headers["x-ratelimit-remaining"]?.trim() === "0") {
    const reset = headers["x-ratelimit-reset"]?.trim();
    if (reset !== undefined && /^\d+$/.test(reset)) return minutesFor(Number(reset) * 1000 - nowMs);
  }
  return 1;
}

function isRateLimited(
  status: number,
  headers: Readonly<Record<string, string>>,
  bodyHint: string | undefined,
): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return (
    headers["retry-after"] !== undefined ||
    headers["x-ratelimit-remaining"]?.trim() === "0" ||
    (bodyHint !== undefined && RATE_HINT_RE.test(bodyHint))
  );
}

export function classifyFailure(failure: Failure, ctx: RequestContext, nowMs: number): FailureOutcome {
  const { endpoint } = ctx;
  const base = { owner: ctx.repo.owner, name: ctx.repo.name };

  switch (failure.kind) {
    case "private-payload":
      return summonerError("REPO_PRIVATE", base);

    case "invalid-body":
      if (isOptional(endpoint)) return { status: "absent" };
      return summonerError("VALIDATION_FAILED", {
        what: "A response body",
        where: "GitHub API",
        reason: "invalid-body",
      });

    case "transport": {
      const kind = failure.error.kind;
      if (isOptional(endpoint)) {
        return {
          status: "degraded",
          field: endpoint,
          cause: kind,
          sanitizedCause: sanitizeCause(failure.error),
        };
      }
      return summonerError("NETWORK_TIMEOUT", {}, failure.error);
    }

    case "http":
      break;
  }

  const { status, headers, bodyHint } = failure;

  if (status === 401) return summonerError("AUTH_INVALID");

  if (isRateLimited(status, headers, bodyHint)) {
    return summonerError("RATE_LIMITED", { minutes: waitMinutes(headers, nowMs) });
  }

  if (status >= 300 && status <= 399) {
    return summonerError("VALIDATION_FAILED", {
      what: "A redirect",
      where: "GitHub API",
      reason: "redirect-refused",
    });
  }

  if (status >= 500 && status <= 599) {
    if (isOptional(endpoint)) {
      return {
        status: "degraded",
        field: endpoint,
        cause: "http-5xx",
        httpStatus: status,
        sanitizedCause: sanitizeCause(new Error(`HTTP ${status}`)),
      };
    }
    return summonerError("UPSTREAM_UNAVAILABLE", { httpStatus: status });
  }

  if (status === 404) {
    switch (endpoint) {
      case "repo":
        return summonerError(ctx.authenticated === true ? "REPO_NOT_FOUND" : "REPO_PRIVATE", base);
      case "commit":
        return summonerError("REF_NOT_FOUND", {
          ...base,
          ...(ctx.ref !== undefined ? { ref: ctx.ref } : {}),
        });
      case "tarball":
        return summonerError("REPO_NOT_FOUND", base);
      case "pulls":
      case "release":
        return { status: "absent" };
    }
  }

  if ((status === 422 || status === 409) && endpoint === "commit") {
    return summonerError("REF_NOT_FOUND", {
      ...base,
      ...(ctx.ref !== undefined ? { ref: ctx.ref } : {}),
      ...(status === 409 ? { reason: "empty-repository" } : {}),
    });
  }

  if (status === 403 || status === 451) return summonerError("REPO_PRIVATE", base);

  return summonerError("VALIDATION_FAILED", {
    what: "A response",
    where: "GitHub API",
    reason: "unexpected-status",
    httpStatus: status,
  });
}
