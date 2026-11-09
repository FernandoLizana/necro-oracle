// @necro/oracle — Item 1 (judge-ready-pass): lazy per-language grammar init.
//
// Production bug: `initParser` used to load the Python AND JavaScript grammars
// in one shared try. On Vercel the readings/resurrect serverless functions do
// not package `tree-sitter-javascript.wasm`, so that shared init threw
// PARSER_INIT_FAILED and `parsePython` was impossible — even though those
// routes only ever parse Python.
//
// The fix splits init per language: `initParser()` arms the runtime + Python
// grammar ONLY; `initJavascript()` arms the JS grammar separately, and only the
// Lovers flow calls it. This smoke proves both halves against the REAL
// tree-sitter WASM (no mock): after `initParser()` Python parses to a `module`
// root, and after `initJavascript()` JavaScript parses to a `program` root. A
// mocked parser would not prove the real wasm loaded, so this uses the real
// grammars the setup/this test arm from disk.
//
// The route-level guarantee (readings/resurrect never load the JS wasm) is
// enforced structurally by `check:wasm-trace` + the fact that only the Lovers
// runner calls `initJavascript()`; this test proves the oracle API half.

import { beforeAll, describe, expect, it } from "vitest";

import { initJavascript, initParser, parseJavascript, parsePython } from "./tree-sitter.js";

describe("Item 1: initParser arms Python without the JavaScript grammar", () => {
  beforeAll(async () => {
    // The global setup already calls initParser(); calling again is idempotent.
    await initParser();
  });

  it("parses Python to a module root after Python-only init", () => {
    const tree = parsePython("print('hi')\nx = 1\n");
    expect(tree.rootNode.type).toBe("module");
    tree.delete();
  });

  it("parses legacy Python 2 to a module root (readings/resurrect path)", () => {
    const tree = parsePython("print 'hi'\nexcept E, e:\n    pass\n");
    expect(tree.rootNode.type).toBe("module");
    tree.delete();
  });
});

describe("Item 1: initJavascript arms the JS grammar separately", () => {
  beforeAll(async () => {
    await initJavascript();
  });

  it("parses JavaScript to a program root after the separate JS init", () => {
    const tree = parseJavascript("export function f(x){ return x; }\n");
    expect(tree.rootNode.type).toBe("program");
    tree.delete();
  });

  it("initJavascript is idempotent (second call resolves, parse still works)", async () => {
    await initJavascript();
    const tree = parseJavascript("const y = 2;\n");
    expect(tree.rootNode.type).toBe("program");
    tree.delete();
  });
});
