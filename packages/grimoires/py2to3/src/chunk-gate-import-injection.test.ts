//
// Item 27 (P0.5): hoisted-import injection. The chunk gate hoists each
// `requiredImports` entry VERBATIM to the module top. `isStdlibImportLine`
// validated the MODULE name but, for the `from <mod> import ...` form, did not
// anchor the end of the line — so `from os import path; os.system("...")`
// passed (top module `os` is stdlib) and the trailing `; os.system(...)`
// statement would be injected at the module top on hoist. An import line must
// be PURELY an import: no `;`, no trailing statement, no smuggled code.
//
// Local tree-sitter WASM (armed once). No network / LLM / sandbox.
import { hasLegacyPythonNodes, initParser, parsePython, type Tree } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { acceptChunk, type ChunkEdit } from "./chunk-gate.js";

const diagnose = (tree: Tree): boolean => hasLegacyPythonNodes(tree);
const parse = (src: string): Tree => parsePython(src);

beforeAll(async () => {
  await initParser();
});

// A chunk whose single line is a trivially-convertible py2 print, so a clean
// edit would otherwise be accepted — isolating the import check.
const BEFORE = "print 'x'\n";
const CHUNK_ID = "f.py#1-1";

function edit(requiredImports: string[]): ChunkEdit {
  return {
    chunkId: CHUNK_ID,
    replacementCode: "print('x')",
    requiredImports,
    reason: "convert print",
    confidence: 0.9,
  };
}

describe("Item 27 (R12.5): the gate rejects a smuggled statement in a requiredImports line", () => {
  // Each of these passes the OLD module-name check but carries injected code.
  const injections = [
    "from os import path; os.system('rm -rf /')",
    "import os; os.system('x')",
    "from sys import argv ; exec('evil')",
    "from os import (path)\nimport evil",
    "from os import path #; then\nos.system('x')",
  ];

  for (const line of injections) {
    it(`rejects: ${JSON.stringify(line)}`, () => {
      const result = acceptChunk(BEFORE, edit([line]), diagnose, parse);
      expect(result.status).toBe("reject");
    });
  }

  it("still accepts a clean stdlib from-import", () => {
    // A pure `from os import path` is a legitimate hoistable import.
    const result = acceptChunk(
      "print x\n",
      { ...edit(["from os import path"]), replacementCode: "print(x)" },
      diagnose,
      parse,
    );
    // It is accepted OR rejected for an unrelated reason, but NEVER bad_import.
    if (result.status === "reject") {
      expect(result.reason).not.toBe("bad_import");
    }
  });
});
