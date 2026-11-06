// Pure module: Resurrection_Ritual timeline for @necro/ui-crt
// (Arcana_Visions, task 5.1).
//
// Validates: Requirements R6.1, R6.2, R6.4, R6.5, R6.6, R6.8, R6.10
//
// This module is pure: it reads no clock, DOM, network, or audio, draws no
// randomness beyond the explicit `seed`, and never throws. `ritualTimeline`
// decides, from a plain options record, either that no ritual plays (returning
// an empty array = a single render straight to the diff/patch view) or that the
// four ritual phases play in order, each with a `startMs` and `durationMs`.
//
// The ordered phases are `closed-glitch -> tremble -> crossfade -> rising-diff`
// (R6.1): the Necronomicon_Closed image glitches, trembles, crossfades to the
// Necronomicon_Open image, and the resurrected diff lines rise. The summed
// durations never exceed `RITUAL_TOTAL_MS` (<= 3000 ms), so the ritual always
// completes within 3 s from first frame to the diff view (R6.2), and the
// `startMs` values are non-decreasing in phase order.
//
// Gating (empty array = skip): the ritual is skipped exactly when Reduced_Motion
// is active (R6.4), or the Necronomicon frames are not ready to decode (R6.10),
// or a Playwright run / `?boot=skip` is active without the Ritual_Force_Flag
// (R6.5); the force flag plays the full ritual even then (R6.6).
//
// Determinism (R6.8): the result is a pure function of `opts`, including `seed`.
// The seed drives only bounded sub-frame jitter redistributed between the first
// three phases; the jitter is derived arithmetically from the seed (no RNG), so
// the same `opts` — same seed included — always yields an identical array, and
// the summed durations stay fixed at the full budget regardless of seed.

import type { MotionMode } from "../motion/motion-mode.js";
import { RITUAL_TOTAL_MS } from "../tokens.js";

/**
 * The Resurrection_Ritual total duration ceiling in ms, re-exported from
 * `tokens.ts`. Caps the summed phase durations at <= 3000 ms (R6.2).
 */
export { RITUAL_TOTAL_MS };

/**
 * The four ordered phases of the Resurrection_Ritual: the closed book glitches,
 * then trembles, then crossfades to the open book, then the resurrected diff
 * lines rise from the pages (R6.1).
 */
export type RitualPhase =
  | "closed-glitch"
  | "tremble"
  | "crossfade"
  | "rising-diff";

/** One ritual phase: its start offset and duration, both in ms from first frame. */
export interface RitualStep {
  readonly phase: RitualPhase;
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * The inputs that decide whether and how the ritual plays. All fields are plain
 * data so the function stays pure and testable without a clock or DOM.
 */
export interface RitualOpts {
  /** `"reduced"` skips the ritual entirely (single render) (R6.4). */
  readonly motionMode: MotionMode;
  /** A detected Playwright run; skips unless `ritualForce` is set (R6.5, R6.6). */
  readonly playwright: boolean;
  /** The `?boot=skip` flag; skips unless `ritualForce` is set (R6.5, R6.6). */
  readonly bootSkip: boolean;
  /** The Ritual_Force_Flag (`?ritual=force`); forces the full ritual (R6.6). */
  readonly ritualForce: boolean;
  /** Deterministic seed (DEMO_SEED in demo); same seed => identical steps (R6.8). */
  readonly seed: number;
  /** Whether both Necronomicon frames are ready to decode; `false` skips (R6.10). */
  readonly imagesReady: boolean;
}

// The ritual spends its full 3 s budget across the four phases in fixed order
// `closed-glitch -> tremble -> crossfade -> rising-diff`. These base durations
// sum to exactly RITUAL_TOTAL_MS; the seed only shifts a small bounded amount
// between the first three phases without changing the total. The glitch and
// crossfade reuse the 300 ms motion budget shape; the tremble is a brief beat;
// the rising-diff takes the remainder so the four phases consume the whole
// RITUAL_TOTAL_MS. A fixed-length tuple keeps the base durations statically
// known (no unchecked indexing).
const BASE_DURATIONS = [
  600, // closed-glitch
  300, // tremble
  600, // crossfade
  RITUAL_TOTAL_MS - 1500, // rising-diff (fills the remaining budget)
] as const satisfies readonly [number, number, number, number];

// The maximum ms the seed may shift out of a phase. Kept small so every phase
// stays clearly visible and the ordering/budget invariants always hold.
const JITTER_MAX_MS = 60;

/**
 * Bounded, deterministic sub-frame jitter in `[0, JITTER_MAX_MS]` derived from
 * the seed and a phase index. Pure integer arithmetic — no RNG — so the same
 * `(seed, index)` always yields the same offset (R6.8). Non-finite seeds map
 * to `0` so the function never produces NaN.
 */
function jitterFor(seed: number, index: number): number {
  if (!Number.isFinite(seed)) return 0;
  // A simple deterministic hash of the seed and phase index, folded into the
  // jitter range. `Math.abs` keeps negative seeds in range; `% (max + 1)`
  // yields an integer in `[0, JITTER_MAX_MS]`.
  const mixed = Math.abs(Math.trunc(seed) * 2654435761 + index * 40503);
  return mixed % (JITTER_MAX_MS + 1);
}

/**
 * Whether the ritual must be skipped (single render) for the given options.
 * Skip when Reduced_Motion is active (R6.4), or the frames are not ready
 * (R6.10), or a Playwright run / `?boot=skip` is active without the force flag
 * (R6.5); the force flag overrides the latter (R6.6).
 */
function shouldSkip(opts: RitualOpts): boolean {
  if (opts.motionMode === "reduced") return true;
  if (!opts.imagesReady) return true;
  if ((opts.playwright || opts.bootSkip) && !opts.ritualForce) return true;
  return false;
}

/**
 * The ordered ritual steps whose durations sum to `<= RITUAL_TOTAL_MS` with
 * non-decreasing `startMs`, OR an empty array meaning "single render, no
 * ritual". Empty exactly when `motionMode === "reduced"`, or `!imagesReady`,
 * or `((playwright || bootSkip) && !ritualForce)`. Otherwise the four phases
 * `closed-glitch -> tremble -> crossfade -> rising-diff` play in order.
 *
 * Pure and deterministic: no clock, DOM, or randomness beyond `seed`. The same
 * `opts` (seed included) always returns an identical array (R6.8); the seed
 * only redistributes bounded jitter among the first three phases and never
 * changes the fixed total of `RITUAL_TOTAL_MS`.
 */
export function ritualTimeline(opts: RitualOpts): RitualStep[] {
  if (shouldSkip(opts)) return [];

  // Compute the seed-driven jitter for the first three phases. Whatever ms a
  // phase loses to jitter is handed to the next phase, so the total is always
  // exactly RITUAL_TOTAL_MS and `startMs` stays non-decreasing. The final phase
  // absorbs the last carried jitter, keeping the sum fixed.
  const [base0, base1, base2, base3] = BASE_DURATIONS;
  const j0 = jitterFor(opts.seed, 0);
  const j1 = jitterFor(opts.seed, 1);
  const j2 = jitterFor(opts.seed, 2);
  const durations: readonly [number, number, number, number] = [
    base0 - j0,
    base1 - j1 + j0,
    base2 - j2 + j1,
    base3 + j2,
  ];

  const [d0, d1, d2, d3] = durations;
  const s0 = 0;
  const s1 = s0 + d0;
  const s2 = s1 + d1;
  const s3 = s2 + d2;
  return [
    { phase: "closed-glitch", startMs: s0, durationMs: d0 },
    { phase: "tremble", startMs: s1, durationMs: d1 },
    { phase: "crossfade", startMs: s2, durationMs: d2 },
    { phase: "rising-diff", startMs: s3, durationMs: d3 },
  ];
}
