// Feature: 03-crt-terminal, Property 5: Sanitized_Text
//
// TEST-FIRST (red). This file is written before `text/sanitize.ts` (task 6.2),
// so the import below fails to resolve and the whole suite is red for the
// expected reason: the sanitiser module does not exist yet.
//
// Validates: Requirements R14.2, R14.3
//
// P5 states: for all strings, `sanitizeText` output contains no C0 or C1
// control character other than line feed, no ANSI escape sequence, and no
// Unicode bidirectional override or isolate character; and sanitizing an
// already-sanitised string returns the same string (idempotence).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  BIDI_CONTROL_CHARS,
  ESC,
  arbBidiControl,
  arbControlChar,
  arbHostileText,
} from "../testing/arbitraries.js";

// Not yet implemented — task 6.2 adds this module.
import { sanitizeText } from "./sanitize.js";

const NUM_RUNS = 200;

/** A C0 control other than line feed, OR any C1 control. */
function hasForbiddenControl(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a) continue; // line feed is allowed
    if (cp <= 0x1f) return true; // remaining C0
    if (cp === 0x7f) return true; // DEL
    if (cp >= 0x80 && cp <= 0x9f) return true; // C1
  }
  return false;
}

/** True if the string still contains an ESC byte (hence any ANSI sequence). */
function hasEsc(s: string): boolean {
  return s.includes(ESC);
}

/** True if the string contains any bidirectional control character. */
function hasBidiControl(s: string): boolean {
  return BIDI_CONTROL_CHARS.some((c) => s.includes(c));
}

describe("P5 (R14.2, R14.3): sanitized text", () => {
  it("leaves no C0/C1 control other than line feed", () => {
    fc.assert(
      fc.property(arbHostileText, (input) => {
        expect(hasForbiddenControl(sanitizeText(input))).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaves no ANSI escape sequence (no surviving ESC byte)", () => {
    fc.assert(
      fc.property(arbHostileText, (input) => {
        expect(hasEsc(sanitizeText(input))).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaves no bidirectional override, embedding, isolate or mark", () => {
    fc.assert(
      fc.property(arbHostileText, (input) => {
        expect(hasBidiControl(sanitizeText(input))).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is idempotent (sanitizing a sanitized string is a no-op)", () => {
    fc.assert(
      fc.property(arbHostileText, (input) => {
        const once = sanitizeText(input);
        expect(sanitizeText(once)).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves line feeds (the one retained control)", () => {
    fc.assert(
      fc.property(fc.array(fc.constant("\n"), { maxLength: 10 }), (feeds) => {
        const input = feeds.join("");
        expect(sanitizeText(input)).toBe(input);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("removes every lone control character and bidi control", () => {
    fc.assert(
      fc.property(fc.oneof(arbControlChar, arbBidiControl), (ch) => {
        expect(sanitizeText(ch)).toBe("");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
