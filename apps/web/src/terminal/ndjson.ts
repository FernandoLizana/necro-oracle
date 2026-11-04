// apps/web/src/terminal/ndjson.ts
//
// `createNdjsonParser` — the incremental NDJSON line splitter the browser
// reader (`createApiPort.read`) feeds raw response chunks into (design
// "Browser adapters"). It is pure: no network, no DOM, no clock.
//
//   const parser = createNdjsonParser();
//   parser.push(chunk);  // => zero or more complete, StreamLineSchema-validated
//                        //    lines; any partial tail is buffered
//   parser.flush();      // => a final line if the last chunk had no trailing
//                        //    newline, else []
//
// Lines are separated by "\n". Blank (whitespace-only) lines are ignored. Each
// complete line is JSON.parsed and validated against StreamLineSchema; a
// malformed line (invalid JSON, or valid JSON that fails the schema) is
// reported as an error by THROWING synchronously from the push/flush call that
// completed it — the reader turns that throw into `invalidResponseError()`.
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import { type StreamLine, StreamLineSchema } from "../protocol/stream.js";

export interface NdjsonParser {
  /** Feed a raw chunk; returns the complete lines it completed, in order. */
  push(chunk: string): StreamLine[];
  /** End of stream; returns the buffered tail as a final line, or []. */
  flush(): StreamLine[];
}

/** Parse one complete line into a validated StreamLine, throwing on malformed input. */
function parseLine(line: string): StreamLine {
  // JSON.parse throws on invalid JSON; StreamLineSchema.parse throws on a
  // well-formed object that matches none of the four line schemas.
  return StreamLineSchema.parse(JSON.parse(line) as unknown);
}

/**
 * Create a stateful incremental NDJSON parser. A single partial tail is kept
 * between `push` calls; complete lines (terminated by "\n") are validated and
 * returned eagerly.
 */
export function createNdjsonParser(): NdjsonParser {
  let buffer = "";

  return {
    push(chunk: string): StreamLine[] {
      buffer += chunk;
      const lines: StreamLine[] = [];

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

    flush(): StreamLine[] {
      const tail = buffer;
      buffer = "";
      if (tail.trim() === "") {
        return [];
      }
      return [parseLine(tail)];
    },
  };
}
