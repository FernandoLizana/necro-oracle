// Feature: 03-crt-terminal
//
// Example tests for the four terminal-raised error builders (task 10.1,
// TEST-FIRST).
//
// TEST-FIRST (red). These examples are written before the builders are added to
// `render/errors.ts` (task 10.2), so the `networkError`, `upstreamError`,
// `invalidResponseError` and `demoUnavailableError` imports below fail to
// resolve and the whole suite is red for the expected reason: `./errors.js`
// exports only `renderError` so far — the four builders do not exist yet.
//
// Validates: Requirements R11.4, R11.5, R11.6, R18.9, R18.10
//
// Each builder constructs a `NecroError` the terminal raises itself (never a
// server envelope): a connection failure / client timeout (`networkError`,
// R11.4/R11.6), a `>= 500` response with no valid envelope (`upstreamError`,
// R11.5), a response that failed the zod schema (`invalidResponseError`,
// R18.9), and a demo chunk that could not load (`demoUnavailableError`,
// R18.10). Every one carries a two-line Oracle_Voice `userMessage` — a mystical
// line, a "\n", then a technical line — of freshly built copy with no wrapped
// `cause` and nothing stack/exception-shaped surfaced.

import { describe, expect, it } from "vitest";

import { NecroError } from "@necro/oracle/client";

// Not yet implemented — task 10.2 adds these builders to `render/errors.ts`.
import {
  demoUnavailableError,
  invalidResponseError,
  networkError,
  upstreamError,
} from "./errors.js";

/** Max columns per rendered line (the terminal's fixed width). */
const LINE_WIDTH = 72;
/** The mystical line stays short enough to read at a glance. */
const MYSTICAL_MAX_WORDS = 16;

/** Markers that would betray a leaked stack / cause / raw exception. */
const LEAK_MARKERS = [
  "at ",
  ".ts:",
  ".js:",
  "node_modules",
  "    at",
  "Error:",
  "stack",
  "exception",
  "\tat ",
] as const;

function wordCount(line: string): number {
  return line.trim().split(/\s+/).filter((w) => w !== "").length;
}

/**
 * Assert the shared contract of every terminal-raised builder: it returns a
 * `NecroError` of the given code whose `userMessage` is a two-line Oracle_Voice
 * string (mystical "\n" technical), each line non-empty, within width, the
 * mystical line short, no leak-shaped text anywhere, and no surfaced `cause`.
 */
function assertTwoLineOracleError(err: NecroError, code: string): void {
  expect(err).toBeInstanceOf(NecroError);
  expect(err.code).toBe(code);

  const lines = err.userMessage.split("\n");
  expect(lines).toHaveLength(2);

  const [mystical, technical] = lines as [string, string];
  expect(mystical.trim()).not.toBe("");
  expect(technical.trim()).not.toBe("");

  // Mystical line: short and within the terminal width.
  expect(wordCount(mystical)).toBeLessThanOrEqual(MYSTICAL_MAX_WORDS);
  expect(mystical.length).toBeLessThanOrEqual(LINE_WIDTH);
  // Technical line: within the terminal width.
  expect(technical.length).toBeLessThanOrEqual(LINE_WIDTH);

  // No emoji (anything outside the BMP, where emoji live, is disallowed).
  for (const ch of err.userMessage) {
    expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0xffff);
  }

  // Nothing stack/cause/exception-shaped surfaces in the message.
  for (const marker of LEAK_MARKERS) {
    expect(err.userMessage.includes(marker)).toBe(false);
  }

  // Freshly constructed — no thrown error is wrapped as `cause`.
  expect(err.cause).toBeUndefined();
}

describe("R11.4, R11.6: networkError()", () => {
  it("builds a two-line Oracle_Voice NETWORK_TIMEOUT error with no cause", () => {
    assertTwoLineOracleError(networkError(), "NETWORK_TIMEOUT");
  });

  it("returns a fresh NecroError on each call", () => {
    const a = networkError();
    const b = networkError();
    expect(a).not.toBe(b);
    expect(a.userMessage).toBe(b.userMessage);
  });
});

describe("R11.5: upstreamError()", () => {
  it("builds a two-line Oracle_Voice UPSTREAM_UNAVAILABLE error with no cause", () => {
    assertTwoLineOracleError(upstreamError(), "UPSTREAM_UNAVAILABLE");
  });
});

describe("R18.9: invalidResponseError()", () => {
  it("builds a two-line Oracle_Voice VALIDATION_FAILED error with no cause", () => {
    assertTwoLineOracleError(invalidResponseError(), "VALIDATION_FAILED");
  });
});

describe("R18.10: demoUnavailableError()", () => {
  it("builds a two-line Oracle_Voice NETWORK_TIMEOUT error with no cause", () => {
    assertTwoLineOracleError(demoUnavailableError(), "NETWORK_TIMEOUT");
  });

  it("tells the user to reload while online on its technical line", () => {
    const err = demoUnavailableError();
    const technical = err.userMessage.split("\n")[1] ?? "";
    expect(technical.toLowerCase()).toContain("reload");
    expect(technical.toLowerCase()).toContain("online");
  });
});
