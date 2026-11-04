// Scaffolding smoke test (task 2.1). Requirements: R9.1, R9.5, R10.7.
import { describe, expect, it } from "vitest";
import type { GitHubSnapshotBuilder } from "@necro/oracle";

// Compile-time only: proves the type is importable from the oracle entry.
export type _BuilderIsImportable = GitHubSnapshotBuilder;

describe("scaffolding (R9.1, R9.5, R10.7)", () => {
  it("global fetch throws when called (vitest.setup.ts is active)", () => {
    expect(() => globalThis.fetch("https://example.invalid/")).toThrow();
  });

  it("@necro/oracle resolves under Vitest and exposes the snapshot surface", async () => {
    const oracle = await import("@necro/oracle");
    expect(typeof oracle.buildSnapshotFromFileMap).toBe("function");
    expect(typeof oracle.parseAllManifests).toBe("function");
    expect(typeof oracle.NecroError).toBe("function");
  });
});
