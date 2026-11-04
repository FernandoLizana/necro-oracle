// @necro/oracle — unit tests for the tree-sitter Python parser (task 11.1).
//
// TEST-FIRST: these tests are written against the full parser API described in
// design.md (parsePython / queryPython / hasLegacyPythonNodes) BEFORE the real
// implementation exists (task 11.2). They are EXPECTED TO BE RED until 11.2
// replaces the typed stubs in tree-sitter.ts with the real logic.
//
// The WASM grammar is initialised once in vitest.setup.ts's beforeAll via
// initParser() (task 10), so parsePython may be called synchronously here with
// no network access (R3.1, R21.5, R21.6).
import { describe, expect, it } from "vitest";

import { NecroError } from "../util/errors.js";

import {
  hasLegacyPythonNodes,
  parsePython,
  queryPython,
} from "./tree-sitter.js";

// --- parsePython ---------------------------------------------------------

describe("parsePython (R3.1, R3.3, R3.6)", () => {
  it("returns a module-root Tree for valid Python 3 source", () => {
    const tree = parsePython("def greet(name):\n    return f'hi {name}'\n");
    expect(tree.rootNode.type).toBe("module");
  });

  it("returns a module-root Tree for valid Python 2 source", () => {
    const tree = parsePython("print 'hello'\nx = 10L\n");
    expect(tree.rootNode.type).toBe("module");
  });

  it("returns a best-effort non-null tree for invalid UTF-8 (never throws on bad bytes)", () => {
    // Lone surrogate / replacement-prone bytes must not throw; parser is
    // best-effort and still yields a tree (R3.4).
    const badUtf8 = "x = '\uD800'\n"; // lone high surrogate
    expect(() => parsePython(badUtf8)).not.toThrow();
    const tree = parsePython(badUtf8);
    expect(tree).not.toBeNull();
    expect(tree.rootNode).toBeDefined();
  });

  it("throws NecroError(FILE_TOO_LARGE) when source byte length exceeds 1 MB (R3.6)", () => {
    // 1_048_576 is the limit; one byte over must throw.
    const tooBig = "#".repeat(1_048_576 + 1);
    expect(() => parsePython(tooBig)).toThrowError(NecroError);
    try {
      parsePython(tooBig);
      expect.unreachable("parsePython should have thrown FILE_TOO_LARGE");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("accepts source exactly at the 1 MB boundary", () => {
    const atLimit = "#".repeat(1_048_576);
    expect(() => parsePython(atLimit)).not.toThrow();
  });
});

// --- queryPython ---------------------------------------------------------

describe("queryPython (R3.5)", () => {
  it("returns matches for a valid S-expression pattern", () => {
    const tree = parsePython("x = 1\ny = 2\n");
    const matches = queryPython(tree, "(assignment) @a");
    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("throws NecroError(INVALID_QUERY_PATTERN) for an invalid S-expression (R3.5)", () => {
    const tree = parsePython("x = 1\n");
    expect(() => queryPython(tree, "(this is not valid")).toThrowError(NecroError);
    try {
      queryPython(tree, "(this is not valid");
      expect.unreachable("queryPython should have thrown INVALID_QUERY_PATTERN");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("INVALID_QUERY_PATTERN");
    }
  });
});

// --- hasLegacyPythonNodes ------------------------------------------------

describe("hasLegacyPythonNodes — legacy Python 2 indicators (R3.7, R3.8)", () => {
  // Each case covers one of the 7 legacy construct indicators from design.md.
  const legacyCases: ReadonlyArray<readonly [string, string]> = [
    ["print_statement", "print 'hello world'\n"],
    ["exec_statement", "exec 'x = 1'\n"],
    ["except E, e (comma-style except)", "try:\n    pass\nexcept Exception, e:\n    pass\n"],
    ["<> inequality operator", "if 1 <> 2:\n    pass\n"],
    ["long literal 10L (/[Ll]$/)", "x = 10L\n"],
    ["legacy octal 0777 (/^0[0-7]+$/)", "mode = 0777\n"],
    ["backtick repr `x` (ERROR-node fallback)", "x = 1\ny = `x`\n"],
  ];

  for (const [label, source] of legacyCases) {
    it(`returns true for ${label}`, () => {
      const tree = parsePython(source);
      expect(hasLegacyPythonNodes(tree)).toBe(true);
    });
  }

  it("returns false for clean Python 3 source (R3.7)", () => {
    const clean =
      "from __future__ import annotations\n\n" +
      "def add(a: int, b: int) -> int:\n" +
      "    result = a + b\n" +
      "    print(result)\n" +
      "    return result\n\n" +
      "class Greeter:\n" +
      "    def __init__(self, name: str) -> None:\n" +
      "        self.name = name\n\n" +
      "    def greet(self) -> str:\n" +
      "        return f'hi {self.name}'\n";
    const tree = parsePython(clean);
    expect(hasLegacyPythonNodes(tree)).toBe(false);
  });

  it("returns false for an octal that uses the py3 0o form", () => {
    const tree = parsePython("mode = 0o777\n");
    expect(hasLegacyPythonNodes(tree)).toBe(false);
  });

  it("returns false for a plain integer literal that is not a long or legacy octal", () => {
    const tree = parsePython("x = 10\ny = 0\n");
    expect(hasLegacyPythonNodes(tree)).toBe(false);
  });
});
