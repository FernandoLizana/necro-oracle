// @necro/llm — the real OpenRouter LlmPort provider (A.2; R1.1–R1.7, R2.3,
// R2.4, R2.6, R5.1, R5.2, R5.4, R7.1, R9.1–R9.3, R10.1, R43.6).
//
// This is the ONLY network-capable module in @necro/llm: it POSTs an
// OpenAI-compatible chat completion to OpenRouter over an INJECTABLE `fetch`
// (so unit/property tests drive it with a recorded-fixture responder and never
// open a socket) and maps every failure to a typed `NecroError` in the oracle
// voice. It therefore lives OUTSIDE the `no-network.guard.test.ts`
// `GUARDED_FILES` set (mock/cache/budget) by design — the guard's job is to
// keep the Mock *default* path network-free, not this provider.
//
// Determinism and caching mirror Mock exactly: the completion is wrapped with
// the shared `withCache(cache, req, …)` so the `cached` flag behaves
// identically, and the request body carries `temperature: 0` with NO `seed`
// field (determinism = temperature 0 + the content-hash completion cache; a
// `seed` would exclude Claude endpoints under `require_parameters:true` — A.2).
//
// Privacy (R9.2): the provider NEVER logs the API key, the prompt body, or the
// repository code body. The only observable, loggable surface is
// `{ model, promptTokens, completionTokens, costUsd, cached }` — ids and sizes.

import type {
  LlmPort,
  LlmRequest,
  LlmResult,
  LlmCallOptions,
} from "@necro/coven";
import { NecroError } from "@necro/oracle";

import { withCache, createLlmCache, type LlmCache } from "../cache.js";
import {
  usageRecordFromResponse,
  type StructuredRequestFields,
  type OpenRouterUsageResponse,
} from "../response/structured.js";

/** The OpenRouter OpenAI-compatible chat-completions endpoint. */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Default `HTTP-Referer` header value when no `referer` is supplied and no
 * `NECRO_PUBLIC_URL` is configured upstream. OpenRouter uses the referer only
 * for attribution; the constant keeps the header well-formed without leaking
 * any deployment-specific URL.
 */
export const NECRO_PUBLIC_URL = "https://necro-oracle.vercel.app";

/** Fixed `X-Title` attribution header value. */
const X_TITLE = "Necro-Oracle";

/**
 * Options for {@link createOpenRouterLlmPort}. `apiKey` is the server default;
 * a per-call `opts.apiKey` (BYOK) overrides it for THAT request only. `fetchImpl`
 * is injected in tests with a recorded-fixture responder so no socket opens;
 * it defaults to the platform `fetch`. `models` is the OpenRouter fallback
 * array (built from `NECRO_LLM_MODEL_FALLBACKS` in `composition.ts`).
 */
export interface OpenRouterOptions {
  /** Server default key; a per-call `opts.apiKey` overrides it (never stored). */
  readonly apiKey: string;
  /** Injectable `fetch` for tests; defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Shared completion cache; defaults to a fresh per-provider cache. */
  readonly cache?: LlmCache;
  /** `HTTP-Referer` header value; defaults to {@link NECRO_PUBLIC_URL}. */
  readonly referer?: string;
  /** `X-Title` header value; defaults to `"Necro-Oracle"`. */
  readonly title?: string;
  /** OpenRouter `models` fallback array (`NECRO_LLM_MODEL_FALLBACKS`). */
  readonly models?: readonly string[];
}

/**
 * The OpenAI-compatible request body this provider puts on the wire (A.2).
 *
 * There is intentionally NO `seed` field on this type: its absence is part of
 * the contract. The structured-output fields (`response_format`, `provider`)
 * are present ONLY when the request carries a {@link StructuredRequestFields}
 * descriptor, and they always travel together with `temperature` and
 * `max_tokens` so a fallback endpoint that cannot honour the schema is skipped.
 */
interface OpenRouterRequestBody {
  readonly model: string;
  readonly models?: readonly string[];
  readonly messages: readonly { readonly role: "system" | "user"; readonly content: string }[];
  readonly max_tokens: number;
  readonly temperature: 0;
  readonly response_format?: StructuredRequestFields["response_format"];
  readonly provider?: StructuredRequestFields["provider"];
}

/**
 * The minimal shape of a successful OpenRouter chat response this provider
 * reads: the assistant content plus the usage/served-model fields consumed by
 * {@link usageRecordFromResponse}.
 */
interface OpenRouterChatResponse extends OpenRouterUsageResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string };
  }[];
}

/**
 * A request MAY carry a pre-assembled structured-output descriptor (built by a
 * runner via `structuredRequestFields` — task 5.4 / 8.6). `LlmRequest` itself
 * is unchanged (task 1.1 pinned it); the descriptor rides as an OPTIONAL extra
 * property so the `LlmPort` signature stays satisfied and older callers that
 * pass a plain `LlmRequest` still send a valid (schema-free) chat body.
 */
type StructuredRequest = LlmRequest & {
  readonly structured?: StructuredRequestFields;
};

/**
 * Create the real OpenRouter {@link LlmPort} (`providerId: "openrouter"`).
 *
 * `complete(req, opts)`:
 *   - resolves the key `opts?.apiKey ?? options.apiKey` (BYOK per-call override);
 *   - arms an `AbortController` with `setTimeout(abort, opts?.timeoutMs ??
 *     req.timeoutMs)` — the single-request DEADLINE supplies `timeoutMs` via
 *     `LlmCallOptions` (A.8), falling back to the request's per-construct
 *     timeout when no per-call deadline is given;
 *   - POSTs an OpenAI-compatible body (model, optional `models` fallback array,
 *     system+user messages, `max_tokens`, `temperature: 0`, and — only when the
 *     request carries a structured descriptor — `response_format` +
 *     `provider.require_parameters`; NEVER a `seed`);
 *   - parses `choices[0].message.content`, builds a `UsageRecord` from `usage`
 *     (cost from `usage.cost`, model from the SERVED `response.model`), and
 *     returns `{ text, cached, usage }`;
 *   - maps `401`/`402` -> `UPSTREAM_UNAVAILABLE` (BYOK auth-fail; never silently
 *     falls back to the server key — the handler decides any fallback),
 *     timeout/abort -> `NETWORK_TIMEOUT`, and any other non-2xx / network fault
 *     -> `UPSTREAM_UNAVAILABLE`, each with an oracle-voice `userMessage`;
 *   - wraps the whole completion in the shared `withCache` so `cached` matches
 *     Mock and the cache key is `req.cacheKey` (content-hash + PROMPT_VERSION +
 *     model, built upstream — NEVER the user key).
 */
export function createOpenRouterLlmPort(options: OpenRouterOptions): LlmPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache ?? createLlmCache();
  const referer = options.referer ?? NECRO_PUBLIC_URL;
  const title = options.title ?? X_TITLE;

  return {
    providerId: "openrouter",
    async complete(req: LlmRequest, opts?: LlmCallOptions): Promise<LlmResult> {
      // --- Cache hit short-circuit (no network, no usage record) -----------
      const hit = cache.get(req.cacheKey);
      if (hit !== undefined) {
        return { text: hit, cached: true };
      }

      const apiKey = opts?.apiKey ?? options.apiKey;
      const model = opts?.modelOverride ?? req.model ?? "";
      const timeoutMs = opts?.timeoutMs ?? req.timeoutMs;

      const structured = (req as StructuredRequest).structured;

      const body: OpenRouterRequestBody = {
        model,
        ...(options.models && options.models.length > 0
          ? { models: options.models }
          : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        max_tokens: req.maxTokens,
        temperature: 0,
        // Structured-output fields are sent ONLY together, so a fallback
        // endpoint that cannot honour the schema is skipped. No `seed` ever.
        ...(structured
          ? {
              response_format: structured.response_format,
              provider: structured.provider,
            }
          : {}),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": referer,
            "X-Title": title,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (cause) {
        // An aborted fetch rejects with an AbortError — map it to a timeout;
        // any other transport failure is an upstream outage. The `cause` is
        // attached but the thrown userMessage carries no key/prompt/code body.
        if (isAbortError(cause)) {
          throw new NecroError(
            "NETWORK_TIMEOUT",
            "The seance ran long and the veil closed. The oracle will try again.",
            cause,
          );
        }
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "The spirits beyond the network did not answer. The oracle will try again.",
          cause,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // 401/402: BYOK auth / payment failure. Never silently fall back to the
        // server key here — the handler decides whether to retry on ORACLE.
        if (response.status === 401 || response.status === 402) {
          throw new NecroError(
            "UPSTREAM_UNAVAILABLE",
            "Your offered key was refused at the gate. Check the key or let the oracle pay in its own souls.",
          );
        }
        // Any other non-2xx (5xx and the rest): upstream unavailable.
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "The spirits beyond the network did not answer. The oracle will try again.",
        );
      }

      let parsed: OpenRouterChatResponse;
      try {
        parsed = (await response.json()) as OpenRouterChatResponse;
      } catch (cause) {
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "The reply came back as noise, not prophecy. The oracle will try again.",
          cause,
        );
      }

      const text = parsed.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "The reply came back as noise, not prophecy. The oracle will try again.",
        );
      }

      const usage = usageRecordFromResponse(parsed);

      // Store the raw completion under the content-hash cache key (never the
      // user key) so a repeat request resolves with `cached: true` exactly as
      // Mock does. `withCache` writes on first sight and returns `cached:false`.
      const result = withCache(cache, req, () => text);
      return { ...result, usage };
    },
  };
}

/** True for a DOMException/Error whose name marks an aborted fetch. */
function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { readonly name?: unknown }).name === "AbortError"
  );
}
