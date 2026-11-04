// 72-column word wrapper for @necro/ui-crt (task 6.2, Property 4).
//
// Validates: Requirements R17.1, R17.3
//
// `wrapText` splits on `\n`, then greedily packs whitespace-separated tokens
// into lines of at most `width` code points. A token longer than `width` is
// cut at `width` by code point, so surrogate pairs stay whole. Whitespace at a
// break is dropped; it never returns an empty array. Width is measured in code
// points, not display cells (East Asian wide characters can look wider;
// accepted for L0). `wrapSegments` runs the same algorithm over the
// concatenated segment text and slices the original segments by offset, so a
// link that crosses a break becomes two segments sharing the same `href`.

/** The default terminal line width, in code points. */
export const LINE_WIDTH = 72;

/** A run of text that may carry a hyperlink target. */
export interface Segment {
  readonly text: string;
  readonly href?: string;
}

/**
 * A wrapped line described as a half-open code-point range `[start, end)` into
 * the source string. Whitespace dropped at a break lies between one line's
 * `end` and the next line's `start`.
 */
interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** True when `ch` (a single code point) is Unicode whitespace. */
function isWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

/**
 * Wrap a single logical line (no `\n`) into code-point ranges. The source is
 * the array of code points of the full text; `base` is the offset of this
 * line's first code point within that array.
 */
function wrapLineRanges(
  points: readonly string[],
  base: number,
  length: number,
  width: number,
): LineRange[] {
  const limit = base + length;
  const ranges: LineRange[] = [];

  // The line currently being built is the contiguous slice [lineStart, lineEnd).
  // Its code-point width is `lineEnd - lineStart`, which includes any internal
  // whitespace runs that were kept between packed tokens. `lineStart === -1`
  // means no line is open yet.
  let lineStart = -1;
  let lineEnd = -1;

  let i = base;
  while (i < limit) {
    if (isWhitespace(points[i]!)) {
      i += 1;
      continue;
    }

    // Read one whitespace-free token [tokenStart, tokenEnd).
    const tokenStart = i;
    let tokenEnd = i;
    while (tokenEnd < limit && !isWhitespace(points[tokenEnd]!)) {
      tokenEnd += 1;
    }
    i = tokenEnd;
    const tokenLen = tokenEnd - tokenStart;

    if (tokenLen > width) {
      // Over-long token: flush any open line (dropping the break whitespace),
      // then cut the token into width-sized pieces by code point.
      if (lineStart !== -1) {
        ranges.push({ start: lineStart, end: lineEnd });
        lineStart = -1;
      }
      let cut = tokenStart;
      while (tokenEnd - cut > width) {
        ranges.push({ start: cut, end: cut + width });
        cut += width;
      }
      // Any remainder (1..width code points) opens a fresh line to pack onto.
      // A token whose length is an exact multiple of `width` leaves none.
      if (cut < tokenEnd) {
        lineStart = cut;
        lineEnd = tokenEnd;
      }
      continue;
    }

    if (lineStart === -1) {
      // Start a fresh line with this token.
      lineStart = tokenStart;
      lineEnd = tokenEnd;
    } else if (tokenEnd - lineStart <= width) {
      // Token (plus the kept internal whitespace) still fits on this line.
      lineEnd = tokenEnd;
    } else {
      // Break: flush the current line and start a new one at the token,
      // dropping the whitespace that fell at the break.
      ranges.push({ start: lineStart, end: lineEnd });
      lineStart = tokenStart;
      lineEnd = tokenEnd;
    }
  }

  if (lineStart !== -1) {
    ranges.push({ start: lineStart, end: lineEnd });
  }
  return ranges;
}

/**
 * Compute the wrapped line ranges for the whole text: split on `\n` into
 * logical lines (blank lines preserved), wrap each, and guarantee at least one
 * range so callers never see an empty result.
 */
function wrapRanges(points: readonly string[], width: number): LineRange[] {
  const effectiveWidth = Math.max(1, Math.floor(width));
  const ranges: LineRange[] = [];

  let lineStart = 0;
  for (let i = 0; i <= points.length; i += 1) {
    if (i === points.length || points[i] === "\n") {
      const length = i - lineStart;
      const lineRanges = wrapLineRanges(points, lineStart, length, effectiveWidth);
      if (lineRanges.length === 0) {
        // Empty or all-whitespace logical line → one blank output line.
        ranges.push({ start: lineStart, end: lineStart });
      } else {
        ranges.push(...lineRanges);
      }
      lineStart = i + 1;
    }
  }

  // Defensive: an empty input still yields one (empty) line.
  if (ranges.length === 0) ranges.push({ start: 0, end: 0 });
  return ranges;
}

/**
 * Wrap `text` to lines of at most `width` code points (default
 * {@link LINE_WIDTH}). Splits on `\n`, greedily packs whitespace-separated
 * tokens, cuts over-long tokens by code point, drops whitespace at breaks, and
 * never returns an empty array.
 */
export function wrapText(text: string, width: number = LINE_WIDTH): string[] {
  const points = [...text];
  const ranges = wrapRanges(points, width);
  return ranges.map((r) => points.slice(r.start, r.end).join(""));
}

/**
 * Wrap a sequence of {@link Segment}s to lines of at most `width` code points.
 * The same algorithm runs over the concatenated segment text; each output line
 * is sliced back into segments by offset, so a segment that straddles a line
 * break becomes two segments sharing the same `href`.
 */
export function wrapSegments(
  segments: readonly Segment[],
  width: number = LINE_WIDTH,
): Segment[][] {
  // Build the concatenated code-point array and, for each code point, the
  // index of the segment it came from.
  const points: string[] = [];
  const owner: number[] = [];
  segments.forEach((segment, index) => {
    for (const ch of segment.text) {
      points.push(ch);
      owner.push(index);
    }
  });

  const ranges = wrapRanges(points, width);

  return ranges.map((range) => {
    const line: Segment[] = [];
    let pos = range.start;
    while (pos < range.end) {
      const segIndex = owner[pos]!;
      let end = pos;
      while (end < range.end && owner[end] === segIndex) {
        end += 1;
      }
      const source = segments[segIndex]!;
      const text = points.slice(pos, end).join("");
      line.push(source.href === undefined ? { text } : { text, href: source.href });
      pos = end;
    }
    return line;
  });
}
