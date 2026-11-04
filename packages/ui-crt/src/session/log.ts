// src/session/log.ts
//
// Feature: 03-crt-terminal, task 12.2.
//
// Output_Log line cap for the CRT terminal: appends new blocks and trims the
// log to the most-recent `LOG_MAX_LINES` output lines (design.md §"History and
// log"; requirement R17.6).
//
// Pure computation — no side effects, no adapters. The authoritative block/line
// shapes live in `../render/blocks.ts` (task 8.2). We import the types only
// (erased at runtime), so this module never depends on that module existing at
// run time; it only ever counts and slices each block's `lines`.
import type { OutputBlock } from "../render/blocks.js";

/** Maximum number of output lines the log retains (R17.6). */
export const LOG_MAX_LINES = 500;

/** Counts the output lines across a list of blocks. */
function countLines(blocks: readonly OutputBlock[]): number {
  let total = 0;
  for (const block of blocks) total += block.lines.length;
  return total;
}

/**
 * Appends `blocks` to `log` and trims the result to at most `LOG_MAX_LINES`
 * output lines.
 *
 * Trimming drops whole oldest blocks until the total line count fits. If the
 * single oldest retained block alone still overflows, its oldest lines are cut
 * so the retained lines are the most-recent suffix of the full concatenated
 * line sequence. Interior and newer blocks are always retained whole.
 */
export function appendBlocks(
  log: readonly OutputBlock[],
  blocks: readonly OutputBlock[],
): OutputBlock[] {
  const combined = [...log, ...blocks];
  let total = countLines(combined);

  if (total <= LOG_MAX_LINES) {
    return combined.slice();
  }

  // Drop whole oldest blocks while doing so still leaves the budget reachable:
  // stop before the point where the current oldest block is the one we must
  // partially cut to land exactly on the cap.
  let start = 0;
  while (start < combined.length) {
    const oldest = combined[start]!;
    if (total - oldest.lines.length < LOG_MAX_LINES) {
      // Dropping this whole block would overshoot — it is the block to cut.
      break;
    }
    total -= oldest.lines.length;
    start += 1;
  }

  const retained = combined.slice(start);
  const overflow = total - LOG_MAX_LINES;
  if (overflow <= 0) {
    return retained;
  }

  // Cut the oldest lines of the single oldest retained block so the kept lines
  // are the most-recent suffix of the full line sequence.
  const [oldest, ...rest] = retained;
  const trimmed: OutputBlock = {
    ...oldest!,
    lines: oldest!.lines.slice(overflow),
  };
  return [trimmed, ...rest];
}
