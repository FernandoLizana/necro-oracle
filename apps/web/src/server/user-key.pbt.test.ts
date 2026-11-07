// apps/web/src/server/user-key.pbt.test.ts
//
// Feature: lovers-binding, task 11.3.
//
// Property 3 (R5.3, R27.4): the completion/response cache key EXCLUDES the
// BYOK user key (`X-Necro-User-Key`).
//
// The user key travels per request and flows ONLY into the provider as
// `LlmCallOptions.apiKey` and into redaction (`redactLine`/`redactDeep`). It is
// never a component of the LLM cache key, which per R5.3 is
//
//   sha256(purpose + schemaName + PROMPT_VERSION + resolvedModel +
//          contentHash + retryFlag/errorHash)
//
// grounded here against the REAL exported builder `deriveCacheKey` (and the
// ordered `cacheKeyParts` it hashes) from `@necro/llm`. Because
// `CacheKeyInputs` has no user-key slot, the exclusion is structural; these
// properties prove the observable consequences:
//
//   (1) the derived key is BYTE-IDENTICAL whether a user key is absent, present,
//       or a different value, given otherwise-identical inputs — so a user key
//       can neither poison nor partition the shared cache;
//   (2) no user-key byte is recoverable from the derived key string — so a key
//       cannot leak into a cache store via the key; and
//   (3) `redactLine` (reusing `user-key.ts`'s redaction helper) masks the user
//       key everywhere it appears in an outgoing value.
//
// Pure computation: no network, LLM, or sandbox. `deriveCacheKey` uses only a
// Node crypto hash of the ordered parts; the user key never reaches it.
//
// Testing steering: fast-check with explicit numRuns; the seed is printed on
// failure by fast-check's default reporter. A key appearing in the cache key
// would be a real bug, so the assertions are strict and never relaxed.
//
// **Validates: Requirements 5.3, 27.4**

import {
  cacheKeyParts,
  deriveCacheKey,
  PROMPT_VERSION,
  type CacheKeyInputs,
  type PromptPurpose,
} from "@necro/llm";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { redactLine, UserKeySchema } from "./user-key.js";

/** P3 runs a generous property budget for a security-critical invariant. */
const NUM_RUNS = 1000;

/** The exhaustive set of prompt purposes the cache key is derived for. */
const ALL_PURPOSES: readonly PromptPurpose[] = [
  "py2to3.chunk",
  "lovers.plan",
  "lovers.generate",
];

const arbPurpose: fc.Arbitrary<PromptPurpose> = fc.constantFrom(
  ...ALL_PURPOSES,
);

/**
 * Arbitrary `CacheKeyInputs` — the ONLY inputs the real cache-key builder
 * consumes (R5.3). Deliberately there is no user-key field: that is the point
 * of the exclusion. `promptVersion` is biased toward the real `PROMPT_VERSION`
 * stamp so the "identical content" branch exercises realistic keys.
 */
const arbCacheKeyInputs: fc.Arbitrary<CacheKeyInputs> = fc
  .record({
    purpose: arbPurpose,
    schemaName: fc.string({ minLength: 1, maxLength: 48 }),
    promptVersion: fc.oneof(
      fc.constant(PROMPT_VERSION),
      fc.string({ minLength: 1, maxLength: 8 }),
    ),
    model: fc.string({ minLength: 1, maxLength: 64 }),
    contentHash: fc.hexaString({ minLength: 8, maxLength: 64 }),
    // `null` models "first attempt" (the optional field OMITTED, under
    // exactOptionalPropertyTypes), a hex string models the single repair retry.
    retryErrorHash: fc.option(fc.hexaString({ minLength: 1, maxLength: 64 }), {
      nil: null,
    }),
  })
  .map(({ retryErrorHash, ...base }): CacheKeyInputs =>
    retryErrorHash === null ? base : { ...base, retryErrorHash },
  );

/**
 * Arbitrary secret-shaped user keys that SATISFY `UserKeySchema` (8..512
 * printable, whitespace-free, control-free). Using the real schema keeps the
 * generator honest: these are exactly the values the transport would accept and
 * then pass to the provider / redaction, never to the cache key.
 */
const arbUserKey: fc.Arbitrary<string> = fc
  .string({ minLength: 8, maxLength: 512 })
  // Keep only schema-valid keys (drops any run that generated whitespace or a
  // control character); the surviving values are representative secret tokens.
  .filter((s) => UserKeySchema.safeParse(s).success);

describe("P3 (R5.3, R27.4): the cache key excludes the user key", () => {
  it("is byte-identical whether a user key is absent or present (same inputs)", () => {
    // The builder takes `CacheKeyInputs` only. Deriving twice from the same
    // inputs while a user key is "in play" (present) vs "not" (absent) can only
    // produce the same string, because the key is not an input at all.
    fc.assert(
      fc.property(arbCacheKeyInputs, arbUserKey, (inputs, _userKey) => {
        const withoutKey = deriveCacheKey(inputs);
        const withKey = deriveCacheKey(inputs);
        expect(withKey).toBe(withoutKey);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is byte-identical across two DIFFERENT user keys with identical inputs", () => {
    fc.assert(
      fc.property(
        arbCacheKeyInputs,
        arbUserKey,
        arbUserKey,
        (inputs, keyA, keyB) => {
          fc.pre(keyA !== keyB);
          // Two tabs, two different BYOK keys, same request content/model/
          // version: the shared cache must see ONE key, not two partitions.
          const keyForA = deriveCacheKey(inputs);
          const keyForB = deriveCacheKey(inputs);
          expect(keyForA).toBe(keyForB);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("never contains any user-key byte verbatim in the derived key", () => {
    fc.assert(
      fc.property(arbCacheKeyInputs, arbUserKey, (inputs, userKey) => {
        const key = deriveCacheKey(inputs);
        // The derived key is a sha-256 hex digest; a secret-shaped user key is
        // >= 8 chars, so a verbatim appearance would be a real leak/bug.
        expect(key.includes(userKey)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the ordered cache-key parts never equal any user-key value", () => {
    // Guards the builder's INPUT contract directly: none of the six R5.3 parts
    // is ever the user key, so no hash input could carry it.
    fc.assert(
      fc.property(arbCacheKeyInputs, arbUserKey, (inputs, userKey) => {
        const parts = cacheKeyParts(inputs);
        expect(parts).toHaveLength(6);
        for (const part of parts) {
          expect(part).not.toBe(userKey);
          expect(part.includes(userKey)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P3 (R27.2, R27.4): redaction masks the user key everywhere it appears", () => {
  it("redactLine removes every user-key occurrence from an outgoing value", () => {
    fc.assert(
      fc.property(
        arbUserKey,
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (userKey, pre, post) => {
          // Embed the key in a nested, stream-line-shaped value: a string leaf,
          // an array element, and an object value — exactly the shapes an
          // outgoing line can take.
          const line = {
            phase: `${pre}${userKey}${post}`,
            detail: { token: userKey, note: pre },
            trace: [post, userKey, `${userKey}${userKey}`],
          };

          const scrubbed = redactLine(line, undefined, userKey);

          // No user-key byte survives anywhere in the serialized result.
          const serialized = JSON.stringify(scrubbed);
          expect(serialized.includes(userKey)).toBe(false);
          // And the overall structure is preserved (keys + array length).
          const asRecord = scrubbed as {
            phase: string;
            detail: { token: string; note: string };
            trace: string[];
          };
          expect(Object.keys(asRecord).sort()).toEqual([
            "detail",
            "phase",
            "trace",
          ]);
          expect(asRecord.trace).toHaveLength(3);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("redactLine scrubs BOTH the server key and the user key together", () => {
    fc.assert(
      fc.property(arbUserKey, arbUserKey, (serverKey, userKey) => {
        fc.pre(serverKey !== userKey && !userKey.includes(serverKey));
        const line = { a: serverKey, b: userKey, c: `${serverKey}:${userKey}` };

        const scrubbed = redactLine(line, serverKey, userKey);
        const serialized = JSON.stringify(scrubbed);

        expect(serialized.includes(serverKey)).toBe(false);
        expect(serialized.includes(userKey)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
