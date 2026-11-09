// src/tarot/draw.ts
//
// The tarot draw (judge-ready-pass item 30).
//
// Draws a three-card Past / Present / Future destiny spread from the 22-card
// Major-Arcana deck (`deck.ts`):
//   - no replacement: the three drawn cards are always DISTINCT;
//   - each card is independently upright or reversed;
//   - the RNG is INJECTED (`RandomFn`), never read from the ambient environment,
//     so tests are fully deterministic and the normal path (crypto) and the
//     demo path (a seeded PRNG) both flow through the same pure code.
//
// No repository is required and none is read: a tarot draw is a destiny
// divination, independent of any diagnosis. Pure and browser-safe (imports only
// `zod`, the deck, and the typed error).

import { z } from "zod";

import { NecroError } from "../util/errors.js";
import {
  TAROT_DECK,
  TarotCardIdSchema,
  type TarotCard,
} from "./deck.js";

/**
 * An injected source of randomness: a function returning a float in `[0, 1)`,
 * exactly like `Math.random`. The caller supplies a crypto-backed generator for
 * the live draw and a seeded PRNG for the demo / tests. Values outside `[0, 1)`
 * are defensively clamped so a misbehaving source can never index out of range.
 */
export type RandomFn = () => number;

/** The three positions of the destiny spread, in reading order. */
export const TAROT_POSITIONS = ["past", "present", "future"] as const;
export type TarotPosition = (typeof TAROT_POSITIONS)[number];

/** Card orientation. Reversed cards render rotated 180 (tarot-ux). */
export const TarotOrientationSchema = z.enum(["upright", "reversed"]);
export type TarotOrientation = z.infer<typeof TarotOrientationSchema>;

/** One drawn card bound to a position and an orientation. */
export const TarotDrawCardSchema = z
  .object({
    position: z.enum(TAROT_POSITIONS),
    cardId: TarotCardIdSchema,
    orientation: TarotOrientationSchema,
  })
  .strict();
export type TarotDrawCard = z.infer<typeof TarotDrawCardSchema>;

/** A complete three-card tarot draw (Past, Present, Future). */
export const TarotDrawSchema = z
  .object({
    cards: z.array(TarotDrawCardSchema).length(TAROT_POSITIONS.length),
  })
  .strict();
export type TarotDraw = z.infer<typeof TarotDrawSchema>;

/** Clamp an RNG sample to `[0, 1)`; NaN maps to 0 (defensive, total). */
function clampUnit(x: number): number {
  if (Number.isNaN(x) || x <= 0) return 0;
  if (x >= 1) return 0.999_999_999_999;
  return x;
}

/**
 * Draw an integer in `[0, n)` from the injected RNG. `n` must be a positive
 * integer; the clamp guarantees the result is always a valid index.
 */
function randomIndex(rng: RandomFn, n: number): number {
  return Math.floor(clampUnit(rng()) * n);
}

/**
 * Draw a three-card Past / Present / Future tarot spread.
 *
 * Uses a partial Fisher-Yates shuffle over a COPY of the deck so the draw is
 * without replacement (three distinct cards) and every card in the deck is
 * reachable. Each drawn card is independently upright or reversed. The RNG is
 * injected and consumed deterministically, so a given RNG sequence always
 * yields the same draw.
 *
 * @param rng - a `() => number` source of floats in `[0, 1)` (crypto-backed for
 *   the live draw; a seeded PRNG for demo / tests).
 * @throws NecroError(VALIDATION_FAILED) only if the frozen deck is somehow too
 *   small to seat the spread (an impossible state the guard still names).
 */
export function drawTarot(rng: RandomFn): TarotDraw {
  if (TAROT_DECK.length < TAROT_POSITIONS.length) {
    throw new NecroError(
      "VALIDATION_FAILED",
      "The tarot deck is too small to lay a three-card spread.",
    );
  }

  // Fisher-Yates over a working copy: pick the first three distinct cards.
  const pool: TarotCard[] = [...TAROT_DECK];
  const chosen: TarotCard[] = [];
  for (let i = 0; i < TAROT_POSITIONS.length; i++) {
    const remaining = pool.length - i;
    const pick = i + randomIndex(rng, remaining);
    const tmp = pool[i] as TarotCard;
    pool[i] = pool[pick] as TarotCard;
    pool[pick] = tmp;
    chosen.push(pool[i] as TarotCard);
  }

  const cards: TarotDrawCard[] = chosen.map((card, i) => ({
    position: TAROT_POSITIONS[i] as TarotPosition,
    cardId: card.id,
    // A second independent RNG draw per card decides orientation.
    orientation: rng() < 0.5 ? "upright" : "reversed",
  }));

  // Validate the assembled draw at the boundary before handing it out.
  return TarotDrawSchema.parse({ cards });
}

/**
 * The live crypto-backed RNG: a `() => number` in `[0, 1)` drawn from
 * `crypto.getRandomValues` (53 bits of entropy), never `Math.random`. Used for
 * a real (non-demo) tarot draw. Available in Node 22 and browsers.
 */
export function cryptoRandomFn(): RandomFn {
  return () => {
    const buf = new Uint32Array(2);
    globalThis.crypto.getRandomValues(buf);
    // Combine two 32-bit words into a 53-bit mantissa for a uniform [0,1).
    const hi = buf[0] as number;
    const lo = buf[1] as number;
    return (hi * 2 ** 21 + (lo >>> 11)) / 2 ** 53;
  };
}

/**
 * A deterministic seeded PRNG (mulberry32) for the DEMO draw and for tests. The
 * demo must NOT patch `globalThis.crypto`; it passes this local generator to
 * `drawTarot` instead (item 33). Same seed -> same draw, every time.
 */
export function seededRandomFn(seed: number): RandomFn {
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}