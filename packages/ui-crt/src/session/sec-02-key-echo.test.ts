//
// SEC-02 (BYOK command echo) — a secret typed inline after `key set` must
// NEVER be echoed to the terminal log, pushed to the recalled history, or
// reflected back in an "Unknown command" message. The only safe way to enter
// a key is the masked `SoulKeyInput`, so `key set <anything>` opens that
// field and the raw tail is dropped before any echo/history/dispatch.
//
// Regression: before the fix, `key set sk-live-SECRET` parsed to `unknown`
// (the `key` op takes exactly one arg), and `stepSubmit` echoed the raw line,
// pushed `raw.trim()` to history, and printed `Unknown command: key set
// sk-live-SECRET...` — leaking the secret three times.
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";
import { blockText } from "../render/blocks.js";

const BOOT: Action = {
  type: "boot",
  motionPreference: "on",
  soundPreference: "off",
  prefersReduced: false,
  visible: true,
  bootSignal: false,
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

// A plausible-looking secret the test tracks everywhere.
const SECRET = "sk-or-v1-deadbeefcafef00dSECRET1234567890";

describe("SEC-02 (R25.1, R25.2): `key set <secret>` never leaks the tail", () => {
  it("does not echo the secret into any output block", () => {
    const base = bootState();
    const { state } = submit(base, `key set ${SECRET}`);
    const text = state.log.map(blockText).join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("deadbeef");
  });

  it("does not push the secret into recalled history", () => {
    const base = bootState();
    const { state } = submit(base, `key set ${SECRET}`);
    for (const entry of state.history.entries) {
      expect(entry).not.toContain(SECRET);
      expect(entry).not.toContain("deadbeef");
    }
  });

  it("opens the masked SoulKeyInput instead of running an unknown command", () => {
    const base = bootState();
    const { state, effects } = submit(base, `key set ${SECRET}`);
    // The masked field is the only safe entry path.
    expect(effects).toContainEqual<Effect>({ type: "byok.open-key-input" });
    // No "Unknown command" reflection of the raw line.
    const text = state.log.map(blockText).join("\n").toLowerCase();
    expect(text).not.toContain("unknown command");
  });

  it("still lets the bare `key set` open the masked field unchanged", () => {
    const base = bootState();
    const { effects } = submit(base, "key set");
    expect(effects).toContainEqual<Effect>({ type: "byok.open-key-input" });
  });
});
