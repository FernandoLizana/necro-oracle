// @vitest-environment jsdom
//
// `use-motion` hook tests (task 17.1, RED). `./use-motion.js` is created by
// task 17.2, so the import fails first (expected red).
//
// Validates: Requirements R10.3, R10.6, R10.7
//
// `use-motion` subscribes to the injected `MediaPort` and reports the current
// `prefers-reduced-motion` match, re-rendering when the system preference
// changes so the resolved motion mode tracks the query without a reload
// (R10.6). It unsubscribes on unmount. The fake `MediaPort` is flipped by the
// test, so no real `matchMedia` is touched.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeFakeMedia } from "../testing/fake-ports.js";

// The system under test — created by task 17.2.
import { useMotion } from "./use-motion.js";

describe("R10.6 / R10.7 (motion): the hook tracks the reduced-motion query live", () => {
  it("reports the initial match and updates when the query flips", () => {
    const media = makeFakeMedia(false);
    const { result } = renderHook(() => useMotion(media));
    expect(result.current.prefersReduced).toBe(false);

    act(() => {
      media.emit(true);
    });
    expect(result.current.prefersReduced).toBe(true);

    act(() => {
      media.emit(false);
    });
    expect(result.current.prefersReduced).toBe(false);
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const media = makeFakeMedia(false);
    const { unmount } = renderHook(() => useMotion(media));
    expect(media.subscriberCount()).toBe(1);
    act(() => {
      unmount();
    });
    expect(media.subscriberCount()).toBe(0);
  });
});
