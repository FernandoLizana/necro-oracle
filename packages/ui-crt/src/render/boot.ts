// Boot_Frame_Renderer for @necro/ui-crt (visual-necromancy task 1.1).
//
// Validates: Requirements 1.1, 2.1, 2.3, 2.4
//
// The Boot_Sequence is a one-time retro startup animation: a memory-check
// readout in dry Oracle_Voice, the `NECROMANTIC SYSTEMS 1986` ASCII logo, a
// phosphor warm-up indication, and finally the ready frame. `bootFrame` maps a
// step index to one Boot_Frame and is pure (design decision: no clock, network,
// DOM or unseeded randomness — R2.1). Frames are cumulative: each memory-check
// step adds one readout line to the lines already shown, so the sequence reads
// like a machine waking up one subsystem at a time.
//
// Every emitted line is at most {@link LINE_WIDTH} (72) columns, matching the
// Terminal column limit (R2.3). The source strings here are authored within
// that limit; `wrapText` is applied as a defensive guarantee so a future edit
// that overshoots is folded rather than silently exceeding the width.
//
// Indexing is total and saturating (R2.4): any index at or beyond the last step
// returns the ready frame, and negative / fractional / NaN indices clamp to the
// first step, so the hook driving the sequence can never index out of range.

import { sanitizeText } from "../text/sanitize.js";
import { LINE_WIDTH, wrapText } from "../text/wrap.js";
import type { OutputLine } from "./blocks.js";

/** One rendered text frame of the Boot_Sequence. */
export interface BootFrame {
  /** The frame's lines, each at most {@link LINE_WIDTH} columns. */
  readonly lines: readonly OutputLine[];
}

/** The accessible text equivalent of the decorative ASCII logo (R10.4). */
export const BOOT_LOGO_TEXT_EQUIVALENT = "NECROMANTIC SYSTEMS 1986";

/**
 * The cumulative memory-check readout, one line revealed per boot step. Dry
 * Oracle_Voice: the machine counting its own cold memory back to life. Each
 * string is authored within the 72-column limit.
 */
const MEMORY_CHECK_LINES: readonly string[] = [
  "MEMORY 0128K ... OK",
  "MEMORY 0384K ... OK",
  "MEMORY 0640K ... OK",
  "NECROMANTIC CORE ... AWAKE",
];

/**
 * The decorative ASCII logo for `NECROMANTIC SYSTEMS 1986`. Authored so the
 * widest line stays within {@link LINE_WIDTH}; `BOOT_LOGO_TEXT_EQUIVALENT`
 * carries the accessible reading for assistive technology.
 */
const BOOT_LOGO_LINES: readonly string[] = [
  " _   _ _____ ____ ____  ___  ",
  "| \\ | | ____/ ___|  _ \\/ _ \\ ",
  "|  \\| |  _|| |   | |_) | | | |",
  "| |\\  | |__| |___|  _ <| |_| |",
  "|_| \\_|_____\\____|_| \\_\\\\___/ ",
  "   NECROMANTIC SYSTEMS 1986   ",
];

/** The phosphor warm-up indication shown just before the ready frame. */
const PHOSPHOR_WARMUP_LINE = "PHOSPHOR WARM-UP ... the screen remembers the dead.";

/**
 * The ready frame: the logo, then the machine declaring itself awake and
 * waiting. This is the terminal state the sequence saturates to (R2.4).
 */
const READY_LINES: readonly string[] = [
  ...BOOT_LOGO_LINES,
  "",
  "SYSTEMS NOMINAL. The oracle is awake.",
  "READY.",
];

/**
 * The ordered list of frames, authored as plain-text line arrays. Memory-check
 * steps accumulate their readout; then the logo frame, the warm-up frame, and
 * finally the ready frame. The renderer wraps and sanitises these into
 * `OutputLine`s on demand.
 */
const FRAME_SOURCES: readonly (readonly string[])[] = [
  // Memory-check steps: each frame shows one more cumulative readout line.
  ...MEMORY_CHECK_LINES.map((_, index) => MEMORY_CHECK_LINES.slice(0, index + 1)),
  // The logo rises.
  BOOT_LOGO_LINES,
  // The phosphor warms up beneath the logo.
  [...BOOT_LOGO_LINES, "", PHOSPHOR_WARMUP_LINE],
  // The ready frame — the final, saturating step.
  READY_LINES,
];

/**
 * The fixed number of boot steps. Valid displayed indices are
 * `0..BOOT_STEP_COUNT-1`; the last is the ready frame.
 */
export const BOOT_STEP_COUNT = FRAME_SOURCES.length;

/** Wrap and sanitise a plain-text line into a width-bounded `OutputLine`. */
function toLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text), LINE_WIDTH).map((line) => ({
    segments: [{ text: line }],
  }));
}

/** Build a `BootFrame` from a plain-text line array. */
function toFrame(source: readonly string[]): BootFrame {
  const lines: OutputLine[] = [];
  for (const text of source) {
    lines.push(...toLines(text));
  }
  return { lines };
}

/**
 * Map a Boot_Sequence step index to its Boot_Frame. Pure: no clock, network,
 * DOM or unseeded randomness (R2.1), and two calls with the same index return
 * equal frames (R2.2). Totally defined and saturating (R2.4): any index at or
 * beyond the last step returns the ready frame, and negative / fractional /
 * `NaN` indices clamp to the first step.
 */
export function bootFrame(stepIndex: number): BootFrame {
  const raw = Number.isFinite(stepIndex) ? Math.floor(stepIndex) : 0;
  const index = Math.min(BOOT_STEP_COUNT - 1, Math.max(0, raw));
  return toFrame(FRAME_SOURCES[index]!);
}
