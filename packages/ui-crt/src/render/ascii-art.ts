// @necro/ui-crt — per-CardId ASCII illustration table (task 2.2, pure).
//
// Validates: Requirements 3.11, 3.12, 11.4
//
// This module owns the bespoke phosphor illustrations the ASCII_Card_Renderer
// (`render/ascii-card.ts`, task 2.1) draws inside each card's inner block. The
// renderer stays free of these strings: it consumes the loaded table as an
// argument, so this file ships in its own lazy chunk that is fetched via
// `loadCardArt()` (in the sibling `render/load-card-art.ts`) outside the first
// terminal render (R11.4). The loader owns the dynamic `import("./ascii-art.js")`
// and is the only first-render reference to this module, so the bundler splits
// the whole table into its own chunk. Keeping the table out of the renderer's
// import graph — and the dynamic import in a separate loader — is what lets the
// terminal route stay inside its gzipped bundle budget.
//
// Each registered CardId maps to a bespoke `CardArt` motif (R3.11). Motifs are
// authored to the frame's inner block — `ART_ROWS` (6) rows of `INNER_COLS`
// (22) columns — so they sit cleanly inside the box; the renderer still
// pads/clips defensively, but every row here is exactly 22 columns. A bespoke
// `reversed` variant is provided wherever a distinct reversed reading aids
// recognisability — the cases where a bare CSS 180° flip would read as a
// confusing upside-down figure or (for a circle) as no change at all. Task 2.2
// covered the Tower, the Wheel, the Hanged Man, the Moon and the Star; task
// 21.4 (OPTIONAL polish, Requirement 13) extends this to Death, the Devil, the
// Hermit, Judgement, Temperance, Justice and the World, each reversed motif
// drawing the card's own reversed meaning (a stalled end, snapped chains, a
// lowered lantern, an unheeded call, a broken flow, a tipped scale, an unjoined
// wreath). Every reversed block is itself exactly 6 × 22 and differs from its
// upright (R3.12). Every CardId without a bespoke entry falls back to
// `GENERIC_ART`.
//
// ASCII / box-drawing only, no emoji; any text within a motif is uppercase.
// Pure module: no clock, network, DOM or unseeded randomness.

import { type CardId } from "@necro/oracle/client";

import { type CardArt } from "./ascii-card.js";

// Re-export the canonical `CardArt` type so this module's consumers can import
// the illustration shape from the art table itself. The one definition lives in
// `ascii-card.ts`; this is only an alias, never a second declaration.
export type { CardArt } from "./ascii-card.js";

/**
 * The fallback illustration for any CardId lacking a bespoke motif: a neutral
 * crescent-and-dot sigil centred in the inner block. Every row is exactly 22
 * columns so it drops straight into the frame.
 */
export const GENERIC_ART: CardArt = {
  upright: [
    "                      ",
    "        .---.         ",
    "       /  *  \\        ",
    "       \\     /        ",
    "        '---'         ",
    "                      ",
  ],
};

/**
 * The bespoke per-CardId illustration table. Keyed by every member of the
 * Deck_Card_Set (R3.11); the type is the total `Record<CardId, CardArt>` so a
 * newly registered CardId without art is a compile error rather than a silent
 * generic fallback. Each motif row is authored to exactly 22 columns to match
 * the 6-row inner block.
 */
export const CARD_ART: Readonly<Record<CardId, CardArt>> = {
  // THE TOWER — a lightning-struck tower, its crown blown off. Reversed: the
  // tower already toppled, rubble where the strike landed.
  tower: {
    upright: [
      "          /\\          ",
      "      ___/  \\___      ",
      "     |:::|  |:::|     ",
      "     |:::| *|:::|     ",
      "     |:::|  |:::|     ",
      "    _|:::|__|:::|_    ",
    ],
    reversed: [
      "     \\   *   /        ",
      "      \\  |  /         ",
      "    ___\\_|_/___       ",
      "   |:::::::::::|      ",
      "   '-._______.-'      ",
      "    .  RUBBLE  .      ",
    ],
  },

  // DEATH — a skull above a crossed scythe. Reversed: the scythe raised and
  // stayed, the skull sinking below — the end resisted, change stalled.
  death: {
    upright: [
      "        .-\"\"-.        ",
      "       / .--. \\       ",
      "       | |  | |       ",
      "       \\ '--' /       ",
      "        '-..-'        ",
      "       --\\--/--       ",
    ],
    reversed: [
      "       __\\--/__       ",
      "          ||          ",
      "        .-''-.        ",
      "       | x  x |       ",
      "       |  --  |       ",
      "        '-..-'        ",
    ],
  },

  // THE DEVIL — a horned mask over hanging chains. Reversed: the chains snapped
  // apart and the mask cast down — bondage broken, the captives freed.
  devil: {
    upright: [
      "     \\\\      //       ",
      "      \\\\    //        ",
      "      (o)  (o)        ",
      "       \\  vv  /       ",
      "        '----'        ",
      "      o~~~~~~~o       ",
    ],
    reversed: [
      "      o~~o  o~~o      ",
      "         .  .         ",
      "        '----'        ",
      "       /  ..  \\       ",
      "      (x)  (x)        ",
      "     //      \\\\       ",
    ],
  },

  // THE HERMIT — a cloaked figure holding a raised lantern. Reversed: the
  // lantern lowered and dark, the figure turned inward — withdrawal, the light
  // hidden rather than offered.
  hermit: {
    upright: [
      "        .==.          ",
      "       |____|         ",
      "        |  |          ",
      "       (    )         ",
      "       /    \\         ",
      "      /______\\        ",
    ],
    reversed: [
      "       (    )         ",
      "       /    \\         ",
      "      /______\\        ",
      "        .==.          ",
      "        |..|          ",
      "        '--'          ",
    ],
  },

  // WHEEL OF FORTUNE — a spoked wheel. Reversed: the wheel turning the other
  // way, the hub shifted.
  wheel: {
    upright: [
      "        .--.          ",
      "      .' \\|/ '.       ",
      "     ( --( )-- )      ",
      "      '. /|\\ .'       ",
      "        '--'          ",
      "         ||           ",
    ],
    reversed: [
      "         ||           ",
      "        .--.          ",
      "      .' /|\\ '.       ",
      "     ( --) (-- )      ",
      "      '. \\|/ .'       ",
      "        '--'          ",
    ],
  },

  // JUDGEMENT — a trumpet sounding above a rising figure. Reversed: the trumpet
  // lowered and silent, the figure sinking back into the grave — the call
  // unheeded, the rising refused.
  judgement: {
    upright: [
      "    =>o               ",
      "       \\___           ",
      "        .o.           ",
      "       /|_|\\          ",
      "        | |           ",
      "       _/ \\_          ",
    ],
    reversed: [
      "       _| |_          ",
      "        |.|           ",
      "        '.'           ",
      "       __.__          ",
      "      o<=   .         ",
      "       '----'         ",
    ],
  },

  // THE HANGED MAN — a figure suspended upside-down by one foot. Reversed: the
  // figure the right way up, no longer hanging.
  hanged_man: {
    upright: [
      "      ===T===         ",
      "         |            ",
      "        _|_           ",
      "       ( o )          ",
      "       /| |\\          ",
      "        /_\\           ",
    ],
    reversed: [
      "        _/_\\_         ",
      "        \\| |/         ",
      "        ( o )         ",
      "         -+-          ",
      "          |           ",
      "      ===+===         ",
    ],
  },

  // TEMPERANCE — two vessels pouring between each other. Reversed: the vessels
  // tipped apart, the stream broken and spilling — the balance lost, the
  // measured flow undone.
  temperance: {
    upright: [
      "      __      __      ",
      "     (  )    (  )     ",
      "      \\ \\~~~~/ /      ",
      "       \\ \\  / /       ",
      "        \\ ~~ /        ",
      "         '--'         ",
    ],
    reversed: [
      "     __        __     ",
      "    (  )      (  )    ",
      "     \\_/ .  . \\_/     ",
      "      .  .  .  .      ",
      "     .  . ..  .  .    ",
      "    ~~~~~~~~~~~~~     ",
    ],
  },

  // JUSTICE — a balance scale held level. Reversed: the beam tipped hard, one
  // pan dropped and the other flung high — the scales no longer balanced,
  // judgement gone crooked.
  justice: {
    upright: [
      "         /\\           ",
      "      ___||___        ",
      "     /   ||   \\       ",
      "    [_]  ||  [_]      ",
      "         ||           ",
      "        /__\\          ",
    ],
    reversed: [
      "         /\\           ",
      "        _||____       ",
      "      _/ ||    \\_     ",
      "    [_]  ||     \\     ",
      "         ||    [_]    ",
      "        /__\\          ",
    ],
  },

  // THE MOON — a pale moon above a path between two towers. Reversed: the moon
  // waning, the path fading downward.
  moon: {
    upright: [
      "        .-.           ",
      "       ( C )          ",
      "        '-'           ",
      "      |  :  |         ",
      "      |  :  |         ",
      "      |__:__|         ",
    ],
    reversed: [
      "      |~~:~~|         ",
      "      |  :  |         ",
      "      |  :  |         ",
      "        .-.           ",
      "       ( D )          ",
      "        '-'           ",
    ],
  },

  // THE STAR — a single eight-pointed star. Reversed: the star dimmed, its rays
  // falling.
  star: {
    upright: [
      "          |           ",
      "          |           ",
      "     \\    |    /      ",
      "   ---- ->*<- ----    ",
      "     /    |    \\      ",
      "          |           ",
    ],
    reversed: [
      "          .           ",
      "     \\    |    /      ",
      "       '. | .'        ",
      "   ---- -.*.- ----    ",
      "       .'   '.        ",
      "     /         \\      ",
    ],
  },

  // THE WORLD — a closed laurel circle (the completed cycle). Reversed: the
  // wreath broken open at the top, its ends unjoined — the cycle left
  // incomplete, closure withheld. (A plain 180 flip of a circle reads the same,
  // so a bespoke broken ring is what makes the reversal legible.)
  world: {
    upright: [
      "       .-\"\"-.         ",
      "     .'  **  '.       ",
      "    /  *    *  \\      ",
      "    \\  *    *  /      ",
      "     '.  **  .'       ",
      "       '-..-'         ",
    ],
    reversed: [
      "      .-'  '-.        ",
      "     '  *  *  '       ",
      "    .  *    *  .      ",
      "    '  *    *  '      ",
      "     .  *  *  .       ",
      "      '-.  .-'        ",
    ],
  },
};

/**
 * Resolve the illustration for a CardId against the bespoke table, falling back
 * to {@link GENERIC_ART} for any id without a bespoke motif. Pure and
 * synchronous. The dynamic chunk boundary is `loadCardArt` in the sibling
 * `render/load-card-art.ts`, which is the ONLY first-render reference to this
 * module, so the whole table splits into its own lazy chunk (R11.4).
 */
export function artFor(cardId: CardId): CardArt {
  return CARD_ART[cardId] ?? GENERIC_ART;
}
