//
// SEC-06 (LLM quotas) â€” the configured per-reading call cap
// (`NECRO_LLM_MAX_CALLS_PER_READING`) must be WIRED into the LocalCovenRunner
// the composition root builds. The runner supports the cap (defaulting to 12),
// but composition built `new LocalCovenRunner(registry)` with no options, so
// the configured value was dead config and the runner always used 12.
//
// The daily request ceiling (`NECRO_DAILY_REQUEST_CEILING`) is already wired
// into the per-IP rate-limit chain (createRouteDeps); BYOK (soulSource=YOURS)
// skipping the server spend ceiling is a per-request route decision covered by
// the lovers/resurrect handler tests.
//
// Pure: `@necro/coven` is mocked to capture the runner constructor options.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Composition from "./composition.js";
import type * as NecroCoven from "@necro/coven";
type NecroCovenModule = typeof NecroCoven;

const capturedRunnerOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock("server-only", () => ({}));
vi.mock("@necro/coven", async (importOriginal) => {
  const actual = await importOriginal<NecroCovenModule>();
  class SpyCovenRunner {
    constructor(_registry: unknown, options?: Record<string, unknown>) {
      capturedRunnerOptions.push(options);
    }
    async run() {
      return { result: null, error: null } as unknown;
    }
  }
  return { ...actual, LocalCovenRunner: SpyCovenRunner };
});

const ENV: Record<string, string | undefined> = {
  OPENROUTER_API_KEY: "sk-server-key-present-000000",
  NECRO_LLM_MODEL_FAST: "openai/gpt-4o-mini",
  NECRO_LLM_MODEL_STRONG: "anthropic/claude-3.5-sonnet",
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
  NECRO_LLM_MAX_CALLS_PER_READING: "5",
};

async function freshComposition(): Promise<typeof Composition> {
  vi.doMock("server-only", () => ({}));
  return import("./composition.js");
}

describe("SEC-06 (R36.1): NECRO_LLM_MAX_CALLS_PER_READING is wired into the runner", () => {
  beforeEach(() => {
    capturedRunnerOptions.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the configured per-reading call cap to LocalCovenRunner", async () => {
    const { getResurrectDeps } = await freshComposition();
    getResurrectDeps(ENV);
    expect(capturedRunnerOptions.length).toBeGreaterThanOrEqual(1);
    const opts = capturedRunnerOptions[0];
    expect(opts).toBeDefined();
    expect(opts?.maxLlmCallsPerReading).toBe(5);
  });
});
