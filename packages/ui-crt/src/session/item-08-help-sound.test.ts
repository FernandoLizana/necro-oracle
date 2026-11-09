// @vitest-environment jsdom
//
// Item 8 (P1): help completeness + bare commands + sound confirmation.
//
//  - help: `renderHelp()` must list EVERY typed command, including the
//    lovers-binding additions (lovers, key, model) and `home` — previously
//    omitted, so a user could not discover them from help.
//  - bare commands: `sound` / `motion` with no arg report the current state
//    (already present — pinned here as a guard).
//  - sound confirmation: `sound on`/`sound off` emits a confirmation line,
//    mirroring `motion`'s "Motion set to X." — previously silent.
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { renderHelp } from "../render/help.js";
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

describe("Item 8: help lists every typed command", () => {
  const help = blockText(renderHelp());
  // Each command token must begin a command line in the help grimoire.
  for (const cmd of [
    "summon",
    "read",
    "explain",
    "resurrect",
    "lovers",
    "key",
    "model",
    "help",
    "clear",
    "home",
    "demo",
    "motion",
    "sound",
  ]) {
    it(`advertises the \`${cmd}\` command`, () => {
      const hasLine = help
        .split("\n")
        .some((line) => line.trim().startsWith(cmd + " ") || line.trim() === cmd);
      expect(hasLine).toBe(true);
    });
  }
});

describe("Item 8: sound confirmation + bare reports", () => {
  it("`sound on` emits a confirmation line", () => {
    const base = bootState();
    const after = submit(base, "sound on");
    expect(appendedText(base, after).toLowerCase()).toContain("sound set to on");
  });

  it("`sound off` emits a confirmation line", () => {
    const base = submit(bootState(), "sound on");
    const after = submit(base, "sound off");
    expect(appendedText(base, after).toLowerCase()).toContain("sound set to off");
  });

  it("bare `sound` reports the current preference (unchanged)", () => {
    const base = bootState();
    const after = submit(base, "sound");
    expect(appendedText(base, after).toLowerCase()).toContain("sound is");
  });

  it("bare `motion` reports the current preference (unchanged)", () => {
    const base = bootState();
    const after = submit(base, "motion");
    expect(appendedText(base, after).toLowerCase()).toContain("motion is");
  });
});
