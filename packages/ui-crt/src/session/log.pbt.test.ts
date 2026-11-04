// src/session/log.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 20
//
// Property-based tests for the Output_Log line cap (task 12.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `session/log.ts` (task 12.2),
// so the import of `./log.js` below fails to resolve and the whole suite is red
// for the expected reason: the module `./log.js` does not exist yet.
//
// Note on the cross-task dependency: `appendBlocks` operates on `OutputBlock`
// values whose authoritative shape lives in `render/blocks.ts` (task 8.2,
// parallel and not necessarily implemented yet). To keep this file's red
// specific to the missing `./log.js` and NOT to `../render/blocks.js`, we
// define a minimal local block/line factory here that matches the design shape
// (design.md §"Reading, summary … renderers": `OutputBlock { id, kind, demo,
// lines: OutputLine[] }`, `OutputLine { segments: Segment[] }`, `Segment {
// text, href? }`). `appendBlocks` only ever counts and slices lines, so the
// structural shape is all it needs.
//
// Property 20 (requirements.md §"P20 — Output_Log cap (R17.6)"):
// For all sequences of Output_Blocks, the Output_Log holds at most 500
// Output_Lines and the retained lines are the most recent ones in order.
//
// Semantics under test (design.md §"History and log"):
//   LOG_MAX_LINES = 500
//   appendBlocks(log, blocks): OutputBlock[]
//     - drops whole oldest blocks until the total line count is at most 500;
//     - if one block alone exceeds 500 lines, its oldest lines are cut, so the
//       retained lines are always a suffix of the full line sequence.
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R17.6**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 12.2 adds this module.
import { LOG_MAX_LINES, appendBlocks } from "./log.js";

/** P20 runs the default property budget. */
const NUM_RUNS = 200;

// --- Minimal local structural model (see header note) ----------------------

interface LocalSegment {
  readonly text: string;
  readonly href?: string;
}
interface LocalLine {
  readonly segments: readonly LocalSegment[];
}
type LocalBlockKind = "boot" | "echo" | "oracle" | "error" | "status";
interface LocalBlock {
  readonly id: number;
  readonly kind: LocalBlockKind;
  readonly demo: boolean;
  readonly lines: readonly LocalLine[];
}

const BLOCK_KINDS: readonly LocalBlockKind[] = [
  "boot",
  "echo",
  "oracle",
  "error",
  "status",
];

/** Builds one line whose single segment carries a unique marker text. */
function makeLine(marker: string): LocalLine {
  return { segments: [{ text: marker }] };
}

// --- Arbitraries ------------------------------------------------------------

/**
 * A block with `lineCount` lines, each tagged `{blockId}:{index}` so we can
 * reconstruct and compare the full line sequence against the retained suffix.
 */
function makeBlock(id: number, lineCount: number): LocalBlock {
  const lines = Array.from({ length: lineCount }, (_unused, index) =>
    makeLine(`${id}:${index}`),
  );
  return {
    id,
    kind: BLOCK_KINDS[id % BLOCK_KINDS.length]!,
    demo: id % 2 === 0,
    lines,
  };
}

/**
 * A sequence of blocks with unique, increasing ids and varied line counts,
 * including empty blocks and the occasional oversized block (> 500 lines) so
 * the single-block-overflow branch is exercised.
 */
const arbBlocks: fc.Arbitrary<readonly LocalBlock[]> = fc
  .array(
    fc.oneof(
      { weight: 9, arbitrary: fc.integer({ min: 0, max: 60 }) },
      { weight: 1, arbitrary: fc.integer({ min: 501, max: 900 }) },
    ),
    { minLength: 0, maxLength: 40 },
  )
  .map((counts) => counts.map((count, id) => makeBlock(id, count)));

/** Flattens a block list to its ordered line-marker sequence. */
function markerSequence(blocks: readonly LocalBlock[]): string[] {
  const markers: string[] = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      markers.push(line.segments.map((segment) => segment.text).join(""));
    }
  }
  return markers;
}

/** Total line count across a block list. */
function lineCount(blocks: readonly LocalBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.lines.length, 0);
}

// `appendBlocks` is typed against the real `OutputBlock`; the local structural
// model matches that shape, so this local alias documents the intent at the
// call sites without importing `../render/blocks.js`.
const append = appendBlocks as unknown as (
  log: readonly LocalBlock[],
  blocks: readonly LocalBlock[],
) => LocalBlock[];

describe("P20 (R17.6): output log line cap", () => {
  it("never retains more than LOG_MAX_LINES output lines", () => {
    expect(LOG_MAX_LINES).toBe(500);
    fc.assert(
      fc.property(arbBlocks, arbBlocks, (existing, incoming) => {
        const result = append(append([], existing), incoming);
        expect(lineCount(result)).toBeLessThanOrEqual(LOG_MAX_LINES);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("retains the most-recent lines as a suffix of the full line sequence, in order", () => {
    fc.assert(
      fc.property(arbBlocks, arbBlocks, (existing, incoming) => {
        const full = markerSequence([...existing, ...incoming]);
        const result = append(append([], existing), incoming);
        const retained = markerSequence(result);

        // The retained lines are exactly the most recent suffix of `full`.
        const expected = full.slice(Math.max(0, full.length - LOG_MAX_LINES));
        expect(retained).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps everything unchanged when the total stays within the cap", () => {
    fc.assert(
      fc.property(
        arbBlocks.filter((blocks) => lineCount(blocks) <= LOG_MAX_LINES),
        (blocks) => {
          const result = append([], blocks);
          expect(markerSequence(result)).toEqual(markerSequence(blocks));
          expect(lineCount(result)).toBe(lineCount(blocks));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("drops whole oldest blocks first, cutting within a block only when one block alone overflows", () => {
    fc.assert(
      fc.property(arbBlocks, (blocks) => {
        const result = append([], blocks);
        const resultIds = new Set(result.map((block) => block.id));

        // Every retained block id came from the input (no fabrication).
        for (const id of resultIds) {
          expect(blocks.some((block) => block.id === id)).toBe(true);
        }

        // Any block that is retained only partially (fewer lines than the
        // source) must be the single oldest retained block — interior/newer
        // blocks are retained whole.
        for (let i = 0; i < result.length; i += 1) {
          const retainedBlock = result[i]!;
          const source = blocks.find((b) => b.id === retainedBlock.id)!;
          const isPartial = retainedBlock.lines.length < source.lines.length;
          if (isPartial) {
            expect(i).toBe(0); // only the oldest retained block may be cut
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves line order within the single oldest retained block after a cut", () => {
    // One block alone exceeds the cap: its oldest lines are cut and the
    // retained lines are the final LOG_MAX_LINES markers in order.
    const big = makeBlock(0, 640);
    const result = append([], [big]);
    const retained = markerSequence(result);
    const expected = markerSequence([big]).slice(-LOG_MAX_LINES);
    expect(retained).toEqual(expected);
    expect(retained.length).toBe(LOG_MAX_LINES);
  });
});
