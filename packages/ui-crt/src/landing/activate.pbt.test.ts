// packages/ui-crt/src/landing/activate.pbt.test.ts
//
// Feature: oracle-landing-polish, Property 3 + Property 10 for the pure
// selection model's `activate`.
//
// P3 (R5.3): `activate` is a total, pure classifier over a `LandingRow`. For
// any row it returns exactly one of `{kind:"summon-read", ref}` or
// `{kind:"focus-input"}`; it never throws, and the result kind is determined
// solely by `row.kind` (a repo row -> summon-read, the ENTER row ->
// focus-input).
//
// P10 (R5.1, R5.2): the ENTER row focuses the NECRO> input and never summons
// (it carries no ref); a concrete repo row yields summon-read whose ref is
// exactly the repo's ref (which downstream becomes `summon <ref>` then
// `read fates`).
//
// No network / LLM / sandbox: `activate` is a pure function of its input and
// the rows are drawn from in-memory arbitraries / the authored LEGACY_REPOS.
//
// _Requirements: R5.1, R5.2, R5.3_

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { activate, type ActivateResult } from "./selection.js";
import {
  ENTER_ANY_LABEL,
  LEGACY_REPOS,
  LegacyRepoSchema,
  type LandingRow,
  type LegacyRepo,
} from "./repos.js";

// --- arbitraries ------------------------------------------------------------

/** A freshly generated, schema-valid repo (non-empty fields, oracleSays <= 72). */
const arbGeneratedRepo: fc.Arbitrary<LegacyRepo> = fc
  .record({
    ref: fc.string({ minLength: 1 }),
    label: fc.string({ minLength: 1 }),
    tag: fc.string({ minLength: 1 }),
    files: fc.string({ minLength: 1 }),
    oracleSays: fc.string({ minLength: 1, maxLength: 72 }),
  })
  .map((fields) => LegacyRepoSchema.parse(fields));

/** A repo drawn from the three authored LEGACY_REPOS rows. */
const arbAuthoredRepo: fc.Arbitrary<LegacyRepo> = fc.constantFrom(...LEGACY_REPOS);

/** Any concrete repo: generated valid fields or one of the authored rows. */
const arbRepo: fc.Arbitrary<LegacyRepo> = fc.oneof(arbGeneratedRepo, arbAuthoredRepo);

/** A concrete repo row of the landing list. */
const arbRepoRow: fc.Arbitrary<LandingRow> = arbRepo.map((repo) => ({
  kind: "repo" as const,
  repo,
}));

/** The ENTER row (label fixed to the authored affordance). */
const arbEnterRow: fc.Arbitrary<LandingRow> = fc.constant({
  kind: "enter" as const,
  label: ENTER_ANY_LABEL,
});

/** Any landing row: a repo row or the ENTER row. */
const arbLandingRow: fc.Arbitrary<LandingRow> = fc.oneof(arbRepoRow, arbEnterRow);

// --- properties -------------------------------------------------------------

describe("P3 (R5.3): activate maps each row to exactly one effect", () => {
  it("R5.3: for any LandingRow, activate returns exactly one of the two effects and never throws", () => {
    fc.assert(
      fc.property(arbLandingRow, (row) => {
        let result: ActivateResult;
        expect(() => {
          result = activate(row);
        }).not.toThrow();
        // exactly one known kind
        result = activate(row);
        expect(["summon-read", "focus-input"]).toContain(result.kind);
      }),
      { numRuns: 1000 },
    );
  });

  it("R5.3: the result kind is determined solely by row.kind", () => {
    fc.assert(
      fc.property(arbLandingRow, (row) => {
        const result = activate(row);
        if (row.kind === "repo") {
          expect(result.kind).toBe("summon-read");
        } else {
          expect(result.kind).toBe("focus-input");
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe("P10 (R5.1, R5.2): the ENTER row focuses the input and never summons; a concrete repo yields summon-read with its ref", () => {
  it("R5.1: a concrete repo row yields summon-read whose ref is exactly the repo's ref", () => {
    fc.assert(
      fc.property(arbRepoRow, (row) => {
        // narrow for the test: arbRepoRow only ever yields repo rows
        if (row.kind !== "repo") {
          throw new Error("arbRepoRow must only produce repo rows");
        }
        const result = activate(row);
        expect(result).toEqual({ kind: "summon-read", ref: row.repo.ref });
      }),
      { numRuns: 1000 },
    );
  });

  it("R5.2: the ENTER row yields focus-input and carries no ref (never summons)", () => {
    fc.assert(
      fc.property(arbEnterRow, (row) => {
        const result = activate(row);
        expect(result).toEqual({ kind: "focus-input" });
        // focus-input never carries a ref
        expect("ref" in result).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
