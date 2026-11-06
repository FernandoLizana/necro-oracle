// @necro/coven — cross-sink secret masking (design: "Error Handling",
// "Redaction"; R12.3, R12.4, R13.2). PURE module: it imports `@necro/oracle`
// (the shared `maskSecret` fingerprint) and the local models only — no
// adapters, no side effects.
//
// Responsibility: before ANY content leaves the runner into a sink — the
// per-file diff, the unified Patch, a Stream_Line (phase/skip-note), a ledger
// entry, or the LLM prompt — every secret-like value inside it is reduced to
// the fixed oracle mask token so no raw secret (including a configured LLM API
// key, if it were ever to appear inside repository content) survives (R12.3,
// R13.2). The web route layers its own `redactDeep` on top for the GitHub/LLM
// tokens it holds (task 13.2); this module covers the coven layer, which is the
// only place that sees raw repository `Before_Content`/`After_Content`.
//
// Masking is total over the inputs it is designed for: `maskSecretsInText`
// never throws for a string. The one failure mode the design calls out (R12.4)
// is a content ITEM that cannot be masked at all — e.g. a value that is not a
// string, so the secret scan cannot even run over it. `maskContentItem` makes
// that explicit: it returns the masked text for a well-formed string item and
// throws a typed `NecroError` for an item masking cannot complete, so the
// caller can WITHHOLD that item from every sink rather than leak it unmasked.
//
// The detection patterns mirror the oracle Devil detector's secret scan so the
// two layers agree on what "secret-like" means (AWS access-key ids, PEM
// private-key headers, and credential-named assignments). The raw matched value
// is handed straight to `maskSecret`; it is never copied, logged, or returned.

import { maskSecret } from "@necro/oracle";

import { covenError } from "./models.js";

// ---------------------------------------------------------------------------
// Secret-detection patterns (mirrored from the oracle Devil detector so both
// layers classify the same substrings as secret-like). All are global so every
// occurrence in the text is masked, not just the first.
// ---------------------------------------------------------------------------

/** AWS access key id: `AKIA` followed by 16 upper-alphanumeric chars. */
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;

/** PEM private-key header (RSA or PKCS#8). */
const PRIVATE_KEY_HEADER_RE = /-----BEGIN (?:RSA )?PRIVATE KEY-----/g;

/**
 * A credential-named assignment: a secret-ish identifier assigned a quoted
 * string of length >= 8. The quote char and the value are captured so only the
 * value (not the identifier or the quotes) is masked. Mirrors the Devil
 * detector's assignment scan.
 */
const SECRET_ASSIGNMENT_RE =
  /([A-Za-z_]\w*)\s*=\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})')/g;

/** Identifier substrings that mark a value as a credential (case-insensitive). */
const SECRET_NAME_RE = /(secret|password|passwd|credential|token|api_?key)/i;

// ---------------------------------------------------------------------------
// Text masking (total — never throws for a string).
// ---------------------------------------------------------------------------

/**
 * Replace every secret-like substring in `text` with its `maskSecret`
 * fingerprint. Returns the text with all detected secrets masked; a string with
 * no secret-like content is returned byte-for-byte unchanged.
 *
 * The three passes are independent substring replacements, so the function is
 * idempotent on its own output: the mask token (`<first 4>****` or `****`) does
 * not itself match any of the secret patterns, so a second pass finds nothing
 * new. This is the primitive every sink routes through; it NEVER throws.
 */
export function maskSecretsInText(text: string): string {
  let out = text.replace(AWS_KEY_RE, (match) => maskSecret(match));
  out = out.replace(PRIVATE_KEY_HEADER_RE, (match) => maskSecret(match));
  out = out.replace(SECRET_ASSIGNMENT_RE, (whole, ident: string, dq, sq) => {
    const value: string = dq ?? sq ?? "";
    if (!SECRET_NAME_RE.test(ident)) return whole;
    // Reconstruct the assignment with only the quoted VALUE masked, preserving
    // the identifier, the `=`, and the original quote character.
    const quote = whole.includes(`"${value}"`) ? '"' : "'";
    const masked = maskSecret(value);
    return whole.replace(`${quote}${value}${quote}`, `${quote}${masked}${quote}`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Content-item masking (R12.4 — withhold-on-failure).
// ---------------------------------------------------------------------------

/** The typed error raised when a content item cannot be masked (R12.4). */
export function maskFailedError(cause?: unknown): ReturnType<typeof covenError> {
  return covenError(
    "VALIDATION_FAILED",
    // oracle-voice: one mystical line, then the actionable technical fact.
    // No path, no secret, no stack (R12.5) — the item is withheld, not named.
    "A fragment would not take the mask; it is left in the dark.\n" +
      "A content item could not be redacted and was withheld from the result.",
    cause,
  );
}

/**
 * Mask every secret-like value in one content item for safe routing to any
 * sink. Returns the masked text when the item is a well-formed string; throws
 * the typed `maskFailedError` (R12.4) when masking cannot complete — e.g. the
 * item is not a string so the scan cannot run over it. The caller catches the
 * throw and WITHHOLDS the item from every sink, never leaking it unmasked.
 *
 * This is the single guarded entry point the runner uses for each file's
 * `Before_Content`, `After_Content`, and residual text before they reach the
 * diff, the Patch, a Stream_Line, the ledger, or the LLM prompt.
 */
export function maskContentItem(item: unknown): string {
  if (typeof item !== "string") {
    throw maskFailedError();
  }
  try {
    return maskSecretsInText(item);
  } catch (cause) {
    // `maskSecretsInText` is total for strings, so this is belt-and-braces:
    // any unexpected throw still becomes a withhold-and-raise (R12.4) rather
    // than an unmasked leak.
    throw maskFailedError(cause);
  }
}
