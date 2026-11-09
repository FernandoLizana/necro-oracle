//
// Item 7 (P1): demo AUTOPLAY + clean demo EXIT.
//
//  - Autoplay: `demo <name>` (bundle loaded) should SHOW a reading immediately
//    — a canned replay runs itself, it does not wait for the viewer to type
//    `read`. After install, lastSpread is "fates" and the log carries the demo
//    reading, without any explicit `read` submit.
//  - Exit: `home` from a demo session leaves it cleanly — no longer a demo
//    session (summary null) AND no stale pendingDemo lingering.
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";
import { isDemoSession } from "./demo-seed.js";
import { mockDemoBundle } from "../testing/mock-reading.js";
import { blockText } from "../render/blocks.js";

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

/** Install a demo (bundle loaded) WITHOUT typing `read`. */
function installedDemo(name = "lich-py2"): SessionState {
  let state = bootState();
  state = submit(state, `demo ${name}`).state;
  const loadId = state.inflight?.id;
  if (loadId !== undefined) {
    state = step(state, { type: "demo.loaded", requestId: loadId, bundle: mockDemoBundle(name) }).state;
  }
  return state;
}

describe("Item 7: demo autoplay", () => {
  it("`demo <name>` auto-runs the fates reading (no explicit read needed)", () => {
    const state = installedDemo();
    // It is a demo session...
    expect(isDemoSession(state)).toBe(true);
    // ...and the fates spread auto-ran: lastSpread is set WITHOUT a `read`.
    expect(state.lastSpread).toBe("fates");
    // The log carries a rendered reading (a card/position line), not just the
    // summary. The reading render includes the vitality gauge line.
    const text = state.log.map(blockText).join("\n").toLowerCase();
    expect(text).toContain("vitality");
  });
});

describe("Item 7: clean demo exit", () => {
  it("`home` from a demo session leaves it cleanly (not a demo session, no pendingDemo)", () => {
    const demo = installedDemo();
    expect(isDemoSession(demo)).toBe(true);
    expect(demo.pendingDemo).toBe("lich-py2");

    const after = submit(demo, "home").state;
    // No longer a demo session, and no stale demo selection lingers.
    expect(isDemoSession(after)).toBe(false);
    expect(after.summary).toBeNull();
    expect(after.pendingDemo).toBeNull();
    // The log is empty so the Landing becomes visible again (home round-trip).
    expect(after.log).toEqual([]);
  });

  it("a live `summon` still replaces a demo session (unchanged)", () => {
    const demo = installedDemo();
    let state = submit(demo, "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: {
        ref: { owner: "o", name: "n", sha: "a".repeat(40), defaultBranch: "main" },
        stars: 1,
        hasWorkflowsDir: false,
        degradedFields: [],
        cache: "miss",
        fileCount: 3,
        truncated: false,
      },
    } as unknown as Action).state;
    expect(isDemoSession(state)).toBe(false);
    expect(state.demoBundle).toBeNull();
  });
});
