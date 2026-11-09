//
// Item 19 (P0.5): the browser Lovers client timeout must be LONGER than the
// server's whole lovers budget. The lovers rite summons + resurrects the file
// BEFORE it reaches PLAN/GENERATE, so the route runs up to a 115 s
// Overall_Budget under maxDuration = 120 s. A client timeout of 55 s (the
// generic value copied from the readings/resurrect clients, whose server
// budgets are 40/48 s) would abort a binding the server is still legitimately
// working on and surface a spurious NETWORK_TIMEOUT. The client must wait until
// AFTER the server's own deadline would have fired.
//
// Pure: imports the exported constant only; no network / timers.
import { describe, expect, it } from "vitest";

import { LOVERS_CLIENT_TIMEOUT_MS } from "./lovers-client.js";

// The server-side lovers budget + serverless backstop (handlers/lovers.ts
// OVERALL_BUDGET_MS = 115_000; route maxDuration = 120 s).
const SERVER_LOVERS_OVERALL_BUDGET_MS = 115_000;
const SERVER_LOVERS_MAX_DURATION_MS = 120_000;

describe("Item 19 (R19.*, C.6): lovers client timeout exceeds the server lovers budget", () => {
  it("is longer than the server Overall_Budget so a legit long binding is not aborted", () => {
    expect(LOVERS_CLIENT_TIMEOUT_MS).toBeGreaterThan(SERVER_LOVERS_OVERALL_BUDGET_MS);
  });

  it("is at least the serverless maxDuration backstop", () => {
    expect(LOVERS_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(SERVER_LOVERS_MAX_DURATION_MS);
  });
});
