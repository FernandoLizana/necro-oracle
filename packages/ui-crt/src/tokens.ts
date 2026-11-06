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

// ---------------------------------------------------------------------------
// Visual_Layer accent colours (visual-necromancy, task 14.1)
// ---------------------------------------------------------------------------
//
// Two accent colours the tarot-ux palette rule already allows, added here as
// the single source of truth so `crt.css` can mirror them. NEITHER is a new
// palette value: both are named in the tarot-ux steering (`#ffb000` warning
// amber, `#ff3355` error red) and in requirement R7.2, and both are used only
// in the narrow, rule-bound places that requirement permits.
//
//   - `CRT_BURNING_AMBER` (`#ffb000`): the warning amber. Used ONLY for the
//     burning cards `tower`/`devil` via `[data-burning="true"]`, and ONLY as a
//     decorative glow (glitch `text-shadow` tint) — never as body text — so it
//     carries no text-contrast obligation. The underlying card glyphs and the
//     screen-reader equivalent stay in the phosphor `--crt-fg` (R5.7, R5.8).
//   - `CRT_STILL_DEAD` (`#ff3355`): the error red. Used ONLY for a STILL DEAD
//     verdict (R7.2). The existing `--crt-error` (`#ff7a7a`, the WCAG arbiter's
//     value) remains the token for error *body text*; this accent is reserved
//     for the single STILL DEAD verdict word, which is also marked by the
//     verdict label text, so severity is never conveyed by colour alone.
//
// The `crt-tokens.test.ts` contrast checks cover `--crt-fg`, `--crt-fg-dim`,
// and `--crt-error`; these two accents are decorative/verdict-only and are not
// subject to those body-text ratios, matching how the design scopes them.

/** Warning amber; decorative glow for `tower`/`devil` only (R5.7, R7.2). */
export const CRT_BURNING_AMBER = "#ffb000";

/** Error red; the STILL DEAD verdict word only (R7.2). */
export const CRT_STILL_DEAD = "#ff3355";

// ---------------------------------------------------------------------------
// Visual_Layer motion tokens (visual-necromancy, task 14.1)
// ---------------------------------------------------------------------------
//
// Bounded durations for the Visual_Layer animations, mirrored as custom
// properties on `.crt`. Every value honours the Flash_Limit: the glitch and
// shake windows are <= 300 ms (R5.9, R5.11) and the rot cadence is slow enough
// that luminance changes stay <= 2 per second (R6.11). The CSS gates all of
// these behind `.crt[data-motion="full"]` and uses
// `animation-iteration-count: 1` for the one-shot effects, so no rolling
// one-second window can ever accumulate more than 2 flashes (R7.6, R10.3).

/** Glitch ceiling in ms; mirrors `GLITCH_MAX_DURATION_MS` (Flash_Limit, R5.9). */
export const CRT_GLITCH_MAX_MS = 300;

/** Tower shake duration in ms; <= 300 to honour the tarot-ux shake allowance (R5.9). */
export const CRT_SHAKE_MS = 300;

/** Card-flip half-turn duration in ms for the one-by-one reveal (R4.1, R4.2). */
export const CRT_FLIP_MS = 320;

/**
 * Minimum interval in ms between visible rot luminance shifts. At >= 500 ms a
 * rolling one-second window sees at most 2 changes, below the 3-flash ceiling
 * (R6.11). The rot playback hook paces frames no faster than this.
 */
export const CRT_ROT_FRAME_MIN_MS = 500;

/**
 * OPTIONAL phosphor bloom duration in ms (visual-necromancy task 21.2,
 * R13.2). A one-shot glow swell on a severity-3 card reveal in full motion:
 * the glow radius / alpha rise once and settle inside this window. It is CSS
 * only (keyed off `data-glitch-intensity="3"`), adds no JS, and is gated behind
 * `.crt[data-motion="full"]`. At <= 300 ms with `animation-iteration-count: 1`
 * and a single rise-then-settle (<= 2 luminance changes, no repeat), it holds
 * the Flash_Limit exactly like the glitch window (R13.2, R13.4, R10.3).
 */
export const CRT_BLOOM_MS = 300;

// ---------------------------------------------------------------------------
// Arcana_Visions motion / ritual tokens (arcana-visions, task 1)
// ---------------------------------------------------------------------------
//
// Bounded durations for the Arcana_Visions pixel-art layer (Spec 06), added in
// this same `tokens.ts` module and mirrored as custom properties on `.crt` so
// `arcana.css` can key off them. Like the Visual_Layer tokens above, every
// value honours the Flash_Limit — here stated as Arcana_Visions' stricter cap
// of <= 2 luminance changes per second per animated region (R4.5) — and the
// ritual total stays within the 3-second ceiling (R6.2).
//
// Two groups:
//
//   - The Resurrection_Ritual total: `RITUAL_TOTAL_MS` caps the sum of the
//     four ritual phase durations (`closed-glitch -> tremble -> crossfade ->
//     rising-diff`) that `ritualTimeline()` emits. At <= 3000 ms it satisfies
//     R6.2 (the ritual completes within 3 s from first frame to the diff view).
//     The pure timeline module re-exports this as its own `RITUAL_TOTAL_MS`.
//   - The Motion_Zone cadence bounds: `MOTION_ZONE_PERIOD_MS` and
//     `MOTION_ZONE_STEPS` are the shared defaults for the CSS-only `steps()`
//     zone animations. The Flash_Limit is `steps / (periodMs / 1000)`; with a
//     2000 ms period and 4 steps that is exactly `4 / (2000/1000) = 2`
//     changes/s — the ceiling, never exceeded (R4.5). Authored per-zone values
//     in the Motion_Zone_Table are validated against this same bound.

/**
 * Resurrection_Ritual total duration ceiling in ms. Caps the summed durations
 * of the ritual phase steps so the ritual completes within 3 s, first frame to
 * the standard diff/patch view (R6.2). Chosen at the 3-second limit itself so
 * the four phases have the full budget while never exceeding it.
 */
export const RITUAL_TOTAL_MS = 3000;

/**
 * Default Motion_Zone animation period in ms (one full `steps()` cycle). Paired
 * with `MOTION_ZONE_STEPS` it keeps a zone's luminance changes at the
 * Flash_Limit of <= 2 per second: `MOTION_ZONE_STEPS / (MOTION_ZONE_PERIOD_MS /
 * 1000) = 4 / 2 = 2` (R4.5).
 */
export const MOTION_ZONE_PERIOD_MS = 2000;

/**
 * Default number of discrete `steps()` frames across one Motion_Zone period. At
 * 4 steps over a 2000 ms period this yields exactly 2 luminance changes per
 * second, the Flash_Limit ceiling for an animated region (R4.5).
 */
export const MOTION_ZONE_STEPS = 4;
