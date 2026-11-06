// @necro/llm — completion cache keyed by `LlmRequest.cacheKey`.
//
// Every LLM call carries a `cacheKey = sha256(pairId + construct + prompt)`
// (see the design's LLM_Pass). The cache memoizes completion *text* by that
// key: the first time a key is seen the underlying completion runs and the
// result is stored with `cached: false`; every later request with the same key
// returns the stored text with `cached: true` and performs no underlying call.
//
// This is a pure in-memory map with no network, no clock, and no eviction — the
// key is a content hash, so identical inputs collapse to one stored entry and
// repeat lookups are deterministic. Providers wrap their completion logic with
// `withCache` so caching behaves identically across Mock and real providers.

import type { LlmRequest, LlmResult } from "@necro/coven";

/** A completion cache: stores raw model text keyed by `LlmRequest.cacheKey`. */
export interface LlmCache {
  /** True iff a completion for this cache key has already been stored. */
  has(cacheKey: string): boolean;
  /** Stored completion text for this key, or `undefined` if unseen. */
  get(cacheKey: string): string | undefined;
  /** Store completion text under this key (first write wins; later writes are ignored). */
  set(cacheKey: string, text: string): void;
  /** Number of distinct keys currently stored. */
  readonly size: number;
}

/** Create a fresh in-memory {@link LlmCache}. */
export function createLlmCache(): LlmCache {
  const store = new Map<string, string>();
  return {
    has: (cacheKey) => store.has(cacheKey),
    get: (cacheKey) => store.get(cacheKey),
    set: (cacheKey, text) => {
      // First write wins: a cache key is a content hash, so re-deriving the
      // same text is a no-op and we never overwrite a stored entry.
      if (!store.has(cacheKey)) store.set(cacheKey, text);
    },
    get size() {
      return store.size;
    },
  };
}

/**
 * Run `compute` through the cache. On a miss, `compute` produces the raw text,
 * which is stored and returned with `cached: false`. On a hit, the stored text
 * is returned with `cached: true` and `compute` is not called.
 *
 * `compute` is kept synchronous because the Mock provider is pure and
 * deterministic; real providers can pre-resolve their text before calling in.
 */
export function withCache(
  cache: LlmCache,
  req: Pick<LlmRequest, "cacheKey">,
  compute: () => string,
): LlmResult {
  const hit = cache.get(req.cacheKey);
  if (hit !== undefined) {
    return { text: hit, cached: true };
  }
  const text = compute();
  cache.set(req.cacheKey, text);
  return { text, cached: false };
}
