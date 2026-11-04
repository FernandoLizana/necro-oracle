// apps/web/src/terminal/ndjson.test.ts
//
// Examples for the incremental NDJSON line splitter `createNdjsonParser`
// (design "Browser adapters"):
//
//   export function createNdjsonParser(): {
//     push(chunk: string): StreamLine[];   // zero or more complete, zod-validated lines; buffers a partial tail
//     flush(): StreamLine[];               // a final line if the last chunk had no trailing newline
//   };
//
// The module lives at `apps/web/src/terminal/ndjson.ts` (not yet written —
// task 19.2). Written first; EXPECTED TO FAIL for "missing module ./ndjson.js"
// until 19.2 implements it (red, then green).
//
// API decision recorded for 19.2: `push`/`flush` return the array of complete,
// StreamLineSchema-validated lines seen so far and buffer any partial tail.
// A malformed line (not valid JSON, or valid JSON that fails StreamLineSchema)
// is REPORTED AS AN ERROR by THROWING synchronously from the `push`/`flush`
// call that completed that line — this is the "reported as an error" behaviour
// the reader (`createApiPort.read`) turns into `invalidResponseError()`.
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import { describe, expect, it } from "vitest";

import { createNdjsonParser } from "./ndjson.js";

const SHA = "a".repeat(40);

const phaseLine = (phase: string): string => JSON.stringify({ phase });
const skipLine = (note: string): string => JSON.stringify({ skip: true, note });

const validResult = {
  result: {
    summary: {
      ref: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
      stars: 1,
      hasWorkflowsDir: false,
      degradedFields: [],
      cache: "miss",
      fileCount: 2,
      truncated: false,
    },
    reading: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      repo: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
      draws: [],
      spread: [{ position: 1, label: "The Corpse", draw: null, description: "still" }],
      vitality: 10,
      createdAt: "2026-01-15T12:00:00.000Z",
      engineVersion: "0.0.0",
      errors: [],
    },
  },
};

describe("createNdjsonParser", () => {
  it("reassembles one line split across several push chunks", () => {
    const parser = createNdjsonParser();
    const whole = `${phaseLine("SUMMON")}\n`;
    // Split the single line into three pieces, none ending in a newline until
    // the last chunk.
    const a = whole.slice(0, 5);
    const b = whole.slice(5, 11);
    const c = whole.slice(11);

    expect(parser.push(a)).toEqual([]);
    expect(parser.push(b)).toEqual([]);
    expect(parser.push(c)).toEqual([{ phase: "SUMMON" }]);
  });

  it("yields multiple complete lines from a single chunk, in order", () => {
    const parser = createNdjsonParser();
    const chunk = `${phaseLine("SUMMON")}\n${phaseLine("DOWNLOAD")}\n${skipLine("slow")}\n`;

    expect(parser.push(chunk)).toEqual([
      { phase: "SUMMON" },
      { phase: "DOWNLOAD" },
      { skip: true, note: "slow" },
    ]);
  });

  it("buffers a chunk with no trailing newline until flush completes the line", () => {
    const parser = createNdjsonParser();
    // A complete line, then a partial line with no trailing newline.
    const chunk = `${phaseLine("EXTERNAL")}\n${JSON.stringify(validResult)}`;

    expect(parser.push(chunk)).toEqual([{ phase: "EXTERNAL" }]);
    // The buffered tail is only emitted on flush (end of stream).
    expect(parser.flush()).toEqual([validResult]);
  });

  it("emits nothing from flush when the buffer is empty (trailing newline case)", () => {
    const parser = createNdjsonParser();
    expect(parser.push(`${phaseLine("READING")}\n`)).toEqual([{ phase: "READING" }]);
    expect(parser.flush()).toEqual([]);
  });

  it("ignores blank lines between complete lines", () => {
    const parser = createNdjsonParser();
    const chunk = `${phaseLine("SUMMON")}\n\n${phaseLine("DOWNLOAD")}\n`;
    expect(parser.push(chunk)).toEqual([{ phase: "SUMMON" }, { phase: "DOWNLOAD" }]);
  });

  it("reports a malformed line (invalid JSON) as an error by throwing from push", () => {
    const parser = createNdjsonParser();
    expect(() => parser.push("this is not json\n")).toThrow();
  });

  it("reports a well-formed JSON line that fails StreamLineSchema as an error", () => {
    const parser = createNdjsonParser();
    // Valid JSON, but matches none of the four line schemas.
    expect(() => parser.push(`${JSON.stringify({ phase: "PARSING" })}\n`)).toThrow();
  });

  it("reports a malformed buffered tail as an error on flush", () => {
    const parser = createNdjsonParser();
    expect(parser.push(`${phaseLine("SUMMON")}\n`)).toEqual([{ phase: "SUMMON" }]);
    parser.push("{not: valid json");
    expect(() => parser.flush()).toThrow();
  });
});
