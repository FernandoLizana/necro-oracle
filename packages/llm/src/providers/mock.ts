// @necro/llm — deterministic, network-free Mock LlmPort provider.
//
// The Mock provider is the required provider (R4.7): the local runner, every
// unit/property test, and Demo_Mode use it so a Ritual runs with no external
// account and no network. It is deterministic — the same `LlmRequest` yields
// byte-identical text (R4.8, R14.4) — and it imports NO network module at all
// (a static import-ban test in task 2.2 enforces this).
//
// Determinism comes from deriving the completion purely from the request: the
// grimoire's `LlmStep` wires its `mockFixture(input)` output into the prompt,
// so in practice the text the Mock returns is exactly what the grimoire pinned.
// When no fixture is supplied, the provider echoes the request's prompt body,
// which is already deterministic. Caching by `cacheKey` is handled by the
// shared cache so the `cached` flag behaves identically to real providers.

import type { LlmPort, LlmRequest, LlmResult } from "@necro/coven";

import { withCache, createLlmCache, type LlmCache } from "../cache.js";

/** Options controlling the Mock provider's deterministic output. */
export interface MockProviderOptions {
  /**
   * Pure function mapping a request to its completion text. Defaults to
   * {@link defaultMockText}. MUST be deterministic and perform no side effects:
   * the provider's determinism guarantee is only as strong as this function.
   */
  readonly respond?: (req: LlmRequest) => string;
  /**
   * Cache to memoize completions by `cacheKey`. Defaults to a fresh per-provider
   * cache. Pass a shared cache to let separate providers observe each other's
   * `cached` flags.
   */
  readonly cache?: LlmCache;
}

/**
 * Default deterministic completion text when no `respond` function is supplied.
 *
 * It extracts the untrusted-code body from between the fixed LLM_Pass delimiters
 * and returns it verbatim; if the delimiters are absent it returns the whole
 * prompt. Either way the result is a pure function of the request, so repeated
 * calls are byte-identical.
 */
export function defaultMockText(req: LlmRequest): string {
  const start = "<<<UNTRUSTED_REPOSITORY_CODE";
  const end = "<<<END_UNTRUSTED_REPOSITORY_CODE>>>";
  const prompt = req.prompt;

  const startIdx = prompt.indexOf(start);
  if (startIdx === -1) return prompt;

  // The body begins after the first newline that closes the opening delimiter.
  const bodyStart = prompt.indexOf("\n", startIdx);
  if (bodyStart === -1) return prompt;

  const endIdx = prompt.indexOf(end, bodyStart);
  const body =
    endIdx === -1
      ? prompt.slice(bodyStart + 1)
      : prompt.slice(bodyStart + 1, endIdx);

  // Trim the single trailing newline the delimiter block introduces, leaving
  // the inner content byte-stable.
  return body.endsWith("\n") ? body.slice(0, -1) : body;
}

/**
 * Create the deterministic, network-free Mock {@link LlmPort}.
 *
 * `complete` never performs I/O and never rejects: there is no timeout or
 * upstream to fail, so it always resolves with the deterministic text for the
 * request. Repeat requests with the same `cacheKey` resolve from the cache with
 * `cached: true`.
 */
export function createMockLlmPort(
  options: MockProviderOptions = {},
): LlmPort {
  const respond = options.respond ?? defaultMockText;
  const cache = options.cache ?? createLlmCache();

  return {
    providerId: "mock",
    complete(req: LlmRequest): Promise<LlmResult> {
      const result = withCache(cache, req, () => respond(req));
      return Promise.resolve(result);
    },
  };
}
