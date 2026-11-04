// Demo catalog shape — example tests (TEST-FIRST).
//
// Feature: 03-crt-terminal
// Validates: Requirements R6.1, R18.1
//
// `DEMO_CATALOG` is the fixed Demo_Catalog: the three purpose-built graveyard
// demos the terminal can replay offline — `lich-py2` (a legacy Python 2 repo),
// `mixed-ruins` and `green-garden` (R18.1). `DEMO_NAME_PATTERN` is the
// Demo_Name rule `^[a-z0-9-]{1,32}$`: lowercase letters, digits and hyphens,
// 1–32 chars. Every catalog name satisfies the pattern, and the pattern
// rejects uppercase and over-long names so an unknown `demo <name>` can be
// told apart from a malformed one.
//
// TEST-FIRST (task 14.1): written before `demo/catalog.ts` (task 14.2) exists.
// EXPECTED TO FAIL now — the import of `./catalog.js` cannot resolve. That is
// the correct red.

import { describe, expect, it } from "vitest";

import { DEMO_CATALOG, DEMO_NAME_PATTERN } from "./catalog.js";

/** The fixed Demo_Catalog names, in authored order (R18.1). */
const EXPECTED_NAMES = ["lich-py2", "mixed-ruins", "green-garden"] as const;

describe("R18.1: DEMO_CATALOG is the fixed graveyard demo list", () => {
  it("contains exactly the three named demos in order", () => {
    expect(DEMO_CATALOG.map((entry) => entry.name)).toEqual([...EXPECTED_NAMES]);
  });

  it("gives every entry a name and a non-empty description", () => {
    for (const entry of DEMO_CATALOG) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("uses unique names", () => {
    const names = DEMO_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("R6.1, R18.1: every catalog name matches DEMO_NAME_PATTERN", () => {
  it("accepts each Demo_Catalog name", () => {
    for (const entry of DEMO_CATALOG) {
      expect(entry.name).toMatch(DEMO_NAME_PATTERN);
    }
  });

  it("is the Demo_Name rule ^[a-z0-9-]{1,32}$", () => {
    expect(DEMO_NAME_PATTERN.source).toBe("^[a-z0-9-]{1,32}$");
  });
});

describe("R18.1: DEMO_NAME_PATTERN rejects malformed names", () => {
  it("rejects uppercase letters", () => {
    expect(DEMO_NAME_PATTERN.test("Lich-Py2")).toBe(false);
    expect(DEMO_NAME_PATTERN.test("GREEN-GARDEN")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(DEMO_NAME_PATTERN.test("")).toBe(false);
  });

  it("rejects names longer than 32 characters", () => {
    expect(DEMO_NAME_PATTERN.test("a".repeat(33))).toBe(false);
    expect(DEMO_NAME_PATTERN.test("a".repeat(32))).toBe(true);
  });

  it("rejects disallowed characters (spaces, slashes, underscores, dots)", () => {
    expect(DEMO_NAME_PATTERN.test("lich py2")).toBe(false);
    expect(DEMO_NAME_PATTERN.test("owner/repo")).toBe(false);
    expect(DEMO_NAME_PATTERN.test("lich_py2")).toBe(false);
    expect(DEMO_NAME_PATTERN.test("lich.py2")).toBe(false);
  });
});
