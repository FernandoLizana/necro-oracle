// Help renderer — example tests.
//
// Validates: Requirements R4.1, R4.2, R4.3 and resurrection-engine R1.1, R1.4
//
// `renderHelp` is a pure, port-free function returning a static oracle block.
// These examples pin that the block lists the `resurrect` command together
// with its optional card-or-file argument, that every rendered line is
// ASCII-only (no emoji, no non-ASCII glyphs — oracle-voice steering), and that
// no line exceeds the 72-column terminal budget. They also pin determinism:
// two calls are byte-for-byte equal.

import { describe, expect, it } from "vitest";
import { blockText, lineText } from "./blocks.js";
import { renderHelp } from "./help.js";
import { LINE_WIDTH } from "../text/wrap.js";

describe("renderHelp — static command grimoire (R4.1, R4.3)", () => {
  // R4.3: identical on every call; depends on no port/clock/DOM.
  it("is deterministic across calls (R4.3)", () => {
    expect(renderHelp()).toStrictEqual(renderHelp());
    expect(blockText(renderHelp())).toBe(blockText(renderHelp()));
  });

  // R4.1: it renders as an oracle block, not an error/echo block.
  it("renders an oracle block that is not flagged demo", () => {
    const block = renderHelp();
    expect(block.kind).toBe("oracle");
    expect(block.demo).toBe(false);
  });

  // resurrection-engine R1.1 / R1.4: the command reference lists `resurrect`
  // with its optional card-or-file argument form and a one-line description.
  it("lists the resurrect command with its argument form (R1.1, R1.4)", () => {
    const lines = renderHelp().lines.map(lineText);
    const resurrectLine = lines.find((line) => line.startsWith("resurrect"));
    expect(resurrectLine).toBeDefined();
    // The optional single card-or-file argument is documented in brackets.
    expect(resurrectLine).toContain("resurrect [<card-or-file>]");
    // The line carries a human-facing description, not just the form.
    expect(resurrectLine!.length).toBeGreaterThan(
      "resurrect [<card-or-file>]".length,
    );
  });
});

describe("renderHelp — ASCII-only within the column budget (oracle voice)", () => {
  // Oracle-voice steering: user-facing copy is ASCII only, no emoji.
  it("contains only printable ASCII characters", () => {
    const text = blockText(renderHelp());
    // Every character is a newline or printable ASCII (0x20..0x7E). The regex
    // negation flags any control, high-bit, or multi-byte glyph.
    expect(text).not.toMatch(/[^\n\x20-\x7E]/u);
  });

  // R17.1 column budget: no rendered line exceeds 72 code points.
  it("keeps every line within the 72-column budget (<= LINE_WIDTH)", () => {
    for (const line of renderHelp().lines) {
      const text = lineText(line);
      expect([...text].length).toBeLessThanOrEqual(LINE_WIDTH);
    }
  });
});
