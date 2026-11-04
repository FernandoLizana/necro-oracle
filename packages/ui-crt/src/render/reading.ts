// Reading, card-block, progress, echo, skip-note and vitality-gauge renderers
// for @necro/ui-crt (task 9.2).
//
// Validates: Requirements R6.10, R6.15, R6.21, R7.1, R7.2, R7.3, R7.5, R7.6,
// R7.7, R7.9, R7.10, R7.12
//
// `renderReading` is a pure, deterministic function of a `ReadingResponse`
// (R7.11): one `BlockDraft` per spread position in the Reading's order (R7.1),
// then a closing block carrying the 20-cell vitality gauge (R7.7), the
// `vitalityVoice` line and the `explain` hint, and — when `reading.errors` is
// non-empty (Q7) — one further block naming the failed-detector count and
// codes. Every drawn card's name, orientation and severity are rendered exactly
// as received (R7.2); no card that was not drawn ever appears (R7.12).
//
// All text passes through `sanitizeText` and is wrapped to 72 columns before it
// becomes a line. Evidence paths become clickable `Evidence_Link` segments only
// for a live reading (R7.6); a demo response prints `fixture:{path}` with no
// href (R18.11).

import {
  getCard,
  type Evidence,
  type Reading,
  type RepoRef,
  type SpreadPosition,
} from "@necro/oracle/client";

import type { ReadingPhase, ReadingResponse } from "../protocol.js";
import { sanitizeText } from "../text/sanitize.js";
import { wrapSegments, wrapText, type Segment } from "../text/wrap.js";
import { VOICE_TABLE } from "../voice/voice-table.js";
import { PHASE_VOICE, vitalityVoice } from "../voice/phrases.js";
import type { BlockDraft, BlockKind, OutputLine } from "./blocks.js";
import { buildEvidenceLink } from "./evidence-link.js";

/** One entry of a Reading's `errors` list: a failed detector's code/message. */
type ReadingError = Reading["errors"][number];

/** Whether a reading is live (links allowed) and which ref its evidence is in. */
export interface RenderContext {
  readonly live: boolean;
  readonly ref: RepoRef | null;
}

/** The number of cells in the ASCII vitality gauge. */
const GAUGE_CELLS = 20;

/** The maximum number of evidence items a card block shows inline. */
const MAX_EVIDENCE_LINES = 3;

/** Build an `OutputLine` of wrapped plain text (sanitised first). */
function textLines(text: string): OutputLine[] {
  const clean = sanitizeText(text);
  return wrapText(clean).map((line) => ({ segments: [{ text: line }] }));
}

/** Build wrapped `OutputLine`s from pre-built segments (text sanitised). */
function segmentLines(segments: readonly Segment[]): OutputLine[] {
  const clean = segments.map((s) =>
    s.href === undefined
      ? { text: sanitizeText(s.text) }
      : { text: sanitizeText(s.text), href: s.href },
  );
  return wrapSegments(clean).map((line) => ({ segments: line }));
}

/** The one-line evidence location text: `path:line  detail` (parts omitted). */
function evidenceInlineText(item: Evidence, pathText: string | null): string {
  const location =
    pathText === null
      ? ""
      : item.line !== undefined
        ? `${pathText}:${item.line}`
        : pathText;
  const detail = item.detail;
  if (location === "" && detail === "") return "";
  if (location === "") return `  ${detail}`;
  if (detail === "") return `  ${location}`;
  return `  ${location}  ${detail}`;
}

/**
 * The display text for an evidence path: the raw repo path for a live reading,
 * or `fixture:{path}` for a demo reading (R18.11). `null` when there is no path.
 */
function evidencePathText(item: Evidence, ctx: RenderContext): string | null {
  if (item.path === undefined) return null;
  return ctx.live ? item.path : `fixture:${item.path}`;
}

/** Build the inline evidence line(s) for one card's drawn position. */
function evidenceLines(
  evidence: readonly Evidence[],
  ctx: RenderContext,
): OutputLine[] {
  const lines: OutputLine[] = [];
  const shown = evidence.slice(0, MAX_EVIDENCE_LINES);

  for (const item of shown) {
    const pathText = evidencePathText(item, ctx);
    const text = evidenceInlineText(item, pathText);
    if (text === "") continue;

    // A live reading with a path renders the location as an Evidence_Link; the
    // link covers only the location text, the detail stays plain.
    const href =
      ctx.live && ctx.ref !== null && item.path !== undefined
        ? buildEvidenceLink(ctx.ref, item)
        : null;

    if (href !== null && pathText !== null) {
      const location =
        item.line !== undefined ? `${pathText}:${item.line}` : pathText;
      const segments: Segment[] = [{ text: "  " }, { text: location, href }];
      if (item.detail !== "") segments.push({ text: `  ${item.detail}` });
      lines.push(...segmentLines(segments));
    } else {
      lines.push(...textLines(text));
    }
  }

  if (evidence.length > MAX_EVIDENCE_LINES) {
    const more = evidence.length - MAX_EVIDENCE_LINES;
    lines.push(...textLines(`  … and ${more} more evidence items.`));
  }

  return lines;
}

/** The header line for a position: `<numeral> <NAME>  <ORIENT>  SEVERITY <n>`. */
function cardHeaderText(position: SpreadPosition): string {
  const draw = position.draw!;
  const def = getCard(draw.card);
  const name = def.name.toUpperCase();
  const orientation = draw.orientation.toUpperCase();
  return `${def.numeral} ${name}  ${orientation}  SEVERITY ${draw.severity}`;
}

/**
 * Render a single spread position as a `BlockDraft`. A void position prints the
 * position label, `VOID`, and its description (R6.10). A drawn position prints
 * the header, the `VOICE_TABLE` mystical line, the technical `summary`, then up
 * to three inline evidence lines.
 */
export function renderCardBlock(
  position: SpreadPosition,
  ctx: RenderContext,
): BlockDraft {
  const lines: OutputLine[] = [];
  const positionLabel = `${position.position}  ${position.label}`;
  lines.push(...textLines(positionLabel));

  if (position.draw === null) {
    lines.push(...textLines("VOID"));
    if (position.description !== undefined) {
      lines.push(...textLines(position.description));
    }
    return { kind: "oracle", demo: false, lines };
  }

  const draw = position.draw;
  lines.push(...textLines(cardHeaderText(position)));
  lines.push(...textLines(VOICE_TABLE[draw.card][draw.orientation]));
  if (draw.summary !== "") {
    lines.push(...textLines(draw.summary));
  }
  lines.push(...evidenceLines(draw.evidence, ctx));

  return { kind: "oracle", demo: false, lines };
}

/** Render the 20-cell ASCII vitality gauge text: `VITALITY n/100 [####----]`. */
function vitalityGaugeText(vitality: number): string {
  const clamped = Math.max(0, Math.min(100, vitality));
  const filled = Math.floor((clamped / 100) * GAUGE_CELLS);
  const gauge = "#".repeat(filled) + "-".repeat(GAUGE_CELLS - filled);
  return `VITALITY ${vitality}/100 [${gauge}]`;
}

/** Render the closing block: vitality voice, gauge, and the explain hint. */
function renderClosingBlock(vitality: number): BlockDraft {
  const lines: OutputLine[] = [];
  lines.push(...textLines(vitalityVoice(vitality)));
  lines.push(...textLines(vitalityGaugeText(vitality)));
  lines.push(
    ...textLines("Type explain <position> for the evidence behind a card."),
  );
  return { kind: "oracle", demo: false, lines };
}

/** Render the Q7 closing error block: failed-detector count and codes. */
function renderErrorSummaryBlock(errors: readonly ReadingError[]): BlockDraft {
  const codes = [...new Set(errors.map((e) => e.code))].join(", ");
  const lines: OutputLine[] = [];
  lines.push(...textLines("Some cards could not be read."));
  lines.push(
    ...textLines(`${errors.length} detector(s) failed: ${codes}.`),
  );
  return { kind: "error", demo: false, lines };
}

/**
 * Render a full `ReadingResponse`: one block per spread position in order, a
 * closing vitality block, and — when the reading carries detector errors — one
 * error-summary block (Q7). Pure and deterministic (R7.11).
 */
export function renderReading(resp: ReadingResponse): BlockDraft[] {
  const { reading, summary } = resp;
  const ctx: RenderContext = {
    live: summary.demo !== true,
    ref: reading.repo,
  };

  const blocks: BlockDraft[] = reading.spread.map((position) =>
    renderCardBlock(position, ctx),
  );

  blocks.push(renderClosingBlock(reading.vitality));

  if (reading.errors.length > 0) {
    blocks.push(renderErrorSummaryBlock(reading.errors));
  }

  return blocks;
}

/** Build a single-block status draft of the given kind from wrapped text. */
function statusBlock(text: string, kind: BlockKind): BlockDraft {
  return { kind, demo: false, lines: textLines(text) };
}

/** Render one Progress_Line for a reading phase (R6.15), kind `status`. */
export function renderProgress(phase: ReadingPhase): BlockDraft {
  const voice = PHASE_VOICE[phase];
  const lines: OutputLine[] = [
    ...textLines(voice.mystical),
    ...textLines(voice.technical),
  ];
  return { kind: "status", demo: false, lines };
}

/** Render the EXTERNAL skip note as a status block (R6.21). */
export function renderSkipNote(note: string): BlockDraft {
  return statusBlock(note, "status");
}

/** Render the echoed command line (sanitised), kind `echo`. */
export function renderEcho(raw: string): BlockDraft {
  return statusBlock(raw, "echo");
}
