// Feature: 02-github-summoner, Property 22: Binary classification
import { describe, it } from "vitest";
import fc from "fast-check";
import { isBinarySample } from "./entry-path.js";

const SNIFF = 8000;

// Bytes that are never NUL.
const arbNonNulByte = fc.integer({ min: 1, max: 255 });

describe("P22 (R3.6): binary iff a NUL byte occurs within the first 8000 bytes", () => {
  it("classifies by NUL position", () => {
    fc.assert(
      fc.property(
        fc.array(arbNonNulByte, { minLength: 0, maxLength: 9000 }),
        fc.integer({ min: 0, max: 9000 }),
        fc.boolean(),
        (bytes, pos, insertNul) => {
          const buf = Uint8Array.from(bytes);
          if (insertNul && buf.length > 0) buf[pos % buf.length] = 0;
          const firstNul = buf.indexOf(0);
          const expected = firstNul !== -1 && firstNul < SNIFF;
          return isBinarySample(buf) === expected;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("NUL only at offset >= 8000 is text; NUL at any offset < 8000 is binary", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8999 }),
        fc.integer({ min: 1, max: 255 }),
        (p, fill) => {
          const buf = new Uint8Array(9000).fill(fill);
          buf[p] = 0;
          return isBinarySample(buf) === p < SNIFF;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
