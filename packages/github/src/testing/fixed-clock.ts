import type { ClockPort } from "../ports.js";

export interface FixedClock extends ClockPort {
  /** Moves the clock forward (or back, if negative) by `ms`. */
  advance(ms: number): void;
  /** Sets the clock to an absolute epoch-millisecond instant. */
  set(ms: number): void;
}

/** A ClockPort that never moves unless told to. */
export function fixedClock(startMs: number): FixedClock {
  let now = startMs;
  return {
    nowMs: () => now,
    advance(ms: number): void {
      now += ms;
    },
    set(ms: number): void {
      now = ms;
    },
  };
}
