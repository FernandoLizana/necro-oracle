/**
 * P0 (skeleton): Monorepo bootstrap — oracle package exports a version string.
 *
 * This is an intentionally trivial test that exists solely to prove the
 * test pipeline (Vitest + TypeScript ESM) is wired correctly.  It will be
 * replaced by real unit tests as detectors and spreads are implemented.
 */
import { describe, expect, it } from "vitest";
import { ORACLE_VERSION } from "./index.js";

describe("P0 (skeleton): @necro/oracle exports", () => {
  it("exports a non-empty version string", () => {
    expect(typeof ORACLE_VERSION).toBe("string");
    expect(ORACLE_VERSION.length).toBeGreaterThan(0);
  });
});
