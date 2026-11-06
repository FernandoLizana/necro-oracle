// @necro/coven — property test for the changed-card set (task 9.5).
//
// Property 7: Changed-card set is the exact draw difference.
//   The reported changed cards are exactly those whose draw differs between the
//   two readings in presence (added / removed), severity, or orientation; no
//   card whose draw is byte-identical in both readings appears, and no card
//   that differs is omitted (R6.4).
//
// `changedCards(before, after)` is a PURE function of two `CardDraw[]` sets, so
// this property drives it directly with generated draw-set pairs rather than
// through the full `rediagnose` pipeline. Driving through `rediagnose` would
// re-divine an overlaid snapshot via `runReading`, which fixes the `after`
// draws as a function of the `before` ones — the property could then neither
// control nor independently know the expected difference. Testing the exported
// pure function is both simpler and a faithful test of the spec'd behaviour.
//
// The expected changed-card set is derived here INDEPENDENTLY from the
// specification (a re-implementation of the symmetric-difference rule over
// (presence, severity, orientation) plus the vitality-contribution `improved`
// flag), never by calling the module under test — so a regression in
// `changedCards` is caught rather than mirrored.
//
// No network / LLM / sandbox: `changedCards` and `CARD_REGISTRY` are pure
// oracle/coven values. fast-check runs 200 times; the failing seed is printed
// by default on failure.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CARD_REGISTRY,
  type CardDraw,
  type CardId,
  type Severity,
} from "@necro/oracle";
import { changedCards, type ChangedCard } from "./index.js";

// ---------------------------------------------------------------------------
// Generators — a draw-set pair over the 12 card ids.
//
// A draw-set is modelled as "for each card id, is it present, and if so with
// what severity/orientation?". Generating presence/severity/orientation per
// card (rather than a free array) guarantees at most one draw per card — the
// same no-duplicate invariant a real reading holds — and lets `before`/`after`
// differ in presence, severity, and orientation independently so every branch
// of the difference rule is exercised.
// ---------------------------------------------------------------------------

const CARD_IDS: readonly CardId[] = [
  "judgement",
  "tower",
  "devil",
  "death",
  "wheel",
  "hermit",
  "hanged_man",
  "temperance",
  "justice",
  "moon",
  "star",
  "world",
] as const;

/** Severity 1..3 (a drawn card; 0 means not-drawn and is modelled as absence). */
const arbSeverity: fc.Arbitrary<Severity> = fc.constantFrom<Severity>(1, 2, 3);

const arbOrientation: fc.Arbitrary<CardDraw["orientation"]> =
  fc.constantFrom("upright", "reversed");

/** A single card's state in one reading: absent, or a drawn CardDraw. */
type CardState = CardDraw | null;

/** A card's state: ~1/4 absent, otherwise a drawn card with evidence noise. */
function arbCardState(card: CardId): fc.Arbitrary<CardState> {
  return fc.option(
    fc.record({ severity: arbSeverity, orientation: arbOrientation }).map(
      ({ severity, orientation }): CardDraw => ({
        card,
        severity,
        orientation,
        // Evidence/summary/grimoires are irrelevant to the difference rule
        // (it keys only on card, severity, orientation) — keep them trivial.
        evidence: [],
        summary: "",
        grimoires: [],
      }),
    ),
    { nil: null, freq: 3 }, // present ~3x as often as absent
  );
}

/** A full draw-set: a per-card state map collapsed to the present draws. */
const arbDrawSet: fc.Arbitrary<readonly CardDraw[]> = fc
  .tuple(...CARD_IDS.map((card) => arbCardState(card)))
  .map((states) => states.filter((s): s is CardDraw => s !== null));

// ---------------------------------------------------------------------------
// Independent expected-set derivation (the specification, re-implemented).
// ---------------------------------------------------------------------------

/** A draw's vitality contribution: `weight × severity` (0 if no registry entry). */
function contribution(draw: CardDraw): number {
  const def = CARD_REGISTRY.get(draw.card as CardId);
  return (def === undefined ? 0 : def.weight) * draw.severity;
}

/**
 * The expected changed-card set, derived straight from the spec:
 *  - a card present in exactly one reading is `added` / `removed`;
 *  - a card in both whose severity differs is `severity` (severity wins when
 *    both severity and orientation differ);
 *  - a card in both whose orientation differs (severity equal) is `orientation`;
 *  - a card identical in presence, severity, AND orientation is NOT reported;
 *  - `improved` is true when the card's vitality contribution drops (a removed
 *    card drops to 0; an added card improves only if its contribution is < 0).
 * The result is ordered by card id so it matches the module's stable ordering.
 */
function expectedChangedCards(
  before: readonly CardDraw[],
  after: readonly CardDraw[],
): ChangedCard[] {
  const b = new Map(before.map((d) => [d.card, d]));
  const a = new Map(after.map((d) => [d.card, d]));
  const cards = [...new Set([...b.keys(), ...a.keys()])].sort();

  const out: ChangedCard[] = [];
  for (const card of cards) {
    const before1 = b.get(card);
    const after1 = a.get(card);
    if (before1 !== undefined && after1 === undefined) {
      out.push({ card, change: "removed", improved: contribution(before1) > 0 });
    } else if (before1 === undefined && after1 !== undefined) {
      out.push({ card, change: "added", improved: contribution(after1) < 0 });
    } else if (before1 !== undefined && after1 !== undefined) {
      if (before1.severity !== after1.severity) {
        out.push({
          card,
          change: "severity",
          improved: contribution(after1) < contribution(before1),
        });
      } else if (before1.orientation !== after1.orientation) {
        out.push({
          card,
          change: "orientation",
          improved: contribution(after1) < contribution(before1),
        });
      }
      // else: identical presence + severity + orientation → not a changed card.
    }
  }
  return out;
}

/** Whether two draws differ in presence/severity/orientation (the spec key). */
function drawsDiffer(b: CardDraw | undefined, a: CardDraw | undefined): boolean {
  if ((b === undefined) !== (a === undefined)) return true; // presence differs
  if (b === undefined || a === undefined) return false; // both absent
  return b.severity !== a.severity || b.orientation !== a.orientation;
}

describe("P7 (R6.4): changed-card set is the exact draw difference", () => {
  it("reports exactly the cards whose draw differs, and no unchanged card", () => {
    fc.assert(
      fc.property(arbDrawSet, arbDrawSet, (before, after) => {
        const actual = changedCards(before, after);

        // The full expected set — card, change kind, and improved flag.
        expect(actual).toEqual(expectedChangedCards(before, after));

        const b = new Map(before.map((d) => [d.card, d]));
        const a = new Map(after.map((d) => [d.card, d]));
        const reported = new Set(actual.map((c) => c.card));

        // No card reported twice (the set is keyed once per card id).
        expect(reported.size).toBe(actual.length);

        // Every card that appears in either reading is correctly classified:
        // reported iff its draw differs; unchanged cards never appear.
        for (const card of new Set([...b.keys(), ...a.keys()])) {
          expect(reported.has(card)).toBe(drawsDiffer(b.get(card), a.get(card)));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("reports nothing when the two draw sets are identical", () => {
    // A metamorphic edge: diffing a set against itself yields no changed card,
    // regardless of the set's content.
    fc.assert(
      fc.property(arbDrawSet, (draws) => {
        expect(changedCards(draws, draws)).toEqual([]);
        // Diffing against a shuffled copy (same draws, different order) is also
        // empty — the rule keys on card id, not array position.
        const shuffled = [...draws].reverse();
        expect(changedCards(draws, shuffled)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("every reported change is one of the four kinds and matches its card's actual difference", () => {
    fc.assert(
      fc.property(arbDrawSet, arbDrawSet, (before, after) => {
        const b = new Map(before.map((d) => [d.card, d]));
        const a = new Map(after.map((d) => [d.card, d]));
        for (const c of changedCards(before, after)) {
          const bd = b.get(c.card as CardId);
          const ad = a.get(c.card as CardId);
          if (bd !== undefined && ad === undefined) {
            expect(c.change).toBe("removed");
          } else if (bd === undefined && ad !== undefined) {
            expect(c.change).toBe("added");
          } else if (bd !== undefined && ad !== undefined) {
            if (bd.severity !== ad.severity) expect(c.change).toBe("severity");
            else expect(c.change).toBe("orientation");
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
