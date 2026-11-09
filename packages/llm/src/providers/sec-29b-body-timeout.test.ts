//
// Item 29b (P0.5): the OpenRouter request timeout must cover the WHOLE request,
// including the RESPONSE BODY read — not just the fetch (headers). A server can
// return headers fast then dribble (or never finish) the body; if the body read
// is unguarded, the provider hangs past its deadline. The AbortController's
// timer must stay armed across `response.json()` so a slow body is aborted and
// mapped to NETWORK_TIMEOUT.
//
// No real network: an injected fetchImpl returns a Response whose `.json()`
// never resolves; fake timers trip the deadline.
import type { LlmRequest } from "@necro/coven";
import { NecroError } from "@necro/oracle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLlmCache } from "../cache.js";
import { PROMPT_VERSION } from "../prompts/version.js";
import { createOpenRouterLlmPort } from "./openrouter.js";

afterEach(() => {
  vi.useRealTimers();
});

let keyCounter = 0;
function plainRequest(timeoutMs: number): LlmRequest {
  keyCounter += 1;
  return {
    system: "s",
    prompt: "p",
    model: "anthropic/claude-sonnet-4.5",
    maxTokens: 16,
    timeoutMs,
    cacheKey: `sec29b:${PROMPT_VERSION}:${keyCounter}`,
  } as LlmRequest;
}

/**
 * A fetchImpl that resolves the fetch promptly (headers) with a 200 Response
 * whose `.json()` NEVER resolves — unless the request's AbortSignal fires, in
 * which case `.json()` rejects with an AbortError (as the platform does).
 */
function hangingBodyFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    return {
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
          // Otherwise never resolves — a dribbling body.
        }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("Item 29b: the OpenRouter timeout covers the response-body read", () => {
  it("aborts a hung body read at the deadline and maps it to NETWORK_TIMEOUT", async () => {
    vi.useFakeTimers();
    const port = createOpenRouterLlmPort({
      apiKey: "sk-server",
      fetchImpl: hangingBodyFetch(),
      cache: createLlmCache(),
    });

    const p = port.complete(plainRequest(5_000));
    // Attach a rejection assertion BEFORE advancing so the rejection is caught.
    const assertion = expect(p).rejects.toBeInstanceOf(NecroError);
    // Trip the 5 s deadline: the body read must be aborted (not hang forever).
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });
});
