// Unit tests for the Demo_Mode port assembly and the outbound-network guard
// (task 16.2; R14.2, R14.4).

import { afterEach, describe, expect, it, vi } from "vitest";

import { NecroError } from "@necro/oracle";

import type { ClockPort, LedgerPort, LlmPort } from "../ports.js";
import {
  createDemoPorts,
  demoNetworkBlockedError,
  installNetworkBlockGuard,
} from "./ports.js";

/** A no-op clock/ledger and a trivial Mock-shaped LlmPort for assembly tests. */
const clock: ClockPort = { nowMs: () => 0 };
const ledger: LedgerPort = { append: () => Promise.resolve() };
const mockLlm: LlmPort = {
  providerId: "mock",
  complete: () => Promise.resolve({ text: "", cached: false }),
};

describe("createDemoPorts (R14.4)", () => {
  it("wires the injected Mock LlmPort and omits the sandbox", () => {
    const ports = createDemoPorts({ llm: mockLlm, clock, ledger });

    expect(ports.llm).toBe(mockLlm);
    expect(ports.clock).toBe(clock);
    expect(ports.ledger).toBe(ledger);
    // The sandbox is intentionally ABSENT so the demo touches no micro-VM and
    // no sandbox network — the Target_Parser validates (R14.2/R14.5).
    expect("sandbox" in ports).toBe(false);
    expect(ports.sandbox).toBeUndefined();
  });

  it("is not Degraded_Mode: an LlmPort is present", () => {
    const ports = createDemoPorts({ llm: mockLlm, clock, ledger });
    expect(ports.llm).toBeDefined();
  });
});

describe("installNetworkBlockGuard (R14.2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    // Restore whatever the host had, regardless of test outcome.
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("replaces fetch with a guard that rejects with a typed NecroError", async () => {
    const restore = installNetworkBlockGuard();
    try {
      await expect(
        (globalThis.fetch as (...a: unknown[]) => Promise<unknown>)(
          "https://example.com",
        ),
      ).rejects.toBeInstanceOf(NecroError);
    } finally {
      restore();
    }
  });

  it("the blocked error carries the right code and leaks no path/secret/stack", () => {
    const err = demoNetworkBlockedError();
    expect(err).toBeInstanceOf(NecroError);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.userMessage.length).toBeGreaterThan(0);
    expect(err.userMessage).not.toMatch(/https?:\/\//);
    expect(err.userMessage.toLowerCase()).not.toContain("error:");
  });

  it("restore puts the original fetch back", () => {
    const sentinel = (() => Promise.resolve()) as unknown as typeof fetch;
    (globalThis as { fetch?: unknown }).fetch = sentinel;

    const restore = installNetworkBlockGuard();
    expect(globalThis.fetch).not.toBe(sentinel);
    restore();
    expect(globalThis.fetch).toBe(sentinel);
  });

  it("restore is idempotent and does not clobber a later replacement", () => {
    const restore = installNetworkBlockGuard();
    const later = (() => Promise.resolve()) as unknown as typeof fetch;
    (globalThis as { fetch?: unknown }).fetch = later;

    restore();
    restore(); // second call is a no-op
    // The guard only restores if it is still the installed fetch; something
    // replaced it, so `later` is left in place.
    expect(globalThis.fetch).toBe(later);
  });
});
