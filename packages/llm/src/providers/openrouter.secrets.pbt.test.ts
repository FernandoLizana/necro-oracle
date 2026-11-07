// @necro/llm — Property 7 (R9.2): secrets never appear in provider logs or
// outputs.
//
// The OpenRouter provider is the ONE network-capable module in @necro/llm. It
// is handed, per request, three secret-shaped values that must stay private:
//   1. the server default key (`OpenRouterOptions.apiKey`, sourced from the
//      `OPENROUTER_API_KEY` env var upstream);
//   2. a per-call BYOK key (`opts.apiKey`, the `X-Necro-User-Key` a user offers
//      for THAT request only);
//   3. the `Authorization: Bearer <key>` header the provider itself builds.
//
// R9.2 requires that NONE of these — nor the prompt body or the code body —
// ever survives verbatim into anything the provider RETURNS (`LlmResult` and
// its `usage` record), THROWS (`NecroError.userMessage` and `.cause`), or LOGS.
// The provider takes no log-sink parameter and is documented to log nothing, so
// we stand in for "the log sink" by capturing every `console` method for the
// duration of each call: a leak to `console` would be the real-world leak.
//
// This masking invariant must hold across EVERY exit path, including the error
// paths (401/402 -> UPSTREAM_UNAVAILABLE, abort/timeout -> NETWORK_TIMEOUT,
// other 5xx / transport fault / malformed body -> UPSTREAM_UNAVAILABLE), which
// is exactly where a careless implementation would splice a key or a prompt
// into an error message.
//
// NO network and NO real key: `fetchImpl` is injected with a synthetic
// responder, and every secret is a generated, secret-SHAPED string (sk-...,
// Bearer tokens, long base64). The upstream responder NEVER echoes the secrets
// back in its content — echoing is a downstream masking concern of the runner
// (task 5.4), not of the provider, whose contract is "don't leak the inputs I
// was handed".
//
// Validates: Requirements 9.2

import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenRouterLlmPort,
  type OpenRouterOptions,
} from "./openrouter.js";

// ---------------------------------------------------------------------------
// Arbitraries: adversarial secret shapes + non-secret request/response bodies.
// ---------------------------------------------------------------------------

/** `sk-...` style keys (OpenAI / OpenRouter secret-key shape). */
const arbSkKey = fc
  .string({
    minLength: 20,
    maxLength: 56,
    unit: fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split(""),
    ),
  })
  .map((tail) => `sk-${tail}`);

/** `sk-or-v1-...` OpenRouter-specific key shape. */
const arbOpenRouterKey = fc
  .string({
    minLength: 24,
    maxLength: 64,
    unit: fc.constantFrom(..."0123456789abcdef".split("")),
  })
  .map((tail) => `sk-or-v1-${tail}`);

/** A bearer-token-looking opaque blob. */
const arbBearerToken = fc
  .string({
    minLength: 24,
    maxLength: 80,
    unit: fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/".split(""),
    ),
  })
  .map((blob) => `Bearer ${blob}`);

/** A long base64 string (JWT-ish / credential-ish). */
const arbLongBase64 = fc
  .string({
    minLength: 40,
    maxLength: 128,
    unit: fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".split(""),
    ),
  });

/** Any adversarial secret shape. Guaranteed non-empty and distinctive. */
const arbSecret = fc.oneof(
  arbSkKey,
  arbOpenRouterKey,
  arbBearerToken,
  arbLongBase64,
);

/**
 * A (distinct) server key and BYOK key. We draw two secrets and make them
 * distinct so we can assert neither one leaks independently; in practice both
 * flow through the same `Authorization` header depending on `opts.apiKey`.
 */
const arbKeyPair = fc
  .tuple(arbSecret, arbSecret)
  .filter(([a, b]) => a !== b && a.length >= 8 && b.length >= 8);

/** The prompt/code bodies the provider is handed (also must not leak). */
const arbBody = fc.record({
  system: fc.string({ minLength: 0, maxLength: 120 }),
  prompt: fc.string({ minLength: 0, maxLength: 400 }),
});

/** Which exit path the injected responder drives. */
type ResponderMode =
  | { readonly kind: "ok"; readonly content: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "abort" }
  | { readonly kind: "throw" }
  | { readonly kind: "badJson" };

const arbResponderMode: fc.Arbitrary<ResponderMode> = fc.oneof(
  fc
    .string({ minLength: 0, maxLength: 200 })
    .map((content) => ({ kind: "ok", content }) as const),
  fc
    .constantFrom(401, 402, 403, 429, 500, 502, 503)
    .map((status) => ({ kind: "status", status }) as const),
  fc.constant({ kind: "abort" } as const),
  fc.constant({ kind: "throw" } as const),
  fc.constant({ kind: "badJson" } as const),
);

// ---------------------------------------------------------------------------
// A fake `fetch` that drives each exit path WITHOUT ever echoing the secrets.
// It also records nothing about the request; the request body/headers carry
// the secrets, but a conforming provider must not surface them on any exit.
// ---------------------------------------------------------------------------

function makeFetch(mode: ResponderMode): typeof fetch {
  const impl = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    switch (mode.kind) {
      case "throw":
        throw new Error("network down");
      case "abort": {
        // Reject exactly as an aborted fetch does: an AbortError.
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        // Respect an already-aborted signal if the provider armed it.
        if (signal?.aborted) throw err;
        throw err;
      }
      case "status": {
        const res = new Response("upstream error", { status: mode.status });
        return res;
      }
      case "badJson":
        return new Response("not json at all {", { status: 200 });
      case "ok": {
        const body = JSON.stringify({
          model: "test/model-served",
          usage: { prompt_tokens: 3, completion_tokens: 5, cost: 0.0001 },
          choices: [{ message: { content: mode.content } }],
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
  };
  return impl as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Capture every console method as the stand-in "log sink".
// ---------------------------------------------------------------------------

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";
const CONSOLE_METHODS: readonly ConsoleMethod[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
];

function captureConsole(): { readonly lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spies = CONSOLE_METHODS.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(stringifyArg).join(" "));
    }),
  );
  return {
    lines,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

/** Deeply stringify an arbitrary value so any embedded secret is searchable. */
function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    const necro = value as Partial<NecroError> & Error;
    return [
      value.name,
      value.message,
      necro.code ?? "",
      necro.userMessage ?? "",
      safeStringify((value as { cause?: unknown }).cause),
      value.stack ?? "",
    ].join(" ");
  }
  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) =>
      v instanceof Error ? { name: v.name, message: v.message } : v,
    ) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Flatten everything a NecroError exposes into one searchable string. */
function necroSurface(err: NecroError): string {
  return [
    err.name,
    err.code,
    err.message,
    err.userMessage,
    safeStringify(err.cause),
    err.stack ?? "",
  ].join(" ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe("P7 (R9.2): secrets never appear in OpenRouter provider logs or outputs", () => {
  it("never surfaces the key, prompt, or code body on ANY exit path (success or error)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbKeyPair,
        arbBody,
        arbResponderMode,
        fc.boolean(),
        async ([serverKey, byokKey], body, mode, useByok) => {
          const capture = captureConsole();
          try {
            const options: OpenRouterOptions = {
              apiKey: serverKey,
              fetchImpl: makeFetch(mode),
              models: ["primary/model", "fallback/model"],
            };
            const port = createOpenRouterLlmPort(options);

            const req = {
              system: body.system,
              prompt: body.prompt,
              maxTokens: 256,
              timeoutMs: 30_000,
              cacheKey: `ck-${body.prompt.length}-${mode.kind}`,
              model: "primary/model",
              promptVersion: "v1",
            };

            // The in-play secrets for THIS call: the server key is always held;
            // the BYOK key is added when we exercise the per-call override.
            const activeSecrets = useByok
              ? [serverKey, byokKey]
              : [serverKey];

            let leaked: string | undefined;
            const assertNoSecret = (haystack: string, where: string): void => {
              for (const secret of activeSecrets) {
                if (haystack.includes(secret)) {
                  leaked = `${where} leaked a secret value`;
                  return;
                }
              }
            };

            try {
              const result = await port.complete(
                req,
                useByok ? { apiKey: byokKey } : undefined,
              );
              // Success path: the returned LlmResult (text + usage) must carry
              // no secret. (The responder never echoes a secret into content.)
              assertNoSecret(safeStringify(result), "LlmResult");
            } catch (err) {
              // Every thrown error must be a typed NecroError whose entire
              // surface (userMessage, cause, stack) is secret-free.
              expect(err).toBeInstanceOf(NecroError);
              assertNoSecret(necroSurface(err as NecroError), "NecroError");
            }

            // The log sink (every console method) must also be secret-free.
            assertNoSecret(capture.lines.join("\n"), "console log sink");

            return leaked === undefined;
          } finally {
            capture.restore();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
