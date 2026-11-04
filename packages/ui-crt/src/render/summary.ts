// Summon-summary renderer for @necro/ui-crt (task 9.2).
//
// Validates: Requirements R5.4, R5.5, R5.6, R5.7, R5.8
//
// `renderSummary` turns a validated `SummonSummary` into a single oracle block:
// a mystical line, then a technical line naming the pinned repo (owner/name and
// the first seven of the sha), its file count (R5.6) and star count (R5.5). It
// adds a line for any degraded fields (R5.4), a line marking a cache hit
// distinctly from a miss (R5.7), a line marking a truncated snapshot (R5.8),
// and a closing line suggesting `read`. All text is sanitised and wrapped to 72
// columns.

import type { SummonSummary } from "../protocol.js";
import { sanitizeText } from "../text/sanitize.js";
import { wrapText } from "../text/wrap.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/** The number of sha characters shown in the summary (short-sha convention). */
const SHORT_SHA_LENGTH = 7;

/** Build wrapped `OutputLine`s of sanitised plain text. */
function textLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/**
 * Render a `SummonSummary` as a single oracle block. The summary is public
 * metadata only; nothing here reveals snapshot contents.
 */
export function renderSummary(summary: SummonSummary): BlockDraft {
  const { ref } = summary;
  const shortSha = ref.sha.slice(0, SHORT_SHA_LENGTH);
  const lines: OutputLine[] = [];

  lines.push(...textLines("The repository answers the summons."));
  lines.push(
    ...textLines(
      `${ref.owner}/${ref.name} @ ${shortSha} (${ref.sha}): ` +
        `${summary.fileCount} files, ${summary.stars} stars.`,
    ),
  );

  if (summary.degradedFields.length > 0) {
    lines.push(
      ...textLines(
        `The mists hide some signs: ${summary.degradedFields.join(", ")}.`,
      ),
    );
  }

  lines.push(
    ...textLines(
      summary.cache === "hit"
        ? "This vision was drawn from memory (cache HIT)."
        : "This vision was drawn fresh (cache miss).",
    ),
  );

  if (summary.truncated) {
    lines.push(
      ...textLines(
        "The body was too large; the snapshot is TRUNCATED to its first files.",
      ),
    );
  }

  lines.push(
    ...textLines("Type read fates or read necropsy to lay the cards."),
  );

  return { kind: "oracle", demo: false, lines };
}
