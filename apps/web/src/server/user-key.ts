// apps/web/src/server/user-key.ts
//
// Feature: lovers-binding, task 11.2.
//
// BYOK ("bring your own key") transport for the user-supplied OpenRouter key
// (design §D.4 "Transport + redaction + cache-key exclusion"; R27.1, R27.2,
// R27.4, R27.5). The key travels per request in a dedicated header on the
// `/api/resurrect` and `/api/lovers` routes ONLY; this module is the single
// place that:
//   1. parses + validates the header value with a bounded zod schema,
//   2. distinguishes ABSENT (no header → not an error; `soulSource` stays
//      ORACLE) from PRESENT-BUT-MALFORMED (→ a typed `VALIDATION_FAILED`
//      `NecroError` with an oracle-voice `userMessage`),
//   3. supplies the redaction wiring so every outgoing stream line is redacted
//      with BOTH the server `OPENROUTER_API_KEY` and the user key, and
//   4. documents + structurally enforces that the completion/response cache key
//      (R5.3) NEVER includes the user key.
//
// SECURITY (R27.3): the user key is NEVER logged, echoed, cached, or included
// in an error body. The only place it flows is into the provider as
// `LlmCallOptions.apiKey` for the lifetime of a single request, after which it
// is dropped. This module therefore never prints the key and never returns it
// inside a `NecroError` (the malformed-key error message is a FIXED oracle-voice
// string that does not echo the offending header value).
//
// Pure computation: no network, LLM, or sandbox. The `redactDeep` wiring here
// is a thin re-export of the existing pure server redaction helper so the
// handlers (tasks 11.6a/11.6b) have one import for the "redact with the user
// key too" step.
//
// _Requirements: R27.1, R27.2, R27.4, R27.5_
// _Design: D.4 Transport + redaction + cache-key exclusion_

import { NecroError } from "@necro/oracle/client";
import { z } from "zod";

import { redactDeep } from "./redact.js";

/**
 * The dedicated transport header for the user-supplied OpenRouter key (R27.1).
 *
 * Exported LOWERCASE because `Headers.get()` / fetch header lookups are
 * case-insensitive but a lowercased name is the canonical form for a programmatic
 * lookup (`req.headers.get(USER_KEY_HEADER)`). The wire/display spelling is
 * `X-Necro-User-Key`; the browser client attaches it with that spelling in task
 * 11.9, and header names are matched case-insensitively, so this constant reads
 * the same value regardless of the casing the client sent.
 */
export const USER_KEY_HEADER = "x-necro-user-key" as const;

/**
 * A bounded, opaque user-key schema (design §D.4): a non-empty string of 8..512
 * characters containing NO whitespace and NO C0/DEL control characters
 * (`\x00-\x1f`, `\x7f`). The key is treated as OPAQUE — we never parse a
 * provider-specific shape, only reject values that could not be a safe header
 * token or that could smuggle a newline/control character into a log or an
 * outgoing line.
 *
 * The 8..512 bound comes straight from the design: 8 rejects trivially short /
 * empty values; 512 is a generous upper bound that still caps the amount of
 * attacker-controlled data accepted from the header.
 */
export const UserKeySchema = z
  .string()
  .regex(/^[^\s\x00-\x1f\x7f]{8,512}$/);

/**
 * The FIXED oracle-voice message for a present-but-malformed user key. It states
 * what happened and what to do next (oracle-voice rule 7) and deliberately does
 * NOT echo the offending header value (R27.3 — the key never appears in an error
 * body).
 */
export const MALFORMED_USER_KEY_MESSAGE =
  "The soul-token you offered is malformed.\n" +
  "Provide a key of 8-512 printable, space-free characters, or clear it to read as the Oracle.";

/**
 * The result of {@link parseUserKey}, a three-way discriminated union so the
 * resurrect/lovers handlers (tasks 11.6a/11.6b) can branch on exactly one of:
 *
 *   - `{ present: false }`      — NO header was sent. This is NOT an error:
 *                                 `soulSource` stays `ORACLE` and the route uses
 *                                 the server key / Mock default.
 *   - `{ ok: true; key }`       — a header was sent AND it validated. The handler
 *                                 sets `soulSource = YOURS`, MUST add `key` to
 *                                 the redaction set for the request's lifetime
 *                                 (see {@link redactLine}), and passes it to the
 *                                 provider as `LlmCallOptions.apiKey` for this
 *                                 request only.
 *   - `{ ok: false; error }`    — a header was sent but it is MALFORMED. The
 *                                 handler terminates with the carried typed
 *                                 `VALIDATION_FAILED` `NecroError` (R27.5).
 *
 * The `present: false` and `ok: false` cases are kept distinct (rather than
 * collapsing absent into "not ok") precisely so the handler can tell "read as
 * the Oracle" apart from "the caller sent garbage".
 */
export type ParseUserKeyResult =
  | { readonly present: false }
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly error: NecroError };

/**
 * Parse + validate the `X-Necro-User-Key` header value.
 *
 * @param headerValue the raw header value (e.g. `req.headers.get(USER_KEY_HEADER)`),
 *   which is `null` when the header is absent and may be `undefined` from other
 *   header shapes.
 * @returns a {@link ParseUserKeyResult}:
 *   - absent header (`null`/`undefined`) → `{ present: false }` (NOT an error);
 *   - present + valid → `{ ok: true, key }`;
 *   - present + malformed → `{ ok: false, error }` carrying a typed
 *     `VALIDATION_FAILED` `NecroError` with the fixed oracle-voice
 *     {@link MALFORMED_USER_KEY_MESSAGE}.
 *
 * Never logs, echoes, or returns the offending value on the malformed path.
 */
export function parseUserKey(
  headerValue: string | null | undefined,
): ParseUserKeyResult {
  // Absent header: not an error. `soulSource` stays ORACLE (R27.1 — the key is
  // only used "when a request carries a user key").
  if (headerValue === null || headerValue === undefined) {
    return { present: false };
  }

  const parsed = UserKeySchema.safeParse(headerValue);
  if (!parsed.success) {
    // Present but malformed (R27.5). The error carries a FIXED oracle-voice
    // message and NEVER the offending value (R27.3). The zod issue is NOT used
    // as the `cause`, so the raw header value cannot leak through an error chain.
    return {
      ok: false,
      error: new NecroError("VALIDATION_FAILED", MALFORMED_USER_KEY_MESSAGE),
    };
  }

  return { ok: true, key: parsed.data };
}

/**
 * Redact a single outgoing value with BOTH the server `OPENROUTER_API_KEY` and
 * the per-request user key (R27.2), in the same two-pass `redactDeep` pattern
 * the resurrect route already uses for the GitHub + LLM tokens.
 *
 * This is the redaction ENTRY POINT the handlers call for every outgoing stream
 * line: the user key MUST be added to the redaction set for the lifetime of the
 * request so that NO log line, response body, or error body can ever contain the
 * key value (R27.3). A `undefined`/empty token is a no-op (see `redactDeep`), so
 * an ORACLE request (no user key) still redacts the server key safely.
 *
 * @param line      the value about to leave the server (a stream line object).
 * @param serverKey the server `OPENROUTER_API_KEY` (may be `undefined`).
 * @param userKey   the validated per-request user key (undefined on ORACLE).
 */
export function redactLine(
  line: unknown,
  serverKey: string | undefined,
  userKey: string | undefined,
): unknown {
  // Two passes: the server key first, then the user key. Order is irrelevant to
  // the result (the marker never contains either token), but doing both is the
  // contract: EVERY outgoing line is scrubbed of both secrets.
  const afterServer = redactDeep(line, serverKey);
  return redactDeep(afterServer, userKey);
}

// --- Cache-key exclusion contract (R27.4) ----------------------------------
//
// CONTRACT: the completion/response cache key stays, per design §D.4 / R5.3,
//
//     sha256(purposeId + schemaName + PROMPT_VERSION + resolvedModel +
//            contentHash + retryFlag/errorHash)
//
// and NEVER includes the user key. This module makes that exclusion STRUCTURALLY
// true rather than merely asserted: the user key is produced ONLY by
// {@link parseUserKey} and consumed ONLY as the provider's
// `LlmCallOptions.apiKey` for a single request (and by {@link redactLine} to
// scrub it out of outgoing lines). It is never threaded into any cache-key input.
//
// The cache key is built in the `@necro/llm` / `@necro/coven` layer from the
// `LlmRequest.cacheKey` field (see `packages/llm/src/cache.ts`), which this
// module does not touch and to which the user key is never passed. Two tabs with
// different keys therefore share cache entries by content only, and no key byte
// is recoverable from a cache key.
//
// The exclusion is property-tested separately in task 11.3 (Property 3). This
// module's responsibility is to keep the key off every cache-key input path.
export {};
