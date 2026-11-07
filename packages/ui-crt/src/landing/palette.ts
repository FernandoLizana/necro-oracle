// src/landing/palette.ts
//
// Feature: oracle-landing-polish, task 7.1.
//
// The strict 4-shade DMG / Arcana_Visions Asset_Palette, exported as a `const`
// tuple so the palette-purity property test (`landing-palette.pbt.test.ts`,
// task 8.4) can import the single source of truth and assert that no rendered
// DMG surface ever uses a colour outside this set (R10.1, design §"Palette
// model").
//
// This is DISTINCT from the surrounding Spec 03 phosphor chrome tokens in
// `tokens.ts` (`--crt-fg` #33ff66 etc.). The DMG landing surfaces are authored
// in THIS asset palette and nothing here alters the phosphor chrome. Both
// palettes share `#001a00` (the darkest shade / CRT background), so the DMG
// panels sit seamlessly on the terminal background.
//
// `landing/landing.css` binds `--dmg-0..3` to exactly these four values (in the
// same darkest -> brightest order) and uses only them (or `transparent`) for
// every `color` / `background-color` / `border-color` on a DMG surface. The
// inverted selected-row style uses `--dmg-3` text on `--dmg-1` background, a
// pair whose sRGB contrast ratio is >= 4.5:1 (R10.2).

/**
 * The strict 4-shade DMG / Asset_Palette, darkest -> brightest, mirrored
 * byte-for-byte by the `--dmg-0..3` custom properties in `landing.css`:
 *   - `--dmg-0` = `#001a00` (darkest; shared with the CRT background)
 *   - `--dmg-1` = `#0b4f1a`
 *   - `--dmg-2` = `#2fa84a`
 *   - `--dmg-3` = `#8cff9e` (brightest)
 */
export const DMG_PALETTE = ["#001a00", "#0b4f1a", "#2fa84a", "#8cff9e"] as const;

/** One of the four strict DMG palette shades. */
export type DmgShade = (typeof DMG_PALETTE)[number];
