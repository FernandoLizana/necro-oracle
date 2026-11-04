// @necro/ui-crt — the Voice_Table: one mystical line per card and orientation.
//
// The terminal prints a two-layer reading for every drawn card: the uppercase
// CARD_REGISTRY name as a heading, this mystical line beneath it, and the
// detector's own technical fact (carried on the draw, not here). This table
// supplies only the mystical halves — the short, present/latent lines sourced
// verbatim from the `oracle-voice` steering "Card voice lines".
//
// Totality is enforced at the type level: VOICE_TABLE is a
// `Readonly<Record<CardId, ...>>`, so omitting a card — or adding one to
// `CardIdSchema` without a line here — fails the build (P6, task 7.1).
//
// Oracle_Voice rules observed: mystical lines are ≤ 16 words and ≤ 72 columns,
// upright reads in present/active tense, reversed in a latent/conditional
// tense, upright and reversed are never the same text, and there are no emoji.
//
// _Requirements: R7.3, R7.4_

import type { CardId } from "@necro/oracle/client";

/** A card's orientation: active (upright) or latent/partial (reversed). */
export type Orientation = "upright" | "reversed";

/**
 * One non-empty mystical line per card and orientation. The lines are the
 * canonical "Card voice lines" from the `oracle-voice` steering; the uppercase
 * card name shown above them comes from `CARD_REGISTRY`, not from this table.
 *
 * The `Readonly<Record<CardId, ...>>` type makes the table total over the deck:
 * every `CardId` must appear, so the structure cannot drift from the registry.
 */
export const VOICE_TABLE: Readonly<
  Record<CardId, Readonly<Record<Orientation, string>>>
> = {
  judgement: {
    upright: "A dead runtime hears the trumpet.",
    reversed: "Half-risen, it straddles two worlds.",
  },
  tower: {
    upright: "The foundations crack and burn.",
    reversed: "The stones drift, not yet fallen.",
  },
  devil: {
    upright: "Chains of sin bind this code.",
    reversed: "Temptation sleeps in the shadows.",
  },
  death: {
    upright: "Corpses lie unburied in these halls.",
    reversed: "Zombies whisper in the comments.",
  },
  wheel: {
    upright: "No tests. Fate alone decides.",
    reversed: "The tests exist, but the wheel is rusted.",
  },
  hermit: {
    upright: "The lantern is dark; no one wrote the way.",
    reversed: "The map is old and lies.",
  },
  hanged_man: {
    upright: "Suspended, abandoned, waiting.",
    reversed: "It sways, slowly, still breathing.",
  },
  temperance: {
    upright: "No vessel tempers this code.",
    reversed: "The old vessel cracked long ago.",
  },
  justice: {
    upright: "No law governs this code.",
    reversed: "The law is written in two tongues.",
  },
  moon: {
    upright: "A labyrinth under a pale moon.",
    reversed: "Fog lies thick on the path.",
  },
  star: {
    upright: "Yet a star still shines.",
    reversed: "A faint star, but a star.",
  },
  world: {
    upright: "The circle closes. It lives.",
    reversed: "The circle wavers, unfinished.",
  },
};
