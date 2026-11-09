// Snapshot cache (task 22.1). Requirements: R8.1, R8.2, R8.3, R8.5, R8.6, R8.7, R8.8, R8.9, R8.11, R8.12, R8.13.
// Test-first: fails until task 22.4 creates ./snapshot-cache.ts.
// Contract assumed for 22.4 (design "Snapshot cache", D5):
//   effectiveTtlMs(configuredTtlMs, degradedFields): number
//     -> degradedFields.length > 0 ? Math.min(configuredTtlMs, DEGRADED_TTL_MS) : configuredTtlMs
//   class SnapshotCache<V>
//     constructor(clock: ClockPort, opts?: { ttlMs?: number; maxEntries?: number })
//       defaults: DEFAULT_TTL_MS, DEFAULT_MAX_CACHE_ENTRIES (from ./constants.js)
//     get(key): V | undefined      fresh hit (now - createdAt < entry ttl) marks MRU; age >= ttl deletes + undefined
//     set(key, value, { ttlMs }?)  replaces existing key; purges expired; evicts LRU at capacity;
//                                  per-entry ttl = min(opts.ttlMs ?? configured, configured)
//     size: number; configuredTtlMs: number
//   Time comes only from the injected ClockPort.nowMs() (no Date.now()).
//   D5 shallow copy: get() returns a new top-level object ({ ...value }) sharing nested references,
//   so mutating a returned object's top-level property does not affect the next hit.
// Not covered here: in-flight promise sharing and "failures not cached". The design places those in the
// summoner (snapshot.ts, tasks 27.x/28.x), not in SnapshotCache, whose API is synchronous.
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CACHE_ENTRIES, DEFAULT_TTL_MS, DEGRADED_TTL_MS } from "./constants.js";
import type { ClockPort } from "./ports.js";
import { cacheKey, effectiveTtlMs, SnapshotCache } from "./snapshot-cache.js";

function fakeClock(start = 1_000_000): ClockPort & { t: number } {
  const c = {
    t: start,
    nowMs() {
      return c.t;
    },
  };
  return c;
}

const TTL = 1000;

describe("constants (R8.5, R8.7, R8.11)", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_TTL_MS).toBe(604_800_000);
    expect(DEFAULT_MAX_CACHE_ENTRIES).toBe(20);
    expect(DEGRADED_TTL_MS).toBe(600_000);
  });

  it("uses the defaults when no options are given", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ n: number }>(clock);
    expect(cache.configuredTtlMs).toBe(DEFAULT_TTL_MS);
    for (let i = 0; i < DEFAULT_MAX_CACHE_ENTRIES + 1; i++) cache.set(`k${i}`, { n: i });
    expect(cache.size).toBe(DEFAULT_MAX_CACHE_ENTRIES);
    clock.t += DEFAULT_TTL_MS - 1;
    expect(cache.get("k5")).toEqual({ n: 5 });
    clock.t += 1;
    expect(cache.get("k5")).toBeUndefined();
  });
});

describe("cacheKey (R8.1)", () => {
  it("joins owner/name@sha, exact case", () => {
    expect(cacheKey({ owner: "Foo", name: "bar", sha: "a".repeat(40) })).toBe(`Foo/bar@${"a".repeat(40)}`);
  });
});

describe("TTL (R8.2, R8.3, R8.13)", () => {
  it("hits just under the TTL and misses at age exactly equal to the TTL", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 });
    clock.t += TTL - 1;
    expect(cache.get("a")).toEqual({ v: 1 });
    clock.t += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("removes an expired entry on get", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 });
    expect(cache.size).toBe(1);
    clock.t += TTL;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("a hit does not extend the entry's lifetime", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 });
    clock.t += TTL - 1;
    expect(cache.get("a")).toBeDefined();
    clock.t += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("reads time only from the injected ClockPort", () => {
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("Date.now must not be used");
    };
    try {
      const clock = fakeClock();
      const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
      cache.set("a", { v: 1 });
      clock.t += TTL;
      expect(cache.get("a")).toBeUndefined();
    } finally {
      Date.now = realNow;
    }
  });
});

describe("LRU and replacement (R8.6, R8.8, R8.9)", () => {
  it("replacing a key keeps one entry and resets its age", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 });
    clock.t += TTL - 1;
    cache.set("a", { v: 2 });
    expect(cache.size).toBe(1);
    clock.t += TTL - 1;
    expect(cache.get("a")).toEqual({ v: 2 });
  });

  it("evicts the least-recently-used entry at capacity", () => {
    const cache = new SnapshotCache<{ v: number }>(fakeClock(), { ttlMs: TTL, maxEntries: 2 });
    cache.set("a", { v: 1 });
    cache.set("b", { v: 2 });
    cache.set("c", { v: 3 });
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toEqual({ v: 2 });
    expect(cache.get("c")).toEqual({ v: 3 });
  });

  it("a hit marks the entry most-recently-used", () => {
    const cache = new SnapshotCache<{ v: number }>(fakeClock(), { ttlMs: TTL, maxEntries: 2 });
    cache.set("a", { v: 1 });
    cache.set("b", { v: 2 });
    expect(cache.get("a")).toBeDefined();
    cache.set("c", { v: 3 });
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual({ v: 1 });
  });

  it("replacing an existing key at capacity evicts nothing", () => {
    const cache = new SnapshotCache<{ v: number }>(fakeClock(), { ttlMs: TTL, maxEntries: 2 });
    cache.set("a", { v: 1 });
    cache.set("b", { v: 2 });
    cache.set("a", { v: 3 });
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toEqual({ v: 2 });
  });

  it("purges expired entries before evicting live ones", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL, maxEntries: 2 });
    cache.set("a", { v: 1 }, { ttlMs: 10 });
    clock.t += 5;
    cache.set("b", { v: 2 });
    clock.t += 5; // a expired (age 10), b live
    cache.set("c", { v: 3 });
    expect(cache.get("b")).toEqual({ v: 2 });
    expect(cache.get("c")).toEqual({ v: 3 });
  });

  it("keys are exact-case", () => {
    const cache = new SnapshotCache<{ v: number }>(fakeClock(), { ttlMs: TTL });
    cache.set("Foo/bar@sha", { v: 1 });
    expect(cache.get("foo/bar@sha")).toBeUndefined();
    cache.set("foo/bar@sha", { v: 2 });
    expect(cache.size).toBe(2);
    expect(cache.get("Foo/bar@sha")).toEqual({ v: 1 });
  });
});

describe("per-entry TTL (R8.11, R8.12)", () => {
  it("honors set's ttlMs instead of the configured TTL", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("short", { v: 1 }, { ttlMs: 100 });
    cache.set("long", { v: 2 });
    clock.t += 99;
    expect(cache.get("short")).toBeDefined();
    clock.t += 1;
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBeDefined();
  });

  it("falls back to the configured TTL when ttlMs is omitted", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 }, {});
    clock.t += TTL - 1;
    expect(cache.get("a")).toBeDefined();
    clock.t += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("clamps a larger per-entry TTL to the configured TTL", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock, { ttlMs: TTL });
    cache.set("a", { v: 1 }, { ttlMs: TTL * 10 });
    clock.t += TTL;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("effectiveTtlMs (R8.11, R8.12)", () => {
  const degraded = [{ field: "pulls" }] as unknown as Parameters<typeof effectiveTtlMs>[1];

  it("caps a non-empty degraded list at 600000", () => {
    expect(effectiveTtlMs(DEFAULT_TTL_MS, degraded)).toBe(600_000);
  });

  it("keeps a configured TTL below 600000 when degraded", () => {
    expect(effectiveTtlMs(5_000, degraded)).toBe(5_000);
  });

  it("returns the configured TTL for an empty list", () => {
    expect(effectiveTtlMs(DEFAULT_TTL_MS, [])).toBe(DEFAULT_TTL_MS);
    expect(effectiveTtlMs(5_000, [])).toBe(5_000);
  });

  it("a degraded entry is a hit at 599999 ms and a miss at 600000 ms", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ v: number }>(clock);
    cache.set("a", { v: 1 }, { ttlMs: effectiveTtlMs(cache.configuredTtlMs, degraded) });
    clock.t += 599_999;
    expect(cache.get("a")).toBeDefined();
    clock.t += 1;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("shallow copy (D5)", () => {
  it("returns a new top-level object sharing nested references", () => {
    const nested = { files: ["a"] };
    const cache = new SnapshotCache<{ nested: typeof nested; manifests?: string }>(fakeClock(), { ttlMs: TTL });
    cache.set("a", { nested });
    const first = cache.get("a");
    const second = cache.get("a");
    expect(first).not.toBe(second);
    expect(first?.nested).toBe(nested);
    if (first) first.manifests = "mutated";
    expect(cache.get("a")?.manifests).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 23 (P0.5): the snapshot cache must be bounded by BYTES, not only by
// entry count. A cached SummonResult holds the snapshot's whole file-content
// Map (up to ~200 MB uncompressed), so 20 entries could pin gigabytes. The
// cache takes an injected `measure(value): number` and a `maxBytes` budget and
// evicts LRU entries until the total measured size is within budget.
// ---------------------------------------------------------------------------

describe("Item 23 (R8.7): the snapshot cache is bounded by total bytes", () => {
  it("evicts LRU entries so total measured bytes never exceed maxBytes", () => {
    const clock = fakeClock();
    // Each value reports its own byte size via `measure`. Budget = 250 bytes.
    const cache = new SnapshotCache<{ bytes: number }>(clock, {
      maxEntries: 100, // high, so BYTES are the binding limit
      maxBytes: 250,
      measure: (v) => v.bytes,
    });

    cache.set("a", { bytes: 100 });
    cache.set("b", { bytes: 100 });
    // a+b = 200 <= 250, both fit.
    expect(cache.get("a")).toEqual({ bytes: 100 });
    expect(cache.get("b")).toEqual({ bytes: 100 });

    // Adding c (100) would make 300 > 250 - evict LRU until within budget.
    // get() above marked a then b as MRU (a is now LRU), so a is evicted.
    cache.set("c", { bytes: 100 });
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toEqual({ bytes: 100 });
    expect(cache.get("c")).toEqual({ bytes: 100 });
  });

  it("still stores a single entry larger than maxBytes (never wedges), but holds only it", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ bytes: number }>(clock, {
      maxBytes: 100,
      measure: (v) => v.bytes,
    });
    cache.set("big", { bytes: 500 }); // bigger than the whole budget
    expect(cache.get("big")).toEqual({ bytes: 500 });
    // A second entry forces the oversize one out (budget can hold at most one).
    cache.set("small", { bytes: 10 });
    expect(cache.get("big")).toBeUndefined();
    expect(cache.get("small")).toEqual({ bytes: 10 });
  });

  it("without a measure/maxBytes it behaves exactly as before (entry-count only)", () => {
    const clock = fakeClock();
    const cache = new SnapshotCache<{ n: number }>(clock, { maxEntries: 2 });
    cache.set("a", { n: 1 });
    cache.set("b", { n: 2 });
    cache.set("c", { n: 3 }); // evicts "a" by count
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(2);
  });
});
