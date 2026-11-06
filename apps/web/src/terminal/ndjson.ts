// apps/web/src/terminal/ndjson.ts
//
// `createNdjsonParser` — the incremental NDJSON line splitter the browser
// readers (`createApiPort.read` and `createApiPort.resurrect`) feed raw
// response chunks into (design "Browser adapters"). It is pure: no network, no
// DOM, no clock.
//
//   const parser = createNdjsonParser();            // reading-stream lines
//   const parser = createNdjsonParser(someSchema);  // any NDJSON line schema
//   parser.push(chunk);  // => zero or more complete, schema-validated lines;
//                        //    any partial tail is buffered
//   parser.flush();      // => a final line if the last chunk had no trailing
//                        //    newline, else []
//
// Lines are separated by "\n". Blank (whitespace-only) lines are ignored. Each
// complete line is JSON.parsed and validated against the supplied line schema
// (defaulting to the Reading_Route `StreamLineSchema`); a malformed line
// (invalid JSON, or valid JSON that fails the schema) is reported as an error
// by THROWING synchronously from the push/flush call that completed it — the
// reader turns that throw into `invalidResponseError()`.
//
// The optional schema argument lets the Resurrection_Route reader reuse the
// exact same line-splitting and error-reporting machinery while validating
// against `ResurrectStreamLineSchema` instead (R9.5, R9.6).
//
// _Requirements: R6.14, R6.18, R12.1, R12.3, R9.5, R9.6_

import type { z } from "zod";

import { type StreamLine, StreamLineSchema } from "../protocol/stream.js";

export interface NdjsonParser<Line> {
  /** Feed a raw chunk; returns the complete lines it completed, in order. */
  push(chunk: string): Line[];
  /** End of stream; returns the buffered tail as a final line, or []. */
  flush(): Line[];
}

/**
 * Create a stateful incremental NDJSON parser. A single partial tail is kept
 * between `push` calls; complete lines (terminated by "\n") are validated
 * against `schema` and returned eagerly. `schema` defaults to the Reading_Route
 * `StreamLineSchema` so existing callers are unchanged; the Resurrection_Route
 * reader passes `ResurrectStreamLineSchema`.
 */
export function createNdjsonParser(): NdjsonParser<StreamLine>;
export function createNdjsonParser<Line>(
  schema: z.ZodType<Line, z.ZodTypeDef, unknown>,
): NdjsonParser<Line>;
export function createNdjsonParser<Line>(
  schema: z.ZodType<Line, z.ZodTypeDef, unknown> = StreamLineSchema as unknown as z.ZodType<
    Line,
    z.ZodTypeDef,
    unknown
  >,
): NdjsonParser<Line> {
  let buffer = "";

  // Parse one complete line into a validated Line, throwing on malformed input.
  // JSON.parse throws on invalid JSON; schema.parse throws on a well-formed
  // object the line schema rejects.
  const parseLine = (line: string): Line =>
    schema.parse(JSON.parse(line) as unknown);

  return {
    push(chunk: string): Line[] {
      buffer += chunk;
      const lines: Line[] = [];

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const raw = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (raw.trim() !== "") {
          lines.push(parseLine(raw));
        }
        newlineIndex = buffer.indexOf("\n");
      }

      return lines;
    },

    flush(): Line[] {
      const tail = buffer;
      buffer = "";
      if (tail.trim() === "") {
        return [];
      }
      return [parseLine(tail)];
    },
  };
}
