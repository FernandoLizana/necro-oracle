//
// SEC-03 (BYOK transport) â€” the server must WIRE the configured public URL as
// the OpenRouter `HTTP-Referer` for BOTH the server-key provider and the
// per-request BYOK provider (`makeUserLlm`). The user supplies NO base URL and
// NO referer; the only user-controlled transport input is the dedicated
// `X-Necro-User-Key` header (covered by user-key.ts / user-key.pbt.test.ts).
//
// Regression: before the fix, `NECRO_PUBLIC_URL` was declared + validated in
// `@necro/config` and documented as the referer source, but `composition.ts`
// never passed `referer` into `createOpenRouterLlmPort`, so a configured
// public URL was dead config and the provider always used its hardcoded
// fallback.
//
// Pure: `@necro/llm` is mocked to capture the options; no network / LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Composition from "./composition.js";
import type * as NecroLlm from "@necro/llm";
type NecroLlmModule = typeof NecroLlm;

// Capture every options object passed to the OpenRouter factory.
const capturedOptions: Array<Record<string, unknown>> = [];

vi.mock("server-only", () => ({}));
vi.mock("@necro/llm", async (importOriginal) => {
  const actual = await importOriginal<NecroLlmModule>();
  return {
    ...actual,
    createOpenRouterLlmPort: (opts: Record<string, unknown>) => {
      capturedOptions.push(opts);
      // A minimal LlmPort stand-in; composition only stores the reference.
      return { providerId: "openrouter", complete: async () => ({ text: "" }) };
    },
  };
});

const PUBLIC_URL = "https://necro.example.test";

const ENV_WITH_KEY: Record<string, string | undefined> = {
  OPENROUTER_API_KEY: "sk-server-key-present-000000",
  NECRO_LLM_MODEL_FAST: "openai/gpt-4o-mini",
  NECRO_LLM_MODEL_STRONG: "anthropic/claude-3.5-sonnet",
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
  NECRO_PUBLIC_URL: PUBLIC_URL,
};

async function freshComposition(): Promise<typeof Composition> {
  vi.doMock("server-only", () => ({}));
  return import("./composition.js");
}

describe("SEC-03 (R27.1): the configured NECRO_PUBLIC_URL is wired as the OpenRouter referer", () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes referer = NECRO_PUBLIC_URL to the server-key provider", async () => {
    const { getResurrectDeps } = await freshComposition();
    getResurrectDeps(ENV_WITH_KEY);
    // The server provider is built eagerly when OPENROUTER_API_KEY is present.
    const serverOpts = capturedOptions.find((o) => o.apiKey === "sk-server-key-present-000000");
    expect(serverOpts).toBeDefined();
    expect(serverOpts?.referer).toBe(PUBLIC_URL);
  });

  it("passes referer = NECRO_PUBLIC_URL to the per-request BYOK provider (makeUserLlm)", async () => {
    const { getResurrectDeps } = await freshComposition();
    const deps = getResurrectDeps(ENV_WITH_KEY);
    expect(typeof deps.makeUserLlm).toBe("function");
    capturedOptions.length = 0;
    deps.makeUserLlm?.("sk-or-v1-user-key-abcdef01234567");
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.apiKey).toBe("sk-or-v1-user-key-abcdef01234567");
    expect(capturedOptions[0]?.referer).toBe(PUBLIC_URL);
  });
});
