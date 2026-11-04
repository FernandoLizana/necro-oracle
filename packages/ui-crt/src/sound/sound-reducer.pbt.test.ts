// src/sound/sound-reducer.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 26
//
// Property-based tests for the Sound_Reducer (task 13.1, TEST-FIRST).
//
// Property 26 (design.md §"Property 26: Sound_Reducer"):
//   For all event sequences starting from any loaded Sound_Preference, the
//   Click and Hum are inactive until a `gesture` event has occurred after
//   `load` (so no sound occurs at load even when the stored preference is
//   `on`); the Hum is active exactly when the preference is `on`, a gesture
//   has occurred and the document is visible; the Click is active under the
//   same condition; and after `sound_off` both are inactive regardless of
//   later `gesture`, `visible` or `hidden` events (until a later `sound_on`
//   with gesture and visibility restores them).
//
// Semantics under test (design.md §"Sound reducer"):
//   - SoundState { preference, gesture, visible }
//   - `load` sets gesture:false regardless of the stored preference.
//   - soundActivity(state) returns hum and click both equal to
//     preference === "on" && gesture && visible.
//   - `sound_off` sets preference:"off"; only a `gesture` event sets gesture.
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R19.1, R19.2, R19.7, R19.8, R19.13, R19.16**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  soundActivity,
  soundReducer,
  type SoundEvent,
  type SoundState,
} from "./sound-reducer.js";

/**
 * SoundPreference is defined in the prefs module (design §"Motion and
 * preferences": `export type SoundPreference = "on" | "off"`). The test
 * restates the literal union locally so it depends only on the unit under
 * test (`./sound-reducer.js`) and not on the prefs module path.
 */
type SoundPreference = "on" | "off";

/** P26 runs the default property budget. */
const NUM_RUNS = 200;

/** The two stored preferences a `load` event can carry. */
const PREFERENCES: readonly SoundPreference[] = ["on", "off"];

/** An arbitrary `load` event: the required first event of any sequence. */
const arbLoadEvent: fc.Arbitrary<Extract<SoundEvent, { type: "load" }>> =
  fc.record({
    type: fc.constant("load" as const),
    preference: fc.constantFrom<SoundPreference>(...PREFERENCES),
    visible: fc.boolean(),
  });

/** An arbitrary non-`load` event (every transition after the initial load). */
const arbStepEvent: fc.Arbitrary<Exclude<SoundEvent, { type: "load" }>> =
  fc.constantFrom<Exclude<SoundEvent, { type: "load" }>>(
    { type: "sound_on" },
    { type: "sound_off" },
    { type: "gesture" },
    { type: "hidden" },
    { type: "visible" },
  );

/**
 * An arbitrary event sequence that always begins with a `load` event,
 * followed by any number (0..24) of later events. This mirrors the real
 * lifecycle: the reducer is seeded by `load`, then driven by UI events.
 */
const arbEventSequence: fc.Arbitrary<readonly SoundEvent[]> = fc
  .tuple(arbLoadEvent, fc.array(arbStepEvent, { maxLength: 24 }))
  .map(([load, rest]) => [load, ...rest] as readonly SoundEvent[]);

/** The state `load` must always produce, used as the reduce seed. */
function loadState(event: Extract<SoundEvent, { type: "load" }>): SoundState {
  return soundReducer(
    // The pre-load seed is irrelevant; `load` overwrites every field.
    { preference: "off", gesture: false, visible: false },
    event,
  );
}

describe("P26 (R19.1, R19.2, R19.7, R19.8, R19.13, R19.16): sound reducer state machine", () => {
  it("is inactive at load and until a gesture, even when the stored preference is on", () => {
    fc.assert(
      fc.property(arbLoadEvent, fc.array(arbStepEvent, { maxLength: 24 }), (load, rest) => {
        // Immediately after `load`, no gesture has occurred.
        let state = loadState(load);
        expect(state.gesture).toBe(false);
        const atLoad = soundActivity(state);
        expect(atLoad.hum).toBe(false);
        expect(atLoad.click).toBe(false);

        // Walk the tail; before the first `gesture` event, both stay inactive
        // no matter what the stored/toggled preference or visibility is.
        let sawGesture = false;
        for (const event of rest) {
          state = soundReducer(state, event);
          if (event.type === "gesture") sawGesture = true;
          if (!sawGesture) {
            const act = soundActivity(state);
            expect(act.hum).toBe(false);
            expect(act.click).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("has hum and click active exactly when preference is on, gesture occurred, and visible", () => {
    fc.assert(
      fc.property(arbEventSequence, (events) => {
        const [load, ...rest] = events as [
          Extract<SoundEvent, { type: "load" }>,
          ...SoundEvent[],
        ];
        let state = loadState(load);
        for (const event of rest) {
          state = soundReducer(state, event);
        }
        const expected =
          state.preference === "on" && state.gesture && state.visible;
        const act = soundActivity(state);
        expect(act.hum).toBe(expected);
        expect(act.click).toBe(expected);
        // Hum and Click share the identical activation condition.
        expect(act.hum).toBe(act.click);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("stays inactive after sound_off regardless of later gesture, visible or hidden events", () => {
    const arbAfterOffEvents: fc.Arbitrary<Exclude<SoundEvent, { type: "load" | "sound_on" }>> =
      fc.constantFrom<Exclude<SoundEvent, { type: "load" | "sound_on" }>>(
        { type: "sound_off" },
        { type: "gesture" },
        { type: "hidden" },
        { type: "visible" },
      );

    fc.assert(
      fc.property(
        arbLoadEvent,
        fc.array(arbStepEvent, { maxLength: 12 }),
        fc.array(arbAfterOffEvents, { maxLength: 12 }),
        (load, lead, tail) => {
          // Reduce up to and including a sound_off event.
          let state = loadState(load);
          for (const event of lead) {
            state = soundReducer(state, event);
          }
          state = soundReducer(state, { type: "sound_off" });
          expect(state.preference).toBe("off");

          // Any mix of gesture/visible/hidden/sound_off keeps both inactive,
          // because none of them turns the preference back on.
          for (const event of tail) {
            state = soundReducer(state, event);
            const act = soundActivity(state);
            expect(act.hum).toBe(false);
            expect(act.click).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
