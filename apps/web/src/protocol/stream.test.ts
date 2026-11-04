// apps/web/src/protocol/stream.test.ts
//
// Examples for the NDJSON stream line schemas (design "Streamed progress and
// time budgets", D13): PhaseLineSchema, SkipNoteLineSchema, ResultLineSchema,
// ErrorLineSchema and the StreamLineSchema union.
//
// These schemas live in `apps/web/src/protocol/stream.ts` (not yet written —
// task 19.2). Written first; EXPECTED TO FAIL for "missing module ./stream.js"
// until 19.2 implements it (red, then green).
//
// Each non-final line of the Reading_Route body is a Progress_Event
// (PhaseLine) or a skip-note (SkipNoteLine); the final line is either
// { result: Reading_Response } or { error: Error_Envelope }. Only the result
// line carries a validated Reading_Response.
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import { describe, expect, it } from "vitest";

import {
  ErrorLineSchema,
  PhaseLineSchema,
  ResultLineSchema,
  SkipNoteLineSchema,
  StreamLineSchema,
} from "./stream.js";

const SHA = "a".repeat(40);

const validSummary = {
  ref: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
  stars: 3,
  hasWorkflowsDir: false,
  degradedFields: [] as const,
  cache: "miss",
  fileCount: 4,
  truncated: false,
} as const;

// A minimal schema-valid oracle Reading (see @necro/oracle ReadingSchema).
const validReading = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  repo: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
  draws: [] as const,
  spread: [
    { position: 1, label: "The Corpse", draw: null, description: "nothing stirs" },
  ],
  vitality: 42,
  createdAt: "2026-01-15T12:00:00.000Z",
  engineVersion: "0.0.0",
  errors: [] as const,
};

const validResult = { result: { summary: validSummary, reading: validReading } };

describe("PhaseLineSchema", () => {
  it("accepts each of the four phases", () => {
    for (const phase of ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"] as const) {
      expect(PhaseLineSchema.parse({ phase })).toEqual({ phase });
    }
  });

  it("rejects an unknown phase, a missing phase and extra keys (strict)", () => {
    expect(PhaseLineSchema.safeParse({ phase: "PARSING" }).success).toBe(false);
    expect(PhaseLineSchema.safeParse({}).success).toBe(false);
    expect(PhaseLineSchema.safeParse({ phase: "SUMMON", note: "x" }).success).toBe(false);
  });
});

describe("SkipNoteLineSchema", () => {
  it("accepts { skip: true, note } with a 1..2000 char note", () => {
    expect(SkipNoteLineSchema.parse({ skip: true, note: "The spirits are slow." })).toEqual({
      skip: true,
      note: "The spirits are slow.",
    });
    expect(
      SkipNoteLineSchema.safeParse({ skip: true, note: "x".repeat(2000) }).success,
    ).toBe(true);
  });

  it("rejects skip !== true, an empty/over-long note and extra keys (strict)", () => {
    expect(SkipNoteLineSchema.safeParse({ skip: false, note: "x" }).success).toBe(false);
    expect(SkipNoteLineSchema.safeParse({ skip: true, note: "" }).success).toBe(false);
    expect(
      SkipNoteLineSchema.safeParse({ skip: true, note: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      SkipNoteLineSchema.safeParse({ skip: true, note: "ok", phase: "SUMMON" }).success,
    ).toBe(false);
  });
});

describe("ResultLineSchema", () => {
  it("accepts { result } wrapping a valid Reading_Response", () => {
    expect(ResultLineSchema.parse(validResult)).toEqual(validResult);
  });

  it("rejects an invalid inner reading, a missing result and extra keys (strict)", () => {
    expect(ResultLineSchema.safeParse({ result: { summary: validSummary } }).success).toBe(
      false,
    );
    expect(ResultLineSchema.safeParse({}).success).toBe(false);
    expect(
      ResultLineSchema.safeParse({ ...validResult, phase: "READING" }).success,
    ).toBe(false);
  });
});

describe("ErrorLineSchema", () => {
  it("accepts { error: { code, userMessage } } (the Error_Envelope error object)", () => {
    const line = { error: { code: "NETWORK_TIMEOUT", userMessage: "The veil went dark." } };
    expect(ErrorLineSchema.parse(line)).toEqual(line);
  });

  it("rejects an unknown code, empty userMessage and extra keys (strict)", () => {
    expect(
      ErrorLineSchema.safeParse({ error: { code: "???", userMessage: "x" } }).success,
    ).toBe(false);
    expect(
      ErrorLineSchema.safeParse({ error: { code: "NETWORK_TIMEOUT", userMessage: "" } }).success,
    ).toBe(false);
    expect(
      ErrorLineSchema.safeParse({
        error: { code: "NETWORK_TIMEOUT", userMessage: "x" },
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe("StreamLineSchema (the union)", () => {
  it("accepts a phase line, a skip-note line, a result line and an error line", () => {
    expect(StreamLineSchema.safeParse({ phase: "SUMMON" }).success).toBe(true);
    expect(StreamLineSchema.safeParse({ skip: true, note: "slow" }).success).toBe(true);
    expect(StreamLineSchema.safeParse(validResult).success).toBe(true);
    expect(
      StreamLineSchema.safeParse({
        error: { code: "RATE_LIMITED", userMessage: "rest" },
      }).success,
    ).toBe(true);
  });

  it("rejects a shape that matches none of the four line schemas", () => {
    expect(StreamLineSchema.safeParse({}).success).toBe(false);
    expect(StreamLineSchema.safeParse({ phase: "SUMMON", skip: true }).success).toBe(false);
    expect(StreamLineSchema.safeParse({ nonsense: 1 }).success).toBe(false);
  });
});
