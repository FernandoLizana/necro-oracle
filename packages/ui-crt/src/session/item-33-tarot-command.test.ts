// src/session/item-33-tarot-command.test.ts
//
// Item 33 (judge-ready-pass): the `tarot` command is wired into the reducer.
//
//  - `tarot` draws a three-card Past/Present/Future spread and renders a full
//    reading, with NO repository required (works on the bare booted landing);
//  - a live session uses the crypto RNG; a DEMO session uses a seeded RNG local
//    to the demo, so a replay is deterministic and never patches crypto;
//  - the command is never silently swallowed.
//
// Offline, pure. No network / LLM / sandbox.

import { describe, expect, it } from "vitest";

import { blockText } from "../render/blocks.js";
import { initialState } from "./state.js";
import type { Action, SessionState } from "./state.js";
import { step } from "./reducer.js";

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
function submit(state: SessionState, raw: string): SessionState {
  return step(state, { type: "submit", raw, source: "enter" }).state;
}
function appendedText(before: SessionState, after: SessionState): string {
  return after.log.slice(before.log.length).map(blockText).join("\n");
}

describe("item 33: the tarot command draws + reads with no repo", () => {
  it("renders a full Past/Present/Future reading on the bare landing", () => {
    const base = bootState();
    const after = submit(base, "tarot");
    const text = appendedText(base, after);
    // Item 31 (reveal): the ceremonial opener, then the per-card flip lines.
    expect(text).toContain("Shuffle. Cut.");
    expect(text).toContain("Past - ");
    expect(text).toContain("Present - ");
    expect(text).toContain("Future - ");
    expect(text).toContain("VERDICT:");
  });

  it("accepts a free-text question without error", () => {
    const base = bootState();
    const after = submit(base, "tarot will my code ever ship?");
    const text = appendedText(base, after);
    expect(text).toContain("VERDICT:");
    // The command is handled, not reported unknown.
    expect(text.toLowerCase()).not.toContain("unknown command");
  });

  it("is never reported as an unknown command", () => {
    const base = bootState();
    const after = submit(base, "tarot");
    expect(appendedText(base, after).toLowerCase()).not.toContain("unknown command");
  });

  it("names three distinct cards in the three positions", () => {
    const base = bootState();
    const after = submit(base, "tarot");
    const lines = appendedText(base, after)
      .split("\n")
      .filter((l) => /^(Past|Present|Future) - /.test(l));
    expect(lines).toHaveLength(3);
    // Extract the uppercase NAME token between the numeral and "(".
    const names = lines.map((l) => l.replace(/^[^-]+ - [^ ]+ /, "").split(" (")[0]);
    expect(new Set(names).size).toBe(3);
  });
});