// Task 25.1: example tests for the external data orchestrator.
// Test-first: fails until src/external-data.ts exists (task 25.5).
// Requirements: R5.1, R5.2, R5.10, R5.11. Design: "External data" pipeline steps 1-4.
//
// Assumed API (src/external-data.ts):
//
//   fetchExternalData(input, deps, opts?): Promise<ExternalDataResult>
//     input: RepoSnapshot | readonly Manifest[]
//            A snapshot is re-parsed with parseAllManifests (snapshot.manifests is IGNORED);
//            a Manifest[] is used as given.
//     deps:  { fetch: FetchPort; clock: ClockPort }   (clock is not used for network time)
//     opts:  { concurrency?: number;   promise-pool size, default EXTERNAL_CONCURRENCY (8)
//              timeoutMs?: number }    effective timeout = min(timeoutMs ?? 10_000, 10_000)
//     Never throws for per-dependency failures.
//
//   ExternalDataResult: { registryData: Map<string, RegistryEntry>;
//                         osvData: OsvVulnerability[];
//                         skipped: SkippedDependency[] }
//     SkippedDependency: { name (as written), ecosystem: "pypi" | "npm",
//                          source: "registry" | "osv", reason: SkipReason }
//
//   Collection (step 1): ecosystem is "npm" for kind "package_json", "pypi" for the four other
//     kinds. Dedupe per ecosystem by name.toLowerCase(); the first spelling wins and the first
//     exactly-pinned versionSpec is kept for OSV. Names are processed alphabetically (by lowercased
//     name). More than MAX_REGISTRY_QUERIES (300) names in one ecosystem: the alphabetical overflow
//     is NOT queried and is recorded as { source: "registry", reason: "limit-exceeded" }.
//   Registry queries (step 2): through fetchPypiEntry / fetchNpmEntry (registries.ts) in a
//     fixed-size promise pool; all PyPI requests are issued before any npm request. The map key is
//     dep.name.toLowerCase() (no ecosystem prefix). Two spellings that normalize to the same PEP 503
//     name share ONE request and both lowercased keys receive the entry. A 404 is omitted, not
//     skipped. If a lowercased key exists in both ecosystems, npm wins (R5.11).
//   OSV (step 3): exactly-pinned dependencies are sent to fetchOsv (osv.ts), whose result is merged.
//     This test file only asserts "registry"-source skips except where OSV is the subject, because
//     whether unpinned dependencies are reported as osv "version-not-pinned" is osv.ts's concern.
import type { Manifest, ManifestKind, OsvVulnerability } from "@necro/oracle";
import { buildSnapshotFromFileMap } from "@necro/oracle";
import { describe, expect, it } from "vitest";
import { EXTERNAL_CONCURRENCY, MAX_REGISTRY_QUERIES } from "./constants.js";
import { fetchExternalData } from "./external-data.js";
import type { FetchPort } from "./ports.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch, type FixtureFetch } from "./testing/fixture-fetch.js";

const clock = fixedClock(Date.UTC(2026, 0, 1));

const pypiUrl = (n: string): string => `https://pypi.org/pypi/${n}/json`;
const npmUrl = (n: string): string => `https://registry.npmjs.org/${n}`;
const BATCH_URL = "https://api.osv.dev/v1/querybatch";
const detailUrl = (id: string): string => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`;

function pypiDoc(name: string, version = "1.0.0"): unknown {
  return {
    info: { name, version, classifiers: [] },
    urls: [{ upload_time_iso_8601: "2020-01-01T00:00:00.000000Z" }],
  };
}
function npmDoc(name: string, version = "2.0.0"): unknown {
  return {
    name,
    "dist-tags": { latest: version },
    versions: { [version]: { name, version } },
    modified: "2024-01-02T03:04:05.000Z",
  };
}

function manifest(kind: ManifestKind, deps: Array<string | [string, string]>, path = "m"): Manifest {
  return {
    path,
    kind,
    parsed: true,
    dependencies: deps.map((d) => {
      const [name, versionSpec] = typeof d === "string" ? [d, ""] : d;
      return { name, versionSpec, extras: [] };
    }),
  };
}

const registrySkips = (r: { skipped: readonly { source: string }[] }) =>
  r.skipped.filter((s) => s.source === "registry");

const requestUrls = (fx: FixtureFetch): string[] => fx.requests.map((r) => r.url);

describe("fetchExternalData: result shape (R5.10)", () => {
  it("returns { registryData, osvData, skipped } and makes no request for no dependencies", async () => {
    const fx = createFixtureFetch();
    const out = await fetchExternalData([], { fetch: fx.fetch, clock });
    expect(out.registryData).toBeInstanceOf(Map);
    expect(out.registryData.size).toBe(0);
    expect(out.osvData).toEqual([]);
    expect(out.skipped).toEqual([]);
    expect(Object.keys(out).sort()).toEqual(["osvData", "registryData", "skipped"]);
    expect(fx.requests).toEqual([]);
  });

  it("keys registryData by dep.name.toLowerCase() with no ecosystem prefix", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("flask-cors"), json: pypiDoc("Flask-Cors", "4.0.0") });
    fx.register({ url: npmUrl("left-pad"), json: npmDoc("left-pad") });
    const out = await fetchExternalData(
      [manifest("requirements_txt", ["Flask_Cors"]), manifest("package_json", ["left-pad"])],
      { fetch: fx.fetch, clock },
    );
    expect([...out.registryData.keys()].sort()).toEqual(["flask_cors", "left-pad"]);
    expect(out.registryData.get("flask_cors")?.name).toBe("Flask-Cors");
    expect(out.registryData.get("left-pad")).toEqual({
      name: "left-pad",
      latestVersion: "2.0.0",
      yanked: false,
      isDeprecated: false,
      py2Only: false,
      publishedAt: "2024-01-02T03:04:05.000Z",
    });
  });
});

describe("fetchExternalData: input forms (R5.1)", () => {
  it("accepts pre-parsed manifests", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("requests"), json: pypiDoc("requests") });
    const out = await fetchExternalData([manifest("requirements_txt", ["requests"])], { fetch: fx.fetch, clock });
    expect([...out.registryData.keys()]).toEqual(["requests"]);
  });

  it("accepts a snapshot, re-parsing manifests and ignoring snapshot.manifests", async () => {
    const snapshot = buildSnapshotFromFileMap(
      { owner: "o", name: "r", sha: "abc", defaultBranch: "main" },
      {
        "requirements.txt": "requests\n",
        "package.json": JSON.stringify({ dependencies: { "left-pad": "^1.0.0" } }),
      },
      { createdAt: "2026-01-01T00:00:00.000Z" },
    );
    const tampered = { ...snapshot, manifests: [] };
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("requests"), json: pypiDoc("requests") });
    fx.register({ url: npmUrl("left-pad"), json: npmDoc("left-pad") });
    const out = await fetchExternalData(tampered, { fetch: fx.fetch, clock });
    expect([...out.registryData.keys()].sort()).toEqual(["left-pad", "requests"]);
  });
});

describe("fetchExternalData: ecosystem and dedupe (R5.1)", () => {
  it("maps package_json to npm and the four other kinds to PyPI", async () => {
    const fx = createFixtureFetch();
    const kinds: ManifestKind[] = ["requirements_txt", "setup_py", "pyproject_toml", "pipfile"];
    kinds.forEach((k, i) => fx.register({ url: pypiUrl(`py${i}`), json: pypiDoc(`py${i}`) }));
    fx.register({ url: npmUrl("js0"), json: npmDoc("js0") });
    const out = await fetchExternalData(
      [...kinds.map((k, i) => manifest(k, [`py${i}`], k)), manifest("package_json", ["js0"])],
      { fetch: fx.fetch, clock },
    );
    expect(requestUrls(fx).filter((u) => u.startsWith("https://pypi.org/")).sort()).toEqual(
      [0, 1, 2, 3].map((i) => pypiUrl(`py${i}`)),
    );
    expect(requestUrls(fx).filter((u) => u.startsWith("https://registry.npmjs.org/"))).toEqual([npmUrl("js0")]);
    expect(out.registryData.size).toBe(5);
  });

  it("dedupes by lowercased name across manifests (one request, one key)", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("requests"), json: pypiDoc("requests") });
    const out = await fetchExternalData(
      [manifest("requirements_txt", ["Requests"], "a/r.txt"), manifest("pyproject_toml", ["requests", "REQUESTS"], "p")],
      { fetch: fx.fetch, clock },
    );
    expect(fx.requests).toHaveLength(1);
    expect([...out.registryData.keys()]).toEqual(["requests"]);
  });

  it("shares one request between spellings with the same PEP 503 name and fans out both keys", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("flask-cors"), json: pypiDoc("Flask-Cors") });
    const out = await fetchExternalData([manifest("requirements_txt", ["Flask_Cors", "flask-cors"])], {
      fetch: fx.fetch,
      clock,
    });
    expect(fx.requests).toHaveLength(1);
    expect([...out.registryData.keys()].sort()).toEqual(["flask-cors", "flask_cors"]);
    expect(out.registryData.get("flask_cors")).toEqual(out.registryData.get("flask-cors"));
  });

  it("issues PyPI requests before npm requests, each alphabetical (deterministic order)", async () => {
    const fx = createFixtureFetch();
    for (const n of ["a", "b"]) fx.register({ url: pypiUrl(n), json: pypiDoc(n) });
    for (const n of ["c", "z"]) fx.register({ url: npmUrl(n), json: npmDoc(n) });
    await fetchExternalData(
      [manifest("package_json", ["z", "c"]), manifest("requirements_txt", ["b", "a"])],
      { fetch: fx.fetch, clock },
      { concurrency: 1 },
    );
    expect(requestUrls(fx)).toEqual([pypiUrl("a"), pypiUrl("b"), npmUrl("c"), npmUrl("z")]);
  });

  it("bounds every request timeout at 10 s and forwards a smaller timeoutMs", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("a"), json: pypiDoc("a") });
    await fetchExternalData([manifest("requirements_txt", ["a"])], { fetch: fx.fetch, clock }, { timeoutMs: 60_000 });
    expect(fx.requests[0]!.timeoutMs).toBeLessThanOrEqual(10_000);
    const fx2 = createFixtureFetch();
    fx2.register({ url: pypiUrl("a"), json: pypiDoc("a") });
    await fetchExternalData([manifest("requirements_txt", ["a"])], { fetch: fx2.fetch, clock }, { timeoutMs: 2_500 });
    expect(fx2.requests[0]!.timeoutMs).toBe(2_500);
  });
});

describe("fetchExternalData: MAX_REGISTRY_QUERIES overflow (R5.1)", () => {
  it("queries the first 300 names alphabetically and skips the rest as limit-exceeded", async () => {
    const names = Array.from({ length: MAX_REGISTRY_QUERIES + 2 }, (_, i) => `pkg${String(i).padStart(4, "0")}`);
    const fx = createFixtureFetch();
    for (const n of names) fx.register({ url: pypiUrl(n), json: pypiDoc(n) });
    // Shuffled input order must not matter.
    const shuffled = [...names].reverse();
    const out = await fetchExternalData([manifest("requirements_txt", shuffled)], { fetch: fx.fetch, clock });
    expect(fx.requests).toHaveLength(MAX_REGISTRY_QUERIES);
    expect(out.registryData.size).toBe(MAX_REGISTRY_QUERIES);
    expect(out.registryData.has(names[MAX_REGISTRY_QUERIES - 1]!)).toBe(true);
    expect(registrySkips(out)).toEqual([
      { name: names[MAX_REGISTRY_QUERIES]!, ecosystem: "pypi", source: "registry", reason: "limit-exceeded" },
      { name: names[MAX_REGISTRY_QUERIES + 1]!, ecosystem: "pypi", source: "registry", reason: "limit-exceeded" },
    ]);
  });
});

describe("fetchExternalData: cross-ecosystem collision (R5.11)", () => {
  it("writes one entry for a name present in both ecosystems and npm wins", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("shared"), json: pypiDoc("shared", "1.0.0") });
    fx.register({ url: npmUrl("shared"), json: npmDoc("shared", "9.9.9") });
    const out = await fetchExternalData(
      [manifest("requirements_txt", ["shared"]), manifest("package_json", ["shared"])],
      { fetch: fx.fetch, clock },
    );
    expect(requestUrls(fx).sort()).toEqual([npmUrl("shared"), pypiUrl("shared")].sort());
    expect(out.registryData.size).toBe(1);
    expect(out.registryData.get("shared")?.latestVersion).toBe("9.9.9");
  });

  it("npm wins even when the npm manifest is listed first", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("shared"), json: pypiDoc("shared", "1.0.0") });
    fx.register({ url: npmUrl("shared"), json: npmDoc("shared", "9.9.9") });
    const out = await fetchExternalData(
      [manifest("package_json", ["shared"]), manifest("requirements_txt", ["shared"])],
      { fetch: fx.fetch, clock },
    );
    expect(out.registryData.get("shared")?.latestVersion).toBe("9.9.9");
  });

  it("keeps the PyPI entry when npm has no such package (404)", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("shared"), json: pypiDoc("shared", "1.0.0") });
    fx.register({ url: npmUrl("shared"), status: 404, json: {} });
    const out = await fetchExternalData(
      [manifest("requirements_txt", ["shared"]), manifest("package_json", ["shared"])],
      { fetch: fx.fetch, clock },
    );
    expect(out.registryData.get("shared")?.latestVersion).toBe("1.0.0");
    expect(registrySkips(out)).toEqual([]);
  });
});

describe("fetchExternalData: per-dependency isolation (R5.5, R5.6)", () => {
  it("omits 404s without skipping, skips failures, and still returns the successes", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("good"), json: pypiDoc("good") });
    fx.register({ url: pypiUrl("gone"), status: 404, json: {} });
    fx.register({ url: pypiUrl("slow"), transportError: "timeout" });
    fx.register({ url: pypiUrl("down"), transportError: "network" });
    const out = await fetchExternalData(
      [manifest("requirements_txt", ["good", "gone", "slow", "down"])],
      { fetch: fx.fetch, clock },
    );
    expect([...out.registryData.keys()]).toEqual(["good"]);
    expect(registrySkips(out)).toEqual([
      { name: "down", ecosystem: "pypi", source: "registry", reason: "network" },
      { name: "slow", ecosystem: "pypi", source: "registry", reason: "timeout" },
    ]);
  });
});

describe("fetchExternalData: concurrency pool (R5.4)", () => {
  function trackingFetch(fx: FixtureFetch): { fetch: FetchPort; peak: () => number } {
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchPort = async (req) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await fx.fetch(req);
      } finally {
        inFlight -= 1;
      }
    };
    return { fetch, peak: () => peak };
  }
  const names = Array.from({ length: 30 }, (_, i) => `dep${String(i).padStart(2, "0")}`);
  function setup(): FixtureFetch {
    const fx = createFixtureFetch();
    for (const n of names) fx.register({ url: pypiUrl(n), json: pypiDoc(n) });
    return fx;
  }

  it("never exceeds opts.concurrency in flight, and does use the pool", async () => {
    const fx = setup();
    const t = trackingFetch(fx);
    const out = await fetchExternalData([manifest("requirements_txt", names)], { fetch: t.fetch, clock }, { concurrency: 3 });
    expect(out.registryData.size).toBe(30);
    expect(t.peak()).toBe(3);
  });

  it("defaults to EXTERNAL_CONCURRENCY", async () => {
    const fx = setup();
    const t = trackingFetch(fx);
    await fetchExternalData([manifest("requirements_txt", names)], { fetch: t.fetch, clock });
    expect(t.peak()).toBeGreaterThan(1);
    expect(t.peak()).toBeLessThanOrEqual(EXTERNAL_CONCURRENCY);
  });
});

describe("fetchExternalData: OSV integration (R5.3, R5.10)", () => {
  it("queries only the first exactly-pinned spec per name and merges osvData", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("oldlib"), json: pypiDoc("oldlib", "1.3.0") });
    fx.register({
      method: "POST",
      url: BATCH_URL,
      json: { results: [{ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] }] },
    });
    fx.register({
      url: detailUrl("GHSA-aaaa-bbbb-cccc"),
      json: {
        id: "GHSA-aaaa-bbbb-cccc",
        database_specific: { severity: "HIGH" },
        affected: [
          {
            package: { name: "oldlib", ecosystem: "PyPI" },
            ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.3.0" }] }],
          },
        ],
      },
    });
    const out = await fetchExternalData(
      [manifest("requirements_txt", [["OldLib", ">=1.0"], ["oldlib", "==1.2.0"], ["oldlib", "==1.1.0"]])],
      { fetch: fx.fetch, clock },
    );
    const posts = fx.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    const queries = (JSON.parse(posts[0]!.body ?? "{}") as { queries: { package: { name: string }; version: string }[] }).queries;
    expect(queries).toHaveLength(1);
    expect(queries[0]!.version).toBe("1.2.0");
    expect(queries[0]!.package.name.toLowerCase()).toBe("oldlib");
    expect(out.osvData).toHaveLength(1);
    expect(out.osvData[0]).toMatchObject<Partial<OsvVulnerability>>({
      id: "GHSA-aaaa-bbbb-cccc",
      severity: "HIGH",
      affectedVersionRange: "<1.3.0",
    });
    expect(out.registryData.has("oldlib")).toBe(true);
  });

  it("makes no OSV request when nothing is exactly pinned", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("a"), json: pypiDoc("a") });
    const out = await fetchExternalData([manifest("requirements_txt", [["a", ">=1.0"]])], { fetch: fx.fetch, clock });
    expect(fx.requests.filter((r) => r.url.startsWith("https://api.osv.dev/"))).toEqual([]);
    expect(out.osvData).toEqual([]);
  });

  it("never throws when OSV fails and keeps registry results", async () => {
    const fx = createFixtureFetch();
    fx.register({ url: pypiUrl("a"), json: pypiDoc("a") });
    fx.register({ method: "POST", url: BATCH_URL, transportError: "network" });
    const out = await fetchExternalData([manifest("requirements_txt", [["a", "==1.0.0"]])], { fetch: fx.fetch, clock });
    expect(out.registryData.has("a")).toBe(true);
    expect(out.osvData).toEqual([]);
    expect(out.skipped).toContainEqual({ name: "a", ecosystem: "pypi", source: "osv", reason: "network" });
  });
});
