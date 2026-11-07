// packages/ui-crt/src/session/landing-reducer.pbt.test.ts
//
// Feature: oracle-landing-polish, task 5.2.
//
// Three properties over the pure session reducer (`step`, `initialState` from
// `./state.js` and `./reducer.js`) and the pure visibility predicate
// `landingVisible` from `../landing/landing-model.js`. They pin the
// Landing_State lifecycle described in design.md §"Landing state machine":
//
// P5 (R1.2, R1.3, R2.3): landing-dismiss / `home` round-trip is identity on
//   visibility — from a booted idle state (boot.phase "done", landing visible),
//   submitting ANY accepted command dismisses the landing (hidden), and then
//   submitting `home` returns to a landing-visible state with an empty log and
//   a null summary. A clean round-trip.
//
// P6 (R1.1, R1.4): `landingVisible(state)` is false whenever any command
//   output or summary exists — for arbitrary reducer states reached by applying
//   a sequence of submits, the landing is hidden whenever the log is non-empty
//   OR summary !== null OR landingDismissed is true OR boot.phase !== "done",
//   and visible only when all four hold.
//
// P11 (R1.6, R2.1, R2.3): `home` is a superset of `clear` plus landing restore
//   — `home` empties the log like `clear` AND additionally nulls summary /
//   readings / lastSpread / lastRitual and sets landingDismissed false (so it
//   restores the landing, which `clear` does not).
//
// Testing steering: fast-check with explicit numRuns 1000; the seed prints on
// failure. No network / LLM / sandbox — every state is reached purely through
// the reducer with Mock actions.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Action, SessionState } from "./state.js";
import { step } from "./reducer.js";
import type { ReadingResponse, SummonSummary } from "../protocol.js";
import { landingVisible } from "../landing/landing-model.js";
import {
  arbAcceptedCommand,
  arbSessionStateDismissed,
  arbSessionStateIdle,
  bootedIdleState,
  submitRaw,
} from "../testing/arbitraries.js";

// ---------------------------------------------------------------------------
// Local seeding helpers (mirror landing-reducer.test.ts).
// ---------------------------------------------------------------------------

const SHA = "a".repeat(40);

function makeSummary(): SummonSummary {
  return {
    ref: { owner: "o", name: "n", sha: SHA, defaultBranch: "main" },
    stars: 3,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 12,
    truncated: false,
  };
}

function makeReadingResponse(): ReadingResponse {
  const ref = { owner: "o", name: "n", sha: SHA, defaultBranch: "main" as const };
  return {
    summary: { ...makeSummary(), ref },
    reading: {
      id: "00000000-0000-4000-8000-000000000000",
      repo: ref,
      spread: [
        { position: 1, label: "PAST", draw: null, description: "No card fell here." },
      ],
      draws: [],
      vitality: 50,
      createdAt: "2024-01-01T00:00:00.000Z",
      engineVersion: "1.0.0",
      errors: [],
    },
  };
}

/**
 * A fully dismissed state carrying a summary, a held reading and a lastSpread:
 * summon o/n → api.summoned → read fates → api.read. This is the richest
 * dismissed shape, used to prove `home` resets every field `clear` leaves.
 */
function withReadingInScope(): SessionState {
  let state = submitRaw(bootedIdleState(), "summon o/n");
  state = step(state, {
    type: "api.summoned",
    requestId: state.inflight!.id,
    summary: makeSummary(),
  } satisfies Action).state;
  state = submitRaw(state, "read fates");
  return step(state, {
    type: "api.read",
    requestId: state.inflight!.id,
    response: makeReadingResponse(),
  } satisfies Action).state;
}

// ---------------------------------------------------------------------------
// P5 — dismiss / home round-trip is identity on visibility (R1.2, R1.3, R2.3)
// ---------------------------------------------------------------------------

describe("P5 (R1.2, R1.3, R2.3): landing dismiss / home round-trip is identity on visibility", () => {
  it("any accepted command hides the landing; home restores a clean landing-visible state", () => {
    fc.assert(
      fc.property(arbSessionStateIdle, arbAcceptedCommand, (idle, command) => {
        // Precondition: the idle state IS landing-visible (R1.1).
        expect(landingVisible(idle)).toBe(true);
        expect(idle.landingDismissed).toBe(false);

        // Submitting any accepted command dismisses the landing (R1.2) so the
        // landing is now hidden (R1.3).
        const dismissed = submitRaw(idle, command);
        expect(dismissed.landingDismissed).toBe(true);
        expect(landingVisible(dismissed)).toBe(false);

        // `home` returns to a landing-visible state: empty log, null summary,
        // flag cleared — a clean round-trip (R2.3).
        const home = submitRaw(dismissed, "home");
        expect(home.landingDismissed).toBe(false);
        expect(home.summary).toBeNull();
        expect(home.log).toEqual([]);
        expect(landingVisible(home)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("round-trips from any dismissed state back to a landing-visible state", () => {
    fc.assert(
      fc.property(arbSessionStateDismissed, (dismissed) => {
        // A dismissed state never shows the landing.
        expect(dismissed.landingDismissed).toBe(true);
        expect(landingVisible(dismissed)).toBe(false);

        // `home` is the single way back to the landing (R2.3).
        const home = submitRaw(dismissed, "home");
        expect(landingVisible(home)).toBe(true);
        expect(home.landingDismissed).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// P6 — landingVisible is false whenever output or summary exists (R1.1, R1.4)
// ---------------------------------------------------------------------------

describe("P6 (R1.1, R1.4): landingVisible is false whenever any command output or summary exists", () => {
  it("landingVisible equals the conjunction of all four gating conditions", () => {
    // Reach arbitrary reducer states by applying a sequence of submits that
    // may include `home` (which restores the landing) and `clear` (which does
    // not), alongside accepted commands. This explores both visible and hidden
    // states so the biconditional is exercised in both directions.
    const arbCommand: fc.Arbitrary<string> = fc.oneof(
      arbAcceptedCommand,
      fc.constant("home"),
      fc.constant("clear"),
      fc.constant(""),
    );

    fc.assert(
      fc.property(
        fc.array(arbCommand, { minLength: 0, maxLength: 10 }),
        (commands) => {
          let state = bootedIdleState();
          for (const raw of commands) {
            state = submitRaw(state, raw);

            // The "log empty" gate treats a log of only the boot banner block
            // (kind "boot", always appended by stepBoot) as empty: it is not
            // command output. Any non-boot block is real output.
            const logIsBootOnly = state.log.every((b) => b.kind === "boot");

            const allHold =
              !state.landingDismissed &&
              state.boot.phase === "done" &&
              logIsBootOnly &&
              state.summary === null;

            // The predicate is exactly the conjunction of the four conditions.
            expect(landingVisible(state)).toBe(allHold);

            // Framed as the requirement: hidden whenever ANY disqualifier holds.
            const anyDisqualifier =
              !logIsBootOnly ||
              state.summary !== null ||
              state.landingDismissed ||
              state.boot.phase !== "done";
            expect(landingVisible(state)).toBe(!anyDisqualifier);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("a non-empty log alone hides the landing (summary still null)", () => {
    fc.assert(
      fc.property(arbAcceptedCommand, (command) => {
        const idle = bootedIdleState();
        const after = submitRaw(idle, command);
        // Every accepted command either dismisses the landing, appends real
        // (non-boot) command output, or opens a summary — in all cases the
        // landing is hidden. A log of only the boot banner is not output.
        const hasRealOutput = after.log.some((b) => b.kind !== "boot");
        if (hasRealOutput || after.summary !== null || after.landingDismissed) {
          expect(landingVisible(after)).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// P11 — home is a superset of clear plus landing restore (R1.6, R2.1, R2.3)
// ---------------------------------------------------------------------------

describe("P11 (R1.6, R2.1, R2.3): home is a superset of clear plus landing restore", () => {
  it("home empties the log like clear AND additionally restores the landing", () => {
    fc.assert(
      fc.property(arbSessionStateDismissed, (dismissed) => {
        // `clear` empties the log but leaves the landing dismissed and keeps
        // summary / readings / lastSpread.
        const cleared = submitRaw(dismissed, "clear");
        expect(cleared.landingDismissed).toBe(true);
        expect(cleared.summary).toBe(dismissed.summary);
        expect(cleared.readings).toBe(dismissed.readings);
        expect(cleared.lastSpread).toBe(dismissed.lastSpread);

        // `home` empties the log TOO (superset of clear's log reset)...
        const home = submitRaw(dismissed, "home");
        expect(home.log).toEqual([]);

        // ...AND additionally nulls summary / readings / lastSpread /
        // lastRitual and clears the dismissed flag, restoring the landing —
        // which `clear` does not do.
        expect(home.summary).toBeNull();
        expect(home.readings).toEqual({});
        expect(home.lastSpread).toBeNull();
        expect(home.lastRitual).toBeNull();
        expect(home.landingDismissed).toBe(false);
        expect(landingVisible(home)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("over a rich reading-in-scope state, home resets every field clear preserves", () => {
    const rich = withReadingInScope();
    // Sanity: the rich state has a summary, a held reading, a lastSpread, and
    // a non-empty log, and the landing is dismissed.
    expect(rich.summary).not.toBeNull();
    expect(rich.lastSpread).not.toBeNull();
    expect(Object.keys(rich.readings).length).toBeGreaterThan(0);
    expect(rich.log.length).toBeGreaterThan(0);
    expect(rich.landingDismissed).toBe(true);

    const cleared = submitRaw(rich, "clear");
    // clear keeps summary / readings / lastSpread; landing stays dismissed.
    expect(cleared.summary).toBe(rich.summary);
    expect(cleared.readings).toBe(rich.readings);
    expect(cleared.lastSpread).toBe(rich.lastSpread);
    expect(cleared.landingDismissed).toBe(true);
    expect(landingVisible(cleared)).toBe(false);

    const home = submitRaw(rich, "home");
    // home resets all of them and restores the landing.
    expect(home.log).toEqual([]);
    expect(home.summary).toBeNull();
    expect(home.readings).toEqual({});
    expect(home.lastSpread).toBeNull();
    expect(home.lastRitual).toBeNull();
    expect(home.landingDismissed).toBe(false);
    expect(landingVisible(home)).toBe(true);
  });
});
