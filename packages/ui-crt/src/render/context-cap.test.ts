// Capped-context-lines test for renderFileResult (prod UX source-dump fix).
//
// A diff of a large file (many context lines, few or no add/remove lines)
// previously printed the entire file into the terminal. The fix caps consecutive
// context-only runs to MAX_CONTEXT_LINES (3) and inserts a "... N unchanged
// lines" note for the remainder. These tests pin that behaviour.
//
// Pure: no network, LLM, or sandbox.

import { describe, expect, it } from "vitest";

import { blockText, lineText } from "./blocks.js";
import { renderFileResult } from "./resurrect-diff.js";
import type { ResurrectDiffLine, ResurrectFileResult } from "../protocol.js";

/** Build a context-only diff with `n` lines. */
function contextDiff(n: number): ResurrectDiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "context" as const,
    text: `line ${i + 1}`,
  }));
}

/** Build a mixed diff: some context before and after a single add line. */
function surroundedDiff(leadCtx: number, trailCtx: number): ResurrectDiffLine[] {
  return [
    ...Array.from({ length: leadCtx }, (_, i) => ({
      kind: "context" as const,
      text: `before ${i + 1}`,
    })),
    { kind: "add" as const, text: 'print("hello")' },
    ...Array.from({ length: trailCtx }, (_, i) => ({
      kind: "context" as const,
      text: `after ${i + 1}`,
    })),
  ];
}

function makeFile(diff: ResurrectDiffLine[]): ResurrectFileResult {
  return {
    path: "src/big.py",
    diff,
    residuals: [],
    fullyConverted: true,
  };
}

describe("renderFileResult ? context line capping (prod UX source-dump fix)", () => {
  it("renders at most 3 context lines when the diff is context-only", () => {
    // A 20-line context-only diff (unchanged file) must not dump all 20 lines.
    const block = renderFileResult(makeFile(contextDiff(20)));
    const lines = block.lines.map(lineText);
    // Only the first 3 context lines appear.
    expect(lines).toContain("  line 1");
    expect(lines).toContain("  line 2");
    expect(lines).toContain("  line 3");
    expect(lines).not.toContain("  line 4");
    expect(lines).not.toContain("  line 20");
  });

  it("inserts an '... N unchanged lines' note for the collapsed portion", () => {
    const block = renderFileResult(makeFile(contextDiff(20)));
    const text = blockText(block);
    // 20 - 3 = 17 lines collapsed.
    expect(text).toContain("17 unchanged lines");
  });

  it("renders all context lines when there are <= 3", () => {
    const block = renderFileResult(makeFile(contextDiff(3)));
    const lines = block.lines.map(lineText);
    expect(lines).toContain("  line 1");
    expect(lines).toContain("  line 2");
    expect(lines).toContain("  line 3");
    // No collapse note.
    expect(blockText(block)).not.toContain("unchanged lines");
  });

  it("does not insert a collapse note when the run is exactly 3", () => {
    const text = blockText(renderFileResult(makeFile(contextDiff(3))));
    expect(text).not.toContain("unchanged");
  });

  it("always shows add/remove lines regardless of context caps", () => {
    // 10 context lines before and after a single add.
    const block = renderFileResult(makeFile(surroundedDiff(10, 10)));
    const text = blockText(block);
    // The add line must appear.
    expect(text).toContain('+ print("hello")');
  });

  it("caps each context run independently (reset after an add/remove)", () => {
    // Two separate runs of 5 context lines each, separated by an add line.
    const diff: ResurrectDiffLine[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ kind: "context" as const, text: `pre ${i}` })),
      { kind: "add" as const, text: "changed" },
      ...Array.from({ length: 5 }, (_, i) => ({ kind: "context" as const, text: `post ${i}` })),
    ];
    const text = blockText(renderFileResult(makeFile(diff)));
    // Each run of 5 collapses to 3 shown + "2 unchanged lines".
    const count = (text.match(/2 unchanged line/g) ?? []).length;
    expect(count).toBe(2);
  });

  it("renders a '1 unchanged line' note (singular) when exactly 1 is collapsed", () => {
    // 4 context lines: 3 shown + 1 collapsed.
    const block = renderFileResult(makeFile(contextDiff(4)));
    const text = blockText(block);
    expect(text).toContain("1 unchanged line");
    expect(text).not.toContain("1 unchanged lines");
  });
});
