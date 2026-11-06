// src/session/boot-reveal.test.ts
//
// Feature: visual-necromancy, task 7.3 — unit tests for the reducer slices
// introduced by the Boot_Sequence (task 7.1) and the Card_Reveal (task 7.2).
//
// These example tests pin the concrete branch rules of the two slices the pure
// session reducer gained for visual-necromancy (design.md §"1. Boot sequence",
// §"One-by-one card reveal"):
//   - `boot` with `bootSignal` / reduced motion lands on `phase: "done"` while
//     the BOOT_PHRASE stays the first Output_Block (R1.5, R12.5).
//   - `boot` in full motion with no signal, never seen, starts `phase:
//     "playing"` with the BOOT_PHRASE still first.
//   - `boot.tick` advances the step index and transitions to `done` at the last
//     step (R1.1 schedule, driven by elapsed time, never a real clock).
//   - `boot.skip` reaches `done` (R1.3).
//   - `seen` guards a once-per-session boot: a second `boot` does not re-append
//     the BOOT_PHRASE (R1.5).
//   - `api.read` seeds a non-empty Card_Reveal schedule in full motion and an
//     empty schedule (all positions already flipped) in reduced motion (R4.4).
//   - an extended `skip-reveal` reaches the final Card_Reveal state: every card
//     flipped, the reveal queue drained (R4.5).
//   - an empty spread yields an empty schedule with no error (R4.8).
//
// Offline, pure. No network / LLM / sandbox / clock / DOM / randomness. This
// file is deliberately distinct from reducer.test.ts and the slice property
// tests so it does not collide with concurrently-edited task files.
//
// Validates: Requirements 1.5, 4.4, 4.5, 4.8, 12.5

import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { Action, SessionState } from "./state.js";
import { step } from "./reducer.js";

import { blockText } from "../render/blocks.js";
import { BOOT_PHRASE } from "../voice/phrases.js";
import { BOOT_STEP_COUNT } from "../render/boot.js";
import { BOOT_TOTAL_MS } from "../motion/boot-schedule.js";

import type { ReadingResponse, SummonSummary } from "../protocol.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHA = "a".repeat(40);

/** A boot action with full-motion defaults; fields overridden per case. */
function bootAction(overrides: Partial<Extract<Action, { type: "boot" }>> = {}): Action {
  return {
    type: "boot",
    motionPreference: "on",
    soundPreference: "off",
    prefersReduced: false,
    visible: true,
    bootSignal: false,
    ...overrides,
  };
}

/** Boot from the fresh pre-boot state, returning the next state + effects. */
function boot(overrides: Partial<Extract<Action, { type: "boot" }>> = {}): {
  state: SessionState;
  effects: ReturnType<typeof step>["effects"];
} {
  return step(initialState(), bootAction(overrides));
}

function makeSummary(overrides: Partial<SummonSummary> = {}): SummonSummary {
  return {
    ref: { owner: "o", name: "n", sha: SHA, defaultBranch: "main" },
    stars: 3,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 12,
    truncated: false,
    ...overrides,
  };
}

/**
 * A ReadingResponse whose spread has `positions` entries. The sha matches the
 * summary ref so a held reading keys line up. With `positions >= 1` the spread
 * is non-empty (so full motion seeds a non-empty schedule); `positions === 0`
 * is the empty-spread edge case.
 */
function makeReadingResponse(positions = 1): ReadingResponse {
  const ref = { owner: "o", name: "n", sha: SHA, defaultBranch: "main" as const };
  const spread = Array.from({ length: positions }, (_, i) => ({
    position: i + 1,
    label: `P${i + 1}`,
    draw: null,
    description: "No card fell here.",
  }));
  return {
    summary: makeSummary({ ref }),
    reading: {
      id: "00000000-0000-4000-8000-000000000000",
      repo: ref,
      spread,
      draws: [],
      vitality: 50,
      createdAt: "2024-01-01T00:00:00.000Z",
      engineVersion: "1.0.0",
      errors: [],
    },
  };
}

/** Summon + read fates, so the next `api.read` seeds the Card_Reveal slice. */
function summonedAndReadFates(booted: SessionState): SessionState {
  let state = step(booted, { type: "submit", raw: "summon o/n", source: "enter" }).state;
  state = step(state, {
    type: "api.summoned",
    requestId: state.inflight!.id,
    summary: makeSummary(),
  }).state;
  return step(state, { type: "submit", raw: "read fates", source: "enter" }).state;
}

// ---------------------------------------------------------------------------
// Boot slice: phase resolution + the boot phrase as first block (R1.5, R12.5)
// ---------------------------------------------------------------------------

describe("boot slice: phase and the boot phrase (R1.5, R12.5)", () => {
  it("bootSignal:true lands on phase 'done' with BOOT_PHRASE first", () => {
    const { state } = boot({ bootSignal: true });
    expect(state.boot.phase).toBe("done");
    expect(state.boot.seen).toBe(true);
    expect(state.log.length).toBeGreaterThanOrEqual(1);
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
    expect(state.log[0]!.kind).toBe("boot");
  });

  it("reduced motion via 'off' preference lands on phase 'done' with BOOT_PHRASE first", () => {
    const { state } = boot({ motionPreference: "off" });
    expect(state.motionMode).toBe("reduced");
    expect(state.boot.phase).toBe("done");
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
  });

  it("reduced motion via prefers-reduced under auto lands on phase 'done' with BOOT_PHRASE first", () => {
    const { state } = boot({ motionPreference: "auto", prefersReduced: true });
    expect(state.motionMode).toBe("reduced");
    expect(state.boot.phase).toBe("done");
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
  });

  it("full motion, no signal, never seen starts phase 'playing' with BOOT_PHRASE first", () => {
    const { state } = boot();
    expect(state.motionMode).toBe("full");
    expect(state.boot.phase).toBe("playing");
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
  });
});

// ---------------------------------------------------------------------------
// boot.tick advances to the last step and transitions to 'done' (R1.1)
// ---------------------------------------------------------------------------

describe("boot.tick advances to done at the last step", () => {
  it("the first tick records startedAtMs and stays at step 0, still playing", () => {
    const booted = boot().state; // full motion => playing
    expect(booted.boot.phase).toBe("playing");
    const after = step(booted, { type: "boot.tick", nowMs: 1000 }).state;
    expect(after.boot.startedAtMs).toBe(1000);
    expect(after.boot.stepIndex).toBe(0);
    expect(after.boot.phase).toBe("playing");
  });

  it("a tick at or beyond the total duration reaches the last step and phase 'done'", () => {
    const booted = boot().state;
    // First tick anchors the schedule start clock...
    const started = step(booted, { type: "boot.tick", nowMs: 1000 }).state;
    // ...a later tick past the nominal total maps to the final step.
    const done = step(started, {
      type: "boot.tick",
      nowMs: 1000 + BOOT_TOTAL_MS,
    }).state;
    expect(done.boot.stepIndex).toBe(BOOT_STEP_COUNT - 1);
    expect(done.boot.phase).toBe("done");
  });

  it("a tick while already done is a no-op", () => {
    const booted = boot({ bootSignal: true }).state; // starts done
    const after = step(booted, { type: "boot.tick", nowMs: 5000 }).state;
    expect(after).toBe(booted);
  });
});

// ---------------------------------------------------------------------------
// boot.skip reaches 'done' (R1.3)
// ---------------------------------------------------------------------------

describe("boot.skip reaches done", () => {
  it("skips a playing boot straight to phase 'done'", () => {
    const booted = boot().state; // playing in full motion
    expect(booted.boot.phase).toBe("playing");
    const after = step(booted, { type: "boot.skip" }).state;
    expect(after.boot.phase).toBe("done");
  });

  it("is a no-op when boot is already done", () => {
    const booted = boot({ bootSignal: true }).state;
    const after = step(booted, { type: "boot.skip" }).state;
    expect(after).toBe(booted);
  });
});

// ---------------------------------------------------------------------------
// `seen` guards a once-per-session boot: no replay of the phrase (R1.5)
// ---------------------------------------------------------------------------

describe("seen guard: a second boot does not re-append BOOT_PHRASE (R1.5)", () => {
  it("sets seen after the first boot and keeps the boot phrase a single block", () => {
    const first = boot().state;
    expect(first.boot.seen).toBe(true);
    const bootBlocks = first.log.filter((b) => b.kind === "boot");
    expect(bootBlocks).toHaveLength(1);

    // A second boot action refreshes live preferences but must not replay the
    // overlay or re-append the boot phrase.
    const second = step(first, bootAction({ motionPreference: "off" })).state;
    const bootBlocksAfter = second.log.filter((b) => b.kind === "boot");
    expect(bootBlocksAfter).toHaveLength(1);
    // The log did not grow a second boot phrase.
    expect(second.log.length).toBe(first.log.length);
    // ...while the refreshed preference did take effect.
    expect(second.motionPreference).toBe("off");
    expect(second.motionMode).toBe("reduced");
  });
});

// ---------------------------------------------------------------------------
// api.read seeds the Card_Reveal schedule by motion mode (R4.4)
// ---------------------------------------------------------------------------

describe("api.read seeds the Card_Reveal schedule (R4.4)", () => {
  it("full motion seeds a non-empty schedule with flippedCount 0 for a non-empty spread", () => {
    const read = summonedAndReadFates(boot().state);
    expect(read.motionMode).toBe("full");
    const resolved = step(read, {
      type: "api.read",
      requestId: read.inflight!.id,
      response: makeReadingResponse(3),
    }).state;
    // One schedule step per spread position, nothing flipped yet.
    expect(resolved.cardReveal.schedule).toHaveLength(3);
    expect(resolved.cardReveal.flippedCount).toBe(0);
  });

  it("reduced motion seeds an empty schedule with flippedCount = position count", () => {
    const read = summonedAndReadFates(boot({ motionPreference: "off" }).state);
    expect(read.motionMode).toBe("reduced");
    const resolved = step(read, {
      type: "api.read",
      requestId: read.inflight!.id,
      response: makeReadingResponse(3),
    }).state;
    // Reduced motion: one render, all cards face-up, no flip queue.
    expect(resolved.cardReveal.schedule).toEqual([]);
    expect(resolved.cardReveal.flippedCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// extended skip-reveal reaches the final Card_Reveal state (R4.5)
// ---------------------------------------------------------------------------

describe("skip-reveal completes the Card_Reveal (R4.5)", () => {
  it("flips every card and drains the reveal queue", () => {
    const read = summonedAndReadFates(boot().state);
    const resolved = step(read, {
      type: "api.read",
      requestId: read.inflight!.id,
      response: makeReadingResponse(4),
    }).state;
    // Mid-reveal: schedule seeded, not all flipped, blocks queued for reveal.
    expect(resolved.cardReveal.schedule.length).toBe(4);
    expect(resolved.cardReveal.flippedCount).toBe(0);

    const skipped = step(resolved, { type: "skip-reveal" }).state;
    // Final state: every scheduled card flipped, the typewriter queue drained.
    expect(skipped.cardReveal.flippedCount).toBe(skipped.cardReveal.schedule.length);
    expect(skipped.cardReveal.flippedCount).toBe(4);
    expect(skipped.reveal.queue).toEqual([]);
    expect(skipped.reveal.startedAtMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// empty spread => empty schedule, no error (R4.8)
// ---------------------------------------------------------------------------

describe("empty spread yields an empty schedule with no error (R4.8)", () => {
  it("seeds an empty schedule and flippedCount 0 in full motion", () => {
    const read = summonedAndReadFates(boot().state);
    const resolved = step(read, {
      type: "api.read",
      requestId: read.inflight!.id,
      response: makeReadingResponse(0),
    }).state;
    expect(resolved.cardReveal.schedule).toEqual([]);
    expect(resolved.cardReveal.flippedCount).toBe(0);
  });

  it("an empty-spread skip-reveal stays at the final (zero) state without throwing", () => {
    const read = summonedAndReadFates(boot().state);
    const resolved = step(read, {
      type: "api.read",
      requestId: read.inflight!.id,
      response: makeReadingResponse(0),
    }).state;
    const skipped = step(resolved, { type: "skip-reveal" }).state;
    expect(skipped.cardReveal.flippedCount).toBe(0);
    expect(skipped.cardReveal.schedule).toEqual([]);
  });
});
