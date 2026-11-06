// packages/coven/test/arbitraries.ts
//
// Shared fast-check arbitraries for the @necro/coven property tests (testing
// steering: reusable arbitraries live in `packages/*/test/arbitraries.ts`; no
// network / LLM / sandbox — these generators are pure).
//
// The oracle package already ships an `arbRepoSnapshot` (packages/oracle/
// test/arbitraries.ts) that produces the *serialized* (file-map) snapshot
// input. The coven's candidate selection, however, reads a *runtime*
// `RepoSnapshot` (with a `contents: Map`) together with a completed `Reading`
// whose draws carry Python-2-classified evidence, and it must be driven by a
// generator that *knows, by construction*, which `.py` paths are py2-classified
// so a property can assert selection against an independently-derived expected
// set (never by re-running the production rule).
//
// So rather than adapt the oracle's content-random snapshot (whose py2 content
// would have to be re-detected to know the answer), this file builds a
// correlated `(snapshot, reading, target)` triple plus the already-known
// `expectedPaths` for each target. The snapshot is assembled as a real
// `RepoSnapshot` via the oracle's `buildSnapshotFromFileMap`. `arbRepoRef` /
// `arbRepoMeta` are defined locally (the oracle's test arbitraries are not a
// public subpath export, and selection reads none of these fields — they exist
// only so `buildSnapshotFromFileMap` yields a schema-valid snapshot).

import fc from "fast-check";

import {
  buildSnapshotFromFileMap,
  type CardDraw,
  type CardId,
  type Evidence,
  type FileEntry,
  type Reading,
  type RepoRef,
  type RepoMeta,
  type RepoSnapshot,
} from "@necro/oracle";
import type { FileResult, ResurrectTarget } from "@necro/coven";

// ---------------------------------------------------------------------------
// Python-2 construct kinds the Judgement detector emits as static evidence.
//
// This mirrors `select.ts`'s `PY2_CONSTRUCT_KINDS`. Keeping an independent copy
// here (rather than importing the private set) is deliberate: the property must
// decide the expected answer from the *specification*, not from the module
// under test, so a regression in that set is caught rather than mirrored.
// ---------------------------------------------------------------------------

const PY2_CONSTRUCT_KINDS = [
  "print_statement",
  "exec_statement",
  "except_comma",
  "ne_operator",
  "long_integer",
  "legacy_octal",
  "backtick_repr",
] as const;

/** Static evidence `source` values that are NOT py2 classification. */
const NON_STATIC_SOURCES = ["github", "osv", "registry", "sandbox"] as const;

/** All 12 card ids (the reading's draws are keyed by these). */
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

// ---------------------------------------------------------------------------
// Path arbitraries
// ---------------------------------------------------------------------------

/** A short, filesystem-safe path segment (letters/digits/_/-; never . or ..). */
const arbPathSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
  .filter((s) => s.length > 0 && s !== "." && s !== "..");

/** A relative `.py` file path (1-3 segments). */
const arbPyPath: fc.Arbitrary<string> = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("/") + ".py");

/** A relative non-`.py` file path (used as noise that must never be selected). */
const arbNonPyPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(arbPathSegment, { minLength: 1, maxLength: 3 }),
    fc.constantFrom(".js", ".ts", ".html", ".md", ".txt", ".cfg"),
  )
  .map(([segments, ext]) => segments.join("/") + ext);

// ---------------------------------------------------------------------------
// Snapshot metadata arbitraries (locally defined; selection reads none of
// these — they only make `buildSnapshotFromFileMap` produce a valid snapshot).
// ---------------------------------------------------------------------------

const arbIsoDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2005-01-01T00:00:00Z"),
    max: new Date("2030-01-01T00:00:00Z"),
  })
  .map((d) => d.toISOString());

const arbRepoRef: fc.Arbitrary<RepoRef> = fc.record({
  owner: arbPathSegment,
  name: arbPathSegment,
  sha: fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
    .map((nibbles) => nibbles.map((n) => "0123456789abcdef"[n]).join("")),
  defaultBranch: fc.constantFrom("main", "master", "develop", "trunk"),
});

const arbRepoMeta: fc.Arbitrary<RepoMeta> = fc.record({
  pushedAt: fc.option(arbIsoDate, { nil: null }),
  isArchived: fc.boolean(),
  openIssueCount: fc.nat({ max: 10000 }),
  openPRCount: fc.nat({ max: 10000 }),
  oldestOpenPRAgeDays: fc.option(fc.nat({ max: 10000 }), { nil: null }),
  latestReleaseAt: fc.option(arbIsoDate, { nil: null }),
  licenseKey: fc.option(
    fc.constantFrom("MIT", "Apache-2.0", "GPL-3.0", "BSD-3-Clause"),
    { nil: null },
  ),
});

// ---------------------------------------------------------------------------
// Evidence arbitraries
// ---------------------------------------------------------------------------

/** A py2-classified static evidence item pointing at `path`. */
function arbPy2Evidence(path: string): fc.Arbitrary<Evidence> {
  return fc.record({
    kind: fc.constantFrom(...PY2_CONSTRUCT_KINDS),
    path: fc.constant(path),
    line: fc.nat({ max: 5000 }),
    detail: fc.string({ maxLength: 40 }),
    source: fc.constant<"static">("static"),
  });
}

/**
 * A non-py2 evidence item: either a static item whose `kind` is NOT a py2
 * construct, or a non-static item (github / osv / registry / sandbox). May
 * point at a `.py` path — this is the exact noise selection must reject: a
 * static evidence item on a `.py` file that is not a known py2 construct, and
 * any non-static evidence, must never pull a path into the candidate set.
 */
function arbNoisyEvidence(path: string): fc.Arbitrary<Evidence> {
  return fc.oneof(
    // static, but a non-py2 construct kind
    fc.record({
      kind: fc
        .string({ minLength: 1, maxLength: 16 })
        .map((s) => s.replace(/[^a-z_]/g, "_"))
        .filter(
          (s) =>
            s.length > 0 &&
            !(PY2_CONSTRUCT_KINDS as readonly string[]).includes(s),
        ),
      path: fc.constant(path),
      line: fc.nat({ max: 5000 }),
      detail: fc.string({ maxLength: 40 }),
      source: fc.constant<"static">("static"),
    }),
    // non-static source (never a py2 classification regardless of kind/path)
    fc.record({
      kind: fc.constantFrom(...PY2_CONSTRUCT_KINDS),
      path: fc.constant(path),
      line: fc.nat({ max: 5000 }),
      detail: fc.string({ maxLength: 40 }),
      source: fc.constantFrom(...NON_STATIC_SOURCES),
    }),
  );
}

// ---------------------------------------------------------------------------
// The correlated selection case
// ---------------------------------------------------------------------------

/**
 * A fully-correlated selection scenario whose expected answers are known by
 * construction.
 *
 * - `snapshot` / `reading` drive `selectCandidates`.
 * - `py2Paths` is the sorted, distinct set of `.py` paths carrying py2 static
 *   evidence (what a bare target selects).
 * - `py2PathsByCard` maps each card id to the sorted, distinct py2 `.py` paths
 *   that card's draw flagged (what a `card` target selects).
 * - `bareTarget` / a `card` target / a `file` target with its expected result
 *   are provided so the property asserts set-equality per target without
 *   re-deriving via the module under test.
 *
 * All files are kept well under the 1 MB per-file limit and the py2 path count
 * is kept at or below the 50-file cap so neither the size guard nor the cap
 * (Property 2 / task 8.3) perturbs the set this property is about.
 */
export interface SelectionCase {
  readonly snapshot: RepoSnapshot;
  readonly reading: Reading;
  /** Distinct, ascending py2 `.py` paths — the bare-target expected set. */
  readonly py2Paths: readonly string[];
  /** card id -> distinct, ascending py2 `.py` paths that card flagged. */
  readonly py2PathsByCard: ReadonlyMap<string, readonly string[]>;
}

/**
 * One py2 `.py` path together with the set of card ids whose draw flags it
 * (at least one), and whether the file also gets an extra noise evidence item.
 */
interface Py2FileSpec {
  readonly path: string;
  readonly cards: readonly CardId[];
}

/** Build the runtime RepoSnapshot + file map from the generated paths. */
function buildSnapshot(
  ref: RepoRef,
  meta: RepoMeta,
  createdAt: string,
  allPaths: readonly string[],
): RepoSnapshot {
  const files: Record<string, string> = {};
  for (const p of allPaths) {
    // Small, harmless content; its bytes stay far under the 1 MB limit. The
    // selection rule reads classification from the reading, not the content,
    // so the text itself is irrelevant to the expected set.
    files[p] = `# ${p}\npass\n`;
  }
  return buildSnapshotFromFileMap(ref, files, { meta, createdAt });
}

/**
 * Assemble a `Reading` whose draws carry the generated evidence. Each card in
 * `specsByCard` gets a draw with one py2 evidence item per flagged path; a few
 * cards also get noise evidence. Cards with no evidence still appear as draws
 * with empty evidence (closer to a real reading) but contribute no candidates.
 */
function buildReading(
  repo: RepoSnapshot["ref"],
  specs: readonly Py2FileSpec[],
  noisePaths: readonly string[],
  noiseEvidence: ReadonlyMap<CardId, readonly Evidence[]>,
  now: string,
): Reading {
  // Invert specs: card id -> py2 evidence items for that card.
  const py2ByCard = new Map<CardId, Evidence[]>();
  for (const spec of specs) {
    for (const card of spec.cards) {
      const list = py2ByCard.get(card) ?? [];
      list.push({
        kind: "print_statement",
        path: spec.path,
        line: 1,
        detail: "legacy print statement",
        source: "static",
      });
      py2ByCard.set(card, list);
    }
  }

  const involvedCards = new Set<CardId>([
    ...py2ByCard.keys(),
    ...noiseEvidence.keys(),
  ]);

  const draws: CardDraw[] = [...involvedCards].map((card) => {
    const evidence: Evidence[] = [
      ...(py2ByCard.get(card) ?? []),
      ...(noiseEvidence.get(card) ?? []),
    ];
    return {
      card,
      severity: 1,
      orientation: "reversed",
      evidence,
      summary: "",
      grimoires: [],
    };
  });

  // `noisePaths` are referenced only by non-py2 evidence (threaded through
  // noiseEvidence), so they never become candidates; kept here for clarity of
  // intent in the generator.
  void noisePaths;

  return {
    id: crypto.randomUUID(),
    repo,
    draws,
    spread: [],
    vitality: 100,
    createdAt: now,
    engineVersion: "0.0.0",
    errors: [],
  };
}

/**
 * `arbSelectionCase` — a correlated snapshot + reading whose py2-classified
 * `.py` paths (overall and per card) are known by construction.
 */
export const arbSelectionCase: fc.Arbitrary<SelectionCase> = fc
  .record({
    ref: arbRepoRef,
    meta: arbRepoMeta,
    createdAt: fc
      .date({
        min: new Date("2020-01-01T00:00:00Z"),
        max: new Date("2030-01-01T00:00:00Z"),
      })
      .map((d) => d.toISOString()),
    // Distinct py2 `.py` paths, 0..40 (<= the 50-file cap so this property is
    // about the set, not the cap). Each is flagged by 1..3 cards.
    py2Files: fc.uniqueArray(
      fc.record({
        path: arbPyPath,
        cards: fc.uniqueArray(fc.constantFrom(...CARD_IDS), {
          minLength: 1,
          maxLength: 3,
        }),
      }),
      { maxLength: 40, selector: (f) => f.path },
    ),
    // Noise `.py` paths referenced by non-py2 (static-non-construct OR
    // non-static) evidence. These must never be selected.
    noisyPyPaths: fc.uniqueArray(arbPyPath, { maxLength: 10 }),
    // Non-`.py` paths referenced by py2-kind static evidence. The `.py`
    // extension guard must exclude these.
    nonPyPaths: fc.uniqueArray(arbNonPyPath, { maxLength: 10 }),
  })
  .chain((base) => {
    // Resolve path collisions across the three disjoint path pools so each
    // path has a single, unambiguous classification.
    const py2Set = new Set(base.py2Files.map((f) => f.path));
    const noisyPy = base.noisyPyPaths.filter((p) => !py2Set.has(p));
    const noisyPySet = new Set(noisyPy);
    const specs: Py2FileSpec[] = base.py2Files;

    // Distribute noise evidence across cards. Noisy `.py` paths get a
    // non-py2-static OR non-static item; non-`.py` paths get a py2-kind static
    // item (which the `.py` guard must still reject).
    const noiseByCardArb = fc.record(
      Object.fromEntries(
        [...noisyPy, ...base.nonPyPaths].map((path, i) => {
          const isNonPy = !noisyPySet.has(path);
          const evArb = isNonPy
            ? // non-`.py` path with a py2-kind STATIC item (rejected by ext guard)
              fc.record({
                kind: fc.constantFrom(...PY2_CONSTRUCT_KINDS),
                path: fc.constant(path),
                line: fc.nat({ max: 5000 }),
                detail: fc.string({ maxLength: 40 }),
                source: fc.constant<"static">("static"),
              })
            : arbNoisyEvidence(path);
          return [`${i}:${path}`, fc.tuple(fc.constantFrom(...CARD_IDS), evArb)];
        }),
      ),
    ) as fc.Arbitrary<Record<string, [CardId, Evidence]>>;

    return fc.record({ noise: noiseByCardArb }).map(({ noise }) => {
      // Group noise evidence by card.
      const noiseEvidence = new Map<CardId, Evidence[]>();
      for (const [card, ev] of Object.values(noise)) {
        const list = noiseEvidence.get(card) ?? [];
        list.push(ev);
        noiseEvidence.set(card, list);
      }

      // All paths that exist in the snapshot: py2, noisy-py, and non-py.
      const allPaths = [
        ...specs.map((s) => s.path),
        ...noisyPy,
        ...base.nonPyPaths,
      ];

      const snapshot = buildSnapshot(
        base.ref,
        base.meta,
        base.createdAt,
        allPaths,
      );
      const reading = buildReading(
        snapshot.ref,
        specs,
        noisyPy,
        noiseEvidence,
        base.createdAt,
      );

      // Expected sets, derived from the generated structure (not the module).
      const py2Paths = [...py2Set].sort();
      const py2PathsByCard = new Map<string, string[]>();
      for (const spec of specs) {
        for (const card of spec.cards) {
          const list = py2PathsByCard.get(card) ?? [];
          list.push(spec.path);
          py2PathsByCard.set(card, list);
        }
      }
      for (const [card, paths] of py2PathsByCard) {
        py2PathsByCard.set(card, [...new Set(paths)].sort());
      }

      return { snapshot, reading, py2Paths, py2PathsByCard };
    });
  });

/** A `card` target for an arbitrary card id (may or may not match a draw). */
export const arbCardTarget: fc.Arbitrary<ResurrectTarget> = fc
  .constantFrom(...CARD_IDS)
  .map((card) => ({ kind: "card", card }));

// ---------------------------------------------------------------------------
// File_Result arbitraries (task 9.2 — Property 9: patch round-trip + unvalidated
// exclusion).
//
// The diff/patch property (P9) asserts a byte-for-byte round-trip, so the
// generated `before`/`after` contents must exercise exactly the edges the
// unified-diff generator in `diff.ts` cares about: empty files, files with and
// without a trailing newline, and lines that themselves may be empty. The
// trailing-newline edge is the load-bearing one — `diff.ts` emits the standard
// "\ No newline at end of file" marker when a side lacks a trailing newline, so
// the generator must produce both kinds freely and in combination.
//
// `arbFileResult` builds a schema-valid `FileResult` directly (it does NOT call
// the module under test to fill `diff`/`fullyConverted`): the property derives
// the expected patch membership from `validated` and `before !== after`
// independently, and only `path`/`before`/`after`/`validated` matter to P9.
// The `diff` field is filled with a trivially-valid placeholder so the object
// satisfies `FileResultSchema` without re-deriving via `lineDiff`.
// ---------------------------------------------------------------------------

/**
 * A small text content that freely exercises the trailing-newline edge:
 *  - 0..5 lines, each 0..12 chars drawn from a mix that includes spaces, so an
 *    all-whitespace or empty line can appear;
 *  - a boolean decides whether the content ends with a trailing "\n".
 *
 * An empty line array yields "" (the empty-file edge). A non-empty array is
 * joined with "\n" and optionally gets a trailing "\n". Only "\n" is used as a
 * terminator so it matches `splitLines` in `diff.ts`.
 */
const arbTextContent: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(
      fc
        .string({ minLength: 0, maxLength: 12 })
        // Keep content to printable ASCII plus space; crucially never contains
        // "\n" (lines are joined explicitly) and never U+0000 (the diff's
        // internal no-newline sentinel), so neither perturbs the round-trip.
        .map((s) => s.replace(/[\u0000\n\r]/g, "")),
      { minLength: 0, maxLength: 5 },
    ),
    fc.boolean(),
  )
  .map(([lines, trailingNewline]) => {
    if (lines.length === 0) return "";
    const joined = lines.join("\n");
    return trailingNewline ? `${joined}\n` : joined;
  });

/**
 * A schema-valid `FileResult` whose `before`/`after`/`validated` fields are the
 * only ones P9 reasons about. `after` is drawn independently of `before`, so
 * both the changed (before !== after) and unchanged (before === after) cases
 * arise naturally; `validated` is a free boolean so the not-validated exclusion
 * (R7.7) is exercised. `diff`/`residuals`/`fullyConverted` are filled with a
 * schema-valid placeholder — the property never inspects them.
 */
export const arbFileResult: fc.Arbitrary<FileResult> = fc
  .record({
    path: arbPyPath,
    before: arbTextContent,
    after: arbTextContent,
    validated: fc.boolean(),
  })
  .map(({ path, before, after, validated }) => ({
    path,
    before,
    after,
    diff: [],
    residuals: [],
    fullyConverted: true,
    validated,
  }));

/**
 * A set of `FileResult`s with DISTINCT paths. The patch is keyed by path, so a
 * duplicate path across two sections would make membership ambiguous; the
 * property drives `buildPatch` with a uniquely-pathed set and asserts against
 * the validated+changed subset of exactly those paths.
 */
export const arbFileResultSet: fc.Arbitrary<readonly FileResult[]> =
  fc.uniqueArray(arbFileResult, {
    maxLength: 12,
    selector: (f) => f.path,
  });

// ===========================================================================
// Cap / oversize selection case (task 8.3, Property 2)
//
// Appended as a distinct export so it does not disturb `arbSelectionCase`
// above (which deliberately stays at or below the 50-file cap and well under
// the 1 MB per-file limit). This generator does the opposite: it produces a
// bare-target scenario with MORE than 50 py2 `.py` files and some files over
// the 1 MB per-file limit, so Property 2 can assert the ascending-by-path
// prefix of length min(n, 50), the deferred count max(0, n - 50), and the
// per-file size exclusion with its naming skip-note.
//
// Everything is known by construction: `oversizePaths` are the py2 paths whose
// snapshot content exceeds 1 MB (and so must be excluded before the cap),
// while `eligiblePaths` are the ascending, under-limit py2 paths the cap then
// applies to. No network / LLM / sandbox.
// ===========================================================================

/** The per-file byte ceiling mirrored from `select.ts` (`MAX_FILE_BYTES`). */
const CAP_MAX_FILE_BYTES = 1_000_000;

/** The per-run file cap mirrored from `select.ts` (`MAX_CANDIDATES`). */
const CAP_MAX_CANDIDATES = 50;

/**
 * A cap/oversize scenario whose expected answers are known by construction.
 *
 * - `snapshot` / `reading` drive a *bare*-target `selectCandidates` call.
 * - `eligiblePaths` is the ascending, distinct set of py2 `.py` paths whose
 *   content is under the 1 MB limit (the set the cap applies to).
 * - `oversizePaths` is the set of py2 `.py` paths whose content exceeds 1 MB
 *   (each must be excluded with a naming skip-note before the cap).
 * - `expectedCandidates` is the ascending prefix of `eligiblePaths` of length
 *   min(eligible.length, 50) — exactly what selection should process.
 * - `expectedDeferred` is max(0, eligible.length - 50).
 */
export interface SelectionCapCase {
  readonly snapshot: RepoSnapshot;
  readonly reading: Reading;
  readonly eligiblePaths: readonly string[];
  readonly oversizePaths: readonly string[];
  readonly expectedCandidates: readonly string[];
  readonly expectedDeferred: number;
}

/**
 * Build the runtime `RepoSnapshot` *directly* (not via
 * `buildSnapshotFromFileMap`). The builder applies its own 1 MB size *filter*
 * that would drop an oversize file from the snapshot entirely before
 * `select.ts` ever sees it, and materializing real megabyte strings 1000×
 * would also make the property both slow and unserializable on failure.
 *
 * Instead we record a `FileEntry.size` over `select.ts`'s `MAX_FILE_BYTES`
 * for each oversize path while keeping the stored content tiny. `select.ts`
 * reads `FileEntry.size` as its primary size signal (falling back to content
 * byte length only when no entry is found), so this faithfully exercises the
 * per-file size guard (R2.5) without any large allocation.
 */
function buildCapSnapshot(
  ref: RepoRef,
  meta: RepoMeta,
  createdAt: string,
  eligiblePaths: readonly string[],
  oversizePaths: readonly string[],
): RepoSnapshot {
  const files: FileEntry[] = [];
  const contents = new Map<string, string>();

  for (const p of eligiblePaths) {
    const content = `# ${p}\nprint "legacy"\n`;
    files.push({
      path: p,
      // Well under the per-file limit.
      size: Buffer.byteLength(content, "utf8"),
      lang: "python",
      sha: "0".repeat(8),
    });
    contents.set(p, content);
  }

  for (const p of oversizePaths) {
    // Tiny stored content, but a recorded size one byte over the limit so the
    // size guard must exclude it (R2.5) — no megabyte allocation.
    contents.set(p, "# oversize placeholder\n");
    files.push({
      path: p,
      size: CAP_MAX_FILE_BYTES + 1,
      lang: "python",
      sha: "0".repeat(8),
    });
  }

  return {
    ref,
    files,
    meta,
    manifests: [],
    contents,
    oversizeFiles: [],
    truncated: false,
    createdAt,
  };
}

/**
 * Build a reading that flags every path in `allPy2Paths` as py2 via one static
 * print-statement evidence item on a single draw (the Judgement card). The
 * draw's card identity does not matter to a bare target; a single draw keeps
 * the generator simple while still exercising the full ascending/cap path.
 */
function buildCapReading(
  repo: RepoSnapshot["ref"],
  allPy2Paths: readonly string[],
  now: string,
): Reading {
  const evidence: Evidence[] = allPy2Paths.map((path) => ({
    kind: "print_statement",
    path,
    line: 1,
    detail: "legacy print statement",
    source: "static",
  }));

  const draws: CardDraw[] = [
    {
      card: "judgement",
      severity: 1,
      orientation: "reversed",
      evidence,
      summary: "",
      grimoires: [],
    },
  ];

  return {
    id: crypto.randomUUID(),
    repo,
    draws,
    spread: [],
    vitality: 100,
    createdAt: now,
    engineVersion: "0.0.0",
    errors: [],
  };
}

/**
 * `arbSelectionCapCase` — a bare-target scenario with > 50 eligible py2 files
 * (so the cap bites) and some py2 files over 1 MB (so the size guard excludes
 * them first). Expected prefix, deferred count, and oversize set are all known
 * by construction.
 */
export const arbSelectionCapCase: fc.Arbitrary<SelectionCapCase> = fc
  .record({
    ref: arbRepoRef,
    meta: arbRepoMeta,
    createdAt: fc
      .date({
        min: new Date("2020-01-01T00:00:00Z"),
        max: new Date("2030-01-01T00:00:00Z"),
      })
      .map((d) => d.toISOString()),
    // 51..70 distinct under-limit py2 `.py` paths so n > 50 always (the cap
    // bites) while keeping the case small enough for 1000 runs.
    eligible: fc.uniqueArray(arbPyPath, {
      minLength: CAP_MAX_CANDIDATES + 1,
      maxLength: CAP_MAX_CANDIDATES + 20,
      selector: (p) => p,
    }),
    // 0..5 oversize py2 `.py` paths — excluded by the size guard before the cap.
    oversizeRaw: fc.uniqueArray(arbPyPath, { maxLength: 5, selector: (p) => p }),
  })
  .map((base) => {
    // Keep the oversize pool disjoint from the eligible pool.
    const eligibleSet = new Set(base.eligible);
    const oversizePaths = base.oversizeRaw.filter((p) => !eligibleSet.has(p));

    const eligiblePaths = [...base.eligible].sort();
    const allPy2Paths = [...eligiblePaths, ...oversizePaths];

    const snapshot = buildCapSnapshot(
      base.ref,
      base.meta,
      base.createdAt,
      eligiblePaths,
      oversizePaths,
    );
    const reading = buildCapReading(snapshot.ref, allPy2Paths, base.createdAt);

    const expectedCandidates = eligiblePaths.slice(0, CAP_MAX_CANDIDATES);
    const expectedDeferred = Math.max(
      0,
      eligiblePaths.length - CAP_MAX_CANDIDATES,
    );

    return {
      snapshot,
      reading,
      eligiblePaths,
      oversizePaths,
      expectedCandidates,
      expectedDeferred,
    };
  });
