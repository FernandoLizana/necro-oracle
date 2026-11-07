// apps/web/src/server/handlers/guard.ts
//
// Feature: 03-crt-terminal, task 25.2.
//
// The shared request/response guard pipeline both route handlers use
// (design.md §"Handler pipeline" steps 1-4, §"Error mapper", §"Rate limiter";
// R12.1, R12.2, R12.3, R12.8, R13.1, R13.5, R13.7). Pure HTTP plumbing over
// the injected `RouteDeps`: no network, LLM, or sandbox of its own — only the
// limiter facade (which the chain guarantees never rejects) and the env port.
//
// Helpers exported here:
//   - `methodNotAllowed(req)`      -> 405 + Allow: POST (+ Error_Envelope body,
//                                      omitted for HEAD)
//   - `readJsonBody(req)`          -> parsed body or a 400/413 guard Response
//   - `checkLimit(req, deps, route)` -> a 429 Response when limited, else null
//   - `jsonResponse` / `errorResponse` / `envelopeResponse` response builders
//
// Every response carries `Cache-Control: no-store` and
// `X-Content-Type-Options: nosniff` (R12.8); success adds
// `Content-Type: application/json`.
//
// _Requirements: R5.3, R12.1, R12.2, R12.3, R12.8, R13.1, R13.5, R13.7_

import type { NecroErrorCode } from "@necro/oracle/client";

import { clientIp } from "../client-ip.js";
import type { RouteDeps } from "../deps.js";
import { mapError, rateLimitedError, type ErrorEnvelope } from "../error-map.js";
import type { RouteName } from "../limiter/port.js";

/** The hard cap on a request body, in bytes (design.md step 3). */
const MAX_BODY_BYTES = 2048;

/** The two security headers every route response carries (R12.8). */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Build a plain `{ error: { code, userMessage } }` envelope. Kept local so the
 * guard can raise `VALIDATION_FAILED` without reaching for a NecroError.
 */
function envelope(code: NecroErrorCode, userMessage: string): ErrorEnvelope {
  return { error: { code, userMessage } };
}

/**
 * A 200 JSON success Response carrying the two security headers plus
 * `Content-Type: application/json`.
 */
export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Build an error Response from a status, an Error_Envelope body, and optional
 * extra headers (e.g. `Retry-After`, `Allow`). Always carries the two security
 * headers and an `application/json` content type.
 */
export function envelopeResponse(
  status: number,
  body: ErrorEnvelope,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

/**
 * Shorthand for a guard-raised error Response of exactly one code + message at
 * the given status (used for the 400/413 body-guard failures).
 */
export function errorResponse(
  status: number,
  code: NecroErrorCode,
  userMessage: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return envelopeResponse(status, envelope(code, userMessage), extraHeaders);
}

/** The fixed Oracle-voice message for a request that violates a body guard. */
const BAD_REQUEST_MESSAGE =
  "The offering is malformed.\nThe oracle accepts only a small JSON request.";

/** The fixed Oracle-voice message for a request body that exceeds the cap. */
const TOO_LARGE_MESSAGE =
  "The offering is too heavy.\nTrim the request below two kilobytes and try again.";

/** The fixed Oracle-voice message for a method other than POST. */
const METHOD_MESSAGE =
  "This rite answers only the proper call.\nSend your request as POST.";

/**
 * Answer any non-POST method: `405` with `Allow: POST` and the two security
 * headers. A `HEAD` request carries NO body (RFC 9110); every other method
 * carries a `VALIDATION_FAILED` Error_Envelope.
 */
export function methodNotAllowed(req: Request): Response {
  const headers = { ...SECURITY_HEADERS, Allow: "POST", "Content-Type": "application/json" };
  if (req.method === "HEAD") {
    return new Response(null, { status: 405, headers: { ...SECURITY_HEADERS, Allow: "POST" } });
  }
  return new Response(JSON.stringify(envelope("VALIDATION_FAILED", METHOD_MESSAGE)), {
    status: 405,
    headers,
  });
}

/** The outcome of reading a request body: a parsed value or a guard Response. */
export type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/**
 * Does the `Content-Type` media type equal `application/json`? Parameters like
 * `charset=utf-8` are allowed; only the media type (before the first `;`) is
 * compared, case-insensitively and trimmed.
 */
function isJsonContentType(req: Request): boolean {
  const raw = req.headers.get("content-type");
  if (raw === null) return false;
  const mediaType = raw.split(";", 1)[0]!.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Read and JSON-parse a request body under the route guards (design.md step
 * 3). Enforces, in order:
 *   - `Content-Type` media type `application/json` (else `400`);
 *   - a declared `Content-Length` over the cap (else proceeds), OR a body that
 *     exceeds the cap while being read (`413`);
 *   - valid JSON (`400` otherwise).
 * On success resolves `{ ok: true, value }`; every failure resolves
 * `{ ok: false, response }` with a guard Response carrying the security
 * headers.
 */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  if (!isJsonContentType(req)) {
    return { ok: false, response: errorResponse(400, "VALIDATION_FAILED", BAD_REQUEST_MESSAGE) };
  }

  // Reject early on a declared length over the cap.
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return { ok: false, response: errorResponse(413, "VALIDATION_FAILED", TOO_LARGE_MESSAGE) };
    }
  }

  // Read the body as text; enforce the byte cap on the decoded UTF-8 length so
  // an undeclared or lying Content-Length cannot slip a large body past.
  const text = await req.text();
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, "VALIDATION_FAILED", TOO_LARGE_MESSAGE) };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: errorResponse(400, "VALIDATION_FAILED", BAD_REQUEST_MESSAGE) };
  }
}

/**
 * The limiter step (design.md step 2): compute the hashed client id, ask the
 * limiter chain, and on denial build a `429` Response with a `Retry-After`
 * header (integer seconds) and the Oracle-voice `RATE_LIMITED` envelope. On
 * allow, resolves `null` so the handler proceeds. This runs BEFORE any GitHub
 * work (R13.1). The chain never rejects, so no try/catch is needed here.
 *
 * `dailyCeilingOverride` (lovers-binding R20.1): the Lovers_Route applies its
 * SEPARATE server daily ceiling from `NECRO_LOVERS_DAILY_CEILING` here, reusing
 * the same per-IP abuse chain (keyed by the `"lovers"` route) and the shared
 * daily-counter infrastructure. When omitted, the shared
 * `NECRO_DAILY_REQUEST_CEILING` applies (the resurrect/summon/readings routes).
 */
export async function checkLimit(
  req: Request,
  deps: RouteDeps,
  route: RouteName,
  dailyCeilingOverride?: number,
): Promise<Response | null> {
  const ipId = clientIp(req, deps.env);
  const decision = await deps.limiter.check({
    route,
    ipId,
    dailyCeiling: dailyCeilingOverride ?? deps.env.get("NECRO_DAILY_REQUEST_CEILING"),
  });
  if (decision.allowed) return null;

  const token = deps.env.get("GITHUB_TOKEN");
  const mapped = mapError(rateLimitedError(decision.retryAfterSeconds), token);
  return envelopeResponse(mapped.status, mapped.body, {
    ...mapped.headers,
    "Retry-After": String(decision.retryAfterSeconds),
  });
}
