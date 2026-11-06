// src/session/demo-isolation.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 24: demo labelling and isolation
//
// Property-based tests for demo-session isolation in the session reducer (task
// 15.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `session/state.ts` and
// `session/reducer.ts` (task 15.2), so the imports below fail to resolve and
// the whole suite is red for the expected reason: the modules do not exist yet.
//
// Property 24 (requirements.md §"P24 — Demo labelling and isolation (R18.5,
// R18.6, R18.7, R18.11)"): for all sequences of `demo`, `read` and `explain`
// commands on a demo Session, every produced non-echo Output_Block starts with
// the Demo_Label, no network request is issued, no rate-limit counter changes,
// and no Evidence_Link is rendered (demo paths print as `fixture:` text).
//
// Semantics under test (design.md §"Session reducer and effects"):
//   - `withDemoLabel` is applied to every non-echo block produced while
//     `summary?.demo === true` by `demo`, `read` and `explain` (R18.5).
//   - No demo path ever emits `api.*` or `demo.load` (R18.6, R18.7).
//   - A demo Evidence path renders as `fixture:{path}` with no href (R18.11).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R18.5, R18.6, R18.7, R18.11**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 15.2 adds these modules.
import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

import type { DemoBundle, ReadingResponse } from "../protocol.js";
import { DEMO_LABEL } from "../voice/phrases.js";
import type { OutputBlock } from "../render/blocks.js";
import { lineText } from "../render/blocks.js";

import {
  arbDemoSessionRaw,
  arbReadingResponse,
  CATALOG_DEMO_NAMES,
} from "../testing/arbitraries.js";

/** P24 runs the default property budget. */
const NUM_RUNS = 200;

/** Every effect that would reach the network — none may appear on a demo. */
const NETWORK_EFFECT_TYPES: ReadonlySet<Effect["type"]> = new Set([
  "api.summon",
  "api.read",
  "demo.load",
]);

/** A `DemoBundle` covering every catalog demo, both flagged `demo: true`. */
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

/** Boot into Idle, full motion so blocks are produced immediately. */
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

/** Submit a raw command line typed with Enter. */
function submit(
  state: SessionState,
  raw: string,
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

/**
 * Drive the reducer into a demo session: boot, load the bundle, then install a
 * demo by name. `demo <known>` with no bundle sets `pendingDemo` and requests
 * `demo.load`; the `demo.loaded` action supplies the bundle and installs the
 * pending demo synchronously, leaving a demo `summary` in the session.
 */
function demoSession(bundle: DemoBundle, name: string): SessionState {
  const requested = submit(boot(), `demo ${name}`);
  const load = requested.effects.find((e) => e.type === "demo.load");
  // The first `demo <known>` without a bundle must request the bundle.
  expect(load).not.toBeUndefined();
  const requestId = (load as { requestId: number }).requestId;
  const loaded = step(requested.state, {
    type: "demo.loaded",
    requestId,
    bundle,
  });
  expect(loaded.state.summary?.demo).toBe(true);
  return loaded.state;
}

/** The blocks appended to the log by one step (the suffix beyond `before`). */
function appendedBlocks(
  before: readonly OutputBlock[],
  after: readonly OutputBlock[],
): readonly OutputBlock[] {
  return after.slice(before.length);
}

describe("P24 (R18.5, R18.6, R18.7, R18.11): demo isolation", () => {
  it("installing a demo emits no network effect and stores a demo summary", () => {
    fc.assert(
      fc.property(arbDemoBundle, fc.constantFrom(...CATALOG_DEMO_NAMES), (bundle, name) => {
        const state = demoSession(bundle, name);
        expect(state.summary?.demo).toBe(true);
        // A loaded demo install carries no snapshot summon or reading request.
        expect(state.inflight).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every demo/read/explain command on a demo session issues no network effect", () => {
    fc.assert(
      fc.property(
        arbDemoBundle,
        fc.constantFrom(...CATALOG_DEMO_NAMES),
        fc.array(arbDemoSessionRaw, { minLength: 1, maxLength: 10 }),
        (bundle, name, raws) => {
          let state = demoSession(bundle, name);
          for (const raw of raws) {
            const { state: next, effects } = submit(state, raw);
            for (const effect of effects) {
              expect(NETWORK_EFFECT_TYPES.has(effect.type)).toBe(false);
            }
            state = next;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("every non-echo block produced on a demo session is flagged demo and carries the DEMO_LABEL", () => {
    fc.assert(
      fc.property(
        arbDemoBundle,
        fc.constantFrom(...CATALOG_DEMO_NAMES),
        fc.array(arbDemoSessionRaw, { minLength: 1, maxLength: 10 }),
        (bundle, name, raws) => {
          let state = demoSession(bundle, name);
          for (const raw of raws) {
            const next = submit(state, raw);
            const added = appendedBlocks(state.log, next.state.log);
            const nonEcho = added.filter((b) => b.kind !== "echo");
            if (nonEcho.length > 0) {
              // Every non-echo block carries the demo flag (R18.5).
              for (const block of nonEcho) {
                expect(block.demo).toBe(true);
              }
              // The first non-echo block is the DEMO_LABEL banner (R18.5).
              const firstLine = lineText(nonEcho[0]!.lines[0]!);
              expect(firstLine).toBe(DEMO_LABEL);
            }
            state = next.state;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("no block on a demo session contains an Evidence_Link segment (fixture: text only)", () => {
    fc.assert(
      fc.property(
        arbDemoBundle,
        fc.constantFrom(...CATALOG_DEMO_NAMES),
        fc.array(arbDemoSessionRaw, { minLength: 1, maxLength: 10 }),
        (bundle, name, raws) => {
          let state = demoSession(bundle, name);
          for (const raw of raws) {
            const next = submit(state, raw);
            const added = appendedBlocks(state.log, next.state.log);
            for (const block of added) {
              for (const line of block.lines) {
                for (const segment of line.segments) {
                  // Demo readings never build an href (R18.11).
                  expect(segment.href).toBeUndefined();
                }
              }
            }
            state = next.state;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
