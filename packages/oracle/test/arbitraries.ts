// packages/oracle/test/arbitraries.ts
//
// Shared fast-check arbitraries for the Oracle Deck Engine property tests.
//
// These generators are consumed by every downstream `[PBT]` task. They produce
// values that satisfy the core primitive schemas (src/registry/schema.ts) and
// the snapshot shapes documented in design.md / requirements.md.
//
// NOTE ON SNAPSHOT TYPES: the snapshot types module (`src/snapshot/types.ts`)
// is introduced by task 7 and does not exist yet. To keep this file typechecking
// standalone, the snapshot-oriented structural types (RepoRef, Lang, FileEntry,
// RepoMeta, RepoSnapshotInput) are declared locally here against the documented
// shapes. Once `src/snapshot/types.ts` lands, these local aliases can be swapped
// for the exported schema-inferred types without changing the generated shapes.
//
// Requirements: R21.5 (reusable arbitraries live in packages/*/test/arbitraries.ts;
// no network / LLM / sandbox in property tests — these generators are pure).

import fc from "fast-check";

import type { CardDraw, CardId, Severity } from "../src/registry/schema.js";

// ---------------------------------------------------------------------------
// Local structural snapshot types (documented shapes; mirror src/snapshot/types.ts
// once task 7 defines them).
// ---------------------------------------------------------------------------

/** Mirror of the forthcoming `RepoRef` (src/snapshot/types.ts, task 7). */
export interface RepoRefShape {
  owner: string;
  name: string;
  sha: string;
  defaultBranch: string;
}

/** Mirror of the forthcoming `Lang` enum. */
export type LangShape = "python" | "js" | "ts" | "html" | "other";

/** Mirror of the forthcoming `FileEntry`. */
export interface FileEntryShape {
  path: string;
  size: number;
  lang: LangShape;
  sha: string;
}

/** Mirror of the forthcoming `RepoMeta` (all R11.1 fields). */
export interface RepoMetaShape {
  pushedAt: string | null;
  isArchived: boolean;
  openIssueCount: number;
  openPRCount: number;
  oldestOpenPRAgeDays: number | null;
  latestReleaseAt: string | null;
  licenseKey: string | null;
}

/**
 * Serialized / file-map form of a snapshot, as accepted by
 * `buildSnapshotFromFileMap(ref, files, { meta, createdAt })`. The runtime
 * `RepoSnapshot` adds a `contents: Map<string, string>` built from `files`.
 */
export interface RepoSnapshotInputShape {
  ref: RepoRefShape;
  files: Record<string, string>;
  meta: RepoMetaShape;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** All 12 card ids from the registry enum. */
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

/** Lowercase hex character. */
const HEX = "0123456789abcdef";

/** A 40-character lowercase hex git SHA-1 string. */
export const arbSha: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
  .map((nibbles) => nibbles.map((n) => HEX[n]).join(""));

/** Severity 0–3, matching SeveritySchema. */
const arbSeverity: fc.Arbitrary<Severity> = fc.constantFrom<Severity>(
  0,
  1,
  2,
  3,
);

/** A short, filesystem-safe path segment. */
const arbPathSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
  .filter((s) => s.length > 0 && s !== "." && s !== "..");

/** A relative file path with a known extension so `lang` is derivable. */
const EXTENSIONS: readonly { ext: string; lang: LangShape }[] = [
  { ext: ".py", lang: "python" },
  { ext: ".js", lang: "js" },
  { ext: ".ts", lang: "ts" },
  { ext: ".html", lang: "html" },
  { ext: ".md", lang: "other" },
  { ext: ".txt", lang: "other" },
];

function langForPath(path: string): LangShape {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".html")) return "html";
  return "other";
}

// ---------------------------------------------------------------------------
// Card / draw arbitraries (depend only on core primitive schemas)
// ---------------------------------------------------------------------------

/** An Evidence object satisfying EvidenceSchema. */
const arbEvidence: fc.Arbitrary<CardDraw["evidence"][number]> = fc.record({
  kind: fc.string({ minLength: 1, maxLength: 24 }),
  path: fc.option(arbPathSegment, { nil: undefined }),
  line: fc.option(fc.nat({ max: 100000 }), { nil: undefined }),
  detail: fc.string({ maxLength: 120 }),
  source: fc.constantFrom(
    "static",
    "github",
    "osv",
    "registry",
    "sandbox",
  ),
});

/**
 * A valid `CardDraw` with consistent severity/orientation.
 *
 * Orientation convention (product rule): upright = active/full-severity,
 * reversed = latent/partial. We keep severity and orientation mutually
 * consistent so Property 4 (severity/orientation consistency) holds:
 *   - severity 0 → always "reversed" (latent / no active penalty)
 *   - severity >= 1 → "upright" when severe (2,3), "reversed" when partial (1)
 */
function orientationForSeverity(
  severity: Severity,
): "upright" | "reversed" {
  if (severity === 0 || severity === 1) return "reversed";
  return "upright";
}

/** Generates a valid CardDraw for a specific card id. */
function arbCardDrawFor(card: CardId): fc.Arbitrary<CardDraw> {
  return fc.record({
    card: fc.constant(card),
    severity: arbSeverity,
    evidence: fc.array(arbEvidence, { maxLength: 4 }),
    summary: fc.string({ maxLength: 120 }),
    grimoires: fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
      maxLength: 3,
    }),
  }).map((partial) => ({
    card: partial.card,
    severity: partial.severity,
    orientation: orientationForSeverity(partial.severity),
    evidence: partial.evidence,
    summary: partial.summary,
    grimoires: partial.grimoires,
  }));
}

/** A valid `CardDraw` with consistent severity/orientation, any card id. */
export const arbCardDraw: fc.Arbitrary<CardDraw> = fc
  .constantFrom(...CARD_IDS)
  .chain((card) => arbCardDrawFor(card));

/**
 * An array of 0–12 `CardDraw`s with no duplicate card ids.
 *
 * Built by selecting a unique subset of card ids (via shuffle) then drawing a
 * CardDraw for each, so the no-duplicate invariant holds by construction.
 */
export const arbCardDrawArray: fc.Arbitrary<CardDraw[]> = fc
  .shuffledSubarray([...CARD_IDS], { minLength: 0, maxLength: 12 })
  .chain((cards) =>
    cards.length === 0
      ? fc.constant<CardDraw[]>([])
      : fc.tuple(...cards.map((c) => arbCardDrawFor(c))),
  );

// ---------------------------------------------------------------------------
// Python source arbitrary (clean Python 3, no py2 constructs) — for P15
// ---------------------------------------------------------------------------

/** A valid Python 3 identifier. */
const arbPyIdentifier: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.string({ maxLength: 6 }).map((s) => s.replace(/[^a-z0-9_]/g, "")),
  )
  .map(([head, tail]) => `${head}${tail}`);

/** A clean Python 3 integer literal (no legacy octal, no long `L` suffix). */
const arbPyInt: fc.Arbitrary<string> = fc
  .nat({ max: 999999 })
  .map((n) => String(n));

/**
 * A single clean Python 3 statement using only py3-valid constructs:
 * `print(...)` function call (never `print x`), simple assignments,
 * `!=` (never `<>`), and `except E as e` (never `except E, e`).
 */
const arbPyStatement: fc.Arbitrary<string> = fc.oneof(
  // print() as a function call
  fc.tuple(arbPyInt).map(([n]) => `print(${n})`),
  // simple assignment
  fc.tuple(arbPyIdentifier, arbPyInt).map(([name, n]) => `${name} = ${n}`),
  // modern inequality comparison inside a boolean assignment
  fc
    .tuple(arbPyIdentifier, arbPyInt, arbPyInt)
    .map(([name, a, b]) => `${name} = ${a} != ${b}`),
  // pass
  fc.constant("pass"),
);

/**
 * `arbPythonSource` — small Python 3 source strings containing none of the 7
 * legacy constructs (print_statement, exec_statement, `<>`, long literal,
 * legacy octal, backtick repr, `except E, e`). Used by P15.
 */
export const arbPythonSource: fc.Arbitrary<string> = fc
  .array(arbPyStatement, { minLength: 1, maxLength: 8 })
  .map((stmts) => stmts.join("\n") + "\n");

// ---------------------------------------------------------------------------
// Snapshot-oriented arbitraries (documented shapes; see note at top of file)
// ---------------------------------------------------------------------------

/** A valid `RepoRef`: owner / name / sha / defaultBranch. */
export const arbRepoRef: fc.Arbitrary<RepoRefShape> = fc.record({
  owner: arbPathSegment,
  name: arbPathSegment,
  sha: arbSha,
  defaultBranch: fc.constantFrom("main", "master", "develop", "trunk"),
});

/** A valid `FileEntry` whose `lang` is derived from its path extension. */
export const arbFileEntry: fc.Arbitrary<FileEntryShape> = fc
  .tuple(
    fc.array(arbPathSegment, { minLength: 1, maxLength: 3 }),
    fc.constantFrom(...EXTENSIONS),
    fc.nat({ max: 5_000_000 }),
    arbSha,
  )
  .map(([segments, { ext }, size, sha]) => {
    const path = segments.join("/") + ext;
    return { path, size, lang: langForPath(path), sha };
  });

/** A valid `RepoMeta` including all R11.1 fields. */
export const arbRepoMeta: fc.Arbitrary<RepoMetaShape> = fc.record({
  pushedAt: fc.option(
    fc
      .date({
        min: new Date("2005-01-01T00:00:00Z"),
        max: new Date("2030-01-01T00:00:00Z"),
      })
      .map((d) => d.toISOString()),
    { nil: null },
  ),
  isArchived: fc.boolean(),
  openIssueCount: fc.nat({ max: 10000 }),
  openPRCount: fc.nat({ max: 10000 }),
  oldestOpenPRAgeDays: fc.option(fc.nat({ max: 10000 }), { nil: null }),
  latestReleaseAt: fc.option(
    fc
      .date({
        min: new Date("2005-01-01T00:00:00Z"),
        max: new Date("2030-01-01T00:00:00Z"),
      })
      .map((d) => d.toISOString()),
    { nil: null },
  ),
  licenseKey: fc.option(
    fc.constantFrom("MIT", "Apache-2.0", "GPL-3.0", "BSD-3-Clause", "NOASSERTION"),
    { nil: null },
  ),
});

/** A file-map entry: a path (with a known extension) → arbitrary content. */
const arbFileMapEntry: fc.Arbitrary<[string, string]> = fc.tuple(
  fc
    .tuple(
      fc.array(arbPathSegment, { minLength: 1, maxLength: 3 }),
      fc.constantFrom(...EXTENSIONS.map((e) => e.ext)),
    )
    .map(([segments, ext]) => segments.join("/") + ext),
  fc.string({ maxLength: 200 }),
);

/**
 * `arbRepoSnapshot` — composes the above into the serialized (file-map) form
 * accepted by `buildSnapshotFromFileMap`. Generates 0–200 files with random
 * content strings, plus a RepoRef, RepoMeta, and deterministic createdAt.
 */
export const arbRepoSnapshot: fc.Arbitrary<RepoSnapshotInputShape> = fc.record({
  ref: arbRepoRef,
  files: fc
    .uniqueArray(arbFileMapEntry, {
      minLength: 0,
      maxLength: 200,
      selector: ([path]) => path,
    })
    .map((entries) => Object.fromEntries(entries) as Record<string, string>),
  meta: arbRepoMeta,
  createdAt: fc
    .date({
      min: new Date("2020-01-01T00:00:00Z"),
      max: new Date("2030-01-01T00:00:00Z"),
    })
    .map((d) => d.toISOString()),
});

/**
 * `arbLargeFileMap` — a file map with > 5000 entries, used by P12 to verify the
 * 5000-file cap and `truncated` flag in `buildSnapshotFromFileMap`. Paths are
 * generated deterministically from an index to guarantee uniqueness and keep
 * generation cheap.
 */
export const arbLargeFileMap: fc.Arbitrary<Record<string, string>> = fc
  .integer({ min: 5001, max: 5200 })
  .chain((count) =>
    fc
      .array(fc.string({ maxLength: 8 }), {
        minLength: count,
        maxLength: count,
      })
      .map((contents) => {
        const map: Record<string, string> = {};
        for (let i = 0; i < contents.length; i++) {
          map[`src/file_${String(i).padStart(5, "0")}.py`] = contents[i] ?? "";
        }
        return map;
      }),
  );
