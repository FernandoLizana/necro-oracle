// src/tarot-ceiling.test.ts
//
// Item 32 (judge-ready-pass): NECRO_TAROT_DAILY_CEILING — its own daily counter
// key, documented with UNIT (tarot LLM completions per UTC day) and DEFAULT
// (300). Mirrors the committed NECRO_LLM_DAILY_CEILING / NECRO_LOVERS_DAILY_
// CEILING shape: positive safe int, canonical decimal, blank -> default.

import { describe, expect, it } from "vitest";

import { loadEnv } from "./index.js";

/** A minimal valid env source (every field is optional / defaulted here). */
function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return { ...overrides };
}

describe("item 32: NECRO_TAROT_DAILY_CEILING", () => {
  it("defaults to 300 when unset", () => {
    const env = loadEnv(baseEnv());
    expect(env.NECRO_TAROT_DAILY_CEILING).toBe(300);
  });

  it("defaults to 300 when blank (blankToUndefined)", () => {
    const env = loadEnv(baseEnv({ NECRO_TAROT_DAILY_CEILING: "   " }));
    expect(env.NECRO_TAROT_DAILY_CEILING).toBe(300);
  });

  it("parses a positive canonical decimal to a number", () => {
    const env = loadEnv(baseEnv({ NECRO_TAROT_DAILY_CEILING: "42" }));
    expect(env.NECRO_TAROT_DAILY_CEILING).toBe(42);
  });

  it("is independent of the general and lovers ceilings", () => {
    const env = loadEnv(
      baseEnv({
        NECRO_TAROT_DAILY_CEILING: "7",
        NECRO_LLM_DAILY_CEILING: "1000",
        NECRO_LOVERS_DAILY_CEILING: "200",
      }),
    );
    expect(env.NECRO_TAROT_DAILY_CEILING).toBe(7);
    expect(env.NECRO_LLM_DAILY_CEILING).toBe(1000);
    expect(env.NECRO_LOVERS_DAILY_CEILING).toBe(200);
  });

  it("rejects a non-positive / non-canonical value by naming the key", () => {
    for (const bad of ["0", "-1", "3.5", "01", "abc"]) {
      expect(
        () => loadEnv(baseEnv({ NECRO_TAROT_DAILY_CEILING: bad })),
        `"${bad}" should be rejected`,
      ).toThrow(/NECRO_TAROT_DAILY_CEILING/);
    }
  });
});