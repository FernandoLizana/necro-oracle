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
export const arbCommandRepoToken: fc.Arbitrary<string> = fc
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

// ============================================================================
// Reading / SpreadPosition / Evidence builders (task 9.1 — renderers P7, P8, P12)
// ============================================================================
//
// These arbitraries build the real `@necro/oracle/client` shapes the reading,
// explain, summary and error renderers consume: `Evidence`, `CardDraw`,
// `SpreadPosition`, `RepoRef`, `Reading`, and the `ui-crt` `SummonSummary` /
// `ReadingResponse` wrappers. They use the REAL field names from the oracle
// schemas (CardDraw: `card`, `orientation`, `severity`, `summary`, `evidence`,
// `grimoires`; SpreadPosition: `position`, `label`, `draw`, `description`) and
// are validated against their schemas so a drift in the oracle shape is caught
// here rather than deep inside a renderer test.
//
// A void SpreadPosition carries `draw: null` and a `description` sentinel; a
// drawn position carries a `CardDraw` and no description. Positions are
// renumbered 1..n in order so a built Reading always has a well-formed spread.

import {
  CardDrawSchema,
  EvidenceSchema,
  ReadingSchema,
  RepoRefSchema,
  SpreadPositionSchema,
  type CardDraw,
  type Evidence,
  type Reading,
  type RepoRef,
  type Severity,
  type SpreadPosition,
} from "@necro/oracle/client";

import type { ReadingResponse, SummonSummary } from "../protocol.js";

// `CardIdSchema` is already imported above (for the Command arbitrary); reuse
// its `.options` here rather than re-importing it.
/** Every CardId literal, for drawing a card. */
const ALL_CARD_IDS = CardIdSchema.options;

/** The two orientations an oracle CardDraw can carry. */
const ORIENTATIONS = ["upright", "reversed"] as const;

/** The five Evidence sources the oracle schema allows. */
const EVIDENCE_SOURCES = [
  "static",
  "github",
  "osv",
  "registry",
  "sandbox",
] as const;

/** A 40-character lowercase hex sha, as GitHub (and RepoRefSchema) accept. */
const arbSha: fc.Arbitrary<string> = fc.stringMatching(/^[0-9a-f]{40}$/);

/** An owner/name token over GitHub's safe set (non-empty for `.min(1)`). */
const arbOwnerName: fc.Arbitrary<string> = fc.stringMatching(
  /^[A-Za-z0-9._-]{1,30}$/,
);

/** A well-formed `RepoRef` (owner, name, 40-hex sha, default branch). */
export const arbRepoRef: fc.Arbitrary<RepoRef> = fc
  .record({
    owner: arbOwnerName,
    name: arbOwnerName,
    sha: arbSha,
    defaultBranch: fc.constantFrom("main", "master", "develop", "trunk"),
  })
  .map((ref) => RepoRefSchema.parse(ref));

/** A severity literal in the real 0..3 range (0 is valid — a latent card). */
export const arbSeverity: fc.Arbitrary<Severity> = fc.constantFrom<Severity[]>(
  0,
  1,
  2,
  3,
);

/**
 * A single path segment that never contains a path separator and stays short.
 * Built from `fc.fullUnicode()` so renderers must survive surrogate pairs.
 */
const arbPathSegment: fc.Arbitrary<string> = fc
  .array(fc.fullUnicode().filter((c) => c !== "/" && c !== "\n"), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(""));

/** A repository path of 1..4 `/`-joined segments (e.g. `src/app/main.py`). */
const arbEvidencePath: fc.Arbitrary<string> = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join("/"));

/**
 * An `Evidence` item. `path` and `line` are optional (the schema allows both to
 * be absent); when present they are a repo path and a nonnegative integer line.
 */
export const arbEvidence: fc.Arbitrary<Evidence> = fc
  .record(
    {
      kind: fc.stringMatching(/^[a-z_]{1,20}$/),
      detail: fc.string({ maxLength: 40 }),
      source: fc.constantFrom(...EVIDENCE_SOURCES),
      path: fc.option(arbEvidencePath, { nil: undefined }),
      line: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
    },
    { requiredKeys: ["kind", "detail", "source"] },
  )
  .map((raw) => EvidenceSchema.parse(raw));

/** An `Evidence` item that always carries a `path` (for the P8 link gate). */
export const arbEvidenceWithPath: fc.Arbitrary<Evidence> = fc
  .record(
    {
      kind: fc.stringMatching(/^[a-z_]{1,20}$/),
      detail: fc.string({ maxLength: 40 }),
      source: fc.constantFrom(...EVIDENCE_SOURCES),
      path: arbEvidencePath,
      line: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
    },
    { requiredKeys: ["kind", "detail", "source", "path"] },
  )
  .map((raw) => EvidenceSchema.parse(raw));

/**
 * A `CardDraw`: a drawn card with its orientation, severity, deterministic
 * summary, a (possibly empty) evidence list, and an empty grimoire list (the
 * oracle package leaves `grimoires` empty). `narration` is omitted — the oracle
 * never writes it, and the renderer uses `VOICE_TABLE`, not `narration`.
 */
export const arbCardDraw: fc.Arbitrary<CardDraw> = fc
  .record({
    card: fc.constantFrom(...ALL_CARD_IDS),
    severity: arbSeverity,
    orientation: fc.constantFrom(...ORIENTATIONS),
    evidence: fc.array(arbEvidence, { maxLength: 5 }),
    summary: fc.string({ maxLength: 60 }),
    grimoires: fc.constant([] as string[]),
  })
  .map((raw) => CardDrawSchema.parse(raw));

/** A `CardDraw` whose evidence list always has at least one path-bearing item. */
export const arbCardDrawWithEvidence: fc.Arbitrary<CardDraw> = fc
  .record({
    card: fc.constantFrom(...ALL_CARD_IDS),
    severity: arbSeverity,
    orientation: fc.constantFrom(...ORIENTATIONS),
    evidence: fc.array(arbEvidenceWithPath, { minLength: 1, maxLength: 5 }),
    summary: fc.string({ maxLength: 60 }),
    grimoires: fc.constant([] as string[]),
  })
  .map((raw) => CardDrawSchema.parse(raw));

/** Options for building a single `SpreadPosition`. */
interface PositionOptions {
  /** 1-based index assigned to this position. */
  readonly position: number;
  /** The draw for a drawn position, or `null` for a void position. */
  readonly draw: CardDraw | null;
}

/** Build one validated `SpreadPosition` from a draw-or-void and an index. */
function buildPosition({ position, draw }: PositionOptions): SpreadPosition {
  const base = {
    position,
    label: `POSITION ${position}`,
    draw,
  };
  // A void position carries a description sentinel; a drawn position omits it.
  const raw =
    draw === null ? { ...base, description: "No card fell here." } : base;
  return SpreadPositionSchema.parse(raw);
}

/**
 * A spread of 1..5 positions, renumbered 1..n in order, mixing drawn and void
 * positions. The `allDrawn` option forces every position to carry a draw (used
 * by the evidence property so every position is a card block).
 */
export function arbSpread(
  options: { readonly allDrawn?: boolean; readonly drawArb?: fc.Arbitrary<CardDraw> } = {},
): fc.Arbitrary<SpreadPosition[]> {
  const drawArb = options.drawArb ?? arbCardDraw;
  const slotArb: fc.Arbitrary<CardDraw | null> = options.allDrawn
    ? drawArb
    : fc.option(drawArb, { nil: null });
  return fc
    .array(slotArb, { minLength: 1, maxLength: 5 })
    .map((slots) =>
      slots.map((draw, index) =>
        buildPosition({ position: index + 1, draw }),
      ),
    );
}

/** A `Reading.errors` entry: a failed detector with a code and message. */
const arbReadingError = fc.record(
  {
    code: fc.stringMatching(/^[A-Z_]{3,30}$/),
    userMessage: fc.string({ maxLength: 60 }),
    cardId: fc.option(fc.constantFrom(...ALL_CARD_IDS), { nil: undefined }),
  },
  { requiredKeys: ["code", "userMessage"] },
);

/** Options steering `arbReading`. */
export interface ReadingOptions {
  /** Force every spread position to carry a draw. */
  readonly allDrawn?: boolean;
  /** The CardDraw arbitrary to use for drawn positions. */
  readonly drawArb?: fc.Arbitrary<CardDraw>;
  /** Force `errors` to be empty (true) or allow failures (false). */
  readonly noErrors?: boolean;
}

/**
 * A complete, schema-valid `Reading`. `draws` mirrors the drawn positions of
 * `spread` so the two stay consistent (the renderer reads `spread`). `id` is a
 * valid UUID and `createdAt === now` per the oracle contract.
 */
export function arbReading(options: ReadingOptions = {}): fc.Arbitrary<Reading> {
  return fc
    .record({
      repo: arbRepoRef,
      spread: arbSpread({
        ...(options.allDrawn !== undefined ? { allDrawn: options.allDrawn } : {}),
        ...(options.drawArb !== undefined ? { drawArb: options.drawArb } : {}),
      }),
      vitality: fc.integer({ min: 0, max: 100 }),
      createdAt: fc.date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2030-01-01T00:00:00.000Z") }).map((d) => d.toISOString()),
      id: fc.uuid(),
      engineVersion: fc.stringMatching(/^[0-9]+\.[0-9]+\.[0-9]+$/),
      errors: options.noErrors
        ? fc.constant([])
        : fc.array(arbReadingError, { maxLength: 3 }),
    })
    .map((raw) => {
      const draws = raw.spread
        .filter((p): p is SpreadPosition & { draw: CardDraw } => p.draw !== null)
        .map((p) => p.draw);
      return ReadingSchema.parse({ ...raw, draws });
    });
}

/** A `SummonSummary` for the summary renderer examples. */
export function arbSummonSummary(
  options: { readonly demo?: boolean } = {},
): fc.Arbitrary<SummonSummary> {
  return fc
    .record({
      ref: arbRepoRef,
      stars: fc.integer({ min: 0, max: 1_000_000 }),
      hasWorkflowsDir: fc.boolean(),
      degradedFields: fc.subarray(["pulls", "release"] as const),
      cache: fc.constantFrom<SummonSummary["cache"][]>("hit", "miss"),
      fileCount: fc.integer({ min: 0, max: 5000 }),
      truncated: fc.boolean(),
    })
    .map((raw): SummonSummary =>
      options.demo ? { ...raw, demo: true } : raw,
    );
}

/** A `ReadingResponse` pairing a summary with a reading that shares its ref. */
export function arbReadingResponse(
  options: ReadingOptions & { readonly demo?: boolean } = {},
): fc.Arbitrary<ReadingResponse> {
  return arbReading(options).chain((reading) =>
    arbSummonSummary({
      ...(options.demo !== undefined ? { demo: options.demo } : {}),
    }).map((summary) => ({
      summary: { ...summary, ref: reading.repo },
      reading,
    })),
  );
}

// ============================================================================
// Session reducer action-sequence arbitraries (task 15.1 — P19, P24, P25, P27)
// ============================================================================
//
// These arbitraries drive the pure session reducer (`session/state.ts` +
// `session/reducer.ts`, task 15.2). They build raw command strings and reducer
// `Action` values so the four properties can replay realistic interleavings:
//
//   - P19 (single in-flight request): summon / read / demo-with-name submits
//     attempted while a request is already in flight.
//   - P24 (demo isolation): sequences of `demo`, `read` and `explain` on a demo
//     session.
//   - P25 (demo resolution): `demo`, `demo <known>`, `demo <unknown>`.
//   - P27 (region independence): interleavings of `motion` and `sound`
//     commands plus the sound sub-events.
//
// They import ONLY the demo catalog (for the real catalog names), the command
// constants and the already-present reading/summary builders above — no reducer
// module, keeping the arbitraries free of the system under test (which does not
// exist yet in the red phase).

import { DEMO_CATALOG } from "../demo/catalog.js";
import { MAX_ENTRY_LENGTH } from "../command/types.js";

/** The real catalog Demo_Names, drawn from `DEMO_CATALOG` so a drift is caught. */
export const CATALOG_DEMO_NAMES: readonly string[] = DEMO_CATALOG.map(
  (entry) => entry.name,
);

/** A Demo_Name that is well-formed (`^[a-z0-9-]{1,32}$`) but NOT in the catalog. */
export const arbUnknownDemoName: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9-]{1,32}$/)
  .filter((name) => !CATALOG_DEMO_NAMES.includes(name));

/** A catalog Demo_Name (`lich-py2`, `mixed-ruins`, `green-garden`). */
export const arbCatalogDemoName: fc.Arbitrary<string> = fc.constantFrom(
  ...CATALOG_DEMO_NAMES,
);

/**
 * A raw command line that, while a request is in flight, must be rejected with
 * the "ritual underway" block and emit no effect (R3.11): a `summon`, a `read`,
 * or a `demo <name>` carrying a name. The repo token and spread stay valid so
 * the reducer reaches the in-flight guard rather than an earlier parse branch.
 */
export const arbInflightBlockingRaw: fc.Arbitrary<string> = fc.oneof(
  arbCommandRepoToken.map((repo) => `summon ${repo}`),
  fc.constantFrom("read", "read fates", "read necropsy"),
  fc
    .constantFrom(...CATALOG_DEMO_NAMES)
    .map((name) => `demo ${name}`),
);

/**
 * A raw command line for a demo session isolation sequence (P24): `demo`,
 * `demo <name>`, `read`, `read fates`, `read necropsy`, `read celtic`,
 * `explain <position>` and `explain <card>`. None of these may touch the
 * network once a demo summary is installed.
 */
export const arbDemoSessionRaw: fc.Arbitrary<string> = fc.oneof(
  fc.constant("demo"),
  arbCatalogDemoName.map((name) => `demo ${name}`),
  fc.constantFrom(
    "read",
    "read fates",
    "read necropsy",
    "read celtic",
  ),
  fc.integer({ min: 1, max: 10 }).map((n) => `explain ${n}`),
);

/** A raw `motion` command line, with and without an argument. */
export const arbMotionRaw: fc.Arbitrary<string> = fc.constantFrom(
  "motion",
  "motion on",
  "motion off",
  "motion auto",
);

/** A raw `sound` command line, with and without an argument. */
export const arbSoundRaw: fc.Arbitrary<string> = fc.constantFrom(
  "sound",
  "sound on",
  "sound off",
);

/**
 * An interleaving of `motion` and `sound` command lines (P27). Each element is
 * tagged with the region it belongs to so a test can assert that a motion
 * command never perturbs the sound region and vice versa.
 */
export const arbMotionSoundStep: fc.Arbitrary<{
  readonly region: "motion" | "sound";
  readonly raw: string;
}> = fc.oneof(
  arbMotionRaw.map((raw) => ({ region: "motion" as const, raw })),
  arbSoundRaw.map((raw) => ({ region: "sound" as const, raw })),
);

/** A short sequence of interleaved motion/sound command steps. */
export const arbMotionSoundSequence = fc.array(arbMotionSoundStep, {
  maxLength: 12,
});

/** A raw entry guaranteed to exceed the 200-character limit (R2.13). */
export const arbOverLengthRaw: fc.Arbitrary<string> = fc
  .integer({ min: MAX_ENTRY_LENGTH + 1, max: MAX_ENTRY_LENGTH + 200 })
  .chain((len) => fc.string({ minLength: len, maxLength: len }));
