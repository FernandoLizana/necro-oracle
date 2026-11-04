// apps/web/src/demo/demo.test.ts
//
// Feature: 03-crt-terminal, task 29.1 example tests for the demo bundle,
// generator and loader.
//
// TEST-FIRST (red). These examples are written against the generator contract
// (`./build-demo.js`) and the loader contract (`./load-bundle.js`) BEFORE task
// 29.2 implements them, so the imports below fail to resolve and the suite is
// RED for the expected reason: those two modules do not exist yet. The fixtures
// they drive (`fixtures/graveyard/{lich-py2,mixed-ruins,green-garden}`) and the
// catalog (`@necro/ui-crt`) are authored/present in task 29.1.
//
// Covers (by example):
//   R18.1  catalog shape (the three Demos) and green-garden strictly highest
//          vitality in the built bundle
//   R18.9  loader schema failure surfaces invalidResponseError (VALIDATION_FAILED)
//   R18.10 loader chunk-load failure surfaces demoUnavailableError (NETWORK_TIMEOUT)
//   R18.8  idle prefetch is best-effort (documented; exercised in 27.2)
//   R18.11 demo evidence paths render as `fixture:<path>` with no link

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Client-safe catalog + the terminal error builders and renderer under test.
import {
  DEMO_CATALOG,
  DEMO_NAME_PATTERN,
  demoUnavailableError,
  invalidResponseError,
  renderReading,
} from "@necro/ui-crt";
import type { ReadingResponse } from "@necro/ui-crt";

import { ReadingResponseSchema } from "../protocol/schemas.js";

// NOT YET IMPLEMENTED — task 29.2 adds these two modules. The imports are the
// source of the expected red.
import { buildDemoBundle } from "./build-demo.js";
import { loadDemoBundle } from "./load-bundle.js";

const FIXTURES_ROOT = fileURLToPath(
  new URL("../../../../fixtures/graveyard/", import.meta.url),
);

// --- R18.1: catalog shape ------------------------------------------------

describe("R18.1: the Demo_Catalog shape", () => {
  it("lists exactly the three Demos in authored order", () => {
    expect(DEMO_CATALOG.map((e) => e.name)).toEqual([
      "lich-py2",
      "mixed-ruins",
      "green-garden",
    ]);
  });

  it("gives every Demo a non-empty description and a valid Demo_Name", () => {
    for (const entry of DEMO_CATALOG) {
      expect(entry.name).toMatch(DEMO_NAME_PATTERN);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

// --- R18.1: green-garden strictly highest vitality -----------------------

describe("R18.1: green-garden has strictly the highest vitality", () => {
  it("beats every other Demo in both the fates and necropsy readings", async () => {
    const bundle = await buildDemoBundle(FIXTURES_ROOT);

    const green = bundle["green-garden"]!;
    const others = DEMO_CATALOG.filter((e) => e.name !== "green-garden").map(
      (e) => bundle[e.name]!,
    );

    for (const spread of ["fates", "necropsy"] as const) {
      const greenVitality = green[spread].reading.vitality;
      for (const other of others) {
        expect(greenVitality).toBeGreaterThan(other[spread].reading.vitality);
      }
    }
  });
});

// --- R18.9 / R18.10: loader error surfaces -------------------------------

describe("R18.10: a demo chunk that fails to load surfaces demoUnavailableError", () => {
  it("the demo-unavailable error is a NETWORK_TIMEOUT telling the user to reload", () => {
    // The loader rejects with this exact builder when the lazy JSON chunk fails
    // to load (R18.10). Asserting the builder contract pins the error the
    // loader must throw; the loader wiring itself lands in 29.2.
    const err = demoUnavailableError();
    expect(err.code).toBe("NETWORK_TIMEOUT");
    expect(err.userMessage.split("\n")[1]?.toLowerCase()).toContain("reload");
  });
});

describe("R18.9: a demo bundle that fails the schema surfaces invalidResponseError", () => {
  it("the invalid-response error is a VALIDATION_FAILED error", () => {
    // The loader validates every entry against ReadingResponseSchema and
    // rejects with this builder on failure (R18.9).
    const err = invalidResponseError();
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.userMessage).toContain("\n");
  });
});

describe("R18.9 / R18.10: loadDemoBundle resolves a schema-valid, demo-flagged bundle", () => {
  it("every entry validates against ReadingResponseSchema with summary.demo === true", async () => {
    const bundle = await loadDemoBundle();
    for (const entry of DEMO_CATALOG) {
      for (const spread of ["fates", "necropsy"] as const) {
        const resp = bundle[entry.name]![spread];
        expect(ReadingResponseSchema.safeParse(resp).success).toBe(true);
        expect(resp.summary.demo).toBe(true);
        expect(resp.summary.ref.owner).toBe("graveyard");
      }
    }
  });

  it("memoises: two calls return the same bundle instance", async () => {
    const [a, b] = await Promise.all([loadDemoBundle(), loadDemoBundle()]);
    expect(a).toBe(b);
  });
});

// --- R18.8: idle prefetch is best-effort ---------------------------------

describe("R18.8: idle prefetch is best-effort", () => {
  // The idle prefetch (requestIdleCallback → ports.demo.load().catch(() => {}))
  // is a one-shot browser interaction wired in TerminalScreen (task 27.2); a
  // failed prefetch is silent and retried on the first `demo <name>`. There is
  // no pure "for all inputs" statement to assert here, so this is documented
  // and exercised by the TerminalScreen tests in 27.2.
  it("is documented as a TerminalScreen concern (see 27.2)", () => {
    expect(typeof loadDemoBundle).toBe("function");
  });
});

// --- R18.11: demo evidence renders as fixture:<path> with no link --------

describe("R18.11: demo paths render as fixture:<path> with no link", () => {
  it("renders evidence paths with a fixture: prefix and no href", async () => {
    const bundle = await buildDemoBundle(FIXTURES_ROOT);
    // lich-py2 draws evidence-bearing cards (judgement et al.) with paths.
    const resp: ReadingResponse = bundle["lich-py2"]!.fates;

    const blocks = renderReading(resp);
    const segments = blocks.flatMap((b) => b.lines.flatMap((l) => l.segments));

    // No rendered segment of a demo reading carries an href (no Evidence_Link).
    expect(segments.every((s) => s.href === undefined)).toBe(true);

    // At least one evidence location is rendered with the `fixture:` prefix.
    const hasFixturePrefix = segments.some((s) => s.text.includes("fixture:"));
    expect(hasFixturePrefix).toBe(true);
  });
});
