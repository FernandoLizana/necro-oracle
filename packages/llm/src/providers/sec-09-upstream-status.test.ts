//
// SEC-09 (upstream status mapping + bounded retry) — the OpenRouter provider
// must map upstream failures to DISTINCT NecroError codes so the UI and the
// handlers can react differently:
//   - 401 (auth)        -> AUTH_INVALID        (the key is bad)
//   - 402 (credit)      -> UPSTREAM_UNAVAILABLE with a credit-specific message
//   - 429 (rate limit)  -> RATE_LIMITED
//   - 5xx / other       -> UPSTREAM_UNAVAILABLE
// and must NEVER silently fall back to the server key (the handler owns any
// fallback). It retries AT MOST ONCE, and ONLY on a transient 429/5xx; it does
// NOT retry a 401/402 (retrying a bad key or an empty balance is pointless and
// wastes BYOK quota).
//
// No network: an injected fetchImpl returns a scripted status sequence.
import type { LlmRequest } from "@necro/coven";
import { NecroError } from "@necro/oracle";
import { describe, expect, it } from "vitest";

import { createLlmCache } from "../cache.js";
import { PROMPT_VERSION } from "../prompts/version.js";
import { createOpenRouterLlmPort } from "./openrouter.js";

const OK_BODY = {
  model: "anthropic/claude-sonnet-4.5",
  choices: [{ message: { role: "assistant", content: "ok" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 },
};

/** A fetchImpl that walks a scripted list of HTTP statuses, counting calls. */
function sequenceResponder(statuses: readonly number[]): {
  fetchImpl: typeof fetch;
  calls: () => number;
} {
  let i = 0;
  const fetchImpl = (async () => {
    const status = statuses[Math.min(i, statuses.length - 1)] ?? 200;
    i += 1;
    return new Response(JSON.stringify(OK_BODY), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => i };
}

let keyCounter = 0;
function plainRequest(): LlmRequest {
  keyCounter += 1;
  return {
    system: "s",
    prompt: "p",
    model: "anthropic/claude-sonnet-4.5",
    maxTokens: 16,
    timeoutMs: 1_000,
    // A fresh cache key each request so a retry test never hits a cached entry.
    cacheKey: `sec09:${PROMPT_VERSION}:${keyCounter}`,
  } as LlmRequest;
}

function portWith(statuses: readonly number[]) {
  const { fetchImpl, calls } = sequenceResponder(statuses);
  const port = createOpenRouterLlmPort({
    apiKey: "sk-server",
    fetchImpl,
    cache: createLlmCache(),
  });
  return { port, calls };
}

describe("SEC-09: distinct upstream status codes", () => {
  it("maps 401 -> AUTH_INVALID", async () => {
    const { port } = portWith([401]);
    const err = (await port.complete(plainRequest()).catch((e: unknown) => e)) as NecroError;
    expect(err).toBeInstanceOf(NecroError);
    expect(err.code).toBe("AUTH_INVALID");
  });

  it("maps 429 -> RATE_LIMITED", async () => {
    // 429 twice so the single retry is also 429 and the error surfaces.
    const { port } = portWith([429, 429]);
    const err = (await port.complete(plainRequest()).catch((e: unknown) => e)) as NecroError;
    expect(err).toBeInstanceOf(NecroError);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("maps 402 -> UPSTREAM_UNAVAILABLE (credit, not auth)", async () => {
    const { port } = portWith([402]);
    const err = (await port.complete(plainRequest()).catch((e: unknown) => e)) as NecroError;
    expect(err).toBeInstanceOf(NecroError);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("maps 500 -> UPSTREAM_UNAVAILABLE after exhausting the retry", async () => {
    const { port } = portWith([500, 500]);
    const err = (await port.complete(plainRequest()).catch((e: unknown) => e)) as NecroError;
    expect(err).toBeInstanceOf(NecroError);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("SEC-09: bounded retry (<= 1) on transient 429/5xx only", () => {
  it("retries ONCE on a 500 then succeeds (2 fetch calls total)", async () => {
    const { port, calls } = portWith([500, 200]);
    const result = await port.complete(plainRequest());
    expect(result.text).toBe("ok");
    expect(calls()).toBe(2);
  });

  it("retries ONCE on a 429 then succeeds (2 fetch calls total)", async () => {
    const { port, calls } = portWith([429, 200]);
    const result = await port.complete(plainRequest());
    expect(result.text).toBe("ok");
    expect(calls()).toBe(2);
  });

  it("does NOT retry a 401 (exactly 1 fetch call)", async () => {
    const { port, calls } = portWith([401, 200]);
    await port.complete(plainRequest()).catch(() => undefined);
    expect(calls()).toBe(1);
  });

  it("does NOT retry a 402 (exactly 1 fetch call)", async () => {
    const { port, calls } = portWith([402, 200]);
    await port.complete(plainRequest()).catch(() => undefined);
    expect(calls()).toBe(1);
  });

  it("retries AT MOST once: two consecutive 500s is 2 calls, not more", async () => {
    const { port, calls } = portWith([500, 500, 200]);
    await port.complete(plainRequest()).catch(() => undefined);
    expect(calls()).toBe(2);
  });
});
