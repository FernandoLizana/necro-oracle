// Shared fast-check arbitraries for @necro/ui-crt property tests.
//
// This module is intentionally additive and merge-friendly: each property task
// appends the arbitraries it needs as named exports. Do NOT redefine exports
// owned by another task (for example the `Command` arbitrary from task 5.1).
//
// The arbitraries below support the text sanitiser and 72-column wrapper
// properties (P4, P5 — tasks 6.1/6.2): they generate strings peppered with
// ANSI escape sequences, C0/C1 control characters, Unicode bidirectional
// control characters, and over-long whitespace-free tokens, so that the
// properties exercise the full input space the real Terminal must defend
// against.

import fc from "fast-check";

// --- Character-class constants (mirrors of the sanitiser's removal sets) -----

/** ESC (U+001B), the byte that introduces every ANSI escape sequence. */
export const ESC = "\u001B";
/** BEL (U+0007), one of the two OSC terminators. */
export const BEL = "\u0007";
/** ST (ESC \), the two-character String Terminator form that ends an OSC. */
export const ST = "\u001B\\";

/**
 * Unicode bidirectional override, embedding and isolate controls plus the
 * directional marks. `sanitizeText` must strip every one of these:
 *   U+202A–U+202E  LRE RLE PDF LRO RLO (embeddings + overrides)
 *   U+2066–U+2069  LRI RLI FSI PDI     (isolates)
 *   U+200E U+200F  LRM RLM             (marks)
 *   U+061C         ALM                 (Arabic letter mark)
 */
export const BIDI_CONTROL_CHARS: readonly string[] = [
  "\u202A",
  "\u202B",
  "\u202C",
  "\u202D",
  "\u202E",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
  "\u200E",
  "\u200F",
  "\u061C",
];

// --- ANSI escape-sequence arbitraries ---------------------------------------

/**
 * A CSI sequence: `ESC [` followed by zero or more parameter/intermediate
 * bytes (0x20–0x3F) and a single final byte (0x40–0x7E). Covers colour codes
 * like `ESC[31m`, cursor moves like `ESC[2J`, and so on.
 */
export const arbAnsiCsi: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringOf(
      fc.integer({ min: 0x20, max: 0x3f }).map((c) => String.fromCodePoint(c)),
      { maxLength: 6 },
    ),
    fc.integer({ min: 0x40, max: 0x7e }).map((c) => String.fromCodePoint(c)),
  )
  .map(([params, final]) => `${ESC}[${params}${final}`);

/**
 * An OSC sequence: `ESC ]` followed by an arbitrary payload and terminated by
 * either BEL or ST (`ESC \`). Used for window titles and hyperlinks.
 */
export const arbAnsiOsc: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ maxLength: 10 }).map((s) => s.replace(/[\u0007\u001B]/g, "")),
    fc.constantFrom(BEL, ST),
  )
  .map(([payload, terminator]) => `${ESC}]${payload}${terminator}`);

/**
 * A two-character `ESC x` sequence, where `x` is a single byte in 0x40–0x5F
 * (for example `ESC c` reset, `ESC D` index).
 */
export const arbAnsiTwoChar: fc.Arbitrary<string> = fc
  .integer({ min: 0x40, max: 0x5f })
  .map((c) => `${ESC}${String.fromCodePoint(c)}`);

/** Any one of the three ANSI escape forms. */
export const arbAnsiSequence: fc.Arbitrary<string> = fc.oneof(
  arbAnsiCsi,
  arbAnsiOsc,
  arbAnsiTwoChar,
);

// --- Control-character arbitraries ------------------------------------------

/**
 * A C0 control character other than line feed (`\n`). Includes DEL (0x7F),
 * which the sanitiser also removes. Covers 0x00–0x09, 0x0B–0x1F, and 0x7F.
 */
export const arbC0Control: fc.Arbitrary<string> = fc
  .oneof(
    fc.integer({ min: 0x00, max: 0x09 }),
    fc.integer({ min: 0x0b, max: 0x1f }),
    fc.constant(0x7f),
  )
  .map((c) => String.fromCodePoint(c));

/** A C1 control character (U+0080–U+009F). */
export const arbC1Control: fc.Arbitrary<string> = fc
  .integer({ min: 0x80, max: 0x9f })
  .map((c) => String.fromCodePoint(c));

/** Any control character the sanitiser removes (C0 except `\n`, DEL, or C1). */
export const arbControlChar: fc.Arbitrary<string> = fc.oneof(
  arbC0Control,
  arbC1Control,
);

/** A single Unicode bidirectional control character. */
export const arbBidiControl: fc.Arbitrary<string> = fc.constantFrom(
  ...BIDI_CONTROL_CHARS,
);

// --- Composite string arbitraries -------------------------------------------

/**
 * Ordinary printable text with a sprinkling of line feeds (the one control the
 * sanitiser keeps and the delimiter the wrapper splits on). Uses the full
 * Unicode range so surrogate pairs appear.
 */
export const arbPlainText: fc.Arbitrary<string> = fc.stringOf(
  fc.oneof(
    { weight: 10, arbitrary: fc.fullUnicode() },
    { weight: 1, arbitrary: fc.constant("\n") },
    { weight: 2, arbitrary: fc.constant(" ") },
  ),
  { maxLength: 80 },
);

/**
 * A "hostile" string: plain text interleaved with ANSI escapes, C0/C1 control
 * characters and bidi controls in any order. This is the primary generator for
 * the sanitiser property (P5).
 */
export const arbHostileText: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.fullUnicode().map((c) => c) },
      { weight: 2, arbitrary: fc.constant("\n") },
      { weight: 1, arbitrary: arbAnsiSequence },
      { weight: 1, arbitrary: arbControlChar },
      { weight: 1, arbitrary: arbBidiControl },
    ),
    { maxLength: 60 },
  )
  .map((parts) => parts.join(""));

/**
 * A single whitespace-free token, which may be far longer than the 72-column
 * wrap width so that the over-long-token cut path is exercised. Built from
 * `fc.fullUnicode()` so surrogate pairs land on and across the cut boundary.
 */
export const arbLongToken: fc.Arbitrary<string> = fc
  .array(fc.fullUnicode().filter((c) => !/\s/u.test(c)), {
    minLength: 1,
    maxLength: 200,
  })
  .map((chars) => chars.join(""));

/**
 * Text for the wrapper property (P4): a mix of ordinary words, runs of spaces,
 * line feeds, and occasional over-long tokens, so every wrapping branch (pack,
 * break-at-whitespace, cut-within-token, split-on-newline) is reachable.
 */
export const arbWrappableText: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      {
        weight: 6,
        arbitrary: fc
          .array(fc.fullUnicode().filter((c) => !/\s/u.test(c)), {
            minLength: 1,
            maxLength: 12,
          })
          .map((chars) => chars.join("")),
      },
      { weight: 1, arbitrary: arbLongToken },
      { weight: 3, arbitrary: fc.stringOf(fc.constant(" "), { minLength: 1, maxLength: 4 }) },
      { weight: 2, arbitrary: fc.constant("\n") },
      { weight: 1, arbitrary: fc.constant("\t") },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""));

// --- Helpers used by the text properties ------------------------------------

/** Count Unicode code points (not UTF-16 units) in a string. */
export function codePointLength(s: string): number {
  return [...s].length;
}

/** Strip every whitespace character, leaving only non-whitespace in order. */
export function stripWhitespace(s: string): string {
  return [...s].filter((c) => !/\s/u.test(c)).join("");
}

// ============================================================================
// Command arbitrary (task 5.1 — P1 command round-trip)
// ============================================================================
//
// `arbCommand` generates valid, non-`unknown` parsed Commands. The `unknown`
// variant is deliberately excluded: it carries an arbitrary raw string and has
// no `printCommand` form (`printCommand` accepts only
// `Exclude<Command, { kind: "unknown" }>`), so it is out of scope for the
// round-trip property P1.
//
// Imports from `@necro/oracle/client` (the Client_Safe_Entry) and the local
// `command/types.ts` only — no parser, no Node modules — keeping the arbitrary
// browser-safe like the code it exercises.

import { CardIdSchema, type CardId } from "@necro/oracle/client";
import type { Command, SpreadArg } from "../command/types.js";

// `motion`/`sound` argument literals. Declared locally (rather than imported
// from the not-yet-built motion module) so this arbitrary depends only on
// `command/types.ts`, the module the round-trip property exercises.
type CommandMotionArg = "auto" | "on" | "off";
type CommandSoundArg = "on" | "off";

/** Every `CardId` literal, for the `explain <card>` form. */
const COMMAND_CARD_IDS: readonly CardId[] = CardIdSchema.options;

/** The three spread names `read` accepts. */
const COMMAND_SPREAD_ARGS: readonly SpreadArg[] = ["fates", "necropsy", "celtic"];

/** The three motion preferences. */
const COMMAND_MOTION_ARGS: readonly CommandMotionArg[] = ["auto", "on", "off"];

/** The two sound preferences. */
const COMMAND_SOUND_ARGS: readonly CommandSoundArg[] = ["on", "off"];

/**
 * A repo reference token the parser recognises as a bare-token summon
 * (`looksLikeRepoRef`): `owner/repo` over `[A-Za-z0-9_.-]` with an optional
 * `#ref` or `@sha`. Kept valid and stable so the round-trip holds: `summon`
 * carries the raw second token unchanged, and `printCommand` re-emits it as-is.
 */
const arbCommandRepoToken: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
    fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
    fc.option(
      fc.oneof(
        fc.stringMatching(/^#[A-Za-z0-9_.-]{1,20}$/),
        fc.stringMatching(/^@[A-Za-z0-9]{1,40}$/),
      ),
      { nil: "" },
    ),
  )
  .map(([owner, repo, suffix]) => `${owner}/${repo}${suffix}`);

/** A Demo_Name: lowercase token `^[a-z0-9-]{1,32}$`. */
const arbCommandDemoName: fc.Arbitrary<string> = fc.stringMatching(
  /^[a-z0-9-]{1,32}$/,
);

/**
 * Generates a valid, non-`unknown` {@link Command}. Covers every variant and
 * both argument-present and argument-absent forms for `motion`, `demo` and
 * `sound`, and both target shapes for `explain`.
 */
export const arbCommand: fc.Arbitrary<Exclude<Command, { kind: "unknown" }>> =
  fc.oneof(
    fc.constant<Command>({ kind: "help" }),
    fc.constant<Command>({ kind: "clear" }),
    arbCommandRepoToken.map<Command>((repo) => ({ kind: "summon", repo })),
    fc
      .constantFrom(...COMMAND_SPREAD_ARGS)
      .map<Command>((spread) => ({ kind: "read", spread })),
    // explain → position target (integer >= 1)
    fc.integer({ min: 1, max: 10_000 }).map<Command>((position) => ({
      kind: "explain",
      target: { kind: "position", position },
    })),
    // explain → card target (a CardId)
    fc.constantFrom(...COMMAND_CARD_IDS).map<Command>((card) => ({
      kind: "explain",
      target: { kind: "card", card },
    })),
    // motion with and without an argument
    fc
      .option(fc.constantFrom(...COMMAND_MOTION_ARGS), { nil: undefined })
      .map<Command>((arg) =>
        arg === undefined ? { kind: "motion" } : { kind: "motion", arg },
      ),
    // demo with and without a name
    fc
      .option(arbCommandDemoName, { nil: undefined })
      .map<Command>((name) =>
        name === undefined ? { kind: "demo" } : { kind: "demo", name },
      ),
    // sound with and without an argument
    fc
      .option(fc.constantFrom(...COMMAND_SOUND_ARGS), { nil: undefined })
      .map<Command>((arg) =>
        arg === undefined ? { kind: "sound" } : { kind: "sound", arg },
      ),
  ) as fc.Arbitrary<Exclude<Command, { kind: "unknown" }>>;
