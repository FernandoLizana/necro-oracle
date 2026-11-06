// @necro/ui-crt — the lazy loader for the per-CardId ASCII art table
// (visual-necromancy task 2.2 / 19.1, R11.4).
//
// This tiny module is the ONLY first-render reference to `render/ascii-art.ts`.
// Its `import("./ascii-art.js")` target is a string literal reached through a
// dynamic import and from nowhere statically, so the bundler emits the whole
// illustration table as its OWN chunk, fetched only when a reading needs it —
// never at page open. It mirrors the sound-engine seam (`sound/load-engine.ts`
// → `import("./engine.js")`) and the resurrection-view seam
// (`apps/web/.../load-resurrection-view.ts` → `import("./ResurrectionResult.js")`):
// each heavy module lives behind a literal-path dynamic import in a separate
// loader so it stays out of the terminal initial route and inside the gzipped
// Bundle_Budget (R11.1, R11.4).
//
// Keeping `loadCardArt` here rather than inside `ascii-art.ts` is what makes the
// split work: a static `import { loadCardArt } from "./ascii-art.js"` in the
// Terminal would pull the table into the eager graph and collapse the dynamic
// import back into the initial chunk. By owning the dynamic import in this
// loader — and importing ONLY this loader from the Terminal and the barrel —
// `ascii-art.ts` is reached exclusively through `import()` and splits out.
//
// Pure wrt the first render: importing this module pulls in no card art; the
// table is fetched lazily when `loadCardArt()` is awaited.
//
// _Requirements: 11.1, 11.4_

import { type CardId } from "@necro/oracle/client";

import { type CardArt } from "./ascii-card.js";

/**
 * The lazy-loaded art module shape returned by {@link loadCardArt}.
 */
export interface LoadedCardArt {
  /** The bespoke per-CardId illustration table. */
  readonly table: Readonly<Record<CardId, CardArt>>;
  /** The fallback illustration for ids without a bespoke motif. */
  readonly generic: CardArt;
  /**
   * Resolve the illustration for a CardId, returning its bespoke motif or the
   * generic fallback when none is registered.
   */
  artFor(cardId: CardId): CardArt;
}

/**
 * Dynamically import the illustration table so the whole table ships in its own
 * chunk, outside the first terminal render (R11.4). Callers `await` this once
 * (e.g. when the first reading arrives) and pass the returned `table` into
 * `asciiCard`. The dynamic `import("./ascii-art.js")` is the only reference to
 * that module in the first-render path, so the bundler splits the table into a
 * separate chunk; this loader must therefore live apart from the table it
 * loads.
 */
export async function loadCardArt(): Promise<LoadedCardArt> {
  const mod = await import("./ascii-art.js");
  return {
    table: mod.CARD_ART,
    generic: mod.GENERIC_ART,
    artFor: mod.artFor,
  };
}
