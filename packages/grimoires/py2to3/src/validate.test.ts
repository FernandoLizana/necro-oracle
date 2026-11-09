//
// Item 17 (P0.5): `validate` must not ACCEPT lingering Python 2 constructs.
//
// The Target_Parser check counted only ERROR/MISSING nodes. But several py2
// constructs parse CLEANLY (zero error nodes) under the tree-sitter py3
// grammar — a long literal `10L` and a legacy octal `0777` are valid integer
// tokens syntactically — so a file that was NOT actually migrated slipped
// through as "valid Python 3". `validate` must also assert, via the oracle AST
// rule `hasLegacyPythonNodes`, that NO legacy py2 node remains.
//
// Parse-only, local tree-sitter WASM (armed once). No network / LLM / sandbox.
import { hasLegacyPythonNodes, initParser, parsePython } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { validate } from "./validate.js";

beforeAll(async () => {
  await initParser();
});

/** Count ERROR/MISSING nodes directly, to prove these py2 forms parse clean. */
function errorNodes(src: string): number {
  const tree = parsePython(src);
  try {
    let n = 0;
    const cursor = tree.walk();
    try {
      for (;;) {
        const node = cursor.currentNode;
        if (node.type === "ERROR" || node.isError || node.isMissing) n += 1;
        if (cursor.gotoFirstChild()) continue;
        for (;;) {
          if (cursor.gotoNextSibling()) break;
          if (!cursor.gotoParent()) return n;
        }
      }
    } finally {
      cursor.delete();
    }
  } finally {
    tree.delete();
  }
}

describe("Item 17 (R5.1): validate rejects a file that still has py2 constructs", () => {
  // These py2 forms parse with ZERO error nodes under the py3 grammar, yet are
  // flagged by hasLegacyPythonNodes — exactly the gap validate must close.
  const cleanlyParsingPy2: ReadonlyArray<readonly [string, string]> = [
    ["long literal 10L", "x = 10L\n"],
    ["legacy octal 0777", "mode = 0777\n"],
  ];

  for (const [name, src] of cleanlyParsingPy2) {
    it(`rejects ${name} even though it parses with zero error nodes`, () => {
      // Premise: it genuinely parses clean AND is genuinely legacy.
      expect(errorNodes(src)).toBe(0);
      const tree = parsePython(src);
      try {
        expect(hasLegacyPythonNodes(tree)).toBe(true);
      } finally {
        tree.delete();
      }
      // The fix: validate must NOT accept it.
      expect(validate(src).valid).toBe(false);
    });
  }

  it("still ACCEPTS genuinely-converted Python 3", () => {
    const py3 = "def add(a, b):\n    return a + b\n\nprint(add(10, 0o777))\n";
    expect(validate(py3).valid).toBe(true);
  });

  it("still rejects unparseable / py2 print statements (error-node path unchanged)", () => {
    expect(validate("print 'x'\n").valid).toBe(false);
  });
});
