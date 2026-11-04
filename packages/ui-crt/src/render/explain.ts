// Explain renderer for @necro/ui-crt (task 9.2).
//
// Validates: Requirements R8.1, R8.2, R8.3, R8.5, R8.6
//
// `renderExplain` resolves an `ExplainTarget` — a 1-based spread position or a
// `CardId` — to a drawn card and renders its full evidence: the card header,
// the `VOICE_TABLE` mystical line, the technical `summary`, and EVERY `Evidence`
// item with its `kind`, `source`, `path`, `line` and `detail` on labelled lines
// (R8.1-R8.3). Links are rendered only for a live reading (R7.6); a demo
// reading prints `fixture:{path}`. Every error path (target out of range, card
// not drawn, void position) returns a graceful oracle message, never a throw
// (R8.5, R8.6).

import {
  getCard,
  type Evidence,
  type RepoRef,
  type SpreadPosition,
} from "@necro/oracle/client";

import type { ExplainTarget } from "../command/types.js";
import type { ReadingResponse } from "../protocol.js";
import { sanitizeText } from "../text/sanitize.js";
import { wrapText, type Segment } from "../text/wrap.js";
import { VOICE_TABLE } from "../voice/voice-table.js";
import type { BlockDraft, OutputLine } from "./blocks.js";
import { buildEvidenceLink } from "./evidence-link.js";
import type { RenderContext } from "./reading.js";

/** Build wrapped `OutputLine`s of sanitised plain text. */
function textLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/**
 * Build a single, UNWRAPPED `OutputLine` from pre-built segments, preserving
 * the evidence value byte-for-byte. `renderExplain` is the full-fidelity view:
 * it must surface EVERY evidence `path` and `detail` exactly as the detector
 * recorded them (R8.1), including whitespace. Neither wrapping (which would
 * collapse whitespace at a break) nor sanitising is applied to these values, so
 * the audit trail stays faithful; the DOM renders them as inert text nodes.
 */
function verbatimSegmentLine(segments: readonly Segment[]): OutputLine {
  return { segments };
}

/** Build a single, UNWRAPPED, verbatim `OutputLine` of plain text. */
function verbatimTextLine(text: string): OutputLine {
  return { segments: [{ text }] };
}

/** A single graceful oracle message block (never a throw). */
function messageBlock(mystical: string, technical: string): BlockDraft {
  const lines: OutputLine[] = [
    ...textLines(mystical),
    ...textLines(technical),
  ];
  return { kind: "oracle", demo: false, lines };
}

/** Render one evidence item's `path`/`line` on a verbatim labelled line. */
function evidencePathLine(item: Evidence, ctx: RenderContext): OutputLine {
  if (item.path === undefined) {
    return verbatimTextLine("  path: (none)");
  }

  const pathText = ctx.live ? item.path : `fixture:${item.path}`;
  const location =
    item.line !== undefined ? `${pathText}:${item.line}` : pathText;

  const href =
    ctx.live && ctx.ref !== null ? buildEvidenceLink(ctx.ref, item) : null;

  if (href !== null) {
    return verbatimSegmentLine([{ text: "  path: " }, { text: location, href }]);
  }
  return verbatimTextLine(`  path: ${location}`);
}

/**
 * Render every field of one evidence item on labelled lines. The `path` and
 * `detail` values are emitted verbatim (unwrapped) so they appear intact even
 * when they contain whitespace (R8.1).
 */
function evidenceItemLines(item: Evidence, ctx: RenderContext): OutputLine[] {
  const lines: OutputLine[] = [];
  lines.push(...textLines(`- kind: ${item.kind}`));
  lines.push(...textLines(`  source: ${item.source}`));
  lines.push(evidencePathLine(item, ctx));
  if (item.line !== undefined) {
    lines.push(...textLines(`  line: ${item.line}`));
  }
  if (item.detail !== "") {
    lines.push(verbatimTextLine(`  detail: ${item.detail}`));
  }
  return lines;
}

/** Render the full explain block for a drawn position (all evidence). */
function renderDrawnExplain(
  position: SpreadPosition,
  ctx: RenderContext,
): BlockDraft {
  const draw = position.draw!;
  const def = getCard(draw.card);
  const name = def.name.toUpperCase();
  const lines: OutputLine[] = [];

  lines.push(
    ...textLines(
      `${def.numeral} ${name}  ${draw.orientation.toUpperCase()}  ` +
        `SEVERITY ${draw.severity}`,
    ),
  );
  lines.push(...textLines(VOICE_TABLE[draw.card][draw.orientation]));
  if (draw.summary !== "") {
    lines.push(...textLines(draw.summary));
  }

  if (draw.evidence.length === 0) {
    lines.push(...textLines("No evidence attends this card."));
  } else {
    lines.push(...textLines("EVIDENCE"));
    for (const item of draw.evidence) {
      lines.push(...evidenceItemLines(item, ctx));
    }
  }

  return { kind: "oracle", demo: false, lines };
}

/** Render a void position's explanation (R8.5). */
function renderVoidExplain(position: SpreadPosition): BlockDraft {
  const lines: OutputLine[] = [];
  lines.push(...textLines(`${position.position}  ${position.label}`));
  lines.push(...textLines("VOID"));
  lines.push(
    ...textLines(
      position.description ?? "This position holds no card — the void is a sign.",
    ),
  );
  return { kind: "oracle", demo: false, lines };
}

/**
 * Resolve an `ExplainTarget` against a reading and render its evidence, or a
 * graceful message when the target cannot be resolved. Never throws (R8.5).
 */
export function renderExplain(
  resp: ReadingResponse,
  target: ExplainTarget,
): BlockDraft[] {
  const { reading, summary } = resp;
  const ctx: RenderContext = {
    live: summary.demo !== true,
    ref: reading.repo as RepoRef,
  };

  if (reading.spread.length === 0) {
    return [
      messageBlock(
        "There is no reading to explain.",
        "No cards have been drawn. Summon a repository and read a spread first.",
      ),
    ];
  }

  if (target.kind === "position") {
    const position = reading.spread.find((p) => p.position === target.position);
    if (position === undefined) {
      return [
        messageBlock(
          "That seat lies beyond the spread.",
          `No card sits at position ${target.position}. ` +
            `This spread holds ${reading.spread.length} positions.`,
        ),
      ];
    }
    if (position.draw === null) {
      return [renderVoidExplain(position)];
    }
    return [renderDrawnExplain(position, ctx)];
  }

  // target.kind === "card"
  const position = reading.spread.find(
    (p) => p.draw !== null && p.draw.card === target.card,
  );
  if (position === undefined) {
    const name = getCard(target.card).name.toUpperCase();
    return [
      messageBlock(
        "That card did not fall in this reading.",
        `${name} was not drawn. Type read to lay a fresh spread, or explain a position that holds a card.`,
      ),
    ];
  }
  return [renderDrawnExplain(position, ctx)];
}
