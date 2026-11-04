// Demo-label decorator for @necro/ui-crt (task 9.2).
//
// Validates: Requirement R18.5
//
// `withDemoLabel` marks a sequence of blocks as a recorded demo replay: it
// prepends one status block carrying the `DEMO_LABEL` line and returns a new
// array in which every block (the label and the originals) has `demo: true`.
// It never mutates the input blocks — the originals keep their own `demo`
// flags.

import { sanitizeText } from "../text/sanitize.js";
import { wrapText } from "../text/wrap.js";
import { DEMO_LABEL } from "../voice/phrases.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/** Build the single-line DEMO_LABEL status block (sanitised, wrapped). */
function demoLabelBlock(): BlockDraft {
  const lines: OutputLine[] = wrapText(sanitizeText(DEMO_LABEL)).map((line) => ({
    segments: [{ text: line }],
  }));
  return { kind: "status", demo: true, lines };
}

/**
 * Prepend the `DEMO_LABEL` block and mark every block as `demo: true`, without
 * mutating any input block.
 */
export function withDemoLabel(
  blocks: readonly BlockDraft[],
): BlockDraft[] {
  const labelled = blocks.map((block) => ({ ...block, demo: true }));
  return [demoLabelBlock(), ...labelled];
}
