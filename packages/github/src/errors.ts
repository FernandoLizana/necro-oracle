// @necro/github: typed errors, oracle-voice message catalog, and secret redaction.
// Requirements: R6.5, R7.1, R7.7, R7.8, R7.10, R7.11.
import { NecroError, type NecroErrorCode } from "@necro/oracle";

export type SummonerErrorCode = Extract<
  NecroErrorCode,
  | "INVALID_REPO_URL"
  | "REPO_NOT_FOUND"
  | "REPO_PRIVATE"
  | "RATE_LIMITED"
  | "NETWORK_TIMEOUT"
  | "DOWNLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "REF_NOT_FOUND"
  | "AUTH_INVALID"
  | "UPSTREAM_UNAVAILABLE"
>;

/** Non-secret scalars only. */
export interface SummonerErrorDetails {
  readonly reason?: string;
  readonly ref?: string;
  readonly httpStatus?: number;
  readonly retryAfterMinutes?: number;
  readonly limit?: "compressed" | "uncompressed" | "entries";
}

/** Flat context; each code reads only the fields it declares. */
export interface ErrorContext {
  readonly owner?: string;
  readonly name?: string;
  readonly ref?: string;
  readonly minutes?: number;
  readonly limit?: "compressed" | "uncompressed" | "entries";
  readonly reason?: string;
  readonly service?: string;
  readonly httpStatus?: number;
  readonly what?: string;
  readonly where?: string;
  /** Known secrets to mask in message, details and cause. */
  readonly secrets?: readonly string[];
}

export class SummonerError extends NecroError {
  declare readonly code: SummonerErrorCode;
  readonly details: SummonerErrorDetails;

  constructor(
    code: SummonerErrorCode,
    userMessage: string,
    details: SummonerErrorDetails,
    cause?: unknown,
  ) {
    super(code, userMessage, cause);
    this.name = "SummonerError";
    this.details = details;
  }
}

const REDACTED = "[REDACTED]";
const BEARER_RE = /Bearer\s+\S+/gi;
const TOKEN_PREFIX_RE = /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]*/g;

/** Replace known secrets, then Bearer credentials and GitHub token prefixes. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  const known = [...new Set(secrets.filter((s) => s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  for (const s of known) out = out.split(s).join(REDACTED);
  return out.replace(BEARER_RE, REDACTED).replace(TOKEN_PREFIX_RE, REDACTED);
}

/**
 * Sanitized clone of an originating error: keeps name, code and status, with
 * message and stack redacted. The original object is never attached.
 */
export function sanitizeCause(error: unknown, secrets: readonly string[] = []): Error {
  if (!(error instanceof Error)) {
    return new Error(redactSecrets(String(error), secrets));
  }
  const clean = new Error(redactSecrets(error.message, secrets));
  clean.name = error.name;
  if (error.stack !== undefined) clean.stack = redactSecrets(error.stack, secrets);
  const src = error as Error & { code?: unknown; status?: unknown };
  const target = clean as Error & { code?: unknown; status?: unknown };
  if (typeof src.code === "string") target.code = redactSecrets(src.code, secrets);
  else if (typeof src.code === "number") target.code = src.code;
  if (typeof src.status === "number") target.status = src.status;
  return clean;
}

/** Redact, force printable ASCII, and flatten to one line. */
function field(value: string | undefined, secrets: readonly string[], fallback: string): string {
  if (value === undefined || value === "") return fallback;
  return redactSecrets(value, secrets).replace(/[^\x20-\x7E]/g, "?");
}

function wholeMinutes(m: number | undefined): number {
  if (m === undefined || !Number.isFinite(m)) return 1;
  return Math.max(1, Math.ceil(m));
}

const LIMIT_TEXT = {
  compressed: "compressed 50 MB",
  uncompressed: "uncompressed 200 MB",
  entries: "100000 entries",
} as const;

export function summonerError(
  code: SummonerErrorCode,
  ctx: ErrorContext = {},
  cause?: unknown,
): SummonerError {
  const secrets = ctx.secrets ?? [];
  const f = (v: string | undefined, fb: string): string => field(v, secrets, fb);
  const repo = `${f(ctx.owner, "unknown")}/${f(ctx.name, "unknown")}`;
  let mystical = "";
  let technical = "";
  const details: { -readonly [K in keyof SummonerErrorDetails]: SummonerErrorDetails[K] } = {};

  switch (code) {
    case "INVALID_REPO_URL": {
      const reason = f(ctx.reason, "unrecognized-input");
      details.reason = reason;
      mystical = "The sigil is malformed. The oracle cannot trace it.";
      technical = `Expected owner/repo or https://github.com/owner/repo. Rejected: ${reason}.`;
      break;
    }
    case "REPO_NOT_FOUND":
      mystical = "No grave lies at this address.";
      technical = `GitHub shows no repository ${repo} visible to this token. Check the spelling, or the repository moved or was renamed.`;
      break;
    case "REPO_PRIVATE":
      mystical = "A sealed crypt. The oracle reads only open graves.";
      technical = `${repo} is private or cannot be shown to be public. Only public repositories are supported.`;
      break;
    case "RATE_LIMITED": {
      const n = wholeMinutes(ctx.minutes);
      details.retryAfterMinutes = n;
      mystical = "The spirits are silent. GitHub bars the door.";
      technical = `GitHub API rate limit reached. Retry in ${n} min.`;
      break;
    }
    case "NETWORK_TIMEOUT":
      mystical = "The ether does not answer.";
      technical = `${f(ctx.service, "GitHub API")} did not respond in time or was unreachable. Retry shortly.`;
      break;
    case "DOWNLOAD_TOO_LARGE": {
      const limit = ctx.limit ?? "compressed";
      details.limit = limit;
      mystical = "This crypt is too vast to enter.";
      technical = `The archive exceeded the ${LIMIT_TEXT[limit]} limit. Try a smaller repository.`;
      break;
    }
    case "VALIDATION_FAILED":
      if (ctx.reason !== undefined) details.reason = f(ctx.reason, "");
      mystical = "The spirits spoke in a tongue the oracle does not know.";
      technical = `${f(ctx.what, "A response")} failed validation (${f(ctx.where, "GitHub API")}). Retry; report it if it persists.`;
      break;
    case "REF_NOT_FOUND": {
      const ref = f(ctx.ref, "unknown");
      details.ref = ref;
      mystical = "The name you speak is not written in this grave.";
      technical = `Ref "${ref}" does not exist in ${repo}. Check the branch, tag, or commit SHA, or omit the ref to read the default branch.`;
      break;
    }
    case "AUTH_INVALID":
      mystical = "The key is refused. The gate stays shut.";
      technical =
        "GitHub rejected the credentials in GITHUB_TOKEN. Replace the token or unset it to read public repositories without one.";
      break;
    case "UPSTREAM_UNAVAILABLE": {
      if (ctx.httpStatus !== undefined) details.httpStatus = ctx.httpStatus;
      mystical = "The halls of GitHub are dark tonight.";
      technical = `${f(ctx.service, "GitHub API")} answered with a server error (HTTP ${ctx.httpStatus ?? "unknown"}). This is not your repository; retry in a few minutes.`;
      break;
    }
  }

  if (code !== "INVALID_REPO_URL" && code !== "VALIDATION_FAILED" && ctx.reason !== undefined) {
    details.reason = f(ctx.reason, "");
  }
  if (code !== "UPSTREAM_UNAVAILABLE" && ctx.httpStatus !== undefined) {
    details.httpStatus = ctx.httpStatus;
  }

  return new SummonerError(
    code,
    `${mystical}\n${technical}`,
    details,
    cause === undefined ? undefined : sanitizeCause(cause, secrets),
  );
}
