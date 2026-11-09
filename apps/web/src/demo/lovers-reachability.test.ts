// apps/web/src/demo/lovers-reachability.test.ts
//
// Addendum (PROD HOTFIX): Lovers reachability integration test.
//
// Proves that the Lovers chip becomes eligible after:
//   demo lich-py2  ->  resurrect-resolved
//
// using the REAL arcana registry (via @necro/ui-crt's loversEligible selector,
// which reads draw.grimoires from the in-scope reading) and the REAL generated
// demo bundle (apps/web/src/demo/bundle.generated.json).
//
// This test WOULD HAVE FAILED before the addendum fix because the lich-py2
// judgement draw had grimoires: ["py2to3","pyproject"] and "lovers-js" was
// absent -- so loversEligible would have returned null even after a successful
// resurrection.
//
// After the fix: Judgement carries linkedGrimoireIds ["py2to3","pyproject",
// "lovers-js"] (packages/oracle/src/registry/cards.ts + detectors/judgement.ts),
// the demo bundle was regenerated with `pnpm demo:bundle`, and this test
// confirms the selector fires end-to-end through the real bundle.
//
// Offline, pure. No network, LLM, or sandbox.

import { describe, expect, it } from "vitest";

import {
  initialState,
  loversEligible,
  step,
} from "@necro/ui-crt";
import type { Action, DemoBundle, Effect, RitualResponse, SessionState } from "@necro/ui-crt";

// The real generated bundle -- same JSON the browser loads at runtime.
// Vite/Vitest resolves JSON imports natively.
import REAL_BUNDLE from "./bundle.generated.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOT: Action = {
  type: "boot",
  motionPreference: "on",
  soundPreference: "off",
  prefersReduced: false,
  visible: true,
  // Skip the boot animation so the session is immediately usable in tests.
  bootSignal: true,
};

function bootState(): SessionState {
  return step(initialState(), BOOT).state;
}

function submit(
  state: SessionState,
  raw: string,
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

/**
 * A minimal RitualResponse for lich-py2: one converted Python file in scope,
 * exactly as loversEligible requires (ritual.files[0].path becomes the
 * prefill target). The demo flag is set to true to match a demo session.
 */
const DEMO_RITUAL: RitualResponse = {
  ritualId: "00000000-0000-4000-8000-000000000001",
  selectedCount: 1,
  files: [
    {
      path: "src/lich.py",
      before: 'print "rise"\n',
      after: 'print("rise")\n',
      diff: [{ kind: "context", text: "" }],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch: "--- a/src/lich.py\n+++ b/src/lich.py\n",
  beforeVitality: 20,
  afterVitality: 45,
  vitalityDelta: 25,
  changedCards: [],
  degraded: false,
  demo: true,
} as unknown as RitualResponse;

// ---------------------------------------------------------------------------
// Drive the reducer into a demo session with a resurrection in scope
// ---------------------------------------------------------------------------

/**
 * Install the lich-py2 demo from the REAL bundle, then synthesise a completed
 * resurrection (api.resurrect.resolved). Returns the resulting SessionState.
 *
 * Flow mirrors the production path:
 *   1. boot    -> session ready
 *   2. `demo lich-py2` -> inflight demo.load (bundle not yet loaded)
 *   3. demo.loaded (real bundle) -> installDemo sets demoBundle + pendingDemo;
 *      autoplay runs the fates reading -> lastSpread = "fates"
 *   4. `resurrect` -> inflight api.resurrect (the effect; we don't call the API)
 *   5. api.resurrect.resolved -> stepResurrectResolved sets lastRitual
 */
function demoAfterResurrect(): SessionState {
  // Step 1: boot
  let state = bootState();

  // Step 2: `demo lich-py2` -- bundle not yet loaded, sets pendingDemo
  const { state: s2 } = submit(state, "demo lich-py2");
  state = s2;
  const loadId = state.inflight?.id;
  expect(loadId, "inflight demo.load id must be set").toBeDefined();

  // Step 3: deliver the REAL bundle -> autoplay runs fates reading
  const withBundle = step(state, {
    type: "demo.loaded",
    requestId: loadId!,
    bundle: REAL_BUNDLE as unknown as DemoBundle,
  }).state;
  // Autoplay: the bundle install renders the fates spread without a `read` command.
  expect(withBundle.lastSpread, "autoplay must set lastSpread after bundle load").toBe("fates");
  state = withBundle;

  // Step 4: submit `resurrect` -> inflight api.resurrect
  const { state: s4, effects } = submit(state, "resurrect");
  state = s4;
  const resEffect = effects.find((e) => e.type === "api.resurrect");
  expect(resEffect, "resurrect must emit api.resurrect effect in a demo session").toBeDefined();
  const resurrectId = state.inflight?.id;
  expect(resurrectId, "inflight resurrect id must be set").toBeDefined();

  // Step 5: resolve the resurrection -> lastRitual is set
  const { state: s5 } = step(state, {
    type: "api.resurrect.resolved",
    requestId: resurrectId!,
    result: DEMO_RITUAL,
  });
  return s5;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Addendum: Lovers is reachable after demo lich-py2 -> resurrect (real bundle)", () => {
  it("REAL bundle: lich-py2 fates has a judgement draw with lovers-js grimoire", () => {
    // Gate: confirm the fixture data is correct before exercising the selector.
    // If this fails, the bundle was not regenerated after the addendum fix.
    const entry = (REAL_BUNDLE as Record<string, unknown>)["lich-py2"] as {
      fates: { reading: { draws: Array<{ card: string; grimoires: string[] }> } };
    };
    const judgementDraw = entry.fates.reading.draws.find((d) => d.card === "judgement");
    expect(judgementDraw, "lich-py2 fates must have a judgement draw").toBeDefined();
    expect(judgementDraw?.grimoires).toContain("lovers-js");
  });

  it("loversEligible is null before resurrect-resolved (no lastRitual yet)", () => {
    // lovers-js is in scope (fates autoplay), but no resurrection completed yet.
    let state = bootState();
    const { state: s2 } = submit(state, "demo lich-py2");
    state = s2;
    const loadId = state.inflight?.id;
    const withBundle = step(state, {
      type: "demo.loaded",
      requestId: loadId!,
      bundle: REAL_BUNDLE as unknown as DemoBundle,
    }).state;
    // Signal present but no lastRitual -> null (R14.3 guard)
    expect(loversEligible(withBundle)).toBeNull();
  });

  it("loversEligible returns { file } after demo lich-py2 -> resurrect-resolved", () => {
    // This is the full signal: lovers-js drawn + resurrection completed.
    const state = demoAfterResurrect();
    const result = loversEligible(state);
    expect(result, "LOVERS chip must be eligible after a completed resurrection").not.toBeNull();
    expect(typeof result?.file).toBe("string");
    expect(result?.file.length).toBeGreaterThan(0);
  });

  it("the eligible file path matches the first resurrected file exactly", () => {
    const state = demoAfterResurrect();
    expect(loversEligible(state)?.file).toBe(DEMO_RITUAL.files[0]!.path);
  });
});
