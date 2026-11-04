// @necro/oracle — property tests for the tree-sitter Python parser (task 11.3).
//
// Property 15: `hasLegacyPythonNodes` is false for clean Python 3.
//
// `arbPythonSource` (packages/oracle/test/arbitraries.ts) generates small,
// py3-valid source strings that contain NONE of the 7 legacy Python 2 construct
// indicators (print_statement, exec_statement, `<>`, long literal, legacy octal,
// backtick repr, `except E, e`). For every such source, parsing and scanning
// with `hasLegacyPythonNodes` must report `false`.
//
// The WASM grammar is initialised once in vitest.setup.ts's beforeAll via
// initParser() (task 10), so parsePython may be called synchronously here with
// no network access (R3.1, R21.5, R21.6). fast-check prints the shrunk
// counterexample and seed on failure by default.
import fc from "fast-check";
import { describe, it } from "vitest";

import { arbPythonSource } from "../../test/arbitraries.js";

import { hasLegacyPythonNodes, parsePython } from "./tree-sitter.js";

describe("P15 (R3.7): hasLegacyPythonNodes is false for clean Python 3", () => {
  // Property 15 — Validates: Requirements R3.7 / Properties: P15
  it("reports no legacy nodes for any clean Python 3 source", () => {
    fc.assert(
      fc.property(arbPythonSource, (src) => {
        const tree = parsePython(src);
        return hasLegacyPythonNodes(tree) === false;
      }),
      { numRuns: 200 },
    );
  });

  // --- Regression examples (permanent counterexamples) -------------------
  //
  // When a counterexample is found by the property above, record it here as a
  // named example test so it is checked forever after. None found yet; this
  // block documents where such regressions live.
});
