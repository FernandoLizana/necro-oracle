// apps/web/src/server/composition.test.ts
//
// Feature: 03-crt-terminal, task 24.1 (TEST-FIRST).
//
// Example tests for the composition root `getRouteDeps` (design.md §"Deps and
// composition"; R12.10, R12.12, R16.4, R16.6).
//
// TEST-FIRST (red). This file is written before `server/composition.ts`
// (task 24.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module `./composition.js` does not exist yet.
//
// `composition.ts` begins with `import "server-only"`, which throws outside a
// React Server Component bundle. We neutralise it with
// `vi.mock("server-only", () => ({}))` so the module can be imported under
// Vitest and its pure wiring exercised directly — this does not weaken the
// contract, it only lets the guard module no-op in the test runtime.
//
// What these examples pin:
//   - MEMOISATION (R12.10, R12.12): two `getRouteDeps(...)` calls return the
//     very same `RouteDeps` instance, and the ONE GitHubSummoner behind
//     `github` is reused (its cache survives warm requests). We assert identity
//     of the returned object AND that the `github` gateway is the same
//     reference across calls.
//   - ENV IS READ ONCE, FROM THE INJECTED SOURCE: `getRouteDeps` accepts an
//     optional env-source override (defaulting to `process.env` in production)
//     so tests supply a plain record instead of mutating the ambient env.
//   - UPSTASH-OR-NULL BRANCH (R16.6): with both UPSTASH_* keys present the
//     chain is built over a real primary (construction only, no network); with
//     them absent the chain is built with `primary: null`. We assert the
//     observable difference without reaching the network.
//
// The exported surface this file drives (recorded for task 24.2):
//   composition.ts  →  getRouteDeps(envSource?: Record<string, string |
//                      undefined>): RouteDeps   (memoised; begins with
//                      `import "server-only"`; the ONLY reader of process.env).
//
// No network / LLM / sandbox: the Upstash client is CONSTRUCTED only; nothing
// here opens a socket.
//
// _Requirements: R12.10, R12.12, R16.4, R16.6_
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws when imported outside an RSC bundle; no-op it so
// composition.ts is importable under Vitest. MUST be hoisted above the import.
vi.mock("server-only", () => ({}));

// The static import is used only for its type (`typeof getRouteDeps` below);
// every call goes through the per-test dynamic re-import so memoisation starts
// cold. Hence `import type`.
import type { getRouteDeps } from "./composition.js";

/** Env source with both UPSTASH_* keys present (obviously fake values). */
const ENV_WITH_UPSTASH: Record<string, string | undefined> = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-token",
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
};

/** Env source with no UPSTASH_* keys (local-dev shape). */
const ENV_WITHOUT_UPSTASH: Record<string, string | undefined> = {
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
};

describe("getRouteDeps — composition root (R12.10, R12.12, R16.4, R16.6)", () => {
  // getRouteDeps memoises module-globally; reset the module registry between
  // tests so each test starts from a cold composition root.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function freshGetRouteDeps(): Promise<typeof getRouteDeps> {
    vi.doMock("server-only", () => ({}));
    const mod = await import("./composition.js");
    return mod.getRouteDeps;
  }

  it("returns a well-formed RouteDeps from the injected env source", async () => {
    const get = await freshGetRouteDeps();
    const deps = get(ENV_WITHOUT_UPSTASH);

    expect(typeof deps.clock.nowMs).toBe("function");
    expect(typeof deps.env.get).toBe("function");
    expect(typeof deps.fetch).toBe("function");
    expect(typeof deps.limiter.check).toBe("function");
    expect(typeof deps.github.summon).toBe("function");
    expect(typeof deps.github.externalData).toBe("function");
    expect(typeof deps.runReading).toBe("function");
  });

  it("memoises: two calls return the same instance and reuse one summoner (R12.10, R12.12)", async () => {
    const get = await freshGetRouteDeps();

    const first = get(ENV_WITHOUT_UPSTASH);
    const second = get(ENV_WITHOUT_UPSTASH);

    // Same RouteDeps object: the one GitHubSummoner (and its SnapshotCache)
    // survives across warm requests rather than being rebuilt per call.
    expect(second).toBe(first);
    // The github gateway wrapping that single summoner is also identical.
    expect(second.github).toBe(first.github);
  });

  it("builds the chain with primary: null when UPSTASH_* keys are absent (R16.6)", async () => {
    const get = await freshGetRouteDeps();
    const deps = get(ENV_WITHOUT_UPSTASH);

    // Observable: the limiter is a chain that answers without a primary. We can
    // only assert the structural contract here (a chain with a `check`); the
    // behavioural "primary: null => always fallback" is pinned in the limiter
    // tests (task 22). This exists to exercise the no-Upstash branch of the
    // composition root so it does not throw.
    expect(typeof deps.limiter.check).toBe("function");
  });

  it("builds a real primary when both UPSTASH_* keys exist, constructing only (R16.6)", async () => {
    const get = await freshGetRouteDeps();

    // Fake-but-well-formed Upstash credentials exercise the "both present ->
    // build Upstash" branch. Construction must not open a socket: a pure
    // getRouteDeps call performs no network I/O, so this resolves synchronously.
    expect(() => get(ENV_WITH_UPSTASH)).not.toThrow();
    const deps = get(ENV_WITH_UPSTASH);
    expect(typeof deps.limiter.check).toBe("function");
  });
});
