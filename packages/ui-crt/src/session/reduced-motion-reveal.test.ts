// src/session/reduced-motion-reveal.test.ts
//
// Feature: resurrection-engine, task 14.12 — reduced-motion unit test for the
// diff / result reveal (design.md §"Browser/terminal rendering",
// §"Motion and preferences"; R14.1, R14.5).
//
// The resurrection result view (diff / vitality / patch) is appended to the
// session log like any other oracle output and reveals only when the effective
// Motion_Mode is `full`. Both signals that mean "no motion" — the OS
// `prefers-reduced-motion` media query and the terminal `motion off` ("quiet")
// command — must resolve to the `reduced` effective mode, and in that mode the
// session reducer must queue NO reveal for an appended result block (the view
// is shown at once, emitting no typewriter motion). This pins that contract at
// the two seams the resurrection reveal relies on:
//
//   1. `resolveMotionMode` — the single owner of effective-motion resolution:
//        - `motion off` (the "quiet" preference) ⇒ `reduced` regardless of the
//          media query (`resolveMotionMode("off", false|true) === "reduced"`).
//        - `prefers-reduced-motion` under `auto` ⇒ `reduced`
//          (`resolveMotionMode("auto", true) === "reduced"`).
//        - full motion only when neither is set
//          (`resolveMotionMode("auto", false) === "full"`).
//   2. the session reducer — booted in `reduced` motion (via either signal),
//      appending output (a stand-in for a resurrect Result_Line's diff /
//      vitality blocks) leaves the reveal queue EMPTY, so no block ever
//      animates (`state.reveal.queue` stays `[]`). In `full` motion the same
//      path DOES queue the new blocks, proving the reduced-motion branch is the
//      thing suppressing motion, not a dead code path.
//
// Offline, pure. No network / LLM / sandbox. This file is distinct from
// reducer.test.ts and the motion-mode property test so it does not collide with
// concurrently-edited task files.
//
// Validates: Requirements 14.1, 14.5

import { describe, expect, it } from "vitest";

import { resolveMotionMode } from "../motion/motion-mode.js";
import { initialState } from "./state.js";
import type { Action, SessionState } from "./state.js";
import { step } from "./reducer.js";

// A boot action; `motionPreference` / `prefersReduced` are overridden per case.
function bootAction(
  motionPreference: "auto" | "on" | "off",
  prefersReduced: boolean,
): Action {
  return {
    type: "boot",
    motionPreference,
    soundPreference: "off",
    prefersReduced,
    visible: true,
  };
}

function bootState(
  motionPreference: "auto" | "on" | "off",
  prefersReduced: boolean,
): SessionState {
  return step(initialState(), bootAction(motionPreference, prefersReduced)).state;
}

// Append output through the public reducer by submitting a command that
// produces oracle blocks (`help`). The resurrection result view is appended by
// the same `appendDrafts` path, so its reveal behaviour is identical: it only
// queues when `motionMode === "full"`.
function submitHelp(state: SessionState): SessionState {
  return step(state, { type: "submit", raw: "help", source: "enter" }).state;
}

describe("R14.1/R14.5: reduced motion resolves correctly for the diff reveal", () => {
  it("resolves `motion off` (quiet) to reduced regardless of the media query", () => {
    expect(resolveMotionMode("off", false)).toBe("reduced");
    expect(resolveMotionMode("off", true)).toBe("reduced");
  });

  it("resolves `prefers-reduced-motion` under auto to reduced", () => {
    expect(resolveMotionMode("auto", true)).toBe("reduced");
  });

  it("resolves to full motion only when neither signal is set", () => {
    expect(resolveMotionMode("auto", false)).toBe("full");
    expect(resolveMotionMode("on", false)).toBe("full");
  });
});

describe("R14.1/R14.5: the reveal queue stays empty in reduced motion", () => {
  it("queues no reveal for appended result output when `motion off` (quiet) is set", () => {
    const base = bootState("off", false);
    expect(base.motionMode).toBe("reduced");
    // Boot itself queued no reveal in reduced motion.
    expect(base.reveal.queue).toEqual([]);

    const after = submitHelp(base);
    // New output was appended...
    expect(after.log.length).toBeGreaterThan(base.log.length);
    // ...but nothing is queued for reveal: the diff/result reveal emits no
    // motion.
    expect(after.reveal.queue).toEqual([]);
    expect(after.reveal.startedAtMs).toBeNull();
  });

  it("queues no reveal when `prefers-reduced-motion` is set under auto", () => {
    const base = bootState("auto", true);
    expect(base.motionMode).toBe("reduced");
    expect(base.reveal.queue).toEqual([]);

    const after = submitHelp(base);
    expect(after.log.length).toBeGreaterThan(base.log.length);
    expect(after.reveal.queue).toEqual([]);
    expect(after.reveal.startedAtMs).toBeNull();
  });

  it("DOES queue a reveal in full motion, proving reduced motion is what suppresses it", () => {
    const base = bootState("on", false);
    expect(base.motionMode).toBe("full");

    const after = submitHelp(base);
    expect(after.log.length).toBeGreaterThan(base.log.length);
    // Full motion queues the newly appended blocks for the typewriter reveal.
    expect(after.reveal.queue.length).toBeGreaterThan(0);
  });
});
