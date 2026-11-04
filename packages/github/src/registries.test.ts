// Task 23.1: example tests for the PyPI and npm registry fetchers.
// Test-first: fails until src/registries.ts exists (task 23.2).
// Requirements: R5.2, R5.4, R5.5, R5.6, R5.8, R5.9, R6.3.
//
// Assumed API (design.md, "External data" > pipeline step 2 and "Registry mapping"):
//
//   fetchPypiEntry(name, deps, opts?): Promise<RegistryOutcome>
//   fetchNpmEntry(name, deps, opts?):  Promise<RegistryOutcome>
//     deps: { fetch: FetchPort }                       (ASSUMED: only the fetch port is needed)
//     opts: { timeoutMs?: number; signal?: AbortSignal }
//       timeoutMs = min(opts.timeoutMs ?? 10_000, 10_000) is what reaches FetchRequest.timeoutMs.
//     `name` is the dependency name as written in the manifest (any case / separators).
//
//   RegistryOutcome (ASSUMED discriminated union; one dependency, one outcome, never throws):
//     | { status: "ok";      entry: RegistryEntry }     entry shape from @necro/oracle
//     | { status: "absent" }                            HTTP 404: omitted, NOT skipped (R5.6)
//     | { status: "skipped"; reason: SkipReason }       any other failure (R5.5)
//
//   Pure helpers (ASSUMED names, exported from registries.ts):
//     pep503Name(name): string          [-_.]+ -> "-", lower-cased
//     encodeNpmName(name): string       "@scope/name" -> "@scope%2Fname"; unscoped unchanged
//     isValidPypiName(name): boolean    strict pattern; false never reaches a URL
//     isValidNpmName(name): boolean     strict pattern (optional @scope/ prefix, lower-case)
//
//   Requests (both host-allow-listed through externalRequest, never an Authorization header):
//     PyPI: GET https://pypi.org/pypi/{pep503Name}/json
//     npm:  GET https://registry.npmjs.org/{encodeNpmName}
//           with Accept: application/vnd.npm.install-v1+json
//
//   Failure mapping: FetchTransportError "timeout" -> "timeout"; "network" -> "network";
//     404 -> absent; 429 -> "rate-limited"; other non-2xx -> "http-error";
//     malformed JSON or zod failure -> "invalid-response";
//     body over MAX_REGISTRY_JSON_BYTES -> "response-too-large";
//     PyPI document with zero files -> "no-published-files";
//     invalid name -> "invalid-name" with zero requests.
//
//   Mapping (RegistryEntry):
//     PyPI: name=info.name, latestVersion=info.version, yanked=info.yanked===true,
//           isDeprecated = "Development Status :: 7 - Inactive" classifier,
//           py2Only = "Python :: 2 :: Only" OR (some "Python :: 2*" and no "Python :: 3*"),
//           publishedAt = latest urls[].upload_time_iso_8601 normalized via toISOString().
//     npm:  name, latestVersion=dist-tags.latest, yanked=false, py2Only=false,
//           isDeprecated = versions[latest].deprecated is a non-empty string,
//           publishedAt = `modified` normalized via toISOString() (design Q3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_REGISTRY_JSON_BYTES, TIMEOUT_EXTERNAL_MS } from "./constants.js";
import {
  encodeNpmName,
  fetchNpmEntry,
  fetchPypiEntry,
  isValidNpmName,
  isValidPypiName,
  pep503Name,
} from "./registries.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/registry");

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as Record<string, unknown>;
}

function pypiDoc(over: {
  classifiers?: string[];
  yanked?: boolean;
  urls?: string[];
  name?: string;
  version?: string;
}): unknown {
  return {
    info: {
      name: over.name ?? "pkg",
      version: over.version ?? "1.0.0",
      classifiers: over.classifiers ?? [],
      ...(over.yanked === undefined ? {} : { yanked: over.yanked }),
    },
    urls: (over.urls ?? ["2020-01-01T00:00:00.000000Z"]).map((t) => ({ upload_time_iso_8601: t })),
  };
}

function pypiUrl(n: string): string {
  return `https://pypi.org/pypi/${n}/json`;
}
function npmUrl(n: string): string {
  return `https://registry.npmjs.org/${n}`;
}

describe("pure helpers", () => {
  it("pep503Name collapses runs of -_. and lower-cases (Flask_Cors -> flask-cors)", () => {
    expect(pep503Name("Flask_Cors")).toBe("flask-cors");
    expect(pep503Name("zope.interface")).toBe("zope-interface");
    expect(pep503Name("A__b--c..D")).toBe("a-b-c-d");
  });

  it("encodeNpmName encodes the scope slash only", () => {
    expect(encodeNpmName("@scope/name")).toBe("@scope%2Fname");
    expect(encodeNpmName("left-pad")).toBe("left-pad");
  });

  it("accepts well-formed names and rejects hostile ones", () => {
    expect(isValidPypiName("Flask_Cors")).toBe(true);
    expect(isValidPypiName("a")).toBe(true);
    for (const bad of ["", "-lead", "trail-", "a b", "a/b", "a?x=1", "../etc", "a%2Fb", "é"]) {
      expect(isValidPypiName(bad), bad).toBe(false);
    }
    expect(isValidNpmName("left-pad")).toBe(true);
    expect(isValidNpmName("@scope/name")).toBe(true);
    for (const bad of ["", "@scope", "@/name", "a b", "a/b", "../x", "UPPER", ".hidden", "_hidden", "a?b", "@a/b/c"]) {
      expect(isValidNpmName(bad), bad).toBe(false);
    }
  });
});

describe("fetchPypiEntry", () => {
  it("requests the PEP 503 normalized URL for Flask_Cors and maps the entry", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("flask-cors"), json: pypiDoc({ name: "Flask-Cors", version: "4.0.0" }) });
    const out = await fetchPypiEntry("Flask_Cors", { fetch: fx.fetch });
    expect(fx.requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${pypiUrl("flask-cors")}`]);
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.entry.name).toBe("Flask-Cors");
  });

  it("maps the py3-active fixture", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("newlib"), json: loadJson("pypi/py3-active.json") });
    const out = await fetchPypiEntry("newlib", { fetch: fx.fetch });
    expect(out).toEqual({
      status: "ok",
      entry: {
        name: "newlib",
        latestVersion: "4.0.1",
        yanked: false,
        isDeprecated: false,
        py2Only: false,
        publishedAt: "2024-09-01T10:00:00.000Z",
      },
    });
  });

  it("maps the py2-only fixture (inactive, python 2 classifiers only)", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("oldlib"), json: loadJson("pypi/py2-only.json") });
    const out = await fetchPypiEntry("oldlib", { fetch: fx.fetch });
    expect(out).toEqual({
      status: "ok",
      entry: {
        name: "oldlib",
        latestVersion: "1.2.0",
        yanked: false,
        isDeprecated: true,
        py2Only: true,
        publishedAt: "2016-05-04T10:00:00.000Z",
      },
    });
  });

  const classifierCases: Array<[string, string[], boolean]> = [
    ["explicit '2 :: Only'", ["Programming Language :: Python :: 2 :: Only"], true],
    ["'2 :: Only' even alongside a 3 classifier", ["Programming Language :: Python :: 2 :: Only", "Programming Language :: Python :: 3"], true],
    ["python 2 and no 3", ["Programming Language :: Python :: 2", "Programming Language :: Python :: 2.7"], true],
    ["python 2 and 3", ["Programming Language :: Python :: 2", "Programming Language :: Python :: 3"], false],
    ["python 2.7 and 3.12", ["Programming Language :: Python :: 2.7", "Programming Language :: Python :: 3.12"], false],
    ["no python classifiers", ["License :: OSI Approved :: MIT License"], false],
    ["no classifiers at all", [], false],
  ];
  for (const [label, classifiers, expected] of classifierCases) {
    it(`py2Only is ${String(expected)} for ${label}`, async () => {
      const fx = createFixtureFetch();
      fx.register({ url: pypiUrl("pkg"), json: pypiDoc({ classifiers }) });
      const out = await fetchPypiEntry("pkg", { fetch: fx.fetch });
      expect(out.status === "ok" && out.entry.py2Only).toBe(expected);
    });
  }

  it("isDeprecated follows the Inactive classifier only", async () => {
    const fx = createFixtureFetch();
    fx.register({
      url: pypiUrl("a"),
      json: pypiDoc({ classifiers: ["Development Status :: 7 - Inactive"] }),
    });
    fx.register({
      url: pypiUrl("b"),
      json: pypiDoc({ classifiers: ["Development Status :: 5 - Production/Stable"] }),
    });
    const a = await fetchPypiEntry("a", { fetch: fx.fetch });
    const b = await fetchPypiEntry("b", { fetch: fx.fetch });
    expect(a.status === "ok" && a.entry.isDeprecated).toBe(true);
    expect(b.status === "ok" && b.entry.isDeprecated).toBe(false);
  });

  it("yanked is true only when info.yanked === true", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("y"), json: pypiDoc({ yanked: true }) });
    fx.register({ url: pypiUrl("n"), json: pypiDoc({ yanked: false }) });
    fx.register({ url: pypiUrl("u"), json: pypiDoc({}) });
    const y = await fetchPypiEntry("y", { fetch: fx.fetch });
    const n = await fetchPypiEntry("n", { fetch: fx.fetch });
    const u = await fetchPypiEntry("u", { fetch: fx.fetch });
    expect(y.status === "ok" && y.entry.yanked).toBe(true);
    expect(n.status === "ok" && n.entry.yanked).toBe(false);
    expect(u.status === "ok" && u.entry.yanked).toBe(false);
  });

  it("publishedAt is the latest upload time, normalized to ISO UTC", async () => {
    const fx = createFixtureFetch();
    fx.register({
      url: pypiUrl("pkg"),
      json: pypiDoc({
        urls: ["2021-03-01T10:00:00+00:00", "2022-06-01T12:00:00.123456Z", "2021-12-31T23:59:59Z"],
      }),
    });
    const out = await fetchPypiEntry("pkg", { fetch: fx.fetch });
    expect(out.status === "ok" && out.entry.publishedAt).toBe("2022-06-01T12:00:00.123Z");
  });

  it("publishedAt converts offsets to UTC", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("pkg"), json: pypiDoc({ urls: ["2022-06-01T12:00:00+02:00"] }) });
    const out = await fetchPypiEntry("pkg", { fetch: fx.fetch });
    expect(out.status === "ok" && out.entry.publishedAt).toBe("2022-06-01T10:00:00.000Z");
  });

  it("a document with no files is skipped as no-published-files", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("pkg"), json: pypiDoc({ urls: [] }) });
    expect(await fetchPypiEntry("pkg", { fetch: fx.fetch })).toEqual({
      status: "skipped",
      reason: "no-published-files",
    });
  });
});

describe("fetchNpmEntry", () => {
  it("requests the abbreviated metadata URL with the install-v1 Accept header", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: npmUrl("fresh-lib"), json: loadJson("npm/active.json") });
    await fetchNpmEntry("fresh-lib", { fetch: fx.fetch });
    expect(fx.requests).toHaveLength(1);
    const req = fx.requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.url).toBe(npmUrl("fresh-lib"));
    const accept = Object.entries(req.headers).find(([k]) => k.toLowerCase() === "accept");
    expect(accept?.[1]).toBe("application/vnd.npm.install-v1+json");
  });

  it("encodes scoped names as @scope%2Fname in the URL", async () => {
    const fx = createFixtureFetch();
    fx.register({
      url: npmUrl("@scope%2Fname"),
      json: { ...loadJson("npm/active.json"), name: "@scope/name" },
    });
    const out = await fetchNpmEntry("@scope/name", { fetch: fx.fetch });
    expect(fx.requests[0]?.url).toBe(npmUrl("@scope%2Fname"));
    expect(out.status === "ok" && out.entry.name).toBe("@scope/name");
  });

  it("maps the active fixture", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: npmUrl("fresh-lib"), json: loadJson("npm/active.json") });
    expect(await fetchNpmEntry("fresh-lib", { fetch: fx.fetch })).toEqual({
      status: "ok",
      entry: {
        name: "fresh-lib",
        latestVersion: "5.1.0",
        yanked: false,
        isDeprecated: false,
        py2Only: false,
        publishedAt: "2025-01-02T03:04:05.000Z",
      },
    });
  });

  it("maps the deprecated fixture (deprecated message on the latest version)", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: npmUrl("left-relic"), json: loadJson("npm/deprecated.json") });
    expect(await fetchNpmEntry("left-relic", { fetch: fx.fetch })).toEqual({
      status: "ok",
      entry: {
        name: "left-relic",
        latestVersion: "2.0.0",
        yanked: false,
        isDeprecated: true,
        py2Only: false,
        publishedAt: "2018-01-02T03:04:05.000Z",
      },
    });
  });

  it("an empty deprecated string is not deprecated; only the latest version counts", async () => {
    const fx = createFixtureFetch();
    fx.register({
      url: npmUrl("a"),
      json: {
        name: "a",
        "dist-tags": { latest: "2.0.0" },
        versions: { "1.0.0": { deprecated: "old" }, "2.0.0": { deprecated: "" } },
        modified: "2024-01-01T00:00:00.000Z",
      },
    });
    const out = await fetchNpmEntry("a", { fetch: fx.fetch });
    expect(out.status === "ok" && out.entry.isDeprecated).toBe(false);
  });

  it("normalizes modified offsets to UTC", async () => {
    const fx = createFixtureFetch();
    fx.register({
      url: npmUrl("a"),
      json: {
        name: "a",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": {} },
        modified: "2024-01-01T02:00:00+02:00",
      },
    });
    const out = await fetchNpmEntry("a", { fetch: fx.fetch });
    expect(out.status === "ok" && out.entry.publishedAt).toBe("2024-01-01T00:00:00.000Z");
  });
});

type Fetcher = typeof fetchPypiEntry;
const ECOSYSTEMS: Array<{ label: string; fetcher: Fetcher; name: string; url: string; good: unknown }> = [
  { label: "pypi", fetcher: fetchPypiEntry, name: "pkg", url: pypiUrl("pkg"), good: pypiDoc({}) },
  { label: "npm", fetcher: fetchNpmEntry, name: "fresh-lib", url: npmUrl("fresh-lib"), good: loadJson("npm/active.json") },
];

for (const eco of ECOSYSTEMS) {
  describe(`${eco.label}: failure mapping and request policy`, () => {
    it("404 is absent, not skipped (R5.6)", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, status: 404, body: '{"message":"Not Found"}' });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({ status: "absent" });
    });

    it("transport timeout -> skipped timeout", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, transportError: "timeout" });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({ status: "skipped", reason: "timeout" });
    });

    it("transport network failure -> skipped network", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, transportError: "network" });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({ status: "skipped", reason: "network" });
    });

    it("an unexpected thrown value -> skipped network, never a rejection", async () => {
      const fx = createFixtureFetch(); // nothing registered: the fixture fetch rejects with a plain Error
      await expect(eco.fetcher(eco.name, { fetch: fx.fetch })).resolves.toEqual({
        status: "skipped",
        reason: "network",
      });
    });

    for (const status of [500, 502, 503, 403, 410]) {
      it(`HTTP ${String(status)} -> skipped http-error`, async () => {
        const fx = createFixtureFetch();
        fx.register({ url: eco.url, status, body: "x" });
        expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
          status: "skipped",
          reason: "http-error",
        });
      });
    }

    it("HTTP 429 -> skipped rate-limited", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, status: 429, headers: { "retry-after": "30" }, body: "slow down" });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "rate-limited",
      });
    });

    it("a redirect response is an http-error (redirects are never followed)", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, redirectTo: "https://evil.example/x" });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "http-error",
      });
      expect(fx.requests).toHaveLength(1);
    });

    it("malformed JSON -> skipped invalid-response", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, body: "{not json" });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "invalid-response",
      });
    });

    it("schema mismatch -> skipped invalid-response", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, json: { unexpected: true } });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "invalid-response",
      });
    });

    it("an empty 200 body -> skipped invalid-response", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, status: 200 });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "invalid-response",
      });
    });

    it("a body over MAX_REGISTRY_JSON_BYTES -> skipped response-too-large, and the stream is cancelled", async () => {
      const fx = createFixtureFetch();
      const chunk = new Uint8Array(1_048_576).fill(0x20);
      const chunks = Array.from({ length: Math.ceil(MAX_REGISTRY_JSON_BYTES / chunk.length) + 2 }, () => chunk);
      const handle = fx.register({ url: eco.url, stream: chunks });
      expect(await eco.fetcher(eco.name, { fetch: fx.fetch })).toEqual({
        status: "skipped",
        reason: "response-too-large",
      });
      expect(handle.cancelCalls).toBeGreaterThanOrEqual(1);
      expect(handle.chunksPulled).toBeLessThan(chunks.length);
    });

    it("sends no Authorization header and uses manual redirects (R6.3)", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, json: eco.good });
      await eco.fetcher(eco.name, { fetch: fx.fetch });
      expect(fx.requests).toHaveLength(1);
      const req = fx.requests[0]!;
      expect(Object.keys(req.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
      expect(req.redirect).toBe("manual");
      expect(req.method).toBe("GET");
    });

    it("only talks to allow-listed https hosts", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, json: eco.good });
      await eco.fetcher(eco.name, { fetch: fx.fetch });
      const u = new URL(fx.requests[0]!.url);
      expect(u.protocol).toBe("https:");
      expect(["pypi.org", "registry.npmjs.org"]).toContain(u.host);
    });

    it("clamps the request timeout to 10 s and honors a smaller one (R5.4)", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, json: eco.good });
      await eco.fetcher(eco.name, { fetch: fx.fetch });
      await eco.fetcher(eco.name, { fetch: fx.fetch }, { timeoutMs: 60_000 });
      await eco.fetcher(eco.name, { fetch: fx.fetch }, { timeoutMs: 2_500 });
      expect(fx.requests.map((r) => r.timeoutMs)).toEqual([TIMEOUT_EXTERNAL_MS, TIMEOUT_EXTERNAL_MS, 2_500]);
    });

    it("forwards the caller's abort signal", async () => {
      const fx = createFixtureFetch();
      fx.register({ url: eco.url, json: eco.good });
      const controller = new AbortController();
      await eco.fetcher(eco.name, { fetch: fx.fetch }, { signal: controller.signal });
      expect(fx.requests[0]?.signal).toBe(controller.signal);
    });
  });
}

describe("invalid names never reach a URL (R5.2)", () => {
  const hostile = ["", "a b", "a/b", "../etc/passwd", "a?x=1", "a#frag", "a%2Fb", "-lead", "http://evil.example/x"];
  for (const name of hostile) {
    it(`pypi rejects ${JSON.stringify(name)}`, async () => {
      const fx = createFixtureFetch();
      expect(await fetchPypiEntry(name, { fetch: fx.fetch })).toEqual({ status: "skipped", reason: "invalid-name" });
      expect(fx.requests).toHaveLength(0);
    });
    it(`npm rejects ${JSON.stringify(name)}`, async () => {
      const fx = createFixtureFetch();
      expect(await fetchNpmEntry(name, { fetch: fx.fetch })).toEqual({ status: "skipped", reason: "invalid-name" });
      expect(fx.requests).toHaveLength(0);
    });
  }

  it("the literal 'invalid-name' string is a legal pypi/npm name shape, so a hyphenated name is requested", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("invalid-name"), status: 404 });
    expect(await fetchPypiEntry("invalid-name", { fetch: fx.fetch })).toEqual({ status: "absent" });
    expect(fx.requests).toHaveLength(1);
  });
});
