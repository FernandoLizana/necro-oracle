// src/session/item-31-tarot-reveal.test.ts
//
// Item 31 (judge-ready-pass): the tarot RITUAL REVEAL.
//
// The `tarot` command lays the spread as a CEREMONIAL sequence: a shuffle/cut
// opener, one block per card (its dealt line + a single Seer line as it flips
// face-up), then the reading typed paragraph by paragraph, then the verdict.
// Each block rides the shell's existing reveal queue, so:
//   - in FULL motion the blocks deal/type ONE BY ONE (the reveal queue holds
//     every new block id), and
//   - in REDUCED motion / prefers-reduced the whole reading renders INSTANTLY
//     (nothing is queued -> no animation, no frame loop, R16.9),
//   - Escape (skip-reveal) and home/clear cancel the reveal, leaving an empty
//     queue (no leaked timers; the frame loop stops when `pending` is false).
// Sound is independent: the `soundCueAllowed` gate stays silent while sound is
// off and permits the tarot toll when sound is on + gesture + visible.
//
// Offline, pure. No network / LLM / sandbox / audio.

import { describe, expect, it } from "vitest";

import { blockText } from "../render/blocks.js";
import { soundReducer } from "../sound/sound-reducer.js";
import { soundCueAllowed } from "../sound/sound-cue.js";
import { initialState } from "./state.js";
import type { Action, SessionState } from "./state.js";
import { step } from "./reducer.js";

function boot(motionPreference: "on" | "off"): SessionState {
  const action: Action = {
    type: "boot",
    motionPreference,
    soundPreference: "off",
    prefersReduced: false,
    visible: true,
    bootSignal: true,
  };
  return step(initialState(), action).state;
}
function submit(state: SessionState, raw: string): SessionState {
  return step(state, { type: "submit", raw, source: "enter" }).state;
}
function appendedText(before: SessionState, after: SessionState): string {
  return after.log.slice(before.log.length).map(blockText).join("\n");
}

describe("item 31: the tarot reveal is a ceremonial staged sequence", () => {
  it("lays the shuffle opener, per-card flip blocks (with a Seer line), then the typed reading + verdict", () => {
    const base = boot("on");
    const after = submit(base, "tarot");
    // Multiple ordered blocks, not one: the shuffle opener + 3 cards + 3
    // paragraphs + the verdict.
    const newBlocks = after.log.slice(base.log.length);
    expect(newBlocks.length).toBeGreaterThanOrEqual(5);
    const text = appendedText(base, after);
    expect(text).toContain("Shuffle. Cut.");
    expect(text).toContain("Past - ");
    expect(text).toContain("Present - ");
    expect(text).toContain("Future - ");
    expect(text).toContain("VERDICT:");
    // Three distinct cards named in the per-card flip blocks.
    const flips = text.split("\n").filter((l) => /^(Past|Present|Future) - /.test(l));
    expect(flips).toHaveLength(3);
  });

  it("FULL motion: every new block is queued for the one-by-one reveal", () => {
    const base = boot("on");
    expect(base.motionMode).toBe("full");
    const after = submit(base, "tarot");
    const newBlockIds = after.log.slice(base.log.length).map((b) => b.id);
    // The reveal queue holds exactly the new tarot blocks (dealt/typed in turn).
    for (const id of newBlockIds) {
      expect(after.reveal.queue).toContain(id);
    }
    expect(after.reveal.queue.length).toBeGreaterThanOrEqual(5);
  });

  it("REDUCED motion: the reveal is instant -- nothing is queued", () => {
    const base = boot("off");
    expect(base.motionMode).toBe("reduced");
    const after = submit(base, "tarot");
    // All blocks render in one pass; no reveal queue => no frame loop (R16.9).
    expect(after.reveal.queue).toEqual([]);
    // The full reading is nonetheless present immediately.
    const text = appendedText(base, after);
    expect(text).toContain("VERDICT:");
    expect(text).toContain("Shuffle. Cut.");
  });

  it("Escape (skip-reveal) drains the reveal queue -- no lingering animation", () => {
    const base = boot("on");
    const drawn = submit(base, "tarot");
    expect(drawn.reveal.queue.length).toBeGreaterThan(0);
    const skipped = step(drawn, { type: "skip-reveal" }).state;
    expect(skipped.reveal.queue).toEqual([]);
    expect(skipped.reveal.startedAtMs).toBeNull();
  });

  it("home cancels an in-progress reveal (empty queue, no leaked timers)", () => {
    const base = boot("on");
    const drawn = submit(base, "tarot");
    expect(drawn.reveal.queue.length).toBeGreaterThan(0);
    const home = submit(drawn, "home");
    expect(home.reveal.queue).toEqual([]);
    expect(home.reveal.startedAtMs).toBeNull();
  });

  it("bumps tarotSeq once per spread so the sound hook can toll exactly once", () => {
    const base = boot("on");
    const after = submit(base, "tarot");
    expect(after.tarotSeq).toBe(base.tarotSeq + 1);
    const again = submit(after, "tarot");
    expect(again.tarotSeq).toBe(after.tarotSeq + 1);
  });
});

describe("item 31: sound is silent when off, permitted when on (original tones only)", () => {
  function soundState(events: readonly Parameters<typeof soundReducer>[1][]) {
    let s = soundReducer(
      { preference: "off", gesture: false, visible: false },
      { type: "load", preference: "off", visible: true },
    );
    for (const e of events) s = soundReducer(s, e);
    return s;
  }

  it("soundCueAllowed is FALSE while sound is off (the tarot toll stays silent)", () => {
    const off = soundState([{ type: "gesture" }]);
    expect(soundCueAllowed(off)).toBe(false);
  });

  it("soundCueAllowed is TRUE when sound is on AND a gesture occurred AND visible", () => {
    const on = soundState([{ type: "gesture" }, { type: "sound_on" }]);
    expect(soundCueAllowed(on)).toBe(true);
  });

  it("is never allowed before the user gesture (no autoplay)", () => {
    const noGesture = soundState([{ type: "sound_on" }, { type: "hidden" }, { type: "visible" }]);
    // sound_on without a gesture must not open the gate.
    const s = soundReducer(
      { preference: "off", gesture: false, visible: true },
      { type: "sound_on" },
    );
    expect(soundCueAllowed(s)).toBe(false);
    expect(soundCueAllowed(noGesture)).toBe(false);
  });
});