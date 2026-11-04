// Feature: 03-crt-terminal, block/line primitives (task 8.1 examples)
//
// TEST-FIRST (red). This file is written before `render/blocks.ts` (task 8.2),
// so the import below fails to resolve and the whole suite is red for the
// expected reason: the blocks module does not exist yet.
//
// Validates: Requirements R14.4, R14.5
//
// These examples pin the block/line/segment model and the two pure join
// helpers from the design's "Rendering" section:
//   type BlockKind = "boot" | "echo" | "oracle" | "error" | "status";
//   interface OutputLine  { readonly segments: readonly Segment[] }
//   interface OutputBlock { readonly id: number; readonly kind: BlockKind;
//                           readonly demo: boolean; readonly lines: readonly OutputLine[] }
//   type BlockDraft = Omit<OutputBlock, "id">;
//   function lineText(line: OutputLine): string;              // segments joined
//   function blockText(block: BlockDraft | OutputBlock): string; // lines joined by "\n"

import { describe, expect, it } from "vitest";

import type { Segment } from "../text/wrap.js";

// Not yet implemented — task 8.2 adds this module.
import {
  blockText,
  lineText,
  type BlockDraft,
  type BlockKind,
  type OutputBlock,
  type OutputLine,
} from "./blocks.js";

/** Build an OutputLine from a list of segments. */
function line(...segments: Segment[]): OutputLine {
  return { segments };
}

describe("lineText", () => {
  it("joins the text of every segment in order", () => {
    const l = line({ text: "XVI THE TOWER  " }, { text: "UPRIGHT  SEVERITY 2" });
    expect(lineText(l)).toBe("XVI THE TOWER  UPRIGHT  SEVERITY 2");
  });

  it("includes the text of a link segment (the href is not part of the text)", () => {
    const l = line(
      { text: "requirements.txt:14  " },
      { text: "MySQL-python", href: "https://github.com/o/n/blob/sha/requirements.txt#L14" },
    );
    expect(lineText(l)).toBe("requirements.txt:14  MySQL-python");
  });

  it("is the empty string for a line with no segments", () => {
    expect(lineText(line())).toBe("");
  });
});

describe("blockText", () => {
  it("joins lines with a single newline", () => {
    const block: BlockDraft = {
      kind: "oracle",
      demo: false,
      lines: [
        line({ text: "1  PAST" }),
        line({ text: "The foundations crack and burn." }),
      ],
    };
    expect(blockText(block)).toBe("1  PAST\nThe foundations crack and burn.");
  });

  it("returns a single line's text unchanged (no trailing newline)", () => {
    const block: BlockDraft = {
      kind: "status",
      demo: false,
      lines: [line({ text: "DOWNLOAD" })],
    };
    expect(blockText(block)).toBe("DOWNLOAD");
  });

  it("accepts an OutputBlock with an id just as it accepts a BlockDraft", () => {
    const block: OutputBlock = {
      id: 7,
      kind: "echo",
      demo: true,
      lines: [line({ text: "> read fates" })],
    };
    expect(blockText(block)).toBe("> read fates");
  });
});

describe("OutputBlock / BlockDraft shape", () => {
  it("BlockDraft is an OutputBlock without an id, and adding one yields an OutputBlock", () => {
    const draft: BlockDraft = {
      kind: "boot",
      demo: false,
      lines: [line({ text: "The veil thins." })],
    };
    // A draft carries no id.
    expect("id" in draft).toBe(false);
    // Assigning an id (as the reducer does) produces a full OutputBlock.
    const block: OutputBlock = { id: 0, ...draft };
    expect(block.id).toBe(0);
    expect(block.kind).toBe("boot");
    expect(block.demo).toBe(false);
    expect(block.lines).toHaveLength(1);
  });

  it("every BlockKind literal is assignable to the kind field", () => {
    const kinds: readonly BlockKind[] = ["boot", "echo", "oracle", "error", "status"];
    for (const kind of kinds) {
      const draft: BlockDraft = { kind, demo: false, lines: [] };
      expect(draft.kind).toBe(kind);
    }
  });
});
