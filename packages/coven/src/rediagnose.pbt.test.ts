// @necro/coven — property test for Vitality_Delta consistency (task 9.4).
//
// Property 6: Vitality_Delta is consistent with the oracle.
//   When re-diagnosis succeeds (a post-resurrection reading settles), the
//   reported `vitalityDelta` equals `computeVitalityDelta(beforeVitality,
//   afterVitality)` AND equals `afterVitality - beforeVitality` (R6.3).
//
// The property drives the REAL `rediagnose(input, files)` over a generated
// `RitualInput` whose `reading`/`snapshot` are produced by the oracle's own
// `runReading` over a generated file-map snapshot. `runReading` initialises the
// tree-sitter parser and parses the `.py` files — a LOCAL parse, which the
// testing steering permits (no network / LLM / sandbox is touched here). The
// generated `FileResult[]` overlay validated+changed content onto real snapshot
// paths so the overlay/re-reading path is actually exercised, but the asserted
// invariant (delta = after - before) holds independent of what is overlaid.
//
// `computeVitalityDelta` is deliberately re-imported and compared against both
// the reported delta AND a hand-computed `after - before`: the three must agree
// so a regression in either `rediagnose`'s wiring or the oracle's delta is
// caught rather than mirrored.
//
// fast-check runs 200 times (per the plan's non-fixer property budget); the
// seed is printed on failure (fast-check prints the failing seed by default).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildSnapshotFromFileMap,
  computeVitalityDelta,
  initParser,
  type RepoRef,
  type SpreadKind,
} from "@necro/oracle";
import { runReading } from "@necro/oracle";
import {
  rediagnose,
  type FileResult,
  type RitualInput,
} from "./index.js";

// ---------------------------------------------------------------------------
// Generators — small, pure, synchronous. The async `runReading` call lives in
// the property body (via `fc.asyncProperty`), not in an arbitrary.
// ---------------------------------------------------------------------------

/** A short, filesystem-safe path segment (letters/digits/_/-; never . or ..). */
const arbPathSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
  .filter((s) => s.length > 0 && s !== "." && s !== "..");

/** A relative `.py` file path (1-2 segments). */
const arbPyPath: fc.Arbitrary<string> = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 2 })
  .map((segments) => segments.join("/") + ".py");

/**
 * A small Python source string mixing legacy (py2) and modern constructs so
 * the Judgement detector (and friends) draw varied cards across runs, giving
 * the re-reading a non-trivial vitality to move. Content is tiny and always
 * well under the 1 MB per-file limit. All lines use "\n" only.
 */
const arbPySource: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      'print "legacy"',
      "print('modern')",
      "x = 0L",
      "if a <> b:\n    pass",
      "except Exception, e:\n    pass",
      "value = 42",
      "def f():\n    return None",
      "# a comment",
      "pass",
    ),
    { minLength: 0, maxLength: 6 },
  )
  .map((lines) => (lines.length === 0 ? "pass\n" : lines.join("\n") + "\n"));

/** A 40-hex-char commit sha (drives the spread's deterministic assignment). */
const arbSha: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
  .map((nibbles) => nibbles.map((n) => "0123456789abcdef"[n]).join(""));

const arbRepoRef: fc.Arbitrary<RepoRef> = fc.record({
  owner: arbPathSegment,
  name: arbPathSegment,
  sha: arbSha,
  defaultBranch: fc.constantFrom("main", "master", "develop"),
});

const arbSpread: fc.Arbitrary<SpreadKind> = fc.constantFrom(
  "fates",
  "necropsy",
  "celtic",
);

const arbIsoNow: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2030-01-01T00:00:00Z"),
  })
  .map((d) => d.toISOString());

/**
 * The raw, synchronously-generated seed. The property body turns `files`
 * (path -> py2/py3 source) into a real snapshot + reading via `runReading`,
 * then derives the `FileResult[]` overlay from the SAME path set so overlaid
 * paths line up with real snapshot entries.
 *
 *  - `files`: 1..5 distinct `.py` paths, each with a small source.
 *  - `afters`: for each path, the content to overlay as `after` (another small
 *    py source) plus a `validated` flag; a file is overlaid only when it is
 *    validated AND its `after` differs from its `before` (per `rediagnose`).
 */
interface RediagnoseSeed {
  readonly ref: RepoRef;
  readonly files: ReadonlyArray<{ readonly path: string; readonly source: string }>;
  readonly afters: ReadonlyArray<{
    readonly after: string;
    readonly validated: boolean;
  }>;
  readonly spread: SpreadKind;
  readonly now: string;
}

const arbRediagnoseSeed: fc.Arbitrary<RediagnoseSeed> = fc
  .record({
    ref: arbRepoRef,
    files: fc.uniqueArray(
      fc.record({ path: arbPyPath, source: arbPySource }),
      { minLength: 1, maxLength: 5, selector: (f) => f.path },
    ),
    spread: arbSpread,
    now: arbIsoNow,
  })
  .chain((base) =>
    // One `after`/`validated` pair per file, generated independently of the
    // `before` so both the changed (overlaid) and unchanged/not-validated
    // (not overlaid) cases arise naturally.
    fc
      .record({
        afters: fc.array(
          fc.record({ after: arbPySource, validated: fc.boolean() }),
          { minLength: base.files.length, maxLength: base.files.length },
        ),
      })
      .map(({ afters }) => ({ ...base, afters })),
  );

/** Assemble a `RitualInput` + `FileResult[]` from a seed via a real reading. */
async function buildScenario(
  seed: RediagnoseSeed,
): Promise<{ input: RitualInput; files: readonly FileResult[] }> {
  const fileMap: Record<string, string> = {};
  for (const f of seed.files) fileMap[f.path] = f.source;

  const snapshot = buildSnapshotFromFileMap(seed.ref, fileMap, {
    createdAt: seed.now,
  });

  // The REAL oracle reading over the generated snapshot — a local parse only.
  const reading = await runReading(snapshot, {
    spreadKind: seed.spread,
    now: seed.now,
  });

  const input: RitualInput = {
    pairId: "python2->python3",
    snapshot,
    reading,
    target: { kind: "bare" },
    spread: seed.spread,
    now: seed.now,
    demo: false,
  };

  // Build one FileResult per generated file, pairing each path with its
  // generated `after`/`validated`. These are the only fields `rediagnose`
  // reads for the overlay; `diff`/`residuals`/`fullyConverted` are filled with
  // schema-shaped placeholders the module never inspects.
  const files: FileResult[] = seed.files.map((f, i) => {
    const a = seed.afters[i] ?? { after: f.source, validated: false };
    return {
      path: f.path,
      before: f.source,
      after: a.after,
      diff: [],
      residuals: [],
      fullyConverted: true,
      validated: a.validated,
    };
  });

  return { input, files };
}

describe("P6 (R6.3): Vitality_Delta is consistent with the oracle", () => {
  it("reported delta === computeVitalityDelta(before, after) === after - before", async () => {
    // Initialise the parser once up front. `runReading` also awaits it, but
    // doing so here makes the local-parse dependency explicit and avoids any
    // first-run init cost landing inside the timed property body.
    await initParser();

    await fc.assert(
      fc.asyncProperty(arbRediagnoseSeed, async (seed) => {
        const { input, files } = await buildScenario(seed);
        const result = await rediagnose(input, files);

        if (result.error !== null) {
          // Re-diagnosis failed (R6.5): after/delta are null and the property
          // (which is about the SUCCESS path) does not constrain them. Assert
          // the documented failure shape so a silent success-with-null cannot
          // slip through.
          expect(result.afterVitality).toBeNull();
          expect(result.vitalityDelta).toBeNull();
          return;
        }

        // Success path: after/delta are numbers.
        expect(result.afterVitality).not.toBeNull();
        expect(result.vitalityDelta).not.toBeNull();

        const before = result.beforeVitality;
        const after = result.afterVitality as number;

        // (1) reported delta agrees with the oracle's own computation.
        expect(result.vitalityDelta).toBe(computeVitalityDelta(before, after));
        // (2) and both equal the plain difference after - before (R6.3).
        expect(result.vitalityDelta).toBe(after - before);
      }),
      { numRuns: 200 },
    );
  });

  it("holds when no files are overlaid (all unchanged/not-validated): delta is 0", async () => {
    // A tighter, deterministic corner: when nothing is overlaid the re-reading
    // is over an unchanged snapshot, so after === before and the delta is 0.
    // This pins the identity case independent of detector behaviour.
    await initParser();

    const arbNoOverlay = arbRediagnoseSeed.map((seed) => ({
      ...seed,
      // Force every file to be excluded from the overlay: after === before.
      afters: seed.files.map((f) => ({ after: f.source, validated: true })),
    }));

    await fc.assert(
      fc.asyncProperty(arbNoOverlay, async (seed) => {
        const { input, files } = await buildScenario(seed);
        const result = await rediagnose(input, files);

        // With no changed content the re-reading must settle.
        expect(result.error).toBeNull();
        const before = result.beforeVitality;
        const after = result.afterVitality as number;
        expect(after).toBe(before);
        expect(result.vitalityDelta).toBe(0);
        expect(result.vitalityDelta).toBe(computeVitalityDelta(before, after));
      }),
      { numRuns: 200 },
    );
  });
});
