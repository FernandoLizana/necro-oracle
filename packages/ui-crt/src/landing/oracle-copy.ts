// src/landing/oracle-copy.ts
//
// Feature: oracle-landing-polish, task 12.1.
//
// The pure oracle-voice copy for the LEGACY REPOS list's empty and
// fetch-failure states (design §"In-world error and empty states"; R19.5,
// R19.6, R19.7). Every message is two layers: a short mystical line (<= 16
// words) then the plain technical fact. Each line is ASCII-only, carries no
// emoji, and is <= 72 columns, so the DOM live-region text can equal the plain
// technical fact verbatim (R19.6).
//
// Nothing here reads the DOM, clock, network, or storage: it is a frozen table
// of authored strings, so the landing list can render the right state (an
// empty-state message vs an in-world error) without importing any adapter and
// without violating the dependency direction (ui-crt imports no adapters).

/** The maximum column width for any oracle-voice terminal/landing line. */
export const MAX_COLUMNS = 72;

/** The maximum word count for a mystical line. */
export const MAX_MYSTICAL_WORDS = 16;

/**
 * One two-layer oracle-voice message: a short mystical line and the plain
 * technical fact. `technical` is the authoritative text the DOM live region
 * reads verbatim (R19.6).
 */
export interface OracleCopy {
  /** The short in-world mystical line (<= 16 words, <= 72 cols). */
  readonly mystical: string;
  /** The plain technical fact (<= 72 cols); equals the live-region text. */
  readonly technical: string;
}

/**
 * Why the LEGACY REPOS list is empty. `"none"` is a legitimate zero-repo
 * result (show the empty-state message, R19.5); the fetch-failure reasons route
 * to the matching in-world error state INSTEAD of the empty message (R19.7).
 */
export type EmptyReason = "none" | "fetch-network" | "fetch-rate-limit";

/**
 * A legitimate zero-entry list: no legacy repositories to show. The ENTER row
 * is always available, so the technical fact points the user at it (R19.5).
 */
export const LANDING_EMPTY_COPY: OracleCopy = {
  mystical: "The crypt holds no graves to show.",
  technical: "No legacy repositories to list; enter any repo to summon one.",
};

/**
 * The list is empty because the underlying fetch failed with a network error
 * or timeout: show this in-world error state instead of the empty message
 * (R19.3-shaped, routed here by R19.7).
 */
export const LANDING_FETCH_NETWORK_COPY: OracleCopy = {
  mystical: "The summons echoed into silence.",
  technical: "The connection failed or timed out; check your link and retry.",
};

/**
 * The list is empty because the underlying fetch was rate-limited: show this
 * in-world error state instead of the empty message (R19.2-shaped, routed here
 * by R19.7). The wait is left vague-but-actionable here because this landing
 * path carries no retry-minutes value; the summon path's RATE_LIMITED error
 * (which does carry a whole 1..60 minute wait) is the precise one.
 */
export const LANDING_FETCH_RATE_LIMIT_COPY: OracleCopy = {
  mystical: "The gate is barred for a little while.",
  technical: "GitHub API rate-limited; retry in a few minutes.",
};

/**
 * Resolve the oracle-voice copy for a LEGACY REPOS list that rendered zero
 * entries, given WHY it is empty. A legitimate zero-repo result yields the
 * empty-state copy (R19.5); a fetch-failure yields the matching in-world error
 * copy (R19.7). Total over `EmptyReason`.
 */
export function emptyListCopy(reason: EmptyReason): OracleCopy {
  switch (reason) {
    case "none":
      return LANDING_EMPTY_COPY;
    case "fetch-network":
      return LANDING_FETCH_NETWORK_COPY;
    case "fetch-rate-limit":
      return LANDING_FETCH_RATE_LIMIT_COPY;
  }
}
