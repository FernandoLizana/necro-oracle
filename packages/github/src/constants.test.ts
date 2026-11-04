// Smoke test pinning default literals (task 8.1).
// Requirements: R3.5, R3.9, R3.10, R3.11, R4.8, R5.4, R8.5, R8.7, R8.11.
import { describe, expect, it } from "vitest";
import * as c from "./constants.js";

describe("constants (R3.5, R3.9, R3.10, R3.11, R4.8, R5.4, R8.5, R8.7, R8.11)", () => {
  it("pins extraction caps (R3.9, R3.10, R3.11)", () => {
    expect(c.MAX_COMPRESSED_BYTES).toBe(52_428_800);
    expect(c.MAX_UNCOMPRESSED_BYTES).toBe(209_715_200);
    expect(c.MAX_ENTRIES).toBe(100_000);
    expect(c.BINARY_SNIFF_BYTES).toBe(8000);
    expect(c.TEXT_FILE_CEILING_BYTES).toBe(1_048_576);
  });

  it("pins budget, cache and TTL defaults (R4.8, R8.5, R8.7, R8.11)", () => {
    expect(c.REST_CALL_BUDGET).toBe(5);
    expect(c.DEFAULT_TTL_MS).toBe(604_800_000);
    expect(c.DEGRADED_TTL_MS).toBe(600_000);
    expect(c.DEFAULT_MAX_CACHE_ENTRIES).toBe(20);
  });

  it("pins timeouts, concurrency and limits (R5.4)", () => {
    expect(c.TIMEOUT_REST_MS).toBe(15_000);
    expect(c.TIMEOUT_TARBALL_MS).toBe(40_000);
    expect(c.TIMEOUT_EXTERNAL_MS).toBe(10_000);
    expect(c.EXTERNAL_CONCURRENCY).toBe(8);
    expect(c.MAX_REGISTRY_QUERIES).toBe(300);
    expect(c.MAX_OSV_DETAIL_FETCHES).toBe(200);
    expect(c.OSV_BATCH_SIZE).toBe(1000);
    expect(c.MAX_REST_JSON_BYTES).toBe(2_097_152);
    expect(c.MAX_REGISTRY_JSON_BYTES).toBe(10_485_760);
    expect(c.MAX_OSV_JSON_BYTES).toBe(5_242_880);
  });

  it("pins host sets", () => {
    expect(c.GITHUB_API_HOST).toBe("api.github.com");
    expect(c.CODELOAD_HOST).toBe("codeload.github.com");
    expect([...c.GITHUB_AUTH_HOSTS].sort()).toEqual(["api.github.com", "github.com"]);
    expect([...c.EXTERNAL_HOSTS].sort()).toEqual(["api.osv.dev", "pypi.org", "registry.npmjs.org"]);
  });

  it("VENDORED_SEGMENTS has exactly the six names (R3.5)", () => {
    expect([...c.VENDORED_SEGMENTS].sort()).toEqual(
      [".git", "bower_components", "node_modules", "site-packages", "third_party", "vendor"],
    );
    expect(c.VENDORED_SEGMENTS.size).toBe(6);
  });
});
