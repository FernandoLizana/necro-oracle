// Per-file diff and Residual_List renderer — example tests.
//
// Validates: Requirements R7.1, R7.2, R8.1, R8.3
//
// `renderFileResult`/`renderFileResults` are pure, port-free functions that
// turn a `ResurrectFileResult` into an oracle `BlockDraft`. These examples pin:
//   - an add/remove/context mix renders the `+`/`-`/` ` markers correctly, with
//     every line ASCII-only and within the 72-column budget (R7.1, R7.2);
//   - an unchanged (context-only) file renders with no `+`/`-` line (R7.2);
//   - a file with residuals renders each as `path:line` followed by its
//     unconverted construct (R8.1);
//   - a zero-residual file renders the fully-converted indication (R8.3).
//
// Flattening is done with `blockText`/`lineText`; no network, LLM, or sandbox.

import { describe, expect, it } from "vitest";
import { blockText, lineText } from "./blocks.js";
import { renderFileResult, renderFileResults } from "./resurrect-diff.js";
import type { ResurrectFileResult } from "../protocol.js";
import { LINE_WIDTH } from "../text/wrap.js";

/** A file whose diff mixes added, removed and context lines, with residuals. */
const MIXED: ResurrectFileResult = {
  path: "src/app.py",
  diff: [
    { kind: "context", text: "import os" },
    { kind: "remove", text: 'print "hello"' },
    { kind: "add", text: 'print("hello")' },
    { kind: "context", text: "sys.exit(0)" },
  ],
  residuals: [
    { path: "src/app.py", line: 42, construct: "exec statement" },
    { path: "src/app.py", line: 77, construct: "backtick repr" },
  ],
  fullyConverted: false,
};

/** A file whose before/after are identical: context-only, fully converted. */
const UNCHANGED: ResurrectFileResult = {
  path: "src/stable.py",
  diff: [
    { kind: "context", text: "x = 1" },
    { kind: "context", text: "y = 2" },
  ],
  residuals: [],
  fullyConverted: true,
};

/** A file fully converted by the Pre_Pass (changed, zero residuals). */
const FULLY_CONVERTED: ResurrectFileResult = {
  path: "src/clean.py",
  diff: [
    { kind: "remove", text: "0L" },
    { kind: "add", text: "0" },
  ],
  residuals: [],
  fullyConverted: true,
};

describe("renderFileResult — add/remove/context marks (R7.1, R7.2)", () => {
  it("renders an oracle block naming the file, not flagged demo", () => {
    const block = renderFileResult(MIXED);
    expect(block.kind).toBe("oracle");
    expect(block.demo).toBe(false);
    expect(lineText(block.lines[0]!)).toContain("src/app.py");
  });

  it("marks added lines with '+', removed with '-', context with ' '", () => {
    const lines = renderFileResult(MIXED).lines.map(lineText);
    // The diff content lines appear in input order, each carrying its marker.
    expect(lines).toContain("  import os");
    expect(lines).toContain('- print "hello"');
    expect(lines).toContain('+ print("hello")');
    expect(lines).toContain("  sys.exit(0)");
  });

  it("is deterministic across calls", () => {
    expect(renderFileResult(MIXED)).toStrictEqual(renderFileResult(MIXED));
    expect(blockText(renderFileResult(MIXED))).toBe(
      blockText(renderFileResult(MIXED)),
    );
  });
});

describe("renderFileResult — an unchanged file has no add/remove (R7.2)", () => {
  it("renders context-only lines, no '+'/'-' line", () => {
    const lines = renderFileResult(UNCHANGED).lines.map(lineText);
    // No diff content line begins with an add or remove marker. (The header
    // and the fully-converted line are prose, not diff content.)
    const addRemove = lines.filter(
      (line) => line.startsWith("+ ") || line.startsWith("- "),
    );
    expect(addRemove).toEqual([]);
    // The context content is present, marked with the context marker.
    expect(lines).toContain("  x = 1");
    expect(lines).toContain("  y = 2");
  });
});

describe("renderFileResult — residuals as path:line + construct (R8.1)", () => {
  it("renders each residual as 'path:line' with its construct", () => {
    const text = blockText(renderFileResult(MIXED));
    expect(text).toContain("src/app.py:42");
    expect(text).toContain("exec statement");
    expect(text).toContain("src/app.py:77");
    expect(text).toContain("backtick repr");
  });

  it("does not render the fully-converted indication when residuals exist", () => {
    const text = blockText(renderFileResult(MIXED));
    expect(text).not.toContain("Fully resurrected");
  });
});

describe("renderFileResult — a zero-residual file is fully converted (R8.3)", () => {
  it("renders the fully-converted indication and no residual list", () => {
    const text = blockText(renderFileResult(FULLY_CONVERTED));
    expect(text).toContain("Fully resurrected; every construct crossed over.");
    expect(text).not.toContain("RESIDUAL");
  });

  it("an unchanged file is also rendered fully converted", () => {
    const text = blockText(renderFileResult(UNCHANGED));
    expect(text).toContain("Fully resurrected; every construct crossed over.");
  });
});

describe("renderFileResult — ASCII-only within the column budget", () => {
  // Repository-derived source can smuggle wide/deceptive glyphs; the renderer
  // must reduce every line to printable ASCII.
  it("contains only printable ASCII characters", () => {
    const hostile: ResurrectFileResult = {
      path: "src/\u202Eevil.py",
      diff: [
        { kind: "remove", text: "s = u\"caf\u00e9\"" },
        { kind: "add", text: "s = \"caf\u00e9\u001b[31m\"" },
      ],
      residuals: [
        { path: "src/\u00fcber.py", line: 3, construct: "wide \uff21 token" },
      ],
      fullyConverted: false,
    };
    const text = blockText(renderFileResult(hostile));
    expect(text).not.toMatch(/[^\n\x20-\x7E]/u);
  });

  it("keeps every line within the 72-column budget (<= LINE_WIDTH)", () => {
    const longLine = "x".repeat(200);
    const wide: ResurrectFileResult = {
      path: "src/" + "deep/".repeat(40) + "module.py",
      diff: [
        { kind: "add", text: longLine },
        { kind: "context", text: longLine },
      ],
      residuals: [
        { path: "src/" + "y".repeat(200) + ".py", line: 1, construct: "z".repeat(200) },
      ],
      fullyConverted: false,
    };
    for (const line of renderFileResult(wide).lines) {
      expect([...lineText(line)].length).toBeLessThanOrEqual(LINE_WIDTH);
    }
  });
});

describe("renderFileResults — one block per file, order preserved", () => {
  it("renders a block per file in input order", () => {
    const blocks = renderFileResults([MIXED, UNCHANGED, FULLY_CONVERTED]);
    expect(blocks).toHaveLength(3);
    expect(lineText(blocks[0]!.lines[0]!)).toContain("src/app.py");
    expect(lineText(blocks[1]!.lines[0]!)).toContain("src/stable.py");
    expect(lineText(blocks[2]!.lines[0]!)).toContain("src/clean.py");
  });

  it("returns an empty array for no files", () => {
    expect(renderFileResults([])).toEqual([]);
  });
});
