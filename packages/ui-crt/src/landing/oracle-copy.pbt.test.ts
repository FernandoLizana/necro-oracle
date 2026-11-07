// @vitest-environment jsdom
//
// src/landing/oracle-copy.pbt.test.ts
//
// Feature: oracle-landing-polish, task 12.2 (property + example tests for the
// in-world oracle-voice error and empty states, Part B bug 4).
//
// Validates: Requirements R19.1, R19.2, R19.3, R19.4, R19.5, R19.6, R19.7
//
// This file pins the oracle-voice contract for every error/empty surface the
// Landing_State can show: each message is a short mystical line (<= 16 words)
// then a plain technical fact, every line is ASCII-only (no emoji) and <= 72
// columns, and the DOM live-region text equals the visible plain technical
// fact (R19.6).
//
// Structure:
//   - P12 (R19.6): a fast-check property over EVERY `EmptyReason` (a small
//     finite union, so it is also iterated exhaustively) asserting the column /
//     ASCII / word budget on `.mystical` and `.technical`, and that
//     `emptyListCopy` is total (never throws) for every reason — including when
//     fuzzed with arbitrary strings that happen to be one of the reasons.
//   - Example tests for the four terminal error states (network, no-Python, and
//     the ui-crt-owned two-line ERROR-block split for bad-repo / rate-limit),
//     each asserting the oracle-voice shape and budget via the real renderers.
//   - jsdom DOM behaviour for the empty vs fetch-failure LEGACY REPOS list
//     (R19.5 / R19.7): a labelled `group` with `role="status"` for a legitimate
//     empty list, a `role="alert"` error state for a fetch failure.

import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  LANDING_EMPTY_COPY,
  LANDING_FETCH_NETWORK_COPY,
  LANDING_FETCH_RATE_LIMIT_COPY,
  MAX_COLUMNS,
  MAX_MYSTICAL_WORDS,
  emptyListCopy,
  type EmptyReason,
  type OracleCopy,
} from "./oracle-copy.js";

import { blockText, lineText } from "../render/blocks.js";
import { networkError, renderError } from "../render/errors.js";
import { renderNoPython } from "../render/summary.js";
import { LegacyRepoList } from "../components/LegacyRepoList.js";
import type { RepoRef } from "@necro/oracle/client";
import type { SummonSummary } from "../protocol.js";

const NUM_RUNS = 1000;

/** The finite `EmptyReason` union, iterated exhaustively below. */
const ALL_EMPTY_REASONS: readonly EmptyReason[] = [
  "none",
  "fetch-network",
  "fetch-rate-limit",
];

/** Count words on a line (whitespace-delimited, ignoring empty runs). */
function wordCount(line: string): number {
  return line.trim().split(/\s+/).filter((w) => w !== "").length;
}

/** True when `s` is pure printable ASCII (0x20-0x7E): no non-ASCII, no emoji. */
function isPrintableAscii(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp > 0x7e) return false;
  }
  return true;
}

/**
 * Assert the shared oracle-voice budget on one `OracleCopy`: both lines are
 * ASCII-only and <= 72 columns, and the mystical line is <= 16 words (R19.6).
 */
function assertCopyBudget(copy: OracleCopy): void {
  // Both lines: ASCII-only (no non-ASCII bytes, no emoji).
  expect(isPrintableAscii(copy.mystical)).toBe(true);
  expect(isPrintableAscii(copy.technical)).toBe(true);
  // Both lines: within the 72-column terminal width.
  expect(copy.mystical.length).toBeLessThanOrEqual(MAX_COLUMNS);
  expect(copy.technical.length).toBeLessThanOrEqual(MAX_COLUMNS);
  // Mystical line: short enough to read at a glance.
  expect(wordCount(copy.mystical)).toBeLessThanOrEqual(MAX_MYSTICAL_WORDS);
  // Neither line may be empty: there is always a visible fact.
  expect(copy.mystical.trim()).not.toBe("");
  expect(copy.technical.trim()).not.toBe("");
}

/** The terminal's fixed line width, mirrored for the renderer example tests. */
const LINE_WIDTH = MAX_COLUMNS;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// P12 (R19.6): the empty/fetch-failure copy table stays within budget.
// ---------------------------------------------------------------------------

describe("P12 (R19.6): oracle-voice error/empty copy stays within the column and ASCII budget", () => {
  // The constants themselves (the three authored OracleCopy values).
  it.each([
    ["LANDING_EMPTY_COPY", LANDING_EMPTY_COPY],
    ["LANDING_FETCH_NETWORK_COPY", LANDING_FETCH_NETWORK_COPY],
    ["LANDING_FETCH_RATE_LIMIT_COPY", LANDING_FETCH_RATE_LIMIT_COPY],
  ] as const)("keeps %s within the ASCII / column / word budget", (_name, copy) => {
    assertCopyBudget(copy);
  });

  // Exhaustive over the finite union: every EmptyReason's resolved copy.
  it.each(ALL_EMPTY_REASONS)(
    "keeps emptyListCopy(%s) within the ASCII / column / word budget",
    (reason) => {
      assertCopyBudget(emptyListCopy(reason));
    },
  );

  // Property: fast-check over EVERY EmptyReason value. `emptyListCopy` is total
  // (never throws) and the resolved copy always honours the budget.
  it("every emptyListCopy(reason) is total and within budget (1000 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_EMPTY_REASONS), (reason) => {
        const copy = emptyListCopy(reason);
        assertCopyBudget(copy);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property: fuzz arbitrary strings; any string that IS one of the reasons
  // routes through the copy table and satisfies the budget, and the function is
  // total — it never throws for a valid reason. Strings outside the union are
  // not valid inputs, so we only assert the budget on the ones that match.
  it("any string that is a valid EmptyReason yields budgeted, non-throwing copy (1000 runs)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...ALL_EMPTY_REASONS),
          fc.string({ minLength: 0, maxLength: 24 }),
        ),
        (candidate) => {
          if ((ALL_EMPTY_REASONS as readonly string[]).includes(candidate)) {
            const copy = emptyListCopy(candidate as EmptyReason);
            assertCopyBudget(copy);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// R19.3 — network / stream failure: networkError() is oracle-voice shaped.
// ---------------------------------------------------------------------------

describe("R19.3: network / stream error copy (networkError)", () => {
  it("splits into a mystical line and a technical retry line within budget", () => {
    const err = networkError();
    const [mystical, technical, ...rest] = err.userMessage.split("\n");
    expect(rest).toHaveLength(0);
    expect(mystical).toBeDefined();
    expect(technical).toBeDefined();

    // Mystical line: short, ASCII, within width.
    expect(wordCount(mystical!)).toBeLessThanOrEqual(MAX_MYSTICAL_WORDS);
    expect(mystical!.length).toBeLessThanOrEqual(LINE_WIDTH);
    expect(isPrintableAscii(mystical!)).toBe(true);

    // Technical line: states the connection failed/timed out AND to retry.
    const tech = technical!.toLowerCase();
    expect(tech).toMatch(/connection failed|timed out/);
    expect(tech).toContain("retry");
    expect(technical!.length).toBeLessThanOrEqual(LINE_WIDTH);
    expect(isPrintableAscii(technical!)).toBe(true);
  });

  it("renders through renderError into an ERROR block whose body is within budget", () => {
    const err = networkError();
    const block = renderError({ code: err.code, userMessage: err.userMessage });
    // First line is the ERROR header; every rendered line stays within width
    // and ASCII, so the live region reads clean text.
    for (const line of block.lines) {
      const text = lineText(line);
      expect(text.length).toBeLessThanOrEqual(LINE_WIDTH);
      expect(isPrintableAscii(text)).toBe(true);
    }
    expect(blockText(block)).toContain("ERROR NETWORK_TIMEOUT");
  });
});

// ---------------------------------------------------------------------------
// R19.4 — no-Python: renderNoPython(summary) names the plain technical fact.
// ---------------------------------------------------------------------------

describe("R19.4: no-.py-files copy (renderNoPython)", () => {
  // A minimal, honest SummonSummary with fileCount 0 (nothing to resurrect).
  const ref: RepoRef = {
    owner: "owner",
    name: "repo",
    sha: "a".repeat(40),
    defaultBranch: "main",
  };
  const summary: SummonSummary = {
    ref,
    stars: 0,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 0,
    truncated: false,
  };

  it("builds a mystical line then the exact 'No .py files found' technical fact", () => {
    const block = renderNoPython(summary);
    // Line 0 is the mystical line; the technical fact follows (wrapped to 72).
    const mystical = lineText(block.lines[0]!);
    expect(wordCount(mystical)).toBeLessThanOrEqual(MAX_MYSTICAL_WORDS);
    expect(isPrintableAscii(mystical)).toBe(true);
    expect(mystical.length).toBeLessThanOrEqual(LINE_WIDTH);

    // The whole block carries the authoritative plain fact, verbatim.
    const expectedFact = `No .py files found in ${ref.owner}/${ref.name}@${ref.sha}; nothing to resurrect.`;
    expect(blockText(block).replace(/\n/g, " ")).toContain(expectedFact);

    // Every rendered line is ASCII and within width.
    for (const line of block.lines) {
      const text = lineText(line);
      expect(text.length).toBeLessThanOrEqual(LINE_WIDTH);
      expect(isPrintableAscii(text)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// R19.1 + R19.2 — bad repo (REPO_NOT_FOUND) + rate limit (RATE_LIMITED).
//
// The github-owned copy for these codes lives in @necro/github and is asserted
// there; the ui-crt-owned behaviour is that `renderError` splits a two-line
// userMessage into a mystical line + a technical fact preserved verbatim, under
// an `ERROR <CODE>` header. We pin exactly that here (no cross-package copy
// duplication).
// ---------------------------------------------------------------------------

describe("R19.1 / R19.2: renderError splits a two-line userMessage and preserves the fact", () => {
  it.each([
    [
      "REPO_NOT_FOUND",
      "No repository answers by this name.",
      "GitHub returned 404 for owner/repo@deadbeef; no such repository.",
    ],
    [
      "RATE_LIMITED",
      "The gate is barred for a little while.",
      "GitHub API rate-limited; retry in 4 minutes.",
    ],
  ] as const)(
    "%s: header, mystical line, then the technical fact verbatim",
    (code, mystical, technical) => {
      const block = renderError({ code, userMessage: `${mystical}\n${technical}` });
      const texts = block.lines.map(lineText);

      // Header first.
      expect(texts[0]).toContain(`ERROR ${code}`);

      // The mystical line and the technical fact both appear, in order, after
      // the header. (Both are short enough to survive the 72-col wrap intact.)
      const body = texts.slice(1);
      const mysticalIndex = body.findIndex((t) => t.includes(mystical));
      const technicalIndex = body.findIndex((t) => t.includes(technical));
      expect(mysticalIndex).toBeGreaterThanOrEqual(0);
      expect(technicalIndex).toBeGreaterThan(mysticalIndex);

      // Every rendered line stays within budget and ASCII.
      for (const t of texts) {
        expect(t.length).toBeLessThanOrEqual(LINE_WIDTH);
        expect(isPrintableAscii(t)).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// R19.5 / R19.7 — empty vs fetch-failure LEGACY REPOS list (jsdom DOM).
//
// With rows=[] and emptyReason="none" the list is a LEGITIMATE empty state: a
// labelled group with a polite `status` live region showing the empty-state
// message — NOT a listbox with no options. With a fetch-failure reason it
// routes to the matching in-world error copy in an assertive `alert`.
// ---------------------------------------------------------------------------

describe("R19.5 / R19.7: empty vs fetch-failure LEGACY REPOS list DOM behaviour", () => {
  const noop = (): void => {};

  it("R19.5: a legitimate empty list is a labelled status group, not an empty listbox", () => {
    render(
      createElement(LegacyRepoList, {
        rows: [],
        selectedIndex: 0,
        onSelect: noop,
        onActivate: noop,
        emptyReason: "none",
      }),
    );

    // Accessible list label is present on a `group` (not a `listbox`): an empty
    // listbox carrying a non-option child would be an ARIA violation.
    const group = screen.getByRole("group", { name: "Legacy repositories" });
    expect(group).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();

    // The empty-state message is a polite `status` live region carrying the
    // plain technical fact verbatim (R19.6 parity).
    const status = within(group).getByRole("status");
    expect(status.textContent ?? "").toContain(LANDING_EMPTY_COPY.technical);
    expect(status.textContent ?? "").toContain(LANDING_EMPTY_COPY.mystical);
    expect(status.getAttribute("aria-live")).toBe("polite");

    // It is NOT an error (no alert for a legitimate empty list).
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["fetch-network", LANDING_FETCH_NETWORK_COPY],
    ["fetch-rate-limit", LANDING_FETCH_RATE_LIMIT_COPY],
  ] as const)(
    "R19.7: a %s fetch failure shows the matching error copy in an alert",
    (reason, copy) => {
      render(
        createElement(LegacyRepoList, {
          rows: [],
          selectedIndex: 0,
          onSelect: noop,
          onActivate: noop,
          emptyReason: reason,
        }),
      );

      // Still a labelled group (keeps the accessible list label), but the live
      // region is an assertive `alert` carrying the error copy — not the
      // empty-state message.
      const group = screen.getByRole("group", { name: "Legacy repositories" });
      const alert = within(group).getByRole("alert");
      expect(alert.textContent ?? "").toContain(copy.technical);
      expect(alert.textContent ?? "").toContain(copy.mystical);
      expect(alert.getAttribute("aria-live")).toBe("assertive");

      // The legitimate empty-state message is NOT shown for a fetch failure.
      expect(alert.textContent ?? "").not.toContain(LANDING_EMPTY_COPY.technical);
      expect(screen.queryByRole("status")).toBeNull();
    },
  );
});
