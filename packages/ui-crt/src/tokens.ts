// src/tokens.ts
//
// Feature: 03-crt-terminal, task 17.2.
//
// The CRT design tokens: the single source of truth for every phosphor colour
// and motion-effect constant the terminal renders with. `src/crt.css` declares
// the identical values as custom properties on `.crt`; the `crt-tokens.test.ts`
// suite parses that stylesheet and asserts it mirrors these exports exactly,
// and that every contrast / flicker / scanline constraint holds (design
// §"CRT design tokens and motion CSS").
//
// The colour values are the WCAG arbiter's output, not decoration. The tokens
// test computes the real sRGB contrast ratios — flat and under the worst-case
// scanline composite — and demands >= 4.5:1 for text and >= 3:1 for the focus
// ring. Two notes on the values below:
//
//   - `CRT_FOCUS` is `#a85c30`, an amber-brown, NOT the near-white the design
//     table listed as a candidate. A focus ring must reach >= 3:1 against both
//     the near-black background AND the bright `#33ff66` foreground. Because
//     `#33ff66` has a high relative luminance (~0.73), any colour light enough
//     to read against the background but still 3:1 below the foreground lands
//     in a narrow mid-luminance band; `#a85c30` sits in it with the most
//     balanced margin (~3.69:1 against both). The design's `#d9ffe3` reached
//     only ~1.24:1 against the foreground and was rejected by the test, so the
//     token (and the matching CSS variable) were adjusted here per the design's
//     own rule that "the test is the arbiter".
//   - Every other candidate from the design table (`#33ff66`, `#001a00`,
//     `#29cc52`, `#ff7a7a`) passed the computed thresholds unchanged.
//
// _Requirements: R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7, R9.8, R15.6, R15.7_

// ---------------------------------------------------------------------------
// Phosphor palette (R9.1)
// ---------------------------------------------------------------------------

/** The phosphor foreground: the signature CRT green (R9.1). */
export const CRT_FG = "#33ff66";

/** The near-black phosphor background (R9.1). */
export const CRT_BG = "#001a00";

/** Dimmed foreground for secondary text; >= 4.5:1 on bg, also under scanlines. */
export const CRT_FG_DIM = "#29cc52";

/** Error foreground; >= 4.5:1 on bg. Error blocks also carry an ERROR marker. */
export const CRT_ERROR = "#ff7a7a";

/**
 * Focus-ring colour; >= 3:1 against both bg and fg (R15.7). Adjusted from the
 * design's candidate `#d9ffe3` (which failed the >= 3:1 vs fg check) to an
 * amber-brown that satisfies the computed threshold on both sides.
 */
export const CRT_FOCUS = "#a85c30";

// ---------------------------------------------------------------------------
// Effect tokens (R9.3–R9.7)
// ---------------------------------------------------------------------------

/** Glow blur radius, in CSS pixels, for the phosphor `text-shadow` (R9.3). */
export const CRT_GLOW_RADIUS_PX = 4;

/** Glow alpha (0..1) for the phosphor `text-shadow` (R9.3). */
export const CRT_GLOW_ALPHA = 0.55;

/** Scanline period, in CSS pixels, of the repeating-linear-gradient (R9.2). */
export const CRT_SCANLINE_PERIOD_PX = 3;

/** Scanline trough alpha (0..1): how dark the darkest scanline is (R9.2). */
export const CRT_SCANLINE_ALPHA = 0.18;

/**
 * Flicker cycles per second. One cycle is a rise and a fall (two luminance
 * changes), so `1` cycle/s is `2` changes/s — within the 3-changes/s cap (R9.4).
 */
export const CRT_FLICKER_CYCLES_PER_S = 1;

/** Flicker depth (0..1): peak opacity of the black flicker overlay (<= 5 %, R9.4). */
export const CRT_FLICKER_DEPTH = 0.04;

/** Afterglow fade duration, in milliseconds; disabled in reduced motion (R9.5). */
export const CRT_AFTERGLOW_MS = 600;
