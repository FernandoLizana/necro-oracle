// src/session/landing-reducer.test.ts
//
// Feature: oracle-landing-polish, task 1.4 — Landing_State reducer examples.
//
// These example tests pin the concrete Landing_State transitions the reducer
// performs (design.md §"Landing state machine"):
//   - the first accepted command dismisses the landing (sets
//     `landingDismissed = true`) (R1.2).
//   - an empty / whitespace-only submit does NOT dismiss the landing, because
//     it produces no output and never reaches the dismiss path (R1.2).
//   - `home` is a superset of `clear` plus the landing restore: it empties the
//     log, nulls summary / readings / lastSpread / lastRitual, and sets
//     `landingDismissed = false`, a clean round-trip back to the landing
//     (R1.4, R1.7, R2.3).
//   - `clear` empties the log but leaves `landingDismissed` unchanged (R1.7).
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

import type { ReadingResponse, SummonSummary } from "../protocol.js";

// ---------------------------------------------------------------------------
// Helpers — seed a booted, settled (boot.phase === "done") idle state.
// ---------------------------------------------------------------------------

// `bootSignal: true` starts `boot.phase: "done"` immediately, so the landing is
// visible (the common idle screen) with `landingDismissed === false`.
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

function submit(
  state: SessionState,
  raw: string,
  source: "enter" | "button" = "enter",
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source });
}

const SHA = "a".repeat(40);

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

function makeReadingResponse(): ReadingResponse {
  const ref = { owner: "o", name: "n", sha: SHA, defaultBranch: "main" as const };
  return {
    summary: makeSummary({ ref }),
    reading: {
      id: "00000000-0000-4000-8000-000000000000",
      repo: ref,
      spread: [
        {
          position: 1,
          label: "PAST",
          draw: null,
          description: "No card fell here.",
        },
      ],
      draws: [],
      vitality: 50,
      createdAt: "2024-01-01T00:00:00.000Z",
      engineVersion: "1.0.0",
      errors: [],
    },
  };
}

/** Summon + read fates + resolve, so summary, a reading, and a lastSpread exist. */
function withReadingInScope(): SessionState {
  let state = submit(bootState(), "summon o/n").state;
  state = step(state, {
    type: "api.summoned",
    requestId: state.inflight!.id,
    summary: makeSummary(),
  }).state;
  const read = submit(state, "read fates");
  return step(read.state, {
    type: "api.read",
    requestId: read.state.inflight!.id,
    response: makeReadingResponse(),
  }).state;
}

// ---------------------------------------------------------------------------
// First accepted command dismisses the landing (R1.2)
// ---------------------------------------------------------------------------

describe("landing dismiss on first command (oracle-landing-polish R1.2)", () => {
  it("starts with landingDismissed false on the idle (boot done) state", () => {
    const base = bootState();
    expect(base.landingDismissed).toBe(false);
    expect(base.boot.phase).toBe("done");
  });

  it("the first accepted command sets landingDismissed to true", () => {
    const base = bootState();
    expect(base.landingDismissed).toBe(false);
    const { state } = submit(base, "help");
    expect(state.landingDismissed).toBe(true);
  });

  it("an empty or whitespace-only submit does NOT dismiss the landing", () => {
    for (const raw of ["", "   ", "\t\n  "]) {
      const base = bootState();
      const { state } = submit(base, raw);
      expect(state.landingDismissed).toBe(false);
    }
  });

  it("the bare SUMMON-button prefill does NOT dismiss the landing", () => {
    // The SUMMON button sends a bare `summon` to prefill the input; it produces
    // no output, so it must not count as an accepted command.
    const base = bootState();
    const { state } = submit(base, "summon", "button");
    expect(state.landingDismissed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// home: full round-trip back to the landing (R1.4, R2.3)
// ---------------------------------------------------------------------------

describe("home transition (oracle-landing-polish R1.4, R2.3)", () => {
  it("empties the log, nulls summary/readings/lastSpread/lastRitual, and clears the dismissed flag", () => {
    // A rich dismissed state: summary, a held reading, lastSpread, and a
    // dismissed landing.
    const dismissed = withReadingInScope();
    expect(dismissed.landingDismissed).toBe(true);
    expect(dismissed.summary).not.toBeNull();
    expect(dismissed.log.length).toBeGreaterThan(0);

    const { state } = submit(dismissed, "home");
    expect(state.log).toEqual([]);
    expect(state.summary).toBeNull();
    expect(state.readings).toEqual({});
    expect(state.lastSpread).toBeNull();
    expect(state.lastRitual).toBeNull();
    expect(state.landingDismissed).toBe(false);
  });

  it("is a clean round-trip: dismiss then home returns to the initial landing-visible shape", () => {
    const base = bootState();
    const dismissed = submit(base, "help").state;
    expect(dismissed.landingDismissed).toBe(true);
    const home = submit(dismissed, "home").state;
    // Back to a landing-visible state: empty log, no summary, flag false.
    expect(home.landingDismissed).toBe(false);
    expect(home.summary).toBeNull();
    expect(home.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clear: empties the log, leaves landingDismissed unchanged (R1.7)
// ---------------------------------------------------------------------------

describe("clear leaves landingDismissed unchanged (oracle-landing-polish R1.7)", () => {
  it("empties the prior output but keeps the dismissed flag true", () => {
    const dismissed = submit(bootState(), "help").state;
    expect(dismissed.landingDismissed).toBe(true);
    const { state } = submit(dismissed, "clear");
    // `clear` leaves the flag untouched — only `home` restores the landing.
    expect(state.landingDismissed).toBe(true);
    // The prior "help" output is gone; the log holds only the "screen cleared"
    // block (R15.10), so the landing does NOT reappear.
    expect(state.summary).toBe(dismissed.summary);
  });
});
