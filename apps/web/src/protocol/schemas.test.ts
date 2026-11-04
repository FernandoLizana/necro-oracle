// apps/web/src/protocol/schemas.test.ts
//
// Examples for the wire zod schemas (design D2, "Wire schemas"):
//   SummonRequestSchema, ReadingRequestSchema, SummonSummarySchema,
//   ReadingResponseSchema, ErrorEnvelopeSchema.
//
// These schemas live in `apps/web/src/protocol/schemas.ts` (not yet written —
// task 19.2). This test is written first and is EXPECTED TO FAIL for the
// "missing module ./schemas.js" reason until 19.2 implements it (red, then
// green).
//
// The schemas are the HTTP boundary of the readings/summon routes and are
// compile-time conformance-checked against the `@necro/ui-crt` protocol TYPES
// (SummonSummary / ReadingResponse, design D2). The `expectTypeOf` assertions
// below reproduce that conformance at the test level: they fail typecheck if a
// zod schema drifts from the ui-crt interface it must mirror.
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import type { ReadingResponse, SummonSummary } from "@necro/ui-crt";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import {
  ErrorEnvelopeSchema,
  ReadingRequestSchema,
  ReadingResponseSchema,
  SummonRequestSchema,
  SummonSummarySchema,
} from "./schemas.js";

// A valid 40-hex lowercase sha used throughout the examples.
const SHA = "a".repeat(40);

// A minimal, schema-valid SummonSummary payload (field-for-field).
const validSummary = {
  ref: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
  stars: 12,
  hasWorkflowsDir: true,
  degradedFields: ["pulls"],
  cache: "hit",
  fileCount: 7,
  truncated: false,
} as const;

describe("SummonRequestSchema (R12.1, R12.3)", () => {
  it("accepts a repo string of 1..200 chars", () => {
    expect(SummonRequestSchema.parse({ repo: "octocat/hello-world" })).toEqual({
      repo: "octocat/hello-world",
    });
    expect(SummonRequestSchema.safeParse({ repo: "a" }).success).toBe(true);
    expect(SummonRequestSchema.safeParse({ repo: "x".repeat(200) }).success).toBe(true);
  });

  it("rejects an empty repo, an over-long repo, and unknown keys (strict)", () => {
    expect(SummonRequestSchema.safeParse({ repo: "" }).success).toBe(false);
    expect(SummonRequestSchema.safeParse({ repo: "x".repeat(201) }).success).toBe(false);
    expect(
      SummonRequestSchema.safeParse({ repo: "octocat/hello-world", extra: 1 }).success,
    ).toBe(false);
    expect(SummonRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("ReadingRequestSchema (Q15, R12.1, R12.3)", () => {
  it("accepts an owner/name@<40-hex-lowercase-sha> ref with spread fates|necropsy", () => {
    expect(
      ReadingRequestSchema.parse({ ref: `octocat/hello-world@${SHA}`, spread: "fates" }),
    ).toEqual({ ref: `octocat/hello-world@${SHA}`, spread: "fates" });
    expect(
      ReadingRequestSchema.safeParse({ ref: `o/n@${SHA}`, spread: "necropsy" }).success,
    ).toBe(true);
  });

  it("rejects the celtic spread (Q15 — server only plays fates/necropsy)", () => {
    expect(
      ReadingRequestSchema.safeParse({ ref: `octocat/hello-world@${SHA}`, spread: "celtic" })
        .success,
    ).toBe(false);
  });

  it("rejects a ref whose sha is not exactly 40 lowercase hex", () => {
    // too short
    expect(
      ReadingRequestSchema.safeParse({
        ref: `octocat/hello-world@${"a".repeat(39)}`,
        spread: "fates",
      }).success,
    ).toBe(false);
    // too long
    expect(
      ReadingRequestSchema.safeParse({
        ref: `octocat/hello-world@${"a".repeat(41)}`,
        spread: "fates",
      }).success,
    ).toBe(false);
    // uppercase hex is not allowed (must be lowercase)
    expect(
      ReadingRequestSchema.safeParse({
        ref: `octocat/hello-world@${"A".repeat(40)}`,
        spread: "fates",
      }).success,
    ).toBe(false);
    // non-hex characters
    expect(
      ReadingRequestSchema.safeParse({
        ref: `octocat/hello-world@${"g".repeat(40)}`,
        spread: "fates",
      }).success,
    ).toBe(false);
    // missing the @sha segment entirely
    expect(
      ReadingRequestSchema.safeParse({ ref: "octocat/hello-world", spread: "fates" }).success,
    ).toBe(false);
    // missing the owner/name shape
    expect(
      ReadingRequestSchema.safeParse({ ref: `hello-world@${SHA}`, spread: "fates" }).success,
    ).toBe(false);
  });

  it("is strict: rejects unknown keys and a missing spread", () => {
    expect(
      ReadingRequestSchema.safeParse({
        ref: `octocat/hello-world@${SHA}`,
        spread: "fates",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      ReadingRequestSchema.safeParse({ ref: `octocat/hello-world@${SHA}` }).success,
    ).toBe(false);
  });
});

describe("SummonSummarySchema (R5.4-R5.8)", () => {
  it("accepts a field-complete summary with a 40-hex sha", () => {
    expect(SummonSummarySchema.parse(validSummary)).toEqual(validSummary);
  });

  it("accepts the optional demo: true marker", () => {
    expect(
      SummonSummarySchema.safeParse({ ...validSummary, demo: true }).success,
    ).toBe(true);
  });

  it("rejects demo: false (only the literal true is allowed)", () => {
    expect(SummonSummarySchema.safeParse({ ...validSummary, demo: false }).success).toBe(
      false,
    );
  });

  it("rejects a non-40-hex sha, a bad cache value and negative counts", () => {
    expect(
      SummonSummarySchema.safeParse({
        ...validSummary,
        ref: { ...validSummary.ref, sha: "z".repeat(40) },
      }).success,
    ).toBe(false);
    expect(
      SummonSummarySchema.safeParse({ ...validSummary, cache: "stale" }).success,
    ).toBe(false);
    expect(SummonSummarySchema.safeParse({ ...validSummary, stars: -1 }).success).toBe(false);
    expect(
      SummonSummarySchema.safeParse({ ...validSummary, fileCount: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown degradedFields entry and unknown keys (strict)", () => {
    expect(
      SummonSummarySchema.safeParse({ ...validSummary, degradedFields: ["commits"] }).success,
    ).toBe(false);
    expect(
      SummonSummarySchema.safeParse({ ...validSummary, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("ReadingResponseSchema (R6.18)", () => {
  it("rejects a response missing the reading field (strict object)", () => {
    expect(ReadingResponseSchema.safeParse({ summary: validSummary }).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(
      ReadingResponseSchema.safeParse({ summary: validSummary, reading: {}, extra: 1 }).success,
    ).toBe(false);
  });

  it("requires a valid inner reading (an empty object is not a Reading)", () => {
    expect(
      ReadingResponseSchema.safeParse({ summary: validSummary, reading: {} }).success,
    ).toBe(false);
  });
});

describe("ErrorEnvelopeSchema (R11.x envelope)", () => {
  it("accepts { error: { code, userMessage } } with a known NecroError code", () => {
    expect(
      ErrorEnvelopeSchema.parse({
        error: { code: "VALIDATION_FAILED", userMessage: "The sigil is malformed." },
      }),
    ).toEqual({ error: { code: "VALIDATION_FAILED", userMessage: "The sigil is malformed." } });
  });

  it("rejects an unknown code, an empty userMessage and any extra key (no cause)", () => {
    expect(
      ErrorEnvelopeSchema.safeParse({ error: { code: "NOPE", userMessage: "x" } }).success,
    ).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: { code: "VALIDATION_FAILED", userMessage: "" },
      }).success,
    ).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: {
          code: "VALIDATION_FAILED",
          userMessage: "boom",
          cause: "stack",
        },
      }).success,
    ).toBe(false);
  });
});

describe("compile-time conformance with @necro/ui-crt types (D2)", () => {
  it("SummonSummarySchema infers exactly the SummonSummary interface", () => {
    expectTypeOf<z.infer<typeof SummonSummarySchema>>().toEqualTypeOf<SummonSummary>();
  });

  it("ReadingResponseSchema infers exactly the ReadingResponse interface", () => {
    expectTypeOf<z.infer<typeof ReadingResponseSchema>>().toEqualTypeOf<ReadingResponse>();
  });
});
