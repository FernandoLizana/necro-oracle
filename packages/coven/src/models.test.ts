// Unit tests for the coven data-model schemas (task 1.3).
//
// Same-package tests import the module under test directly (./models.js);
// the cross-package barrel (src/index.ts) is only for other packages.
//
// Coverage:
//  - ResidualEntrySchema.reason accepts each documented reason and rejects
//    others (R8.1).
//  - RitualResultSchema nullability of afterVitality / vitalityDelta: null is
//    accepted (re-diagnosis failed, R6.5) and valid numbers pass; out-of-range
//    and non-integer values are rejected (R8.3 well-formedness).

import { describe, expect, it } from "vitest";

import { ResidualEntrySchema, RitualResultSchema } from "./models.js";

// The seven documented reasons, kept in sync with ResidualEntrySchema (design:
// "ResidualEntry"). Any divergence here surfaces as a failing test.
const DOCUMENTED_REASONS = [
  "parse_failed",
  "no_transform",
  "llm_unavailable",
  "llm_invalid_output",
  "output_unparseable",
  "not_validated",
  "incomplete",
] as const;

/** A valid ResidualEntry body with a swappable `reason`. */
function residual(reason: string) {
  return {
    path: "pkg/legacy.py",
    line: 12,
    construct: "print statement",
    reason,
  };
}

/** A fully valid RitualResult with swappable vitality fields. */
function ritualResult(overrides: Record<string, unknown> = {}) {
  return {
    ritualId: "7f3d6b1e-9c2a-4d5e-8b1a-0f2c3d4e5f60",
    selectedCount: 2,
    files: [],
    patch: "",
    beforeVitality: 40,
    afterVitality: 55,
    vitalityDelta: 15,
    changedCards: [],
    degraded: false,
    demo: false,
    ...overrides,
  };
}

describe("R8.1: ResidualEntrySchema.reason enum", () => {
  it.each(DOCUMENTED_REASONS)("accepts documented reason %s", (reason) => {
    const parsed = ResidualEntrySchema.parse(residual(reason));
    expect(parsed.reason).toBe(reason);
  });

  it.each([
    "unknown",
    "PARSE_FAILED", // case-sensitive: uppercase is not a member
    "parse-failed", // hyphen, not underscore
    "", // empty string
    "timeout", // plausible-but-undocumented
  ])("rejects undocumented reason %j", (reason) => {
    expect(ResidualEntrySchema.safeParse(residual(reason)).success).toBe(false);
  });

  it("rejects a missing reason field", () => {
    const body = residual("parse_failed") as Record<string, unknown>;
    delete body.reason;
    expect(ResidualEntrySchema.safeParse(body).success).toBe(false);
  });

  it("exposes exactly the seven documented reasons as enum options", () => {
    expect([...ResidualEntrySchema.shape.reason.options].sort()).toEqual(
      [...DOCUMENTED_REASONS].sort(),
    );
  });
});

describe("R6.5 / R8.3: RitualResultSchema vitality nullability", () => {
  it("accepts numeric afterVitality and vitalityDelta", () => {
    const parsed = RitualResultSchema.parse(ritualResult());
    expect(parsed.afterVitality).toBe(55);
    expect(parsed.vitalityDelta).toBe(15);
  });

  it("accepts null afterVitality and vitalityDelta (re-diagnosis failed)", () => {
    const parsed = RitualResultSchema.parse(
      ritualResult({ afterVitality: null, vitalityDelta: null }),
    );
    expect(parsed.afterVitality).toBeNull();
    expect(parsed.vitalityDelta).toBeNull();
  });

  it("accepts a negative vitalityDelta (vitality can drop)", () => {
    const parsed = RitualResultSchema.parse(
      ritualResult({ afterVitality: 30, vitalityDelta: -10 }),
    );
    expect(parsed.vitalityDelta).toBe(-10);
  });

  it("rejects a missing afterVitality (null must be explicit, not absent)", () => {
    const body = ritualResult() as Record<string, unknown>;
    delete body.afterVitality;
    expect(RitualResultSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a missing vitalityDelta", () => {
    const body = ritualResult() as Record<string, unknown>;
    delete body.vitalityDelta;
    expect(RitualResultSchema.safeParse(body).success).toBe(false);
  });

  it.each([-1, 101, 55.5])(
    "rejects out-of-range / non-integer afterVitality %p",
    (afterVitality) => {
      expect(
        RitualResultSchema.safeParse(ritualResult({ afterVitality })).success,
      ).toBe(false);
    },
  );

  it("rejects a non-integer vitalityDelta", () => {
    expect(
      RitualResultSchema.safeParse(ritualResult({ vitalityDelta: 1.5 })).success,
    ).toBe(false);
  });

  it("requires beforeVitality to be non-null (only after/delta are nullable)", () => {
    expect(
      RitualResultSchema.safeParse(ritualResult({ beforeVitality: null }))
        .success,
    ).toBe(false);
  });
});
