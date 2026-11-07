// @necro/llm — golden-fixture tests for the OpenRouter LlmPort provider
// (task 4.2; R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R2.6, R7.1, R9.3, R10.1,
// R43.3).
//
// These are NO-NETWORK golden-fixture tests: the provider is driven with an
// INJECTED `fetchImpl` that returns RECORDED fixtures and records the exact
// request the provider put on the wire. No socket is ever opened — the fixtures
// stand in for OpenRouter's responses, exactly as the tech-stack testing rule
// (no network/LLM/sandbox in unit tests) and the design A.2 injectable-fetch
// seam require.
//
// The fixtures are KEYED PER `PROMPT_VERSION` (R8.4): `GOLDEN_FIXTURES` is a
// record indexed by prompt version, and every test resolves its fixture bundle
// through the live `PROMPT_VERSION` constant. A prompt-template change bumps
// `PROMPT_VERSION`, which means the old key no longer resolves and the
// `ACTIVE_FIXTURES` lookup fails deterministically until the fixtures are
// re-recorded for the new version. This versions the golden data the same way
// the completion cache is versioned.
//
// Coverage (task 4.2):
//   - request body shape: `response_format`, `temperature` EXACTLY 0,
//     `max_tokens`, `models` fallback array, `provider.require_parameters:true`
//     present ONLY when the structured descriptor (response_format + temperature
//     + max_tokens) is set, and NO `seed` field anywhere in the body;
//   - header handling: `Authorization: Bearer <opts.apiKey ?? serverKey>`
//     (the BYOK per-call override, mirroring `X-Necro-User-Key` upstream),
//     `HTTP-Referer`, `X-Title`;
//   - usage accounting: `usage.{prompt_tokens,completion_tokens,cost}` and the
//     SERVED `model` extracted into a `UsageRecord`;
//   - a decline / low-confidence structured response path: the provider returns
//     the recorded content verbatim (it never interprets confidence) and the
//     caller's `parseStructured` sees a `confidence: 0` edit;
//   - error mapping: `401`/`402` -> `UPSTREAM_UNAVAILABLE`,
//     timeout/abort -> `NETWORK_TIMEOUT`;
//   - the shared-cache `cached` flag (identical to Mock).
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.6, 7.1, 9.3, 10.1, 43.3

import type { LlmRequest } from "@necro/coven";
import { NecroError } from "@necro/oracle";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { createLlmCache } from "../cache.js";
import { PROMPT_VERSION } from "../prompts/version.js";
import { structuredRequestFields } from "../response/structured.js";
import {
  createOpenRouterLlmPort,
  OPENROUTER_URL,
  NECRO_PUBLIC_URL,
} from "./openrouter.js";

// ---------------------------------------------------------------------------
// Recorded fixtures, keyed per PROMPT_VERSION.
//
// Each bundle is a frozen set of OpenRouter chat-completion response bodies for
// one prompt version. The provider is version-agnostic, but keying the fixtures
// by `PROMPT_VERSION` means a prompt-template bump invalidates the recorded data
// deterministically: `ACTIVE_FIXTURES` would stop resolving and every test that
// reads it fails until the bundle is re-recorded for the new version.
// ---------------------------------------------------------------------------

interface OpenRouterResponseFixture {
  /** The served model id (may differ from the requested model on fallback). */
  readonly model: string;
  readonly choices: readonly {
    readonly message: { readonly role: "assistant"; readonly content: string };
  }[];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly cost: number;
  };
}

interface GoldenFixtureBundle {
  /** A normal, high-confidence structured chunk edit the gate would accept. */
  readonly accepted: OpenRouterResponseFixture;
  /** A DECLINE response: a well-formed edit whose `confidence` is 0. */
  readonly decline: OpenRouterResponseFixture;
}

/**
 * Golden fixtures indexed by prompt version. Re-record the active bundle (and
 * add a new key) whenever `PROMPT_VERSION` changes.
 */
const GOLDEN_FIXTURES: Readonly<Record<string, GoldenFixtureBundle>> = {
  v1: {
    accepted: {
      model: "anthropic/claude-sonnet-4.5",
      choices: [
        {
          message: {
            role: "assistant",
            content:
              '{"chunkId":"sample.py#1-1","replacementCode":"print(\\"hi\\", name)","requiredImports":[],"reason":"Converted the print statement to a print() call.","confidence":1}',
          },
        },
      ],
      usage: { prompt_tokens: 412, completion_tokens: 37, cost: 0.0018 },
    },
    decline: {
      model: "openai/gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content:
              '{"chunkId":"sample.py#2-4","replacementCode":"","requiredImports":[],"reason":"Could not resolve the metaclass rewrite with certainty.","confidence":0}',
          },
        },
      ],
      usage: { prompt_tokens: 980, completion_tokens: 11, cost: 0.00005 },
    },
  },
};

/**
 * The fixture bundle for the LIVE prompt version. If `PROMPT_VERSION` is bumped
 * without re-recording, this is `undefined` and `activeFixtures()` throws — the
 * deterministic "stale fixtures" failure.
 */
function activeFixtures(): GoldenFixtureBundle {
  const bundle = GOLDEN_FIXTURES[PROMPT_VERSION];
  if (bundle === undefined) {
    throw new Error(
      `No golden fixtures recorded for PROMPT_VERSION "${PROMPT_VERSION}". ` +
        "Re-record GOLDEN_FIXTURES for the current prompt version.",
    );
  }
  return bundle;
}

// ---------------------------------------------------------------------------
// Fixture responder + request capture (injected `fetchImpl`, no socket).
// ---------------------------------------------------------------------------

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

interface FixtureFetch {
  readonly fetchImpl: typeof fetch;
  readonly captured: CapturedRequest[];
}

/** Build a `fetchImpl` that records the request and returns `fixture` as JSON. */
function fixtureResponder(
  fixture: OpenRouterResponseFixture,
  init: { status?: number } = {},
): FixtureFetch {
  const captured: CapturedRequest[] = [];
  const fetchImpl = (async (url: string, request?: RequestInit) => {
    captured.push({
      url: String(url),
      method: String(request?.method ?? "GET"),
      headers: { ...((request?.headers as Record<string, string>) ?? {}) },
      body: JSON.parse(String(request?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(fixture), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, captured };
}

// ---------------------------------------------------------------------------
// Request builders.
// ---------------------------------------------------------------------------

/** The strict chunk-edit schema the structured descriptor is generated from. */
const ChunkEditSchema = z
  .object({
    chunkId: z.string().describe("The stable chunk id the edit echoes."),
    replacementCode: z.string().describe("The Python 3 replacement."),
    requiredImports: z.array(z.string()).describe("Stdlib imports to hoist."),
    reason: z.string().describe("One sentence naming what changed."),
    confidence: z.number().describe("0..1; 0 means decline."),
  })
  .strict();

const MAX_TOKENS = 1024;

/** A plain (schema-free) request — no structured descriptor. */
function plainRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    system: "Convert the single Python 2 construct to Python 3.",
    prompt: "print 'hi'",
    maxTokens: MAX_TOKENS,
    timeoutMs: 20_000,
    cacheKey: "k-plain",
    model: "anthropic/claude-sonnet-4.5",
    promptVersion: PROMPT_VERSION,
    ...overrides,
  };
}

/** A structured request carrying the `response_format` + `provider` descriptor. */
function structuredRequest(
  overrides: Partial<LlmRequest> = {},
): LlmRequest & { readonly structured: ReturnType<typeof structuredRequestFields> } {
  return {
    ...plainRequest({ cacheKey: "k-structured", ...overrides }),
    structured: structuredRequestFields("ChunkEdit", ChunkEditSchema, MAX_TOKENS),
  };
}

/** OpenRouter fallback array used across the body-shape assertions. */
const MODELS_FALLBACK = [
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-4o-mini",
] as const;

// ===========================================================================

describe("R1.2, R43.3 (task 4.2): request body shape per PROMPT_VERSION", () => {
  it("resolves a golden fixture bundle for the live PROMPT_VERSION", () => {
    // Guards the whole suite: a version bump without re-recorded fixtures fails
    // here deterministically rather than silently testing stale data.
    expect(() => activeFixtures()).not.toThrow();
  });

  it("sends response_format, temperature 0, max_tokens, and the models fallback array", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({
      apiKey: "sk-server",
      fetchImpl,
      cache: createLlmCache(),
      models: [...MODELS_FALLBACK],
    });

    await port.complete(structuredRequest());

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body;
    expect(captured[0]!.url).toBe(OPENROUTER_URL);
    expect(captured[0]!.method).toBe("POST");

    // temperature is EXACTLY 0 (determinism = temp 0 + cache).
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(body.models).toEqual([...MODELS_FALLBACK]);

    // response_format is the strict json_schema descriptor.
    const responseFormat = body.response_format as Record<string, unknown>;
    expect(responseFormat.type).toBe("json_schema");
    const jsonSchema = responseFormat.json_schema as Record<string, unknown>;
    expect(jsonSchema.name).toBe("ChunkEdit");
    expect(jsonSchema.strict).toBe(true);
  });

  it("sends provider.require_parameters:true ONLY alongside response_format + temperature + max_tokens", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(structuredRequest());

    const body = captured[0]!.body;
    // The structured trio travels together; provider.require_parameters is set.
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format).toBeDefined();
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(MAX_TOKENS);
  });

  it("omits provider and response_format on a plain (schema-free) request", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(plainRequest());

    const body = captured[0]!.body;
    // No descriptor => no structured fields, but temperature is still 0.
    expect(body.provider).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(MAX_TOKENS);
  });

  it("NEVER puts a seed field anywhere in the request body", async () => {
    const { accepted } = activeFixtures();

    for (const req of [plainRequest(), structuredRequest()]) {
      const { fetchImpl, captured } = fixtureResponder(accepted);
      const port = createOpenRouterLlmPort({
        apiKey: "sk-server",
        fetchImpl,
        models: [...MODELS_FALLBACK],
      });
      await port.complete(req);

      const body = captured[0]!.body;
      // Top-level and nested: a seed would exclude Claude under require_parameters.
      expect("seed" in body).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/"seed"/);
    }
  });

  it("places the system message first and the untrusted prompt second", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(
      plainRequest({ system: "SYS", prompt: "USERCODE" }),
    );

    const messages = captured[0]!.body.messages as readonly {
      role: string;
      content: string;
    }[];
    expect(messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USERCODE" },
    ]);
  });

  it("uses opts.modelOverride ?? req.model as the body model", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(plainRequest({ model: "requested/model" }), {
      modelOverride: "override/model",
    });

    expect(captured[0]!.body.model).toBe("override/model");
  });
});

describe("R1.3, R2.6, R9.3 (task 4.2): Authorization + attribution headers", () => {
  it("uses the server key when no per-call BYOK key is given", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(plainRequest());

    const headers = captured[0]!.headers;
    expect(headers.Authorization).toBe("Bearer sk-server");
    expect(headers["HTTP-Referer"]).toBe(NECRO_PUBLIC_URL);
    expect(headers["X-Title"]).toBe("Necro-Oracle");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("prefers the per-call BYOK key (X-Necro-User-Key path) over the server key", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await port.complete(plainRequest(), { apiKey: "sk-user-byok" });

    expect(captured[0]!.headers.Authorization).toBe("Bearer sk-user-byok");
  });

  it("honours a configured referer/title override", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({
      apiKey: "sk-server",
      fetchImpl,
      referer: "https://example.test",
      title: "Custom-Title",
    });

    await port.complete(plainRequest());

    const headers = captured[0]!.headers;
    expect(headers["HTTP-Referer"]).toBe("https://example.test");
    expect(headers["X-Title"]).toBe("Custom-Title");
  });
});

describe("R7.1, R43.3 (task 4.2): usage accounting + parsed result", () => {
  it("returns the recorded content and extracts usage into a UsageRecord", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    const result = await port.complete(structuredRequest());

    expect(result.text).toBe(accepted.choices[0]!.message.content);
    expect(result.cached).toBe(false);
    expect(result.usage).toEqual({
      model: accepted.model, // the SERVED model, not the requested id
      promptTokens: accepted.usage.prompt_tokens,
      completionTokens: accepted.usage.completion_tokens,
      costUsd: accepted.usage.cost,
    });
  });

  it("records the served (fallback) model, which may differ from the requested id", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    // Request a different id than the fixture's served model.
    const result = await port.complete(
      structuredRequest({ model: "requested/only" }),
    );

    expect(result.usage?.model).toBe(accepted.model);
    expect(result.usage?.model).not.toBe("requested/only");
  });
});

describe("R7.1 (task 4.2): decline / low-confidence structured response path", () => {
  it("returns a confidence-0 edit verbatim; the provider never interprets it", async () => {
    const { decline } = activeFixtures();
    const { fetchImpl } = fixtureResponder(decline);
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    const result = await port.complete(structuredRequest());

    // The provider is a faithful transport: the decline content comes back
    // untouched, and the caller (runner) is the one that reads confidence === 0.
    expect(result.text).toBe(decline.choices[0]!.message.content);
    const edit = ChunkEditSchema.parse(JSON.parse(result.text));
    expect(edit.confidence).toBe(0);
    expect(edit.replacementCode).toBe("");
    // Usage is still accounted even for a decline.
    expect(result.usage?.costUsd).toBe(decline.usage.cost);
  });
});

describe("R1.4, R1.5 (task 4.2): error mapping", () => {
  it("maps 401 -> UPSTREAM_UNAVAILABLE", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl } = fixtureResponder(accepted, { status: 401 });
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await expect(port.complete(plainRequest())).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("maps 402 -> UPSTREAM_UNAVAILABLE", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl } = fixtureResponder(accepted, { status: 402 });
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    const err = await port.complete(plainRequest()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("maps a 500 -> UPSTREAM_UNAVAILABLE", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl } = fixtureResponder(accepted, { status: 500 });
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await expect(port.complete(plainRequest())).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("maps an aborted fetch (timeout) -> NETWORK_TIMEOUT", async () => {
    // A fetch that rejects with an AbortError models the deadline firing.
    const fetchImpl = (async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    const err = await port
      .complete(plainRequest({ timeoutMs: 5 }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("NETWORK_TIMEOUT");
  });

  it("maps a transport failure -> UPSTREAM_UNAVAILABLE", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const port = createOpenRouterLlmPort({ apiKey: "sk-server", fetchImpl });

    await expect(port.complete(plainRequest())).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});

describe("R10.1 (task 4.2): shared-cache `cached` flag mirrors Mock", () => {
  it("misses then hits for the same cacheKey, with no second fetch", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const spy = vi.fn(fetchImpl);
    const port = createOpenRouterLlmPort({
      apiKey: "sk-server",
      fetchImpl: spy as unknown as typeof fetch,
      cache: createLlmCache(),
    });

    const req = structuredRequest({ cacheKey: "k-cache" });
    const first = await port.complete(req);
    const second = await port.complete(req);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.text).toBe(first.text);
    // The cache hit short-circuits before the network: exactly one fetch.
    expect(captured).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("treats a different cacheKey as a fresh miss (second fetch)", async () => {
    const { accepted } = activeFixtures();
    const { fetchImpl, captured } = fixtureResponder(accepted);
    const port = createOpenRouterLlmPort({
      apiKey: "sk-server",
      fetchImpl,
      cache: createLlmCache(),
    });

    await port.complete(structuredRequest({ cacheKey: "a" }));
    await port.complete(structuredRequest({ cacheKey: "b" }));

    expect(captured).toHaveLength(2);
  });
});
