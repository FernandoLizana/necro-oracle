import { describe, expect, it } from "vitest";
import { fixedClock } from "./fixed-clock.js";

describe("fixedClock (R9.2, R9.5)", () => {
  it("returns the fixed value on every read", () => {
    const clock = fixedClock(1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
  });

  it("does not move on its own", async () => {
    const clock = fixedClock(5);
    await new Promise((r) => setTimeout(r, 15));
    expect(clock.nowMs()).toBe(5);
  });

  it("advances only when told to, by the given amount", () => {
    const clock = fixedClock(1_000);
    clock.advance(250);
    expect(clock.nowMs()).toBe(1_250);
    clock.advance(750);
    expect(clock.nowMs()).toBe(2_000);
  });

  it("can be set to an absolute instant", () => {
    const clock = fixedClock(1_000);
    clock.set(42);
    expect(clock.nowMs()).toBe(42);
  });
});
