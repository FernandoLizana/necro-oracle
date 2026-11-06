// Feature: visual-necromancy — Boot_Sequence schedule example tests (task 1.3).
//
// Example/unit assertions over the boot schedule: the endpoints of `bootStepAt`
// (elapsed 0 ⇒ first step, elapsed BOOT_TOTAL_MS ⇒ the ready step) and the hard
// duration budget (the whole sequence fits within 3.5 s, R1.1). The property
// tests (task 1.2) cover the renderer; here we nail the concrete timing math
// that keeps the boot under budget and lands on the ready frame.
//
// Pure: no network, LLM, sandbox, clock, DOM or unseeded randomness.
//
// Requirements: 1.1, 2.3, 2.4

import { describe, expect, it } from "vitest";

import {
  BOOT_BUDGET_MS,
  BOOT_STEP_MS,
  BOOT_TOTAL_MS,
  bootStepAt,
} from "./boot-schedule.js";
import { BOOT_STEP_COUNT } from "../render/boot.js";

describe("bootStepAt endpoints (R2.4)", () => {
  it("maps elapsed 0 ms to the first step", () => {
    expect(bootStepAt(0)).toBe(0);
  });

  it("maps the nominal total duration to the final (ready) step", () => {
    expect(bootStepAt(BOOT_TOTAL_MS)).toBe(BOOT_STEP_COUNT - 1);
  });
});

describe("boot schedule duration budget (R1.1, R2.3)", () => {
  it("fits the whole sequence within the 3500 ms budget", () => {
    expect(BOOT_BUDGET_MS).toBe(3500);
    expect(BOOT_STEP_COUNT * BOOT_STEP_MS).toBeLessThanOrEqual(3500);
  });

  it("keeps the nominal total under the budget ceiling", () => {
    expect(BOOT_TOTAL_MS).toBe(3400);
    expect(BOOT_TOTAL_MS).toBeLessThanOrEqual(BOOT_BUDGET_MS);
  });
});
