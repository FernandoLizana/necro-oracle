// @necro/llm — prompt templates (re-export of the single source of truth) +
// the crypto-backed completion cache-key helper.
//
// The prompt catalogue, the `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE` markers,
// `neutraliseDelimiters`, `buildMessages`, `PROMPT_VERSION`, and the cache-key
// INPUTS contract are OWNED by `@necro/coven`'s `prompts/templates.ts` — the
// ONE source of truth shared by the adapter-free grimoires (design A.4/A.5a,
// R43.9). They are RE-EXPORTED here so the `@necro/llm` barrel exposes them
// exactly as design A.4/A.5a require ("exported through packages/llm/src/
// index.ts"). `@necro/coven` never imports `@necro/llm`, so the dependency
// direction (oracle <- grimoires/coven <- llm) and the grimoire import-ban hold.
//
// The crypto hash itself lives HERE (not in the browser-safe coven barrel):
// `@necro/llm` owns the completion cache and already uses Node freely, so
// `deriveCacheKey` turns the ordered `cacheKeyParts` (R5.3) into a sha-256.

import { createHash } from "node:crypto";

import { cacheKeyParts, type CacheKeyInputs } from "@necro/coven";

// Re-export the single source of truth so the `@necro/llm` barrel is unchanged
// for its consumers (the OpenRouter provider, the structured-output path, the
// LoversRunner wiring).
export {
  PROMPT_VERSION,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  neutraliseDelimiters,
  PROMPT_TEMPLATES,
  getTemplate,
  buildMessages,
  cacheKeyParts,
  type PromptPurpose,
  type PromptTemplate,
  type FewShotPair,
  type MessageInputs,
  type PromptMessage,
  type BuiltMessages,
  type CacheKeyInputs,
} from "@necro/coven";

/**
 * Derive the completion cache key from the R5.3 inputs (design A.5 / D.4). A
 * sha-256 over the ordered {@link cacheKeyParts} joined with NUL (`\u0000`)
 * separators so distinct field boundaries cannot collide. The user API key is
 * intentionally absent (R5.3): the parts are purpose/template id, schema name,
 * PROMPT_VERSION, resolved model id, content hash, and the retry-flag/error
 * hash.
 */
export function deriveCacheKey(inputs: CacheKeyInputs): string {
  const hash = createHash("sha256");
  for (const part of cacheKeyParts(inputs)) {
    hash.update(part).update("\u0000");
  }
  return hash.digest("hex");
}

/** sha-256 hex of arbitrary text — a convenience for deriving `contentHash`. */
export function contentHashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
