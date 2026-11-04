// Public API surface (task 30.1). Requirements: R10.1–R10.7.
// Fails until src/index.ts exports the designed API (task 30.2).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GitHubSnapshotBuilder } from "@necro/oracle";
import * as api from "./index.js";
import {
  createSummoner,
  GitHubSummoner,
  type ClockPort,
  type DegradedCause,
  type DegradedField,
  type EnvPort,
  type ExternalDataResult,
  type ExtractionLimits,
  type FetchPort,
  type FetchRequest,
  type FetchResponse,
  type MappedMeta,
  type MetaInputs,
  type OptionalOutcome,
  type ParsedRepoRef,
  type SkippedDependency,
  type SkipReason,
  type SummonerDeps,
  type SummonerErrorCode,
  type SummonerOptions,
  type SummonExtras,
  type SummonResult,
} from "./index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const RUNTIME_EXPORTS = [
  "parseRepoRef",
  "resolveRef",
  "ParsedRepoRefSchema",
  "GitHubSummoner",
  "createSummoner",
  "fetchExternalData",
  "mapRepoMeta",
  "cacheKey",
  "effectiveTtlMs",
  "SnapshotCache",
  "GitHubClient",
  "SummonerError",
  "DEFAULT_LIMITS",
  "FetchTransportError",
  "createSystemFetchPort",
  "systemClock",
] as const;

describe("public API (R10.1, R10.2, R10.3, R10.4, R10.5, R10.6, R10.7)", () => {
  it("exports every designed runtime name from src/index.ts alone", () => {
    for (const name of RUNTIME_EXPORTS) {
      expect(api, `missing export ${name}`).toHaveProperty(name);
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("exports nothing beyond the designed runtime names (no GITHUB_VERSION placeholder, no internals)", () => {
    expect(Object.keys(api).sort()).toEqual([...RUNTIME_EXPORTS].sort());
  });

  it("exports callables and classes with the expected kinds", () => {
    for (const fn of ["parseRepoRef", "resolveRef", "createSummoner", "fetchExternalData", "mapRepoMeta", "cacheKey", "effectiveTtlMs", "createSystemFetchPort"] as const) {
      expect(typeof api[fn], fn).toBe("function");
    }
    for (const cls of ["GitHubSummoner", "SnapshotCache", "GitHubClient", "SummonerError", "FetchTransportError"] as const) {
      expect(typeof api[cls], cls).toBe("function");
    }
    expect(typeof api.systemClock.nowMs).toBe("function");
    expect(typeof api.DEFAULT_LIMITS).toBe("object");
    expect(typeof api.ParsedRepoRefSchema.safeParse).toBe("function");
  });

  it("does not export resolveRefDetailed (internal to GitHubSummoner)", () => {
    expect(api).not.toHaveProperty("resolveRefDetailed");
  });

  it("does not export any testing/ helper", async () => {
    const dir = path.join(HERE, "testing");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    const exported = new Set(Object.keys(api));
    for (const f of files) {
      const mod = (await import(/* @vite-ignore */ `./testing/${f.replace(/\.ts$/, ".js")}`)) as Record<string, unknown>;
      for (const name of Object.keys(mod)) {
        expect(exported.has(name), `${f} helper ${name} leaked through index`).toBe(false);
      }
    }
  });

  it("createSummoner returns a GitHubSummoner usable as GitHubSnapshotBuilder", () => {
    const deps: SummonerDeps = {
      fetch: (() => Promise.reject(new Error("no network in tests"))) as FetchPort,
      clock: api.systemClock,
      env: { get: () => undefined },
    };
    const _: GitHubSnapshotBuilder = createSummoner(deps);
    const __: GitHubSnapshotBuilder = new GitHubSummoner(deps);
    expect(_).toBeInstanceOf(GitHubSummoner);
    expect(typeof _.build).toBe("function");
    expect(__).toBeInstanceOf(GitHubSummoner);
  });

  it("re-exports the associated types (compile-time)", () => {
    // Type-only: if any name is missing, typecheck fails; at runtime this is a no-op.
    type Surface = [
      ClockPort,
      DegradedCause,
      DegradedField,
      EnvPort,
      ExternalDataResult,
      ExtractionLimits,
      FetchRequest,
      FetchResponse,
      MappedMeta,
      MetaInputs,
      OptionalOutcome<unknown>,
      ParsedRepoRef,
      SkippedDependency,
      SkipReason,
      SummonerErrorCode,
      SummonerOptions,
      SummonExtras,
      SummonResult,
    ];
    const marker: Surface | undefined = undefined;
    expect(marker).toBeUndefined();
  });
});
