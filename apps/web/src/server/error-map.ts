// apps/web/src/server/error-map.ts
//
// Feature: 03-crt-terminal, task 21.2.
//
// The server error mapper (design.md §"Error mapper"; R12.4, R12.5, R12.6,
// R12.7). It turns any thrown value into a safe HTTP response triple:
//   - a NecroError maps to its documented status, an Error_Envelope of exactly
//     { error: { code, userMessage } } (userMessage redacted), and — for a
//     summoner RATE_LIMITED carrying details.retryAfterMinutes — a Retry-After
//     header;
//   - any non-NecroError throwable maps to 500 + UPSTREAM_UNAVAILABLE and a
//     single fixed Oracle-voice message that leaks none of the thrown value's
//     message or stack text.
//
// The `cause` of a NecroError is never read nor serialised (R12.7).
//
// Pure computation: no network, LLM, or sandbox.
//
// _Requirements: R12.4, R12.5, R12.6, R12.7, R14.7_
import { NecroError, type NecroErrorCode } from "@necro/oracle/client";

import { redactString } from "./redact.js";

/** The error envelope carried in every error response body (R11.x). */
export interface ErrorEnvelope {
  readonly error: { readonly code: NecroErrorCode; readonly userMessage: string };
}

/** The HTTP response triple produced for a thrown value. */
export interface MappedError {
  readonly status: number;
  readonly body: ErrorEnvelope;
  readonly headers: Record<string, string>;
}

/**
 * The single fixed Oracle-voice message used for every non-NecroError
 * throwable. It must be identical across all inputs (P13 asserts a single
 * distinct message) and must interpolate none of the thrown value's text so no
 * internal detail or secret can leak (R12.5, R12.7).
 */
const UNEXPECTED_MESSAGE =
  "The veil is torn.\nAn unexpected fault stirred beyond the circle. Try again shortly.";

/** Map a NecroErrorCode to its HTTP status (design.md §"Error mapper"). */
export function statusFor(code: NecroErrorCode): number {
  switch (code) {
    case "INVALID_REPO_URL":
    case "VALIDATION_FAILED":
      return 400;
    case "REPO_PRIVATE":
      return 403;
    case "REPO_NOT_FOUND":
    case "REF_NOT_FOUND":
      return 404;
    case "DOWNLOAD_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
      return 429;
    case "AUTH_INVALID":
    case "UPSTREAM_UNAVAILABLE":
      return 502;
    case "NETWORK_TIMEOUT":
      return 504;
    default:
      return 500;
  }
}

/**
 * Duck-typed guard for a NecroError. Uses `instanceof` first (the common path)
 * and falls back to a shape check on `code` + `userMessage`, so an error that
 * crossed a module boundary (losing its prototype identity) is still handled
 * as a NecroError.
 */
function isNecroError(err: unknown): err is NecroError {
  if (err instanceof NecroError) return true;
  if (err === null || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; userMessage?: unknown };
  return (
    typeof candidate.code === "string" && typeof candidate.userMessage === "string"
  );
}

/** Read a numeric `details.retryAfterMinutes` from a summoner error, if any. */
function retryAfterMinutesOf(err: object): number | undefined {
  const details = (err as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return undefined;
  const minutes = (details as { retryAfterMinutes?: unknown }).retryAfterMinutes;
  return typeof minutes === "number" ? minutes : undefined;
}

/**
 * Map any thrown value to a safe {@link MappedError}. The `token`, when given,
 * is redacted out of the NecroError's userMessage before it is returned.
 */
export function mapError(err: unknown, token?: string): MappedError {
  if (isNecroError(err)) {
    const headers: Record<string, string> = {};
    if (err.code === "RATE_LIMITED") {
      const minutes = retryAfterMinutesOf(err);
      if (minutes !== undefined) {
        headers["Retry-After"] = String(minutes * 60);
      }
    }
    return {
      status: statusFor(err.code),
      body: {
        error: {
          code: err.code,
          userMessage: redactString(err.userMessage, token),
        },
      },
      headers,
    };
  }

  // Non-NecroError: a single fixed message, nothing of the thrown value.
  return {
    status: 500,
    body: { error: { code: "UPSTREAM_UNAVAILABLE", userMessage: UNEXPECTED_MESSAGE } },
    headers: {},
  };
}

/**
 * Build the Oracle-voice RATE_LIMITED error our own rate limiter raises on
 * rejection. `minutes = max(1, ceil(retryAfterSeconds / 60))` (design.md
 * §"Rate limiter", R13.5, R13.7).
 */
export function rateLimitedError(retryAfterSeconds: number): NecroError {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new NecroError(
    "RATE_LIMITED",
    `The oracle must rest.\nToo many readings from this address. Retry in ${minutes} min.`,
  );
}
