// src/session/history.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 15
//
// Property-based tests for command History bounds and navigation (task 12.1,
// TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `session/history.ts`
// (task 12.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module `./history.js` does not exist yet.
//
// Property 15 (requirements.md §"P15 — History bounds (R3.2, R3.3)"):
// For all sequences of submitted entries and Up Arrow / Down Arrow presses,
// the history length is at most 50, the history index stays within the history
// bounds, and the oldest entry is discarded first.
//
// Semantics under test (design.md §"History and log"):
//   HISTORY_MAX = 50
//   interface History {
//     readonly entries: readonly string[];
//     readonly cursor: number | null;
//     readonly draft: string;
//   }
//   historyPush(h, entry): History
//     - appends `entry`, drops oldest beyond 50, resets the cursor.
//   historyPrev(h, current): { history; text }
//     - from a fresh line (cursor === null) saves `current` as the draft and
//       selects the newest entry; otherwise moves one entry older; stops at
//       index 0 (no wrap).
//   historyNext(h, current): { history; text }
//     - moves one entry newer; stepping past the newest restores the draft and
//       returns cursor to null (fresh line).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R3.2, R3.3**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 12.2 adds this module.
import {
  HISTORY_MAX,
  historyNext,
  historyPrev,
  historyPush,
  type History,
} from "./history.js";

/** P15 runs the default property budget. */
const NUM_RUNS = 200;

/** A fresh, empty history on a blank command line. */
const EMPTY: History = { entries: [], cursor: null, draft: "" };

/** Navigation keys we interleave with pushes. */
type NavKey = "up" | "down";

/** An action applied to the live history/line pair during a session. */
type HistoryAction =
  | { readonly tag: "push"; readonly entry: string }
  | { readonly tag: "nav"; readonly key: NavKey };

/** Entries a user might submit; includes a few shared values to force dupes. */
const arbEntry: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.constantFrom("read", "summon owner/repo", "help", "clear"),
);

const arbAction: fc.Arbitrary<HistoryAction> = fc.oneof(
  arbEntry.map((entry) => ({ tag: "push" as const, entry })),
  fc
    .constantFrom<NavKey>("up", "down")
    .map((key) => ({ tag: "nav" as const, key })),
);

/** Longer sequences so the 50-entry cap is exercised many times over. */
const arbActions: fc.Arbitrary<readonly HistoryAction[]> = fc.array(
  arbAction,
  { minLength: 0, maxLength: 140 },
);

/** Only pushes, so the kept-suffix invariant can be stated precisely. */
const arbEntries: fc.Arbitrary<readonly string[]> = fc.array(arbEntry, {
  minLength: 0,
  maxLength: 140,
});

/**
 * Replays a sequence against the real functions and returns the live history
 * plus the current line text at every step (the text starts blank).
 */
function replay(actions: readonly HistoryAction[]): {
  history: History;
  text: string;
} {
  let history = EMPTY;
  let text = "";
  for (const action of actions) {
    if (action.tag === "push") {
      history = historyPush(history, action.entry);
      text = ""; // submitting an entry clears the command line
    } else if (action.key === "up") {
      const r = historyPrev(history, text);
      history = r.history;
      text = r.text;
    } else {
      const r = historyNext(history, text);
      history = r.history;
      text = r.text;
    }
  }
  return { history, text };
}

describe("P15 (R3.2, R3.3): command history bounds", () => {
  it("never grows beyond HISTORY_MAX entries", () => {
    expect(HISTORY_MAX).toBe(50);
    fc.assert(
      fc.property(arbActions, (actions) => {
        const { history } = replay(actions);
        expect(history.entries.length).toBeLessThanOrEqual(HISTORY_MAX);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("discards the oldest entry first (kept entries are the most recent suffix in order)", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        let history = EMPTY;
        for (const entry of entries) history = historyPush(history, entry);
        // The kept entries are exactly the last min(n, 50) submissions, in
        // submission order (oldest surplus discarded first).
        const expected = entries.slice(Math.max(0, entries.length - HISTORY_MAX));
        expect(history.entries).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the cursor within bounds at every step (0..length-1 or null)", () => {
    fc.assert(
      fc.property(arbActions, (actions) => {
        let history = EMPTY;
        let text = "";
        const check = (h: History): void => {
          if (h.cursor !== null) {
            expect(Number.isInteger(h.cursor)).toBe(true);
            expect(h.cursor).toBeGreaterThanOrEqual(0);
            expect(h.cursor).toBeLessThan(h.entries.length);
          }
        };
        check(history);
        for (const action of actions) {
          if (action.tag === "push") {
            history = historyPush(history, action.entry);
            text = "";
          } else if (action.key === "up") {
            const r = historyPrev(history, text);
            history = r.history;
            text = r.text;
          } else {
            const r = historyNext(history, text);
            history = r.history;
            text = r.text;
          }
          check(history);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("does not wrap: Up Arrow stops at the oldest entry", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (entries, extra) => {
          let history = EMPTY;
          for (const entry of entries) history = historyPush(history, entry);
          // The first Up selects the NEWEST entry (index length-1), and each
          // subsequent Up moves one older (design.md). Pressing at least
          // `entries.length` times walks the cursor from newest down to 0, and
          // any extra presses stay pinned at 0 (no wrap).
          const ups = history.entries.length + extra;
          let text = "";
          for (let i = 0; i < ups; i += 1) {
            const r = historyPrev(history, text);
            history = r.history;
            text = r.text;
          }
          // After enough presses we land on index 0 and never pass it.
          expect(history.cursor).toBe(0);
          expect(text).toBe(history.entries[0]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("restores the saved draft when Down Arrow steps past the newest entry", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { minLength: 1, maxLength: 40 }),
        fc.string({ maxLength: 20 }),
        (entries, draft) => {
          let history = EMPTY;
          for (const entry of entries) history = historyPush(history, entry);

          // From a fresh line, Up saves the draft and selects the newest entry.
          const up = historyPrev(history, draft);
          expect(up.text).toBe(entries[entries.length - 1]);

          // Down from the newest entry restores the draft and returns to a
          // fresh line (cursor null), without wrapping to the oldest.
          const down = historyNext(up.history, up.text);
          expect(down.history.cursor).toBeNull();
          expect(down.text).toBe(draft);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("navigation never mutates the stored entries", () => {
    fc.assert(
      fc.property(arbActions, (actions) => {
        let history = EMPTY;
        let text = "";
        let lastEntries: readonly string[] = history.entries;
        for (const action of actions) {
          if (action.tag === "push") {
            history = historyPush(history, action.entry);
            text = "";
            lastEntries = history.entries;
          } else {
            const r =
              action.key === "up"
                ? historyPrev(history, text)
                : historyNext(history, text);
            history = r.history;
            text = r.text;
            // Pure navigation leaves the entry list untouched.
            expect(history.entries).toEqual(lastEntries);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
