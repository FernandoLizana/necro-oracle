// src/session/demo-seed.test.ts
//
// Feature: visual-necromancy, task 13.1.
//
// Unit tests for the pure Demo_Seed resolution helper (`isDemoSession`,
// `resolveSeed`) and the `DEMO_SEED` constant. These pin the design D6 contract
// that in Demo mode the glitch/rot seed is the fixed `DEMO_SEED`, and that
// outside Demo mode the seed is a deterministic, stable function of the Reading
// / ritual rather than a clock or unseeded randomness.
//
// Offline, pure. No network / LLM / sandbox / clock.
//
// _Requirements: R9.1, R9.3, R9.4, R12.5_

import { describe, expect, it } from "vitest";

import { DEMO_SEED } from "../demo/catalog.js";
import type {
  DemoBundle,
  ReadingResponse,
  RitualResponse,
  SummonSummary,
} from "../protocol.js";
import { initialState } from "./state.js";
import type { SessionState } from "./state.js";
import { isDemoSession, resolveSeed } from "./demo-seed.js";

function summary(demo: boolean, sha = "a".repeat(40)): SummonSummary {
  return {
    ref: { owner: "o", name: "r", sha, defaultBranch: "main" },
    stars: 0,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 1,
    truncated: false,
    ...(demo ? { demo: true as const } : {}),
  };
}

function readingResponse(id: string, demo: boolean): ReadingResponse {
  return {
    summary: summary(demo),
    reading: {
      id,
      repo: { owner: "o", name: "r", sha: "a".repeat(40), defaultBranch: "main" },
      draws: [],
      spread: [],
      vitality: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
      engineVersion: "0.0.0",
      errors: [],
    },
  };
}

function ritual(ritualId: string): RitualResponse {
  return {
    ritualId,
    selectedCount: 1,
    files: [],
    patch: "",
    beforeVitality: 10,
    afterVitality: 20,
    vitalityDelta: 10,
    changedCards: [],
    degraded: false,
    demo: false,
  };
}

const bundle: DemoBundle = {
  "lich-py2": {
    fates: readingResponse("11111111-1111-4111-8111-111111111111", true),
    necropsy: readingResponse("22222222-2222-4222-8222-222222222222", true),
  },
};

describe("DEMO_SEED (R9.1)", () => {
  it("is the fixed constant 0x6e6563 spelling 'nec'", () => {
    expect(DEMO_SEED).toBe(0x6e6563);
    expect(DEMO_SEED).toBe(7234915);
  });
});

describe("isDemoSession (R9.1, D6)", () => {
  it("is false on a fresh session (no bundle, no summary)", () => {
    expect(isDemoSession(initialState())).toBe(false);
  });

  it("is true only when a bundle is loaded AND the summary is demo", () => {
    const base = initialState();
    const demoState: SessionState = {
      ...base,
      demoBundle: bundle,
      summary: summary(true),
    };
    expect(isDemoSession(demoState)).toBe(true);
  });

  it("is false when a bundle is loaded but the live summary is not demo", () => {
    const base = initialState();
    const liveState: SessionState = {
      ...base,
      demoBundle: bundle,
      summary: summary(false),
    };
    expect(isDemoSession(liveState)).toBe(false);
  });

  it("is false when the summary is demo but no bundle has loaded yet", () => {
    const base = initialState();
    const state: SessionState = { ...base, demoBundle: null, summary: summary(true) };
    expect(isDemoSession(state)).toBe(false);
  });
});

describe("resolveSeed (R9.1, R9.3, R9.4, R12.5)", () => {
  it("returns DEMO_SEED in Demo mode", () => {
    const base = initialState();
    const demoState: SessionState = {
      ...base,
      demoBundle: bundle,
      summary: summary(true),
      lastSpread: "fates",
      readings: { fates: readingResponse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true) },
    };
    expect(resolveSeed(demoState)).toBe(DEMO_SEED);
  });

  it("ignores boot phase: demo seeding is stable whether boot played or was skipped (R12.5)", () => {
    const base = initialState();
    const common: SessionState = {
      ...base,
      demoBundle: bundle,
      summary: summary(true),
    };
    const playedBoot: SessionState = {
      ...common,
      boot: { phase: "playing", startedAtMs: 0, stepIndex: 2, seen: true },
    };
    const skippedBoot: SessionState = {
      ...common,
      boot: { phase: "done", startedAtMs: null, stepIndex: 0, seen: true },
    };
    expect(resolveSeed(playedBoot)).toBe(DEMO_SEED);
    expect(resolveSeed(skippedBoot)).toBe(DEMO_SEED);
    expect(resolveSeed(playedBoot)).toBe(resolveSeed(skippedBoot));
  });

  it("prefers the ritual id outside Demo mode and is deterministic", () => {
    const base = initialState();
    const state: SessionState = {
      ...base,
      summary: summary(false),
      lastRitual: ritual("ritual-abc"),
    };
    const seed = resolveSeed(state);
    expect(seed).toBe(resolveSeed(state));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the reading id when there is no ritual", () => {
    const base = initialState();
    const withReading: SessionState = {
      ...base,
      summary: summary(false),
      lastSpread: "necropsy",
      readings: { necropsy: readingResponse("reading-xyz", false) },
    };
    const seedA = resolveSeed(withReading);

    const differentReading: SessionState = {
      ...withReading,
      readings: { necropsy: readingResponse("reading-other", false) },
    };
    const seedB = resolveSeed(differentReading);

    expect(seedA).toBe(resolveSeed(withReading));
    expect(seedA).not.toBe(seedB);
  });

  it("falls back to the pinned ref sha when nothing has been drawn", () => {
    const base = initialState();
    const state: SessionState = { ...base, summary: summary(false, "b".repeat(40)) };
    const seed = resolveSeed(state);
    expect(seed).toBe(resolveSeed(state));
    expect(seed).not.toBe(DEMO_SEED);
  });

  it("returns DEMO_SEED as the fallback for a bare session with nothing available", () => {
    expect(resolveSeed(initialState())).toBe(DEMO_SEED);
  });
});
