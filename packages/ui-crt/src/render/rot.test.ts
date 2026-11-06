// Feature: visual-necromancy — Rot_Transform example tests (task 5.1).
//
// Concrete edge cases complementing the property tests in `rot.pbt.test.ts`:
// the decay-0 and clamp identities, newline preservation, full corruption at
// decay 1, and the empty / newline-only inputs.

import { describe, expect, it } from "vitest";

import { rot } from "./rot.js";

describe("rot (R6.4, R6.5, R6.12): Rot_Transform", () => {
  it("returns the source unchanged at decay 0", () => {
    const source = "def main():\n    return 42\n";
    expect(rot(source, 0, 1)).toBe(source);
  });

  it("clamps negative decay to the decay-0 identity", () => {
    const source = "import os\n";
    expect(rot(source, -5, 7)).toBe(source);
  });

  it("clamps decay above 1 to the decay-1 result", () => {
    const source = "print 'hello'\n";
    expect(rot(source, 4, 7)).toBe(rot(source, 1, 7));
  });

  it("preserves length and line count and keeps newlines at decay 1", () => {
    const source = "a\nbb\nccc\n";
    const out = rot(source, 1, 123);

    expect(out.length).toBe(source.length);
    expect(out.split("\n").length).toBe(source.split("\n").length);
    // Every original newline is still a newline at the same index.
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") expect(out[i]).toBe("\n");
    }
  });

  it("corrupts every non-newline position at decay 1", () => {
    const source = "abc\ndef";
    const out = rot(source, 1, 9);
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        expect(out[i]).toBe("\n");
      } else {
        expect(out[i]).not.toBe(source[i]);
      }
    }
  });

  it("is a no-op for an empty source and a newline-only source", () => {
    expect(rot("", 1, 3)).toBe("");
    expect(rot("\n\n\n", 1, 3)).toBe("\n\n\n");
  });

  it("is deterministic given the same (source, decay, seed)", () => {
    const source = "x = 1\ny = 2\n";
    expect(rot(source, 0.5, 42)).toBe(rot(source, 0.5, 42));
  });
});
