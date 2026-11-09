//
// Item 16 (P0.5): cache "retry poison". The chunked LLM_Pass retries a rejected
// chunk with an escalated model and a prompt that appends the rejection reason.
// If the retry reuses the FIRST attempt's cache key, the completion cache serves
// the first (rejected) text straight back and the retry is pointless. The retry
// must therefore use a cache key DISTINCT from the base and distinct per
// (model, prior error). `retryCacheKey` is that derivation; it never contains a
// user key (the base key already excludes it).
//
// Pure: no network / LLM / sandbox.
import { describe, expect, it } from "vitest";

import { retryCacheKey } from "./local.js";

const BASE = "a".repeat(64); // a sha-256-hex-shaped base key

describe("Item 16 (R5.3, R4.1): retryCacheKey avoids cache retry poison", () => {
  it("produces a key DIFFERENT from the base cache key", () => {
    expect(retryCacheKey(BASE, "vendor/strong", "schema validation failed")).not.toBe(BASE);
  });

  it("differs when the escalated model differs (FAST->STRONG)", () => {
    const a = retryCacheKey(BASE, "vendor/fast", "reason");
    const b = retryCacheKey(BASE, "vendor/strong", "reason");
    expect(a).not.toBe(b);
  });

  it("differs when the prior error differs", () => {
    const a = retryCacheKey(BASE, "vendor/strong", "schema validation failed");
    const b = retryCacheKey(BASE, "vendor/strong", "gate rejected: still legacy");
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same inputs (idempotent key derivation)", () => {
    const a = retryCacheKey(BASE, "vendor/strong", "reason");
    const b = retryCacheKey(BASE, "vendor/strong", "reason");
    expect(a).toBe(b);
  });

  it("embeds the base key so two different base keys never collide on retry", () => {
    const base2 = "b".repeat(64);
    expect(retryCacheKey(BASE, "m", "e")).not.toBe(retryCacheKey(base2, "m", "e"));
  });
});
