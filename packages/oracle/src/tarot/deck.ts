// src/tarot/deck.ts
//
// The 22 Major Arcana tarot deck (judge-ready-pass item 30).
//
// This is a SEPARATE deck from the 12 diagnosis cards in `registry/cards.ts`:
// the diagnosis deck is drawn by deterministic detectors with evidence (the
// cards cannot lie); this tarot deck is a playful destiny divination drawn at
// random, with no repository evidence behind it. Nothing here is added to the
// diagnosis `CARD_REGISTRY`, and the two decks never share a registry.
//
// Pure and browser-safe: imports only `zod` and the typed error, so it is
// exported through the `@necro/oracle/client` subpath and consumed by the web
// terminal. No clock, DOM, network, RNG, or Node API. The RNG is injected into
// the draw (`draw.ts`), never read here.
//
// Each card carries its canonical Major-Arcana order (0..21), Roman numeral,
// display name, id (matching the committed `arcana/manifest.json` asset id and
// the `apps/web/public/arcana/<id>.webp` filename), and a short oracle-voice
// upright/reversed meaning (<= 16 words, mystical line only — the factual layer
// of a diagnosis has no analogue in a destiny draw).

import { z } from "zod";

import { NecroError } from "../util/errors.js";

/**
 * The 22 Major-Arcana tarot ids, in canonical deck order (The Fool = 0 through
 * The World = XXI). Each id matches a committed `arcana/<id>.webp` asset. This
 * is the authoritative membership + order of the tarot deck.
 */
export const TAROT_CARD_IDS = [
  "fool",
  "magician",
  "high_priestess",
  "empress",
  "emperor",
  "hierophant",
  "lovers",
  "chariot",
  "strength",
  "hermit",
  "wheel",
  "justice",
  "hanged_man",
  "death",
  "temperance",
  "devil",
  "tower",
  "star",
  "moon",
  "sun",
  "judgement",
  "world",
] as const;

/** One Major-Arcana tarot id. */
export const TarotCardIdSchema = z.enum(TAROT_CARD_IDS);
export type TarotCardId = z.infer<typeof TarotCardIdSchema>;

/** A tarot card's immutable definition (no evidence — this is a destiny draw). */
export const TarotCardSchema = z
  .object({
    /** Canonical Major-Arcana order, 0 (The Fool) .. 21 (The World). */
    order: z.number().int().min(0).max(21),
    /** Roman numeral as shown on the card face. */
    numeral: z.string().min(1),
    /** Display name, upper-cased by the UI (oracle-voice rule 8). */
    name: z.string().min(1),
    /** The asset id (matches `arcana/<id>.webp`). */
    id: TarotCardIdSchema,
    /** Oracle-voice mystical line, present tense, <= 16 words (rule 6). */
    upright: z.string().min(1),
    /** Oracle-voice mystical line, latent/conditional tense, <= 16 words. */
    reversed: z.string().min(1),
  })
  .strict();

export type TarotCard = z.infer<typeof TarotCardSchema>;

/** Count the words in an oracle-voice line (mystical lines are <= 16 words). */
function wordCount(line: string): number {
  const trimmed = line.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

// The 22 cards in canonical order. Every `upright`/`reversed` line is oracle
// voice: a short mystical pronouncement (<= 16 words), present tense upright and
// latent/conditional tense reversed (oracle-voice rules 2 and 6). These are the
// TRADITIONAL destiny meanings, not the code-diagnosis meanings of the
// same-named diagnosis cards.
const TAROT_DEFINITIONS: readonly TarotCard[] = [
  {
    order: 0,
    numeral: "0",
    name: "The Fool",
    id: "fool",
    upright: "A new path opens; step off the cliff and begin.",
    reversed: "The leap is held back; recklessness or hesitation waits unspent.",
  },
  {
    order: 1,
    numeral: "I",
    name: "The Magician",
    id: "magician",
    upright: "The tools are all here; will alone shapes the work.",
    reversed: "The power lies latent, unfocused, its craft not yet summoned.",
  },
  {
    order: 2,
    numeral: "II",
    name: "The High Priestess",
    id: "high_priestess",
    upright: "A secret sleeps behind the veil; listen, do not speak.",
    reversed: "Hidden knowledge stirs unread; intuition muffled beneath the surface.",
  },
  {
    order: 3,
    numeral: "III",
    name: "The Empress",
    id: "empress",
    upright: "Abundance grows; what was planted now bears its fruit.",
    reversed: "Growth lies dormant; creation stalls, the harvest not yet come.",
  },
  {
    order: 4,
    numeral: "IV",
    name: "The Emperor",
    id: "emperor",
    upright: "Order is imposed; structure holds the chaos at bay.",
    reversed: "The throne wavers; rigid rule or no rule waits unresolved.",
  },
  {
    order: 5,
    numeral: "V",
    name: "The Hierophant",
    id: "hierophant",
    upright: "Old doctrine guides the way; tradition speaks its law.",
    reversed: "The orthodoxy cracks; a new convention waits to be written.",
  },
  {
    order: 6,
    numeral: "VI",
    name: "The Lovers",
    id: "lovers",
    upright: "Two are bound as one; a choice of the heart binds all.",
    reversed: "The bond frays; a union or a choice hangs undecided.",
  },
  {
    order: 7,
    numeral: "VII",
    name: "The Chariot",
    id: "chariot",
    upright: "Will drives the chariot onward; victory through control.",
    reversed: "The reins slip; momentum scattered, the course not yet held.",
  },
  {
    order: 8,
    numeral: "VIII",
    name: "Strength",
    id: "strength",
    upright: "Gentle courage tames the beast; patience is the power.",
    reversed: "The inner beast stirs untamed; strength doubts itself in shadow.",
  },
  {
    order: 9,
    numeral: "IX",
    name: "The Hermit",
    id: "hermit",
    upright: "The lantern seeks truth alone; wisdom found in solitude.",
    reversed: "The light turns inward too far; isolation waits, counsel unheard.",
  },
  {
    order: 10,
    numeral: "X",
    name: "Wheel of Fortune",
    id: "wheel",
    upright: "The wheel turns; fortune rises and the cycle renews.",
    reversed: "The wheel grinds backward; luck stalled, the turning resisted.",
  },
  {
    order: 11,
    numeral: "XI",
    name: "Justice",
    id: "justice",
    upright: "The scales balance; cause and consequence are weighed true.",
    reversed: "The scales tip unseen; a reckoning waits, judgment deferred.",
  },
  {
    order: 12,
    numeral: "XII",
    name: "The Hanged Man",
    id: "hanged_man",
    upright: "Surrender grants new sight; wait, suspended, and see anew.",
    reversed: "The pause drags on; a sacrifice withheld, insight not yet come.",
  },
  {
    order: 13,
    numeral: "XIII",
    name: "Death",
    id: "death",
    upright: "An ending clears the ground; transformation walks the halls.",
    reversed: "Change is resisted; the old clings on, the rebirth stalled.",
  },
  {
    order: 14,
    numeral: "XIV",
    name: "Temperance",
    id: "temperance",
    upright: "Opposites are blended well; balance pours between two cups.",
    reversed: "The mixture sours; excess or imbalance waits, patience untried.",
  },
  {
    order: 15,
    numeral: "XV",
    name: "The Devil",
    id: "devil",
    upright: "Chains bind by choice; a bargain holds you fast.",
    reversed: "The chains loosen in shadow; a freedom waits to be claimed.",
  },
  {
    order: 16,
    numeral: "XVI",
    name: "The Tower",
    id: "tower",
    upright: "The tower falls; sudden ruin clears the false foundation.",
    reversed: "The collapse is delayed; disaster averted, the crack unmended.",
  },
  {
    order: 17,
    numeral: "XVII",
    name: "The Star",
    id: "star",
    upright: "A quiet star returns; hope and healing light the dark.",
    reversed: "The star dims behind cloud; faith waits, renewal withheld.",
  },
  {
    order: 18,
    numeral: "XVIII",
    name: "The Moon",
    id: "moon",
    upright: "Illusion clouds the path; trust the dream, fear the mist.",
    reversed: "The fog begins to lift; a confusion waits to resolve.",
  },
  {
    order: 19,
    numeral: "XIX",
    name: "The Sun",
    id: "sun",
    upright: "The sun blazes clear; joy and plain truth warm all.",
    reversed: "The light is veiled a while; a gladness waits its dawn.",
  },
  {
    order: 20,
    numeral: "XX",
    name: "Judgement",
    id: "judgement",
    upright: "The trumpet calls; what was buried rises to be weighed.",
    reversed: "The call goes half-heard; a reckoning waits, awakening deferred.",
  },
  {
    order: 21,
    numeral: "XXI",
    name: "The World",
    id: "world",
    upright: "The circle closes whole; the journey completes, fulfilled.",
    reversed: "The circle stays unclosed; completion waits one step away.",
  },
];

/**
 * Build and freeze the tarot deck. Validates every card against
 * `TarotCardSchema`, enforces the <= 16-word oracle-voice ceiling on both
 * meanings, and rejects duplicate ids / orders / numerals, exactly 22 cards in
 * strictly ascending canonical order. Throws `NecroError(REGISTRY_INVALID)` at
 * module load so a malformed deck fails loudly before any draw.
 */
function buildDeck(defs: readonly TarotCard[]): readonly TarotCard[] {
  if (defs.length !== TAROT_CARD_IDS.length) {
    throw new NecroError(
      "REGISTRY_INVALID",
      `The tarot deck is malformed: expected ${TAROT_CARD_IDS.length} cards, found ${defs.length}.`,
    );
  }
  const seenId = new Set<string>();
  const seenOrder = new Set<number>();
  const seenNumeral = new Set<string>();

  defs.forEach((raw, i) => {
    const parsed = TarotCardSchema.safeParse(raw);
    if (!parsed.success) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The tarot deck is malformed: card "${raw.id}" failed validation (${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}).`,
        parsed.error,
      );
    }
    const card = parsed.data;
    if (card.order !== i) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The tarot deck is malformed: card "${card.id}" has order ${card.order} at deck index ${i} (must be in ascending canonical order).`,
      );
    }
    if (card.id !== TAROT_CARD_IDS[i]) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The tarot deck is malformed: card at index ${i} is "${card.id}", expected "${TAROT_CARD_IDS[i]}".`,
      );
    }
    for (const [line, label] of [
      [card.upright, "upright"],
      [card.reversed, "reversed"],
    ] as const) {
      if (wordCount(line) > 16) {
        throw new NecroError(
          "REGISTRY_INVALID",
          `The tarot deck is malformed: "${card.id}" ${label} meaning exceeds 16 words (oracle-voice rule 2).`,
        );
      }
    }
    if (seenId.has(card.id)) {
      throw new NecroError("REGISTRY_INVALID", `Duplicate tarot id "${card.id}".`);
    }
    if (seenOrder.has(card.order)) {
      throw new NecroError("REGISTRY_INVALID", `Duplicate tarot order "${card.order}".`);
    }
    if (seenNumeral.has(card.numeral)) {
      throw new NecroError("REGISTRY_INVALID", `Duplicate tarot numeral "${card.numeral}".`);
    }
    seenId.add(card.id);
    seenOrder.add(card.order);
    seenNumeral.add(card.numeral);
  });

  return Object.freeze([...defs]);
}

/** The validated, frozen 22-card Major-Arcana tarot deck, in canonical order. */
export const TAROT_DECK: readonly TarotCard[] = buildDeck(TAROT_DEFINITIONS);

/** Map of id -> card for O(1) lookup. */
const TAROT_BY_ID: ReadonlyMap<TarotCardId, TarotCard> = new Map(
  TAROT_DECK.map((card) => [card.id, card]),
);

/**
 * Look up a tarot card by id.
 *
 * @throws NecroError(CARD_NOT_FOUND) when the id is not a Major-Arcana id.
 */
export function getTarotCard(id: TarotCardId): TarotCard {
  const card = TAROT_BY_ID.get(id);
  if (card === undefined) {
    throw new NecroError("CARD_NOT_FOUND", `The tarot deck holds no card named "${id}".`);
  }
  return card;
}