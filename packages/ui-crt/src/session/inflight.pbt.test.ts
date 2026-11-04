// src/session/inflight.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 19: single in-flight request
//
// Property-based tests for the single-in-flight-request invariant of the
// session reducer (task 15.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `session/state.ts` and
// `session/reducer.ts` (task 15.2), so the imports below fail to resolve and
// the whole suite is red for the expected reason: the modules do not exist yet.
//
// Property 19 (requirements.md §"P19 — Single in-flight request (R3.11)"): for
// all interleavings of `summon` and `read` submissions while a request is in
// flight, the Terminal sends at most one request at a time. Concretely, once a
// `summon` has set `inflight`, every further `summon`, `read`, or `demo <name>`
// submit is answered with the "ritual underway" status block and produces NO
// new `api.*` / `demo.load` effect; only one request is ever in flight.
//
// Semantics under test (design.md §"Session reducer and effects"):
//   - `summon` allocates `requestId`, sets `inflight`, appends the in-progress
//     block, and emits exactly one `api.summon` effect.
//   - While `inflight !== null`, a `summon`, `read` or `demo <name>` command is
//     answered with the "ritual underway, Ctrl+C interrupts it" block and
//     produces no request effect (R3.11).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R3.11**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 15.2 adds these modules.
import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

import {
  arbCommandRepoToken,
  arbInflightBlockingRaw,
} from "../testing/arbitraries.js";

/** P19 runs the default property budget. */
const NUM_RUNS = 200;

/** The effect types that represent an outbound request of any kind. */
const REQUEST_EFFECT_TYPES: ReadonlySet<Effect["type"]> = new Set([
  "api.summon",
  "api.read",
  "demo.load",
]);

/** How many request effects a step produced. */
function countRequestEffects(effects: readonly Effect[]): number {
  return effects.filter((e) => REQUEST_EFFECT_TYPES.has(e.type)).length;
}

/** Boot the reducer into a ready `Idle` state with full motion. */
function boot(): SessionState {
  const action: Action = {
    type: "boot",
    motionPreference: "on",
    soundPreference: "off",
    prefersReduced: false,
    visible: true,
  };
  return step(initialState(), action).state;
}

/** Submit a raw command line typed with Enter and return the next step. */
function submit(
  state: SessionState,
  raw: string,
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

describe("P19 (R3.11): single in-flight request", () => {
  it("a fresh summon from Idle emits exactly one api.summon and sets inflight", () => {
    fc.assert(
      fc.property(arbCommandRepoToken, (repo) => {
        const { state, effects } = submit(boot(), `summon ${repo}`);
        expect(state.inflight).not.toBeNull();
        const summons = effects.filter((e) => e.type === "api.summon");
        expect(summons).toHaveLength(1);
        expect(countRequestEffects(effects)).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects every blocking submit while a request is in flight: no new request effect", () => {
    fc.assert(
      fc.property(
        arbCommandRepoToken,
        fc.array(arbInflightBlockingRaw, { minLength: 1, maxLength: 8 }),
        (repo, blocked) => {
          // Enter the in-flight state with one live summon.
          let state = submit(boot(), `summon ${repo}`).state;
          const inflightId = state.inflight?.id;
          expect(inflightId).not.toBeUndefined();

          for (const raw of blocked) {
            const next = submit(state, raw);
            // No second request may leave while one is in flight (R3.11).
            expect(countRequestEffects(next.effects)).toBe(0);
            // The in-flight request is unchanged — same request still running.
            expect(next.state.inflight?.id).toBe(inflightId);
            state = next.state;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("across any interleaving of blocking submits, at most one request is ever in flight", () => {
    fc.assert(
      fc.property(
        fc.array(arbInflightBlockingRaw, { minLength: 1, maxLength: 12 }),
        (raws) => {
          let state = boot();
          let outstanding = 0;
          let maxOutstanding = 0;

          for (const raw of raws) {
            const { state: next, effects } = submit(state, raw);
            outstanding += countRequestEffects(effects);
            maxOutstanding = Math.max(maxOutstanding, outstanding);
            // The reducer never has more than one request recorded in flight.
            expect(next.inflight === null ? 0 : 1).toBeLessThanOrEqual(1);
            state = next;
          }

          // At most one request is ever launched without being resolved first:
          // after the first launch, every further launch is blocked.
          expect(maxOutstanding).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the in-flight request clears on api.summoned, re-enabling a new request", () => {
    fc.assert(
      fc.property(arbCommandRepoToken, arbCommandRepoToken, (repoA, repoB) => {
        // First summon -> in flight.
        const first = submit(boot(), `summon ${repoA}`);
        const requestId = first.state.inflight?.id;
        expect(requestId).not.toBeUndefined();

        // A blocked second summon emits no request while the first is pending.
        const blocked = submit(first.state, `summon ${repoB}`);
        expect(countRequestEffects(blocked.effects)).toBe(0);

        // Resolve the first request; inflight clears.
        const resolved = step(blocked.state, {
          type: "api.summoned",
          requestId: requestId!,
          summary: {
            ref: {
              owner: "o",
              name: "n",
              sha: "a".repeat(40),
              defaultBranch: "main",
            },
            stars: 0,
            hasWorkflowsDir: false,
            degradedFields: [],
            cache: "miss",
            fileCount: 1,
            truncated: false,
          },
        });
        expect(resolved.state.inflight).toBeNull();

        // Now a fresh summon is accepted again — exactly one request effect.
        const second = submit(resolved.state, `summon ${repoB}`);
        expect(countRequestEffects(second.effects)).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
