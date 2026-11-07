// @vitest-environment jsdom
//
// LoversView — axe zero-violation accessibility test (lovers-binding task 14.5).
//
// Validates: Requirements 30.1, 30.3
//
// R30.1: WHILE the Lovers_View is rendered, it reports ZERO axe violations.
// R30.3: the new surfaces expose accessible names and an `aria-live` status
//        region (every typed command is also a clickable chip — that chip
//        coverage is asserted in the ui-crt ButtonRow axe test, task 14.5).
//
// This renders the REAL `LoversView` (the DMG split view) with representative
// props across BOTH `soulSource` values (ORACLE / YOURS) and BOTH `path` values
// (llm / template), and asserts axe finds no violations and that the accessible
// landmarks the tarot-ux rule requires are present: a named region, named code
// panes, a named download control, and an `aria-live` status region.
//
// HONEST LIMITATION: jest-axe is a PROGRAMMATIC check. axe-core turns OFF its
// color-contrast rule under jsdom (jsdom computes no real layout or color), so
// the >= 4.5:1 contrast floor (R30.3) is NOT verified here — it is covered by
// the palette property test (`lovers-view-palette.pbt.test.ts`) and the browser
// axe e2e (`apps/web/e2e/*.e2e.ts`, `@axe-core/playwright`). Full WCAG
// conformance still needs manual testing with real assistive technologies.

import { cleanup, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import type { LoversResult } from "@necro/coven";

import { LoversView } from "./LoversView.js";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});

/**
 * A representative, redaction-safe `LoversResult` for rendering. The code
 * bodies are short but real (they parse), the plan names one bindable function,
 * and the usage aggregate is a plain non-secret figure.
 */
function makeResult(
  overrides: Partial<Pick<LoversResult, "path" | "soulSource">> = {},
): LoversResult {
  const soulSource = overrides.soulSource ?? "ORACLE";
  return {
    file: "src/mathlib.py",
    targetLang: "javascript",
    path: overrides.path ?? "llm",
    soulSource,
    demo: false,
    plan: {
      functions: [
        {
          name: "add",
          params: [
            { name: "a", pyType: "int", jsonType: "integer", jsType: "number", required: true },
            { name: "b", pyType: "int", jsonType: "integer", jsType: "number", required: true },
          ],
          returns: { pyType: "int", jsonType: "integer", jsType: "number" },
          bindable: true,
          edgeCases: ["a=0,b=0", "negatives"],
        },
      ],
      typeMap: [{ py: "int", json: "integer", js: "number" }],
    },
    pair: {
      pythonHeart: "import sys, json\n\ndef handle(request):\n    return {'id': request['id'], 'ok': True, 'value': 0}\n",
      jsBeloved: "export function createClient() {\n  return { add: async (a, b) => a + b };\n}\n",
      contractSchema:
        '{"$schema":"https://json-schema.org/draft/2020-12/schema","$defs":{"add.request":{},"add.response":{}}}',
      pythonTests: "import unittest\n\nclass T(unittest.TestCase):\n    pass\n",
      jsTests: "import test from 'node:test';\n",
    },
    soulsSpent: {
      promptTokens: 120,
      completionTokens: 340,
      costUsd: 0.0021,
      soulSource,
      byModel: [
        {
          model: "demo/mock",
          promptTokens: 120,
          completionTokens: 340,
          costUsd: 0.0021,
        },
      ],
    },
  };
}

// Every combination of the two props that change what the view narrates:
// soulSource drives the attribution text, path drives the "bound via" phrase.
const CASES: ReadonlyArray<{
  readonly soulSource: LoversResult["soulSource"];
  readonly path: LoversResult["path"];
}> = [
  { soulSource: "ORACLE", path: "llm" },
  { soulSource: "ORACLE", path: "template" },
  { soulSource: "YOURS", path: "llm" },
  { soulSource: "YOURS", path: "template" },
];

describe("30.1 / 30.3 (R30.1, R30.3): LoversView reports zero axe violations", () => {
  for (const { soulSource, path } of CASES) {
    it(`has no axe violations (soulSource=${soulSource}, path=${path})`, async () => {
      const { container } = render(
        <LoversView result={makeResult({ soulSource, path })} />,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  }

  it("exposes the region, pane, and download accessible names (R30.3)", () => {
    const { getByRole } = render(<LoversView result={makeResult()} />);

    // A named region landmark for the whole binding.
    expect(getByRole("region", { name: "The Lovers binding" })).toBeInTheDocument();

    // Each code pane is a named region (the pane title is its accessible name).
    expect(getByRole("region", { name: "PYTHON HEART" })).toBeInTheDocument();
    expect(getByRole("region", { name: "CONTRACT" })).toBeInTheDocument();
    expect(getByRole("region", { name: "JS BELOVED" })).toBeInTheDocument();

    // The download control carries an explicit accessible name, not just glyph
    // text that changes while working.
    expect(
      getByRole("button", { name: "Download the bound pair as a ZIP" }),
    ).toBeInTheDocument();
  });

  it("renders an aria-live status region for the download state (R30.3)", () => {
    const { container } = render(<LoversView result={makeResult()} />);

    // The download status line is a polite live region so a screen reader
    // announces "sealed / yours / slipped" without moving focus.
    const live = container.querySelector(
      ".crt-lovers-download-status[aria-live='polite']",
    );
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("role", "status");
  });
});
