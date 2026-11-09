// Caps, hosts, timeouts and defaults for the GitHub summoner (design: Constants).

export const MAX_COMPRESSED_BYTES = 52_428_800; // 50 MB (R3.9)
export const MAX_UNCOMPRESSED_BYTES = 209_715_200; // 200 MB (R3.10)
export const MAX_ENTRIES = 100_000; // (R3.11)
export const BINARY_SNIFF_BYTES = 8000; // NUL within first 8000 bytes (R3.6)
/** Mirrors the oracle cap; used only to decide whether to pass the oversize sentinel. */
export const TEXT_FILE_CEILING_BYTES = 1_048_576;
/** Hard guard in GitHubClient (R4.8). Excludes the tarball download, includes a followed rename redirect. */
export const REST_CALL_BUDGET = 5;
export const DEFAULT_TTL_MS = 604_800_000; // 7 days (R8.5)
/** Cap on the effective TTL of an entry whose degradedFields is non-empty (R8.11). */
export const DEGRADED_TTL_MS = 600_000;
export const DEFAULT_MAX_CACHE_ENTRIES = 20; // (R8.7)
/**
 * Item 23: total-byte budget for the snapshot cache. A cached SummonResult
 * holds the snapshot's whole file-content Map (up to ~200 MB uncompressed), so
 * bounding by entry count alone (20) could pin gigabytes. 256 MB keeps a few
 * large snapshots warm while bounding the warm-instance footprint; the LRU
 * evicts oldest-first once the running total would exceed it.
 */
export const MAX_SNAPSHOT_CACHE_BYTES = 268_435_456; // 256 MB
export const TIMEOUT_REST_MS = 15_000;
export const TIMEOUT_TARBALL_MS = 40_000;
export const TIMEOUT_EXTERNAL_MS = 10_000; // (R5.4)
export const EXTERNAL_CONCURRENCY = 8;
export const MAX_REGISTRY_QUERIES = 300;
export const MAX_OSV_DETAIL_FETCHES = 200;
export const OSV_BATCH_SIZE = 1000;
export const MAX_REST_JSON_BYTES = 2_097_152; // 2 MiB
export const MAX_REGISTRY_JSON_BYTES = 10_485_760; // 10 MiB
export const MAX_OSV_JSON_BYTES = 5_242_880; // 5 MiB

export const GITHUB_API_HOST = "api.github.com";
export const GITHUB_AUTH_HOSTS: ReadonlySet<string> = new Set(["github.com", "api.github.com"]);
/** Direct tarball host (no token) and the only permitted redirect target of the token path. */
export const CODELOAD_HOST = "codeload.github.com";
export const EXTERNAL_HOSTS: ReadonlySet<string> = new Set([
  "pypi.org",
  "registry.npmjs.org",
  "api.osv.dev",
]);

/** Path segments marking vendored or VCS data (R3.5). */
export const VENDORED_SEGMENTS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "vendor",
  "third_party",
  "bower_components",
  "site-packages",
]);
