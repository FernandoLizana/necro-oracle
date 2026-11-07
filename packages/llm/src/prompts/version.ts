// @necro/llm — prompt template version (re-export of the single source of truth).
//
// PROMPT_VERSION participates in every completion cache key (R8.4) so that any
// change to a prompt template invalidates previously cached completions. The
// constant is OWNED by `@necro/coven`'s `prompts/templates.ts` (the one source
// of truth shared by the adapter-free grimoires), and re-exported here so the
// `@necro/llm` barrel's `PROMPT_VERSION` export is unchanged for its consumers.
export { PROMPT_VERSION } from "@necro/coven";
