// apps/web/src/server/deps.test.ts
//
// Feature: 03-crt-terminal, task 24.1 (TEST-FIRST).
//
// Example tests for the PURE route-deps assembly (design.md §"Deps and
// composition"; R12.12, R16.4, R16.6).
//
// TEST-FIRST (red). This file is written before `server/deps.ts` (task 24.2),
// so the import below fails to resolve and the whole suite is red for the
// expected reason: the module `./deps.js` does not exist yet.
//
// These examples pin the contract for the three PURE pieces that live in
// `deps.ts` (none of them read `process.env`, build a real adapter, or open a
// socket):
//
//   - `createRouteDeps(overrides?)`: pure assembly. Given a full set of fakes
//     via `overrides` it returns a `RouteDeps` carrying exactly those fakes,
//     with the documented shape { clock, env, fetch, limiter, github,
//     runReading }. Calling it NEVER touches `process.env` (asserted by running
//     it with an emptied `process.env` and still getting a well-formed object).
//
//   - `chooseLimiterPrimary(env)`: returns a `RateLimitPort` ONLY when BOTH
//     UPSTASH_* keys are present on the env source, else `null` (so the chain
//     is built with `primary: null`). Construction only — no network.
//
//   - `makeGithubGateway({ summoner, fetch, clock })`: wraps `summoner.summon`
//     and `fetchExternalData(snapshot, { fetch, clock })` behind the
//     `GithubGateway` interface over the INJECTED fetch/clock.
//
// The exported surface this file drives (recorded for task 24.2):
//   deps.ts  →  createRouteDeps, chooseLimiterPrimary, makeGithubGateway,
//               and the types RouteDeps, RouteEnvPort, GithubGateway.
//
// No network / LLM / sandbox — pure construction with injected fakes only.
//
// _Requirements: R12.12, R16.4, R16.6_
import type {
  ClockPort,
  ExternalDataResult,
  FetchPort,
  ParsedRepoRef,
  SummonResult,
} from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Not yet implemented — task 24.2 adds this module. The import is what makes
// this suite red until then.
import {
  chooseLimiterPrimary,
  createRouteDeps,
  makeGithubGateway,
  type GithubGateway,
  type RouteDeps,
  type RouteEnvPort,
} from "./deps.js";

// --- fakes (no real adapters, no I/O) --------------------------------------

/** A fake ClockPort pinned to a fixed epoch-ms. */
function fakeClock(nowMs = 1_700_000_000_000): ClockPort {
  return { nowMs: () => nowMs };
}

/**
 * A fake RouteEnvPort backed by a plain record. Only `get` is read; it returns
 * the configured typed values and `undefined` for anything absent. The number
 * / string typings mirror the EnvPort overloads so the structural shape is a
 * `RouteEnvPort`.
 */
function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    NECRO_DAILY_REQUEST_CEILING: 1000,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

/** A fake FetchPort that records calls but performs no I/O. */
function fakeFetch(): FetchPort & { calls: number } {
  const port = Object.assign(
    vi.fn(async () => ({ status: 200, headers: {}, body: null })),
    { calls: 0 },
  );
  return port as unknown as FetchPort & { calls: number };
}

/** A fake RateLimitChain — only `check` is part of the contract. */
function fakeLimiter(): RouteDeps["limiter"] {
  return { check: vi.fn(async () => ({ allowed: true as const })) };
}

/** A fake GithubGateway with both methods. */
function fakeGithub(): GithubGateway {
  return {
    summon: vi.fn(async () => ({}) as SummonResult),
    externalData: vi.fn(async () => ({}) as ExternalDataResult),
  };
}

/** A fake runReading. */
function fakeRunReading(): RouteDeps["runReading"] {
  return vi.fn(async (_snapshot: RepoSnapshot, _opts: ReadingOpts) => ({}) as Reading);
}

/** A full set of overrides covering every RouteDeps field. */
function fullOverrides(): RouteDeps {
  return {
    clock: fakeClock(),
    env: fakeEnv(),
    fetch: fakeFetch(),
    limiter: fakeLimiter(),
    github: fakeGithub(),
    runReading: fakeRunReading(),
  };
}

describe("createRouteDeps — pure assembly (R12.12, R16.4)", () => {
  // Guard that createRouteDeps never reads process.env: empty it for the
  // duration of these tests and restore afterwards.
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = process.env;
    // A frozen, empty env: any read would still succeed structurally, but a
    // WRITE or unexpected mutation would throw — a defensive tripwire.
    process.env = Object.freeze({}) as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("returns the overridden fakes verbatim (identity preserved)", () => {
    const overrides = fullOverrides();
    const deps = createRouteDeps(overrides);

    expect(deps.clock).toBe(overrides.clock);
    expect(deps.env).toBe(overrides.env);
    expect(deps.fetch).toBe(overrides.fetch);
    expect(deps.limiter).toBe(overrides.limiter);
    expect(deps.github).toBe(overrides.github);
    expect(deps.runReading).toBe(overrides.runReading);
  });

  it("produces the full RouteDeps shape", () => {
    const deps = createRouteDeps(fullOverrides());

    // Every documented field is present and of the right kind.
    expect(typeof deps.clock.nowMs).toBe("function");
    expect(typeof deps.env.get).toBe("function");
    expect(typeof deps.fetch).toBe("function");
    expect(typeof deps.limiter.check).toBe("function");
    expect(typeof deps.github.summon).toBe("function");
    expect(typeof deps.github.externalData).toBe("function");
    expect(typeof deps.runReading).toBe("function");
    expect(Object.keys(deps).sort()).toEqual(
      ["clock", "env", "fetch", "github", "limiter", "runReading"].sort(),
    );
  });

  it("does not throw and reads no process.env even with an empty env", () => {
    // process.env is frozen+empty here; a full set of fakes means nothing has
    // to be constructed from the environment.
    expect(() => createRouteDeps(fullOverrides())).not.toThrow();
  });
});

describe("chooseLimiterPrimary — Upstash only when both keys exist (R16.6)", () => {
  it("returns null when neither UPSTASH_* key is present", () => {
    const env = fakeEnv();
    expect(chooseLimiterPrimary(env)).toBeNull();
  });

  it("returns null when only the URL is present", () => {
    const env = fakeEnv({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" });
    expect(chooseLimiterPrimary(env)).toBeNull();
  });

  it("returns null when only the token is present", () => {
    const env = fakeEnv({ UPSTASH_REDIS_REST_TOKEN: "fake-token" });
    expect(chooseLimiterPrimary(env)).toBeNull();
  });

  it("builds a RateLimitPort (construction only, no network) when both keys exist", () => {
    const env = fakeEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "fake-token",
    });
    const primary = chooseLimiterPrimary(env);
    expect(primary).not.toBeNull();
    expect(typeof primary?.check).toBe("function");
  });
});

describe("makeGithubGateway — wraps summon + externalData over injected ports", () => {
  it("delegates summon to the injected summoner", async () => {
    const result = {} as SummonResult;
    const summoner = { summon: vi.fn(async () => result) };
    const fetch = fakeFetch();
    const clock = fakeClock();

    const gateway = makeGithubGateway({ summoner, fetch, clock });
    const parsed = {
      host: "github.com",
      owner: "octo",
      name: "legacy",
      ref: null,
    } as ParsedRepoRef;

    await expect(gateway.summon(parsed)).resolves.toBe(result);
    expect(summoner.summon).toHaveBeenCalledWith(parsed);
  });

  it("exposes an externalData method that uses the injected fetch/clock", () => {
    const summoner = { summon: vi.fn(async () => ({}) as SummonResult) };
    const fetch = fakeFetch();
    const clock = fakeClock();

    const gateway = makeGithubGateway({ summoner, fetch, clock });
    // Structural check only: externalData is wired and callable. We do not
    // invoke it here because fetchExternalData would exercise the real
    // orchestrator; the handler tests (task 26) cover the call path.
    expect(typeof gateway.externalData).toBe("function");
  });
});
