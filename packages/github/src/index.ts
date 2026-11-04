// @necro/github — public API (design: Public API). Adapters are injected via ports.
export { parseRepoRef, resolveRef, ParsedRepoRefSchema, type ParsedRepoRef } from "./intake.js";
export { GitHubSummoner, createSummoner } from "./snapshot.js";
export type { SummonExtras, SummonResult, SummonerOptions } from "./snapshot.js";
export { fetchExternalData } from "./external-data.js";
export type { ExternalDataResult, SkippedDependency, SkipReason } from "./external-data.js";
export { mapRepoMeta } from "./repo-meta.js";
export type { MappedMeta, MetaInputs, OptionalOutcome } from "./repo-meta.js";
export { cacheKey, effectiveTtlMs, SnapshotCache } from "./snapshot-cache.js";
export { GitHubClient } from "./github-client.js";
export { SummonerError } from "./errors.js";
export type { SummonerErrorCode } from "./errors.js";
export { DEFAULT_LIMITS } from "./tar-extract.js";
export type { ExtractionLimits } from "./tar-extract.js";
export { FetchTransportError } from "./ports.js";
export type { ClockPort, EnvPort, FetchPort, FetchRequest, FetchResponse, SummonerDeps } from "./ports.js";
export type { DegradedCause, DegradedField } from "./http-failure.js";
export { createSystemFetchPort } from "./adapters/system-fetch.js";
export { systemClock } from "./adapters/system-clock.js";
