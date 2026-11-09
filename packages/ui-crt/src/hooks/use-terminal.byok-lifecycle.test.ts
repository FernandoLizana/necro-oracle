// @vitest-environment jsdom
//
// SEC-01 (judge-ready-pass): the BYOK key lifecycle. Clearing the key must
// abort any in-flight LLM request so a request that already copied the
// `X-Necro-User-Key` header cannot keep running under the just-revoked key.
//
// Regression: before the fix, `performEffect("byok.clear-key")` only relayed
// the clear intent to the host ref; it did NOT abort `abortRef`, so an
// in-flight `resurrect`/`lovers` fetch kept going with the header already sent.
// This drives the real `useTerminal` hook with fake ports, starts a resurrect
// (capturing its AbortSignal), submits `key clear`, and asserts the signal
// aborted.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTerminal } from "./use-terminal.js";
import { makeFakePorts } from "../testing/fake-ports.js";
import { mockReadingResponse, mockSummary } from "../testing/mock-reading.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drive summon -> read -> resolve so a completed fates reading is in scope. */
async function withReadingInScope(fakes: ReturnType<typeof makeFakePorts>, result: ReturnType<typeof renderHook<ReturnType<typeof useTerminal>, unknown>>) {
  const ctrl = result.result.current;
  await act(async () => {
    ctrl.submit("summon spooky/crypt", "enter");
  });
  await act(async () => {
    fakes.api.summons[0]!.resolve(mockSummary());
  });
  await act(async () => {
    result.result.current.submit("read fates", "enter");
  });
  await act(async () => {
    fakes.api.reads[0]!.resolve(mockReadingResponse());
  });
}

describe("SEC-01: key clear aborts an in-flight LLM request", () => {
  it("aborts the live resurrect signal when the key is cleared mid-flight", async () => {
    const clearKey = vi.fn();
    const fakes = makeFakePorts();
    const r = renderHook(() =>
      useTerminal(fakes.ports, { bootSignal: true, onClearKey: clearKey }),
    );

    await withReadingInScope(fakes, r);

    // Start a resurrect; the hook stores its AbortController in abortRef.
    await act(async () => {
      r.result.current.submit("resurrect", "enter");
    });
    expect(fakes.api.resurrects.length).toBe(1);
    const signal = fakes.api.resurrects[0]!.signal;
    expect(signal.aborted).toBe(false);

    // Clear the key while the resurrect is still in flight.
    await act(async () => {
      r.result.current.submit("key clear", "enter");
    });

    // The in-flight request's signal must now be aborted (SEC-01), and the host
    // ref-clear intent still relayed exactly once.
    expect(signal.aborted).toBe(true);
    expect(clearKey).toHaveBeenCalledTimes(1);
  });

  it("does not abort anything when key clear runs with no request in flight", async () => {
    const clearKey = vi.fn();
    const fakes = makeFakePorts();
    const r = renderHook(() =>
      useTerminal(fakes.ports, { bootSignal: true, onClearKey: clearKey }),
    );

    await act(async () => {
      r.result.current.submit("key clear", "enter");
    });

    // No crash, the clear intent relayed, and no stray resurrect/lovers call.
    expect(clearKey).toHaveBeenCalledTimes(1);
    expect(fakes.api.resurrects.length).toBe(0);
    expect(fakes.api.loversCalls.length).toBe(0);
  });
});
