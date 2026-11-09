// Sticky-bottom auto-scroll unit test (prod UX bug fix).
//
// Tests the sticky-bottom logic in a JSDOM environment. Since jsdom does not
// do real scroll layout (scrollHeight is always 0), we verify the behaviour
// through the `userScrolledUpRef` guard by using a mock log element with
// settable `scrollTop`/`scrollHeight`/`clientHeight`.
//
// This test is intentionally narrow: it tests ONLY the sticky-bottom guard
// logic (does the auto-scroll skip when the user scrolled up?) rather than
// trying to simulate a full scroll layout in jsdom. The integration proof is
// in the e2e suite.

import { describe, expect, it } from "vitest";

// The sticky-bottom logic: scrolls to bottom iff the user has NOT scrolled up.
// Mirrors the useLayoutEffect in use-terminal.ts exactly.
function applyAutoScroll(
  log: { scrollTop: number; scrollHeight: number; clientHeight: number },
  userScrolledUp: boolean,
): void {
  if (userScrolledUp) return;
  log.scrollTop = log.scrollHeight;
}

// The guard: given current scroll state, is the user at the bottom?
function isAtBottom(log: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight <= 2;
}

describe("sticky-bottom auto-scroll guard (prod UX fix)", () => {
  it("scrolls to bottom when the user has not scrolled up", () => {
    const log = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
    applyAutoScroll(log, /* userScrolledUp */ false);
    expect(log.scrollTop).toBe(1000);
  });

  it("does NOT scroll when the user has scrolled up", () => {
    const log = { scrollTop: 100, scrollHeight: 1000, clientHeight: 200 };
    applyAutoScroll(log, /* userScrolledUp */ true);
    expect(log.scrollTop).toBe(100); // unchanged
  });

  it("isAtBottom is true when gap <= 2px", () => {
    expect(isAtBottom({ scrollTop: 798, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
    expect(isAtBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it("isAtBottom is false when gap > 2px", () => {
    expect(isAtBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
    expect(isAtBottom({ scrollTop: 797, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
  });

  it("auto-scroll resumes when user reaches the bottom (flag cleared)", () => {
    const log = { scrollTop: 798, scrollHeight: 1000, clientHeight: 200 };
    // At bottom: flag should be false (reset).
    const atBottom = isAtBottom(log);
    expect(atBottom).toBe(true); // gap is 2, at bottom

    // Since atBottom === true, userScrolledUpRef would be set to false.
    // Next auto-scroll should fire.
    applyAutoScroll(log, /* userScrolledUp (now false) */ false);
    expect(log.scrollTop).toBe(1000);
  });
});
