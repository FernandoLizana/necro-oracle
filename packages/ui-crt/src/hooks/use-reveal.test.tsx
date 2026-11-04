// @vitest-environment jsdom
//
// `use-reveal` hook tests (task 17.1, RED). `./use-reveal.js` is created by
// task 17.2, so the import fails first (expected red).
//
// Validates: Requirements R10.1, R10.2, R10.3, R10.8, R10.11, R16.9
//
// `use-reveal` drives the typewriter reveal entirely through the injected
// `FramePort`: it schedules a frame only while there is a block to reveal and
// the motion mode is `full`, advances the revealed-character count from the
// frame clock, and completes a reveal (or every reveal) on demand. In `reduced`
// mode it reveals nothing and schedules no frame. The fake `FramePort` has a
// manual clock, so the schedule is asserted deterministically with no real
// `requestAnimationFrame` and no wall-clock time.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeFakeFrames } from "../testing/fake-ports.js";

// The system under test — created by task 17.2.
import { useReveal } from "./use-reveal.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R10.1 / R10.2 (reveal): the count advances from the frame clock in full motion", () => {
  it("schedules a frame while a reveal is pending and advances the count over time", () => {
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    renderHook(() =>
      useReveal({
        frames,
        motionMode: "full",
        pending: true,
        onTick,
      }),
    );

    // A pending reveal in full motion requests at least one animation frame.
    expect(frames.pending()).toBeGreaterThanOrEqual(1);

    // Advancing the clock runs the frame callback, which reports progress.
    act(() => {
      frames.advance(100);
    });
    expect(onTick).toHaveBeenCalled();
    const nowArg = onTick.mock.calls.at(-1)?.[0];
    expect(typeof nowArg).toBe("number");
  });
});

describe("R10.3 / R10.11 / R16.9 (reduced): no frame is scheduled and nothing reveals", () => {
  it("requests no animation frame in reduced mode", () => {
    const frames = makeFakeFrames();
    renderHook(() =>
      useReveal({
        frames,
        motionMode: "reduced",
        pending: true,
        onTick: vi.fn(),
      }),
    );
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
  });

  it("requests no animation frame when nothing is pending, even in full motion", () => {
    const frames = makeFakeFrames();
    renderHook(() =>
      useReveal({
        frames,
        motionMode: "full",
        pending: false,
        onTick: vi.fn(),
      }),
    );
    expect(frames.requestCount()).toBe(0);
  });
});

describe("R10.8 (cleanup): the hook cancels its pending frame on unmount", () => {
  it("leaves no scheduled frame after unmount", () => {
    const frames = makeFakeFrames();
    const { unmount } = renderHook(() =>
      useReveal({
        frames,
        motionMode: "full",
        pending: true,
        onTick: vi.fn(),
      }),
    );
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
    act(() => {
      unmount();
    });
    expect(frames.pending()).toBe(0);
  });
});
