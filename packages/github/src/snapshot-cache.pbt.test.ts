// Property tests for the snapshot cache (task 22.2). Test-first: fails until task 22.4 creates ./snapshot-cache.ts.
// Feature: 02-github-summoner, Property 8
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbOwnerOrName } from "../test/arbitraries.js";
import { DEGRADED_TTL_MS } from "./constants.js";
import type { ClockPort } from "./ports.js";
import { cacheKey, effectiveTtlMs, SnapshotCache } from "./snapshot-cache.js";

const HEX = "0123456789abcdef".split("");

/** Valid sha: 40 lowercase hex characters. */
const arbSha: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...HEX), { minLength: 40, maxLength: 40 })
  .map((cs) => cs.join(""));

interface Triple {
  owner: string;
  name: string;
  sha: string;
}

const arbTriple: fc.Arbitrary<Triple> = fc.record({ owner: arbOwnerOrName, name: arbOwnerOrName, sha: arbSha });

/** Flip the case of the first letter, or change one hex digit, so the result differs from the input. */
function differentString(s: string): string {
  const swapped = s === s.toLowerCase() ? s.toUpperCase() : s.toLowerCase();
  return swapped !== s ? swapped : `${s}x`;
}

describe("P8 (R8.1, R8.4): cache key determinism and injectivity", () => {
  it("is deterministic: repeated derivations give the same string", () => {
    fc.assert(
      fc.property(arbTriple, (t) => {
        const first = cacheKey({ ...t });
        expect(cacheKey({ ...t })).toBe(first);
        expect(cacheKey({ sha: t.sha, name: t.name, owner: t.owner })).toBe(first);
      }),
      { numRuns: 200 },
    );
  });

  it("two triples produce the same key if and only if all three components are equal", () => {
    fc.assert(
      fc.property(arbTriple, arbTriple, (a, b) => {
        const equalTriples = a.owner === b.owner && a.name === b.name && a.sha === b.sha;
        expect(cacheKey(a) === cacheKey(b)).toBe(equalTriples);
      }),
      { numRuns: 200 },
    );
  });

  it("changing exactly one component changes the key (including case-only changes)", () => {
    fc.assert(
      fc.property(arbTriple, fc.constantFrom<"owner" | "name" | "sha">("owner", "name", "sha"), (t, field) => {
        const other: Triple = { ...t, [field]: differentString(t[field]) };
        expect(cacheKey(other)).not.toBe(cacheKey(t));
      }),
      { numRuns: 200 },
    );
  });

  it("shifting characters between owner and name never collides", () => {
    fc.assert(
      fc.property(arbOwnerOrName, arbOwnerOrName, arbSha, (x, y, sha) => {
        fc.pre(x !== y);
        expect(cacheKey({ owner: x, name: y, sha })).not.toBe(cacheKey({ owner: y, name: x, sha }));
      }),
      { numRuns: 200 },
    );
  });

  it("ignores extra fields on the ref", () => {
    fc.assert(
      fc.property(arbTriple, fc.string(), (t, ref) => {
        const withExtra = { ...t, ref } as Triple;
        expect(cacheKey(withExtra)).toBe(cacheKey(t));
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Task 22.3. Test-first: fails until task 22.4 creates ./snapshot-cache.ts exports below.
// Feature: 02-github-summoner, Property 31
// Feature: 02-github-summoner, Property 34
// ---------------------------------------------------------------------------------------------
type Op =
  | { kind: "advance"; ms: number }
  | { kind: "get"; key: string }
  | { kind: "set"; key: string; value: number; ttlMs: number | undefined };

const KEYS = ["k0", "k1", "k2", "k3", "k4", "k5", "k6"];
const arbKey = fc.constantFrom(...KEYS);

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 40 }).map((ms): Op => ({ kind: "advance", ms })) },
  { weight: 4, arbitrary: arbKey.map((key): Op => ({ kind: "get", key })) },
  {
    weight: 4,
    arbitrary: fc
      .record({
        key: arbKey,
        value: fc.integer({ min: 0, max: 1000 }),
        // undefined = omitted (falls back to configured); may exceed configured (must be capped to it).
        ttlMs: fc.option(fc.integer({ min: 1, max: 120 }), { nil: undefined }),
      })
      .map((r): Op => ({ kind: "set", ...r })),
  },
);

interface ModelEntry {
  key: string;
  value: number;
  setTime: number;
  entryTtl: number;
}

describe("P31 + P34 (R8.1, R8.2, R8.3, R8.6, R8.8, R8.9, R8.11, R8.12, R8.13, R8.14): snapshot cache is a TTL + LRU model; degraded entries expire early", () => {
  it("P31: matches a reference TTL + LRU model over random operation sequences", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // configured ttlMs
        fc.integer({ min: 1, max: 5 }), // maxEntries
        fc.array(arbOp, { minLength: 1, maxLength: 60 }),
        (configuredTtl, maxEntries, ops) => {
          const clock: ClockPort & { t: number } = {
            t: 1_000_000,
            nowMs() {
              return this.t;
            },
          };
          const cache = new SnapshotCache<{ n: number }>(clock, { ttlMs: configuredTtl, maxEntries });
          let model: ModelEntry[] = []; // least-recently-used first

          for (const op of ops) {
            if (op.kind === "advance") {
              clock.t += op.ms;
            } else if (op.kind === "get") {
              const idx = model.findIndex((e) => e.key === op.key);
              let expected: number | undefined;
              if (idx >= 0) {
                const entry = model[idx] as ModelEntry;
                model.splice(idx, 1);
                if (clock.t - entry.setTime < entry.entryTtl) {
                  model.push(entry); // fresh hit: most recently used, age not extended
                  expected = entry.value;
                }
              }
              const actual = cache.get(op.key);
              expect(actual === undefined ? undefined : actual.n).toBe(expected);
            } else {
              const entryTtl = Math.min(configuredTtl, op.ttlMs ?? configuredTtl);
              model = model.filter((e) => e.key !== op.key); // replace keeps one entry per key
              model = model.filter((e) => clock.t - e.setTime < e.entryTtl); // purge expired
              if (model.length >= maxEntries) model.shift(); // evict LRU
              model.push({ key: op.key, value: op.value, setTime: clock.t, entryTtl });
              cache.set(op.key, { n: op.value }, op.ttlMs === undefined ? undefined : { ttlMs: op.ttlMs });
            }
            expect(cache.size).toBe(model.length);
            expect(cache.size).toBeLessThanOrEqual(maxEntries);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("P34: effectiveTtlMs is min(configured, 600000) for a non-empty degraded list, else configured", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 0, maxLength: 4 }),
        (configured, degraded) => {
          const expected = degraded.length > 0 ? Math.min(configured, DEGRADED_TTL_MS) : configured;
          expect(effectiveTtlMs(configured, degraded)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("P34: a degraded entry is fresh below its effective TTL and a miss from it onward; a clean entry uses the configured TTL", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 0, maxLength: 3 }),
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        (configured, degraded, start) => {
          const clock: ClockPort & { t: number } = {
            t: start,
            nowMs() {
              return this.t;
            },
          };
          const eff = effectiveTtlMs(configured, degraded);
          const cache = new SnapshotCache<{ n: number }>(clock, { ttlMs: configured });
          cache.set("k", { n: 1 }, { ttlMs: eff });
          clock.t = start + eff - 1;
          expect(cache.get("k")).toEqual({ n: 1 });
          clock.t = start + eff;
          expect(cache.get("k")).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
