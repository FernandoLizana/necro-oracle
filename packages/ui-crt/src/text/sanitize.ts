// Text sanitiser for @necro/ui-crt (task 6.2, Property 5).
//
// Validates: Requirements R14.2, R14.3
//
// `sanitizeText` defends the CRT terminal against hostile repository-derived
// strings: ANSI escape sequences, C0/C1 control characters, and Unicode
// bidirectional controls. Line feeds (`\n`) are the one control deliberately
// kept — the wrapper splits on them. Removal happens in a fixed order; because
// the final character-class filter removes every `ESC`, no ANSI sequence can
// survive or re-form, so the function is idempotent.

/**
 * CSI sequence: `ESC [` then zero or more parameter/intermediate bytes
 * (0x20–0x3F) and a single final byte (0x40–0x7E).
 */
const ANSI_CSI = /\u001B\[[\x20-\x3F]*[\x40-\x7E]/gu;

/**
 * OSC sequence: `ESC ]` then an arbitrary payload terminated by BEL (0x07) or
 * ST (`ESC \`). The payload is non-greedy so the first terminator ends it.
 */
const ANSI_OSC = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu;

/** Two-character `ESC x` form, where `x` is any single byte. */
const ANSI_TWO_CHAR = /\u001B[\s\S]/gu;

/**
 * Every remaining C0 control except line feed (`\n`, 0x0A), plus DEL (0x7F)
 * and the C1 range (U+0080–U+009F). This filter removes every surviving `ESC`.
 */
const CONTROLS = /[\x00-\x09\x0B-\x1F\x7F\u0080-\u009F]/gu;

/**
 * Bidirectional overrides, embeddings and isolates (U+202A–U+202E,
 * U+2066–U+2069) plus the marks U+200E, U+200F and U+061C.
 */
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/gu;

/**
 * Remove ANSI escape sequences, forbidden control characters, and Unicode
 * bidirectional controls from `input`, in that order. Keeps line feeds.
 *
 * Idempotent: because {@link CONTROLS} strips every `ESC`, sanitizing an
 * already-sanitised string returns it unchanged.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(ANSI_CSI, "")
    .replace(ANSI_OSC, "")
    .replace(ANSI_TWO_CHAR, "")
    .replace(CONTROLS, "")
    .replace(BIDI, "");
}
