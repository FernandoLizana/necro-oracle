// src/session/history.ts
//
// Feature: 03-crt-terminal, task 12.2.
//
// Command-line history for the CRT terminal: a bounded ring of submitted
// entries plus Up/Down navigation with draft save/restore (design.md
// §"History and log"; requirements R3.2, R3.3).
//
// Pure computation — no side effects, no adapters. Every function returns a
// fresh `History` value; the stored `entries` array is never mutated.

/** Maximum number of submitted entries the history keeps (R3.2). */
export const HISTORY_MAX = 50;

/**
 * Command history state.
 *
 * - `entries` is the most-recent `HISTORY_MAX` submissions, oldest first.
 * - `cursor` is the index being browsed, or `null` on a fresh command line.
 * - `draft` is the unsubmitted text saved when navigation first begins, so a
 *   Down-past-newest can restore what the user was typing.
 */
export interface History {
  readonly entries: readonly string[];
  readonly cursor: number | null;
  readonly draft: string;
}

/**
 * Appends `entry`, dropping the oldest surplus so at most `HISTORY_MAX`
 * entries remain, and resets navigation to a fresh line (cursor `null`, draft
 * cleared). The kept entries are the last `min(n, HISTORY_MAX)` submissions in
 * submission order.
 */
export function historyPush(h: History, entry: string): History {
  const next = [...h.entries, entry];
  const entries =
    next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
  return { entries, cursor: null, draft: "" };
}

/**
 * Moves one entry older (Up Arrow). From a fresh line this saves `current` as
 * the draft and selects the newest entry; otherwise it steps toward older
 * entries and stops at index 0 (no wrap). Returns the updated history and the
 * text that should replace the command line.
 */
export function historyPrev(
  h: History,
  current: string,
): { history: History; text: string } {
  if (h.entries.length === 0) {
    // Nothing to browse: leave the line untouched.
    return { history: h, text: current };
  }
  if (h.cursor === null) {
    // First Up from a fresh line: remember the draft, select the newest entry.
    const cursor = h.entries.length - 1;
    return {
      history: { entries: h.entries, cursor, draft: current },
      text: h.entries[cursor]!,
    };
  }
  // Already browsing: step one older, stopping at the oldest entry.
  const cursor = Math.max(0, h.cursor - 1);
  return {
    history: { entries: h.entries, cursor, draft: h.draft },
    text: h.entries[cursor]!,
  };
}

/**
 * Moves one entry newer (Down Arrow). Stepping past the newest entry restores
 * the saved draft and returns to a fresh line (cursor `null`). On a fresh line
 * there is nothing newer to move to, so the line is left untouched.
 */
export function historyNext(
  h: History,
  current: string,
): { history: History; text: string } {
  if (h.cursor === null) {
    // Already on a fresh line: nothing newer to reach.
    return { history: h, text: current };
  }
  if (h.cursor >= h.entries.length - 1) {
    // Down from the newest entry: restore the draft, return to a fresh line.
    return {
      history: { entries: h.entries, cursor: null, draft: "" },
      text: h.draft,
    };
  }
  // Step one newer, staying within the entries.
  const cursor = h.cursor + 1;
  return {
    history: { entries: h.entries, cursor, draft: h.draft },
    text: h.entries[cursor]!,
  };
}
