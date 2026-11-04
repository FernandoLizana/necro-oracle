// Error renderer for @necro/ui-crt (task 9.2).
//
// Validates: Requirements R11.1, R11.2, R11.3, R11.8, R11.9
//
// `renderError` turns a `{ code, userMessage }` pair into a single `error`
// block (R11.8). Its first line is always `ERROR <CODE>` (R11.1). It splits the
// `userMessage` at the FIRST `\n`: the part before is the mystical line and the
// rest are the technical lines (R11.2). When the message has no newline, a
// per-code generic mystical line is used and the whole message becomes the
// technical line (R11.3). Every one of the 18 `NecroErrorCode`s has a fallback
// entry, so the renderer is total. `stack`, `cause` and exception text are not
// inputs, so they can never surface (R11.9); the fallback copy is written to
// avoid any such leak-shaped marker.

import { NecroError, type NecroErrorCode } from "@necro/oracle/client";

import { sanitizeText } from "../text/sanitize.js";
import { wrapText } from "../text/wrap.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/**
 * A per-code generic mystical line used when the `userMessage` carries no
 * newline. The table is total over the 18-code enum (`Record<NecroErrorCode,
 * string>`), so omitting a code — or adding one upstream — fails the build.
 * The copy is in-world and actionable, and contains no leak-shaped tokens.
 */
// Every line is in-world and actionable, and is written to avoid leak-shaped
// tokens: no "at " (a stack-frame prefix), no "Error:", "stack" or "cause".
const MYSTICAL_FALLBACK: Readonly<Record<NecroErrorCode, string>> = {
  REGISTRY_INVALID: "The deck itself is malformed; the cards will not settle.",
  CARD_NOT_FOUND: "No such card lives in this deck.",
  PARSER_INIT_FAILED: "The reading glass clouded before the vision began.",
  FILE_TOO_LARGE: "This tome is too heavy for the oracle to lift.",
  INVALID_QUERY_PATTERN: "The incantation was malformed; the glass stays dark.",
  SNAPSHOT_DIR_NOT_FOUND: "The body was laid out, then lost in the mists.",
  INVALID_REPO_META: "The repository's markings are unreadable.",
  DETECTOR_FAILED: "One of the seers faltered mid-reading.",
  INVALID_REPO_URL: "This is no path the oracle can follow.",
  REPO_NOT_FOUND: "No repository answers by this name.",
  REPO_PRIVATE: "A locked crypt; the oracle may not enter.",
  RATE_LIMITED: "The gate is barred for a little while.",
  NETWORK_TIMEOUT: "The summons echoed into silence.",
  DOWNLOAD_TOO_LARGE: "The corpse is too vast to raise whole.",
  VALIDATION_FAILED: "The reply does not fit the oracle's ledger.",
  REF_NOT_FOUND: "No such commit haunts this repository.",
  AUTH_INVALID: "The sigil of passage is spent or false.",
  UPSTREAM_UNAVAILABLE: "The realms beyond will not answer just now.",
};

/** Build wrapped `OutputLine`s of sanitised plain text. */
function textLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/**
 * Render a terminal error as a single `error` block. Total over the 18-code
 * enum; leaks no internals (only `code` and `userMessage` are read).
 */
export function renderError(err: {
  code: NecroErrorCode;
  userMessage: string;
}): BlockDraft {
  const lines: OutputLine[] = [];
  lines.push(...textLines(`ERROR ${err.code}`));

  const newlineIndex = err.userMessage.indexOf("\n");
  if (newlineIndex === -1) {
    // No newline: generic mystical line + the whole message as the technical.
    lines.push(...textLines(MYSTICAL_FALLBACK[err.code]));
    lines.push(...textLines(err.userMessage));
  } else {
    const mystical = err.userMessage.slice(0, newlineIndex);
    const technical = err.userMessage.slice(newlineIndex + 1);
    lines.push(...textLines(mystical));
    lines.push(...textLines(technical));
  }

  return { kind: "error", demo: false, lines };
}

// Terminal-raised error builders (task 10.2).
//
// Validates: Requirements R11.4, R11.5, R11.6, R18.9, R18.10
//
// These four builders construct the `NecroError`s the terminal raises itself,
// never a server envelope: a connection failure / client timeout
// (`networkError`, R11.4/R11.6), a `>= 500` response with no valid envelope
// (`upstreamError`, R11.5), a response that failed the zod schema
// (`invalidResponseError`, R18.9), and a demo chunk that could not load
// (`demoUnavailableError`, R18.10). Each carries a two-line Oracle_Voice
// `userMessage` (mystical line, "\n", technical line) built fresh on every
// call with no wrapped `cause`, so no stack/exception text can surface.

/** Connection failure or client-side timeout before any reply arrived. */
export function networkError(): NecroError {
  return new NecroError(
    "NETWORK_TIMEOUT",
    "The summons echoed into silence.\n" +
      "The connection failed or timed out; check your link and retry.",
  );
}

/** Upstream answered `>= 500` or with no valid envelope the oracle can read. */
export function upstreamError(): NecroError {
  return new NecroError(
    "UPSTREAM_UNAVAILABLE",
    "The realms beyond will not answer just now.\n" +
      "The upstream service is unavailable (server fault); retry later.",
  );
}

/** The reply arrived but failed the oracle's schema validation. */
export function invalidResponseError(): NecroError {
  return new NecroError(
    "VALIDATION_FAILED",
    "The reply does not fit the oracle's ledger.\n" +
      "The response failed validation; its shape was malformed. Retry soon.",
  );
}

/** The lazy demo chunk could not be loaded into the terminal. */
export function demoUnavailableError(): NecroError {
  return new NecroError(
    "NETWORK_TIMEOUT",
    "The replay would not wake from its slumber.\n" +
      "The demo could not load; reload the page while online.",
  );
}
