// apps/web/src/protocol/resurrect-stream.test.ts
//
// Examples for the Resurrection_Route NDJSON stream line schemas (design:
// "Resurrection NDJSON additions"): ResurrectionPhaseSchema,
// ResurrectPhaseLineSchema, ResurrectResultLineSchema and the
// ResurrectStreamLineSchema union, plus the reuse of SkipNoteLineSchema and
// ErrorLineSchema verbatim.
//
// The result line carries a redaction-safe `RitualResult` wire form (the
// @necro/coven RitualResultSchema). The error line is the two-field
// { error: { code, userMessage } } envelope (no cause).
//
// _Requirements: R9.1, R9.5_

import { describe, expect, it } from "vitest";

import {
  ResurrectionPhaseSchema,
  ResurrectPhaseLineSchema,
  ResurrectResultLineSchema,
  ResurrectStreamLineSchema,
  RitualResultWireSchema,
} from "./resurrect-stream.js";

const RESURRECTION_PHASES = [
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
] as const;

// A minimal, schema-valid RitualResult (mirrors @necro/coven RitualResultSchema).
const validResult = {
  ritualId: "7f3d6b1e-9c2a-4d5e-8b1a-0f2c3d4e5f60",
  selectedCount: 1,
  files: [
    {
      path: "lich.py",
      before: 'print "summoned"\n',
      after: 'print("summoned")\n',
      diff: [
        { kind: "remove", text: 'print "summoned"' },
        { kind: "add", text: 'print("summoned")' },
      ],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch: "--- a/lich.py\n+++ b/lich.py\n",
  beforeVitality: 40,
  afterVitality: 55,
  vitalityDelta: 15,
  changedCards: [{ card: "judgement", change: "severity", improved: true }],
  degraded: false,
  demo: false,
};

describe("R9.1: ResurrectionPhaseSchema", () => {
  it("accepts each of the six ordered phases", () => {
    for (const phase of RESURRECTION_PHASES) {
      expect(ResurrectionPhaseSchema.parse(phase)).toBe(phase);
    }
  });

  it("rejects an unknown phase (the reading phases are not resurrection phases)", () => {
    expect(ResurrectionPhaseSchema.safeParse("SUMMON").success).toBe(false);
    expect(ResurrectionPhaseSchema.safeParse("READING").success).toBe(false);
    expect(ResurrectionPhaseSchema.safeParse("").success).toBe(false);
  });
});

describe("R9.1: ResurrectPhaseLineSchema", () => {
  it("accepts { phase } for each resurrection phase", () => {
    for (const phase of RESURRECTION_PHASES) {
      expect(ResurrectPhaseLineSchema.parse({ phase })).toEqual({ phase });
    }
  });

  it("rejects an unknown phase, a missing phase and extra keys (strict)", () => {
    expect(ResurrectPhaseLineSchema.safeParse({ phase: "SUMMON" }).success).toBe(
      false,
    );
    expect(ResurrectPhaseLineSchema.safeParse({}).success).toBe(false);
    expect(
      ResurrectPhaseLineSchema.safeParse({ phase: "SELECT", note: "x" }).success,
    ).toBe(false);
  });
});

describe("R9.5: RitualResultWireSchema (redaction-safe wire form)", () => {
  it("accepts a field-complete RitualResult", () => {
    expect(RitualResultWireSchema.parse(validResult)).toEqual(validResult);
  });

  it("accepts null afterVitality / vitalityDelta (re-diagnosis failed, R6.5)", () => {
    expect(
      RitualResultWireSchema.safeParse({
        ...validResult,
        afterVitality: null,
        vitalityDelta: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid ritualId and an out-of-range vitality", () => {
    expect(
      RitualResultWireSchema.safeParse({ ...validResult, ritualId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      RitualResultWireSchema.safeParse({ ...validResult, beforeVitality: 101 })
        .success,
    ).toBe(false);
  });
});

describe("R9.5: ResurrectResultLineSchema", () => {
  it("accepts { result } wrapping a valid RitualResult", () => {
    expect(ResurrectResultLineSchema.parse({ result: validResult })).toEqual({
      result: validResult,
    });
  });

  it("rejects an invalid inner result, a missing result and extra keys (strict)", () => {
    expect(
      ResurrectResultLineSchema.safeParse({ result: { selectedCount: 1 } }).success,
    ).toBe(false);
    expect(ResurrectResultLineSchema.safeParse({}).success).toBe(false);
    expect(
      ResurrectResultLineSchema.safeParse({ result: validResult, phase: "DIFF" })
        .success,
    ).toBe(false);
  });
});

describe("R9.1 / R9.5: ResurrectStreamLineSchema (the union)", () => {
  it("accepts a phase line, a skip-note line, a result line and an error line", () => {
    expect(ResurrectStreamLineSchema.safeParse({ phase: "SELECT" }).success).toBe(
      true,
    );
    expect(
      ResurrectStreamLineSchema.safeParse({ skip: true, note: "The sandbox sleeps." })
        .success,
    ).toBe(true);
    expect(
      ResurrectStreamLineSchema.safeParse({ result: validResult }).success,
    ).toBe(true);
    // ErrorLineSchema is reused VERBATIM, so its code set is the oracle
    // NecroError code set (mapError maps coven codes onto these upstream).
    expect(
      ResurrectStreamLineSchema.safeParse({
        error: { code: "VALIDATION_FAILED", userMessage: "The ritual ran long." },
      }).success,
    ).toBe(true);
  });

  it("reuses the two-field error envelope: rejects an error line carrying a cause", () => {
    expect(
      ResurrectStreamLineSchema.safeParse({
        error: {
          code: "VALIDATION_FAILED",
          userMessage: "boom",
          cause: "stack",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a shape that matches none of the four line schemas", () => {
    expect(ResurrectStreamLineSchema.safeParse({}).success).toBe(false);
    expect(
      ResurrectStreamLineSchema.safeParse({ phase: "SELECT", skip: true }).success,
    ).toBe(false);
    expect(ResurrectStreamLineSchema.safeParse({ nonsense: 1 }).success).toBe(
      false,
    );
  });
});
