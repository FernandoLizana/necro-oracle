// apps/web/src/server/redact.ts
//
// Feature: 03-crt-terminal, task 21.2.
//
// Server-side redaction helpers (design.md §"Redaction"; R12.6, R14.7).
// Before an error message or any JSON-like value leaves the server, every
// occurrence of a secret token (e.g. a GitHub installation token) is replaced
// with the fixed marker so no credential can leak into a response, a log, or
// an LLM prompt.
//
// Pure computation: no network, LLM, or sandbox. Both helpers are no-ops when
// the token is undefined or the empty string, and are idempotent (the marker
// never contains the token, so a second pass finds nothing to replace).
//
// _Requirements: R12.6, R14.7_

/** The fixed marker substituted for every occurrence of a secret token. */
const MARKER = "[REDACTED]";

/**
 * Replace every occurrence of `token` in `s` with {@link MARKER}.
 *
 * Returns `s` unchanged when `token` is undefined or the empty string. The
 * replacement is a plain substring substitution (not a regular expression), so
 * tokens containing regex metacharacters are handled literally.
 */
export function redactString(s: string, token?: string): string {
  if (token === undefined || token === "") return s;
  return s.split(token).join(MARKER);
}

/**
 * Recursively redact every string leaf of a JSON-like value.
 *
 * Strings are passed through {@link redactString}; arrays and plain objects are
 * rebuilt with each element/value redacted; numbers, booleans and null are
 * returned unchanged. The structure (array lengths, object keys) is preserved.
 * An undefined or empty token is a no-op (the input is returned unchanged).
 */
export function redactDeep(value: unknown, token?: string): unknown {
  if (token === undefined || token === "") return value;
  if (typeof value === "string") return redactString(value, token);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, token));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(item, token);
    }
    return out;
  }
  return value;
}

/**
 * SEC-04: redact EVERY in-scope secret out of a single string before it is
 * logged. Applies {@link redactString} once per token (`undefined`/empty
 * tokens are no-ops), so a thrown error's `message`/`stack` can be logged
 * for observability without ever leaking the GitHub token, the server/legacy
 * LLM keys, or a per-request BYOK user key. `undefined` in -> `undefined`
 * out, so an absent `err.stack` stays absent in the log.
 */
export function redactSecrets(
  s: string | undefined,
  tokens: readonly (string | undefined)[],
): string | undefined {
  if (s === undefined) return undefined;
  let out = s;
  for (const token of tokens) out = redactString(out, token);
  return out;
}
