// src/session/demo-offline.test.ts
//
// Item 2 (judge-ready-pass): a demo session must resurrect/bind OFFLINE. The
// reducer therefore stamps `demo: true` on the `api.resurrect` and `api.lovers`
// effects when the session is a demo replay, so the browser POSTs `demo: true`
// and the server reads the bundled fixture instead of calling GitHub (the demo
// pinned ref is not a real repo) or OpenRouter.
//
// Regression: before the fix the reducer emitted those effects with NO demo
// flag, so `demo lich-py2` -> `resurrect` hit the live `/api/resurrect` with a
// non-existent repo ref and returned REPO_NOT_FOUND in production.
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";
import { mockDemoBundle } from "../testing/mock-reading.js";

const BOOT: Action = {
  type: "boot",
  motionPreference: "on",
  soundPreference: "off",
  prefersReduced: false,
  visible: true,
  bootSignal: true,
};

function bootState(): SessionState {
  return step(initialState(), BOOT).state;
}

function submit(state: SessionState, raw: string): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

/**
 * Establish a demo session with a fates reading in scope: load the bundle,
 * `demo lich-py2` (installs the demo summary, demo:true), then `read fates`
 * (renders the demo spread from the bundle and sets lastSpread).
 */
function demoSessionWithReading(name = "lich-py2"): SessionState {
  let state = bootState();
  // Request the bundle, then deliver it.
  state = submit(state, `demo ${name}`).state;
  const loadId = state.inflight?.id;
  if (loadId !== undefined) {
    state = step(state, { type: "demo.loaded", requestId: loadId, bundle: mockDemoBundle(name) }).state;
  }
  // Now a demo session; read the fates spread from the bundle (local, no api).
  state = submit(state, "read fates").state;
  return state;
}

describe("Item 2: a demo session forwards demo:true on resurrect", () => {
  it("stamps demo:true on the api.resurrect effect in a demo session", () => {
    const base = demoSessionWithReading();
    expect(base.summary?.demo).toBe(true);
    const { effects } = submit(base, "resurrect");
    const effect = effects.find((e) => e.type === "api.resurrect");
    expect(effect).toBeDefined();
    expect((effect as Extract<Effect, { type: "api.resurrect" }>).demo).toBe(true);
  });

  it("stamps demo:true on the api.lovers effect in a demo session", () => {
    const base = demoSessionWithReading();
    const { effects } = submit(base, "lovers src/app.py js");
    const effect = effects.find((e) => e.type === "api.lovers");
    expect(effect).toBeDefined();
    expect((effect as Extract<Effect, { type: "api.lovers" }>).demo).toBe(true);
  });
});

describe("Item 2: a live session never forwards demo", () => {
  it("omits demo on the api.resurrect effect for a live reading", () => {
    // Live path: summon -> summoned (no demo) -> read -> api.read.
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: {
        ref: { owner: "o", name: "n", sha: "a".repeat(40), defaultBranch: "main" },
        stars: 1,
        hasWorkflowsDir: false,
        degradedFields: [],
        cache: "miss",
        fileCount: 4,
        truncated: false,
      },
    }).state;
    const read = submit(state, "read fates");
    state = step(read.state, {
      type: "api.read",
      requestId: read.state.inflight!.id,
      response: {
        summary: state.summary!,
        reading: {
          id: "00000000-0000-4000-8000-000000000000",
          repo: state.summary!.ref,
          spread: [{ position: 1, label: "PAST", draw: null, description: "void" }],
          draws: [],
          vitality: 50,
          createdAt: "2026-01-01T00:00:00.000Z",
          engineVersion: "1.0.0",
          errors: [],
        },
      },
    }).state;
    const { effects } = submit(state, "resurrect");
    const effect = effects.find((e) => e.type === "api.resurrect") as
      | Extract<Effect, { type: "api.resurrect" }>
      | undefined;
    expect(effect).toBeDefined();
    expect(effect!.demo).toBeUndefined();
  });
});
