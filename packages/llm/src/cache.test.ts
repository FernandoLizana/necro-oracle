// @necro/llm — unit tests for the completion cache (task 2.2).
//
// The cache memoizes raw completion text by `LlmRequest.cacheKey`: the first
// time a key is seen `compute` runs and the result is returned with
// `cached: false`; every later request with the same key returns the stored
// text with `cached: true` and does NOT call `compute` again (R4.8). First
// write wins: re-deriving the same key never overwrites the stored entry and a
// different key is an independent entry.
//
// Pure in-memory — no network / LLM / sandbox.
//
// Validates: Requirements 4.8, 14.4

import { describe, expect, it, vi } from "vitest";

import { createLlmCache, withCache } from "./cache.js";

describe("R4.8, R14.4: LlmCache stores completion text by cacheKey", () => {
  it("starts empty and reports unseen keys", () => {
    const cache = createLlmCache();
    expect(cache.size).toBe(0);
    expect(cache.has("k")).toBe(false);
    expect(cache.get("k")).toBeUndefined();
  });

  it("stores on first write and reports the key thereafter", () => {
    const cache = createLlmCache();
    cache.set("k", "hello");
    expect(cache.has("k")).toBe(true);
    expect(cache.get("k")).toBe("hello");
    expect(cache.size).toBe(1);
  });

  it("first write wins: a later write for the same key is ignored", () => {
    const cache = createLlmCache();
    cache.set("k", "first");
    cache.set("k", "second");
    expect(cache.get("k")).toBe("first");
    expect(cache.size).toBe(1);
  });

  it("keeps distinct keys as independent entries", () => {
    const cache = createLlmCache();
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBe("B");
    expect(cache.size).toBe(2);
  });
});

describe("R4.8, R14.4: withCache sets the cached flag and skips recompute on a hit", () => {
  it("misses on the first call: cached:false and compute runs once", () => {
    const cache = createLlmCache();
    const compute = vi.fn(() => "completion");

    const result = withCache(cache, { cacheKey: "k" }, compute);

    expect(result).toEqual({ text: "completion", cached: false });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBe("completion");
  });

  it("hits on a repeat of the same cacheKey: cached:true and compute is NOT called", () => {
    const cache = createLlmCache();
    const first = vi.fn(() => "completion");
    const second = vi.fn(() => "DIFFERENT");

    const r1 = withCache(cache, { cacheKey: "k" }, first);
    const r2 = withCache(cache, { cacheKey: "k" }, second);

    expect(r1).toEqual({ text: "completion", cached: false });
    // The stored text is returned verbatim; the second compute never runs.
    expect(r2).toEqual({ text: "completion", cached: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("treats a different cacheKey as a fresh miss", () => {
    const cache = createLlmCache();
    const a = vi.fn(() => "A");
    const b = vi.fn(() => "B");

    const ra = withCache(cache, { cacheKey: "a" }, a);
    const rb = withCache(cache, { cacheKey: "b" }, b);

    expect(ra).toEqual({ text: "A", cached: false });
    expect(rb).toEqual({ text: "B", cached: false });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("caches empty-string completions (distinguishes stored-empty from unseen)", () => {
    const cache = createLlmCache();
    const compute = vi.fn(() => "");

    const r1 = withCache(cache, { cacheKey: "k" }, compute);
    const r2 = withCache(cache, { cacheKey: "k" }, compute);

    expect(r1).toEqual({ text: "", cached: false });
    expect(r2).toEqual({ text: "", cached: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SEC-05: the completion cache is BOUNDED so a long-lived server provider
// instance cannot grow without limit (accepted-output cache isolation + size
// cap). Eviction is oldest-first; the key dimensions (model+prompt+version)
// and the no-raw-key contract live in cacheKeyParts and are unchanged.
// ---------------------------------------------------------------------------

describe("SEC-05: LlmCache is bounded and evicts the oldest entry past the cap", () => {
  it("never exceeds the configured maximum number of entries", () => {
    const cache = createLlmCache(3);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    cache.set("d", "D"); // evicts the oldest ("a")
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.size).toBe(3);
  });

  it("evicts the OLDEST key first (FIFO by insertion)", () => {
    const cache = createLlmCache(2);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C"); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  it("has a finite DEFAULT cap when no size is given", () => {
    const cache = createLlmCache();
    // Insert more than any sane working set and confirm it stays bounded.
    for (let i = 0; i < 5000; i++) cache.set("k" + i, "v" + i);
    expect(cache.size).toBeLessThanOrEqual(2048);
  });
});
