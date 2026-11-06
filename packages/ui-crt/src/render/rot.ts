// Rot_Transform for @necro/ui-crt (task 5.1).
//
// Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.12
//
// `rot` is the pure function that drives the "code rot" half of the
// Resurrection_Animation: given a source text, a decay amount in [0,1] and a
// seed, it returns a corrupted copy of the source in which a bounded,
// deterministic set of characters has been replaced by decay glyphs.
//
// The module is pure: no clock, network, DOM or unseeded randomness. The only
// source of randomness is the `seed` argument, fed through a small seeded PRNG
// (R6.7). Two calls with the same `(source, decay, seed)` return equal strings
// (R6.8).
//
// Invariants:
//   - `decay` is clamped to [0,1] before use (R6.12).
//   - `decay === 0` (after clamping) returns `source` unchanged (R6.4).
//   - Only existing non-newline positions are ever replaced; newlines are left
//     intact, so the line count and total string length are preserved for every
//     decay, including 1 (R6.5).
//   - The set of corrupted positions grows monotonically with `decay`: a lower
//     decay's corrupted positions are a subset of a higher decay's (R6.6). This
//     is achieved by fixing a single seeded permutation of the non-newline
//     positions (independent of `decay`) and corrupting the first `N` of them,
//     where `N` scales with `decay`.

/**
 * The decay glyphs cycled through when corrupting a position. All are single
 * code units (no surrogate pairs), so replacing one source code unit with one
 * glyph preserves the total string length exactly.
 */
const DECAY_GLYPHS = "▓▒░#%&@*/\\" as const;

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded entirely by `seed`; returns a
 * function yielding floats in [0,1). Used only for the position permutation and
 * glyph choice — never for any observable side effect.
 */
function mulberry32(seed: number): () => number {
  // Normalise the seed into an unsigned 32-bit integer so the stream is stable
  // across any finite input (including negatives and non-integers).
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp an arbitrary number into [0,1]; NaN clamps to 0 (the identity decay). */
function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Replace a bounded, deterministic set of non-newline characters of `source`
 * with decay glyphs, scaled by `decay`.
 *
 * Preserves the total string length and the line count for every `decay`
 * (including 1), corrupts only existing non-newline positions, and is
 * deterministic given `(source, decay, seed)`. The corrupted position set is
 * non-decreasing in `decay`.
 *
 * @param source The pre-ritual text to decay.
 * @param decay  The decay amount; clamped to [0,1] before use.
 * @param seed   The only source of randomness (seeded permutation + glyphs).
 */
export function rot(source: string, decay: number, seed: number): string {
  const amount = clamp01(decay);
  if (amount === 0) return source;

  // Collect the indexes of every non-newline UTF-16 code unit. We operate on
  // code units (not code points) so that replacing one unit with one glyph
  // keeps `source.length` exactly — a multi-unit character may be partially
  // overwritten, which is acceptable for a purely decorative decay frame and is
  // the only way to guarantee total-length preservation (R6.5). These are the
  // only positions eligible for corruption, which also keeps newlines (and
  // therefore the line count) intact.
  const units = source.split("");
  const positions: number[] = [];
  for (let i = 0; i < units.length; i++) {
    if (units[i] !== "\n") positions.push(i);
  }
  if (positions.length === 0) return source;

  const rng = mulberry32(seed);

  // Fisher–Yates shuffle of the eligible positions. The permutation depends on
  // `(source length, seed)` but NOT on `decay`, so the corrupted prefix for a
  // lower decay is always a subset of the prefix for a higher decay (R6.6).
  const order = positions.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }

  // Corrupt the first `count` positions of the fixed permutation. `count` scales
  // with `decay` and never exceeds the number of eligible positions, so the
  // corrupted-character count never exceeds the source length (R6.5).
  const count = Math.min(order.length, Math.round(amount * order.length));

  for (let k = 0; k < count; k++) {
    const pos = order[k] as number;
    // One more draw per corrupted position picks the glyph deterministically.
    const glyph = DECAY_GLYPHS[Math.floor(rng() * DECAY_GLYPHS.length)] as string;
    units[pos] = glyph;
  }

  return units.join("");
}
