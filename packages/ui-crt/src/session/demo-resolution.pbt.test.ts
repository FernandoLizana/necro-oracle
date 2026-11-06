// src/session/demo-resolution.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 25: demo command resolution
//
// Property-based tests for how the session reducer resolves the `demo` command
// (task 15.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `session/state.ts` and
// `session/reducer.ts` (task 15.2), so the imports below fail to resolve and
// the whole suite is red for the expected reason: the modules do not exist yet.
//
// Property 25 (requirements.md §"P25 — Demo Command resolution (R18.2, R18.3,
// R18.4)"): for all strings matching the Demo_Name form, `demo <name>` loads a
// Demo exactly when the name is in the Demo_Catalog, and otherwise yields an
// Oracle_Voice message listing every catalog name.
//
// Semantics under test (design.md §"Session reducer and effects"):
//   - `demo` without a name lists the catalog (R18.2): one block, no effect.
//   - `demo <catalog name>` with no bundle loaded sets `pendingDemo`, sets
//     `inflight.kind = "demo-load"`, and emits exactly one `demo.load` effect
//     (R18.3).
//   - `demo <catalog name>` with the bundle already loaded installs the demo
//     summary and readings synchronously, with no `demo.load` effect (R18.3,
//     R16.8).
//   - `demo <unknown name>` lists the catalog message and emits no effect
//     (R18.4).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R18.2, R18.3, R18.4**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 15.2 adds these modules.
import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

import type { DemoBundle, ReadingResponse } from "../protocol.js";
import { DEMO_CATALOG } from "../demo/catalog.js";
import { blockText } from "../render/blocks.js";
import type { OutputBlock } from "../render/blocks.js";

import {
  arbCatalogDemoName,
  arbReadingResponse,
  arbUnknownDemoName,
  CATALOG_DEMO_NAMES,
} from "../testing/arbitraries.js";

/** P25 runs the default property budget. */
const NUM_RUNS = 200;

/** A `DemoBundle` covering every catalog demo (both spreads, demo-flagged). */
const arbDemoBundle: fc.Arbitrary<DemoBundle> = fc
  .tuple(
    ...CATALOG_DEMO_NAMES.map(() =>
      fc.tuple(
        arbReadingResponse({ demo: true, allDrawn: true }),
        arbReadingResponse({ demo: true, allDrawn: true }),
      ),
    ),
  )
  .map((pairs) => {
    const bundle: Record<
      string,
      { fates: ReadingResponse; necropsy: ReadingResponse }
    > = {};
    CATALOG_DEMO_NAMES.forEach((name, i) => {
      const [fates, necropsy] = pairs[i]!;
      bundle[name] = { fates, necropsy };
    });
    return bundle as DemoBundle;
  });

function boot(): SessionState {
  const action: Action = {
    type: "boot",
    motionPreference: "on",
    soundPreference: "off",
    prefersReduced: false,
    visible: true,
    bootSignal: false,
  };
  return step(initialState(), action).state;
}

function submit(
  state: SessionState,
  raw: string,
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

/** The blocks this step appended beyond `before`. */
function appendedBlocks(
  before: readonly OutputBlock[],
  after: readonly OutputBlock[],
): readonly OutputBlock[] {
  return after.slice(before.length);
}

/** A loaded-bundle session: a demo already installed so the bundle is present. */
function sessionWithBundle(bundle: DemoBundle): SessionState {
  const seedName = CATALOG_DEMO_NAMES[0]!;
  const requested = submit(boot(), `demo ${seedName}`);
  const load = requested.effects.find((e) => e.type === "demo.load");
  const requestId = (load as { requestId: number }).requestId;
  return step(requested.state, { type: "demo.loaded", requestId, bundle }).state;
}

describe("P25 (R18.2, R18.3, R18.4): demo resolution", () => {
  it("`demo` with no name lists the catalog and emits no request effect", () => {
    const { state, effects } = submit(boot(), "demo");
    // A typed command emits only the R15.4 `focus` effect; no demo.load / api.*
    // request effect is produced for a bare `demo` listing.
    expect(effects.filter((e) => e.type !== "focus")).toHaveLength(0);
    expect(state.inflight).toBeNull();
    const added = state.log.slice(boot().log.length);
    const text = added.map(blockText).join("\n");
    // The listing names every catalog demo (R18.2).
    for (const entry of DEMO_CATALOG) {
      expect(text).toContain(entry.name);
    }
  });

  it("`demo <known>` with no bundle sets pendingDemo and emits exactly one demo.load", () => {
    fc.assert(
      fc.property(arbCatalogDemoName, (name) => {
        const { state, effects } = submit(boot(), `demo ${name}`);
        const loads = effects.filter((e) => e.type === "demo.load");
        expect(loads).toHaveLength(1);
        expect(state.pendingDemo).toBe(name);
        expect(state.inflight?.kind).toBe("demo-load");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("`demo <known>` with the bundle loaded installs synchronously, no demo.load", () => {
    fc.assert(
      fc.property(arbDemoBundle, arbCatalogDemoName, (bundle, name) => {
        const base = sessionWithBundle(bundle);
        const { state, effects } = submit(base, `demo ${name}`);
        // Synchronous install: no network/load effect.
        expect(effects.some((e) => e.type === "demo.load")).toBe(false);
        expect(state.inflight).toBeNull();
        // A demo summary is installed in the session.
        expect(state.summary?.demo).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("`demo <unknown>` lists the catalog message and emits no effect", () => {
    fc.assert(
      fc.property(arbUnknownDemoName, (name) => {
        const { state, effects } = submit(boot(), `demo ${name}`);
        expect(effects.some((e) => e.type === "demo.load")).toBe(false);
        expect(state.pendingDemo).toBeNull();
        expect(state.inflight).toBeNull();
        const added = appendedBlocks(boot().log, state.log);
        const text = added.map(blockText).join("\n");
        // The message lists every catalog name (R18.4).
        for (const catalogName of CATALOG_DEMO_NAMES) {
          expect(text).toContain(catalogName);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("`demo <name>` loads a demo exactly when the name is in the catalog", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbCatalogDemoName, arbUnknownDemoName),
        (name) => {
          const { state, effects } = submit(boot(), `demo ${name}`);
          const known = CATALOG_DEMO_NAMES.includes(name);
          const requested =
            effects.some((e) => e.type === "demo.load") ||
            state.pendingDemo !== null;
          expect(requested).toBe(known);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
