// Task 24.1: example tests for the OSV querybatch + vuln detail client.
// Test-first: fails until src/osv.ts exists (task 24.2).
// Requirements: R5.3, R5.5, R5.8, R5.9. Design: D6, "External data" pipeline step 3, "OSV mapping".
//
// Assumed API (src/osv.ts; the orchestrator in external-data.ts calls it):
//
//   fetchOsv(queries, deps, opts?): Promise<OsvResult>   (never throws for per-dependency failures)
//
//   queries: readonly { name: string; ecosystem: "pypi" | "npm"; versionSpec: string }[]
//            `name` is kept as written in the manifest. The order given is the order queried.
//   deps:    { fetch: FetchPort }   (no Authorization header is ever set, R6.3)
//   opts:    { timeoutMs?: number;          effective timeout = min(timeoutMs ?? 10_000, 10_000)
//              batchSize?: number;          default OSV_BATCH_SIZE (1000)
//              maxDetailFetches?: number }  default MAX_OSV_DETAIL_FETCHES (200)
//   OsvResult: { osvData: OsvVulnerability[]; skipped: SkippedDependency[] }
//     SkippedDependency (structural, as in external-data.ts):
//       { name, ecosystem, source: "osv", reason: SkipReason }
//
// Wire protocol (ASSUMED from the OSV API and design.md):
//   POST https://api.osv.dev/v1/querybatch  body {"queries":[{"package":{"name","ecosystem"},"version"}]}
//        ecosystem strings: "PyPI" and "npm". Response {"results":[{"vulns":[{"id"}],"next_page_token"?}]}
//        index-aligned with the queries of that chunk.
//   GET  https://api.osv.dev/v1/vulns/{encodeURIComponent(id)}   one per distinct id (sorted by id).
//
// Pinning (D6): PyPI "==1.2.3" only; npm "1.2.3" or "=1.2.3" only. Anything else is skipped with
// reason "version-not-pinned" and is never sent to OSV (no request at all when nothing is pinned).
//
// Skip reasons (ASSUMED, from the SkipReason union in the design):
//   batch POST or detail GET: transport timeout -> "timeout", transport network -> "network",
//   429 -> "rate-limited", other non-2xx -> "http-error", zod failure or invalid JSON ->
//   "invalid-response", body over MAX_OSV_JSON_BYTES (5 MiB, body cancelled) -> "response-too-large".
//   A failed batch skips every dependency in that chunk. A failed detail skips every dependency
//   that reported that id. A result-count mismatch skips the chunk as "invalid-response".
//   A result carrying `next_page_token` skips that dependency as "response-too-large"
//   (ASSUMED: the page is truncated, the closest existing reason).
//   Ids beyond the detail cap (ids sorted ascending, first N fetched) skip their dependencies
//   as "limit-exceeded".
//
// Mapping (design "OSV mapping"): see the describe blocks below. Output is sorted by
// (affectedPackage, id) using plain code-unit string comparison.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OsvVulnerability } from "@necro/oracle";
import { describe, expect, it } from "vitest";
import { FetchTransportError, type FetchPort, type FetchResponse } from "./ports.js";
import { fetchOsv } from "./osv.js";
import { createFixtureFetch, type FixtureFetch } from "./testing/fixture-fetch.js";

const OSV_FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/registry/osv",
);
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(OSV_FIXTURES, name), "utf8")) as unknown;
}

const BATCH_URL = "https://api.osv.dev/v1/querybatch";
const detailUrl = (id: string): string => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`;

type Q = { name: string; ecosystem: "pypi" | "npm"; versionSpec: string };
const py = (name: string, versionSpec = "==1.2.0"): Q => ({ name, ecosystem: "pypi", versionSpec });
const npm = (name: string, versionSpec = "1.2.0"): Q => ({ name, ecosystem: "npm", versionSpec });

function skip(q: Q, reason: string) {
  return { name: q.name, ecosystem: q.ecosystem, source: "osv", reason };
}

// ---- detail builders -------------------------------------------------------------------

type Event = Record<string, string>;
function affected(ecosystem: string, name: string, ...ranges: Event[][]) {
  return {
    package: { name, ecosystem },
    ranges: ranges.map((events) => ({ type: "ECOSYSTEM", events })),
  };
}
function detail(
  id: string,
  over: { aliases?: string[]; severity?: unknown; affected?: unknown[] } = {},
): Record<string, unknown> {
  return {
    id,
    ...(over.aliases ? { aliases: over.aliases } : {}),
    ...(over.severity !== undefined ? { database_specific: { severity: over.severity } } : {}),
    affected: over.affected ?? [affected("PyPI", "oldlib", [{ introduced: "0" }, { fixed: "1.3.0" }])],
  };
}

// ---- fetch plumbing --------------------------------------------------------------------

function registerBatch(fx: FixtureFetch, results: unknown[], extra: Record<string, unknown> = {}) {
  return fx.register({ method: "POST", url: BATCH_URL, json: { results }, ...extra });
}
function registerDetail(fx: FixtureFetch, id: string, json: unknown, extra: Record<string, unknown> = {}) {
  return fx.register({ url: detailUrl(id), json, ...extra });
}

interface PostedQuery {
  package: { name: string; ecosystem: string };
  version: string;
}
function postedBatches(fx: { requests: { method: string; url: string; body?: string }[] }): PostedQuery[][] {
  return fx.requests
    .filter((r) => r.method === "POST" && r.url === BATCH_URL)
    .map((r) => (JSON.parse(r.body ?? "{}") as { queries: PostedQuery[] }).queries);
}
function detailRequests(fx: FixtureFetch): string[] {
  return fx.requests.filter((r) => r.method === "GET").map((r) => r.url);
}

type BatchScript = (queries: PostedQuery[]) => unknown;
/**
 * Answers querybatch dynamically (one script step per POST, the last step repeats), delegating
 * every other request to the fixture fetch. Requests are recorded on `fx.requests`.
 */
function scriptedBatches(fx: FixtureFetch, steps: BatchScript[]): FetchPort {
  let call = 0;
  const encoder = new TextEncoder();
  return (req) => {
    if (req.method === "POST" && req.url === BATCH_URL) {
      fx.requests.push(req);
      const step = steps[Math.min(call, steps.length - 1)]!;
      call += 1;
      const queries = (JSON.parse(req.body ?? "{}") as { queries: PostedQuery[] }).queries;
      const bytes = encoder.encode(JSON.stringify(step(queries)));
      const res: FetchResponse = {
        status: 200,
        headers: {},
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
      return Promise.resolve(res);
    }
    return fx.fetch(req);
  };
}
const emptyResults = (qs: PostedQuery[]) => ({ results: qs.map(() => ({})) });

// ---- happy path with recorded fixtures --------------------------------------------------

describe("fetchOsv: recorded fixtures round trip (R5.3, R5.8)", () => {
  it("queries pinned deps, fetches details, maps to OsvVulnerability", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, (fixture("batch.json") as { results: unknown[] }).results);
    registerDetail(fx, "GHSA-xxxx-yyyy-zzzz", fixture("GHSA-xxxx-yyyy-zzzz.json"));
    registerDetail(
      fx,
      "PYSEC-2019-0001",
      detail("PYSEC-2019-0001", { aliases: ["GHSA-xxxx-yyyy-zzzz", "CVE-2019-00000"] }),
    );

    const out = await fetchOsv([py("oldlib", "==1.2.0"), py("cleanlib", "==2.0.0")], { fetch: fx.fetch });

    expect(out.osvData).toEqual<OsvVulnerability[]>([
      {
        id: "GHSA-xxxx-yyyy-zzzz",
        severity: "HIGH",
        affectedPackage: "oldlib",
        affectedVersionRange: "<1.3.0",
      },
    ]);
    expect(out.skipped).toEqual([]);

    expect(postedBatches(fx)).toEqual([
      [
        { package: { name: "oldlib", ecosystem: "PyPI" }, version: "1.2.0" },
        { package: { name: "cleanlib", ecosystem: "PyPI" }, version: "2.0.0" },
      ],
    ]);
    expect(detailRequests(fx).sort()).toEqual(
      [detailUrl("GHSA-xxxx-yyyy-zzzz"), detailUrl("PYSEC-2019-0001")].sort(),
    );
  });

  it("never sets Authorization and bounds every request timeout at 10 s (R5.4, R6.3)", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{ vulns: [{ id: "GHSA-xxxx-yyyy-zzzz" }] }]);
    registerDetail(fx, "GHSA-xxxx-yyyy-zzzz", fixture("GHSA-xxxx-yyyy-zzzz.json"));
    await fetchOsv([py("oldlib")], { fetch: fx.fetch }, { timeoutMs: 60_000 });
    expect(fx.requests.length).toBe(2);
    for (const r of fx.requests) {
      expect(r.timeoutMs).toBeLessThanOrEqual(10_000);
      expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
    const fx2 = createFixtureFetch();
    registerBatch(fx2, [{}]);
    await fetchOsv([py("oldlib")], { fetch: fx2.fetch }, { timeoutMs: 2_500 });
    expect(fx2.requests[0]!.timeoutMs).toBe(2_500);
  });

  it("does not make detail requests when no vulnerability is reported", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}, {}]);
    const out = await fetchOsv([py("a"), npm("b")], { fetch: fx.fetch });
    expect(out).toEqual({ osvData: [], skipped: [] });
    expect(detailRequests(fx)).toEqual([]);
  });

  it("uses the npm ecosystem name for npm queries", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}]);
    await fetchOsv([npm("left-pad", "=1.3.0")], { fetch: fx.fetch });
    expect(postedBatches(fx)).toEqual([
      [{ package: { name: "left-pad", ecosystem: "npm" }, version: "1.3.0" }],
    ]);
  });
});

// ---- pinning (D6) ----------------------------------------------------------------------

describe("fetchOsv: only exactly-pinned dependencies are queried (D6, R5.3)", () => {
  it.each([
    ["==1.2.3", "1.2.3"],
    ["==0.0.1", "0.0.1"],
    ["==2.0.0.post1", "2.0.0.post1"],
  ])("PyPI %s is pinned to %s", async (spec, version) => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}]);
    const out = await fetchOsv([py("pkg", spec)], { fetch: fx.fetch });
    expect(postedBatches(fx)[0]![0]!.version).toBe(version);
    expect(out.skipped).toEqual([]);
  });

  it.each([
    ["1.2.3", "1.2.3"],
    ["=1.2.3", "1.2.3"],
    ["1.2.3-beta.1", "1.2.3-beta.1"],
  ])("npm %s is pinned to %s", async (spec, version) => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}]);
    const out = await fetchOsv([npm("pkg", spec)], { fetch: fx.fetch });
    expect(postedBatches(fx)[0]![0]!.version).toBe(version);
    expect(out.skipped).toEqual([]);
  });

  it.each(["", ">=1.0", "~=1.2", "==1.2.*", "<2", "!=1.0", "*", "1.2", "==1.2.3,<2"])(
    "PyPI %j is skipped as version-not-pinned and never queried",
    async (spec) => {
      const fx = createFixtureFetch();
      const q = py("Some_Pkg", spec);
      const out = await fetchOsv([q], { fetch: fx.fetch });
      expect(out.osvData).toEqual([]);
      expect(out.skipped).toEqual([skip(q, "version-not-pinned")]);
      expect(fx.requests).toEqual([]);
    },
  );

  it.each(["", "^1.2.3", "~1.2.3", "1.x", "*", "latest", ">=1", "1.2", "1.2.3 - 2.0.0", "git+https://x/y.git", "==1.2.3"])(
    "npm %j is skipped as version-not-pinned and never queried",
    async (spec) => {
      const fx = createFixtureFetch();
      const q = npm("@scope/Pkg", spec);
      const out = await fetchOsv([q], { fetch: fx.fetch });
      expect(out.skipped).toEqual([skip(q, "version-not-pinned")]);
      expect(fx.requests).toEqual([]);
    },
  );

  it("queries the pinned subset and reports the rest, keeping the name as written", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}]);
    const pinned = py("Flask_Cors", "==3.0.0");
    const loose = py("requests", ">=2");
    const out = await fetchOsv([loose, pinned], { fetch: fx.fetch });
    expect(postedBatches(fx)[0]).toEqual([
      { package: { name: "Flask_Cors", ecosystem: "PyPI" }, version: "3.0.0" },
    ]);
    expect(out.skipped).toEqual([skip(loose, "version-not-pinned")]);
  });
});

// ---- batching, caps ----------------------------------------------------------------------

describe("fetchOsv: batching and caps (R5.3, R5.5)", () => {
  it("posts chunks of at most 1000 queries, preserving order", async () => {
    const fx = createFixtureFetch();
    const qs = Array.from({ length: 2001 }, (_, i) => py(`pkg-${String(i).padStart(4, "0")}`));
    const fetch = scriptedBatches(fx, [emptyResults]);
    const out = await fetchOsv(qs, { fetch });
    const batches = postedBatches(fx);
    expect(batches.map((b) => b.length)).toEqual([1000, 1000, 1]);
    expect(batches.flat().map((q) => q.package.name)).toEqual(qs.map((q) => q.name));
    expect(out).toEqual({ osvData: [], skipped: [] });
  });

  it("honors an injected batch size", async () => {
    const fx = createFixtureFetch();
    const fetch = scriptedBatches(fx, [emptyResults]);
    await fetchOsv([py("a"), py("b"), py("c")], { fetch }, { batchSize: 2 });
    expect(postedBatches(fx).map((b) => b.length)).toEqual([2, 1]);
  });

  it("skips a chunk whose result count differs from its query count, others continue", async () => {
    const fx = createFixtureFetch();
    const [a, b, c, d] = [py("a"), py("b"), py("c"), py("d")];
    registerDetail(fx, "GHSA-aaaa-bbbb-cccc", detail("GHSA-aaaa-bbbb-cccc", { severity: "LOW" }));
    const fetch = scriptedBatches(fx, [
      () => ({ results: [{}] }), // 1 result for 2 queries
      () => ({ results: [{ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] }, {}] }),
    ]);
    const out = await fetchOsv([a, b, c, d], { fetch }, { batchSize: 2 });
    expect(out.skipped).toEqual([skip(a, "invalid-response"), skip(b, "invalid-response")]);
    expect(out.osvData.map((v) => [v.affectedPackage, v.id])).toEqual([["c", "GHSA-aaaa-bbbb-cccc"]]);
  });

  it("skips a chunk that returns more results than queries", async () => {
    const fx = createFixtureFetch();
    registerBatch(fx, [{}, {}, {}]);
    const a = py("a");
    const out = await fetchOsv([a], { fetch: fx.fetch });
    expect(out.skipped).toEqual([skip(a, "invalid-response")]);
  });

  it("records next_page_token as a skipped dependency", async () => {
    const fx = createFixtureFetch();
    const [a, b] = [py("a"), py("b")];
    registerBatch(fx, [{ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }], next_page_token: "tok" }, {}]);
    registerDetail(fx, "GHSA-aaaa-bbbb-cccc", detail("GHSA-aaaa-bbbb-cccc"));
    const out = await fetchOsv([a, b], { fetch: fx.fetch });
    expect(out.skipped).toEqual([skip(a, "response-too-large")]);
  });

  it("fetches each distinct id once, even when several dependencies report it", async () => {
    const fx = createFixtureFetch();
    const id = "GHSA-aaaa-bbbb-cccc";
    registerBatch(fx, [{ vulns: [{ id }] }, { vulns: [{ id }, { id }] }]);
    registerDetail(
      fx,
      id,
      detail(id, {
        severity: "HIGH",
        affected: [
          affected("PyPI", "one", [{ introduced: "0" }, { fixed: "2" }]),
          affected("PyPI", "two", [{ introduced: "0" }, { fixed: "3" }]),
        ],
      }),
    );
    const out = await fetchOsv([py("one"), py("two")], { fetch: fx.fetch });
    expect(detailRequests(fx)).toEqual([detailUrl(id)]);
    expect(out.osvData).toEqual([
      { id, severity: "HIGH", affectedPackage: "one", affectedVersionRange: "<2" },
      { id, severity: "HIGH", affectedPackage: "two", affectedVersionRange: "<3" },
    ]);
  });

  it("caps detail fetches: sorted ids beyond the cap are never requested and skip their dependencies", async () => {
    const fx = createFixtureFetch();
    const ids = ["GHSA-aaaa-aaaa-aaaa", "GHSA-bbbb-bbbb-bbbb", "GHSA-cccc-cccc-cccc"];
    const qs = [py("c"), py("b"), py("a")];
    registerBatch(fx, [
      { vulns: [{ id: ids[2]! }] },
      { vulns: [{ id: ids[1]! }] },
      { vulns: [{ id: ids[0]! }] },
    ]);
    for (const id of ids.slice(0, 2)) registerDetail(fx, id, detail(id, { affected: [affected("PyPI", id === ids[0] ? "a" : "b", [{ introduced: "0" }, { fixed: "9" }])] }));
    const out = await fetchOsv(qs, { fetch: fx.fetch }, { maxDetailFetches: 2 });
    expect(detailRequests(fx).sort()).toEqual([detailUrl(ids[0]!), detailUrl(ids[1]!)]);
    expect(out.skipped).toEqual([skip(qs[0]!, "limit-exceeded")]);
    expect(out.osvData.map((v) => v.affectedPackage)).toEqual(["a", "b"]);
  });

  it("default detail cap is 200", async () => {
    const fx = createFixtureFetch();
    const n = 201;
    const qs = Array.from({ length: n }, (_, i) => py(`p${String(i).padStart(3, "0")}`));
    const idOf = (i: number) => `GHSA-${String(i).padStart(4, "0")}-aaaa-aaaa`;
    const fetch = scriptedBatches(fx, [
      (queries) => ({ results: queries.map((_, i) => ({ vulns: [{ id: idOf(i) }] })) }),
    ]);
    for (let i = 0; i < n; i++) {
      registerDetail(fx, idOf(i), detail(idOf(i), { affected: [affected("PyPI", `p${String(i).padStart(3, "0")}`, [{ introduced: "0" }, { fixed: "1" }])] }));
    }
    const out = await fetchOsv(qs, { fetch });
    expect(detailRequests(fx).length).toBe(200);
    expect(out.skipped).toEqual([skip(qs[200]!, "limit-exceeded")]);
    expect(out.osvData.length).toBe(200);
  });
});

// ---- per-item failures ---------------------------------------------------------------------

describe("fetchOsv: failures are skipped per item and never thrown (R5.5)", () => {
  const ID_OK = "GHSA-okok-okok-okok";
  const ID_BAD = "GHSA-badd-badd-badd";

  async function withBadDetail(configure: (fx: FixtureFetch) => void) {
    const fx = createFixtureFetch();
    const good = py("good");
    const bad = py("bad");
    registerBatch(fx, [{ vulns: [{ id: ID_OK }] }, { vulns: [{ id: ID_BAD }] }]);
    registerDetail(
      fx,
      ID_OK,
      detail(ID_OK, { severity: "LOW", affected: [affected("PyPI", "good", [{ introduced: "0" }, { fixed: "2" }])] }),
    );
    configure(fx);
    const out = await fetchOsv([good, bad], { fetch: fx.fetch });
    return { out, bad };
  }

  it.each([
    ["500", { status: 500, json: {} }, "http-error"],
    ["404", { status: 404, json: {} }, "http-error"],
    ["429", { status: 429, json: {} }, "rate-limited"],
    ["timeout", { transportError: "timeout" as const }, "timeout"],
    ["network", { transportError: "network" as const }, "network"],
    ["not JSON", { body: "<html>nope</html>" }, "invalid-response"],
    ["schema violation", { json: { id: 7 } }, "invalid-response"],
  ])("detail %s skips only the affected dependency", async (_label, spec, reason) => {
    const { out, bad } = await withBadDetail((fx) => {
      fx.register({ url: detailUrl(ID_BAD), ...spec });
    });
    expect(out.skipped).toEqual([skip(bad, reason)]);
    expect(out.osvData.map((v) => v.id)).toEqual([ID_OK]);
  });

  it("a detail over the 5 MiB cap is response-too-large and its body is cancelled", async () => {
    let handle: { cancelCalls: number } | undefined;
    const { out, bad } = await withBadDetail((fx) => {
      handle = fx.register({
        url: detailUrl(ID_BAD),
        stream: [new Uint8Array(3_000_000), new Uint8Array(3_000_000), new Uint8Array(3_000_000)],
      });
    });
    expect(out.skipped).toEqual([skip(bad, "response-too-large")]);
    expect(handle!.cancelCalls).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["500", { status: 500, json: {} }, "http-error"],
    ["429", { status: 429, json: {} }, "rate-limited"],
    ["timeout", { transportError: "timeout" as const }, "timeout"],
    ["network", { transportError: "network" as const }, "network"],
    ["not JSON", { body: "garbage" }, "invalid-response"],
    ["missing results", { json: { nope: [] } }, "invalid-response"],
    ["vuln without id", { json: { results: [{ vulns: [{}] }] } }, "invalid-response"],
  ])("a failing querybatch (%s) skips every dependency of that chunk", async (_label, spec, reason) => {
    const fx = createFixtureFetch();
    const qs = [py("a"), npm("b")];
    fx.register({ method: "POST", url: BATCH_URL, ...spec });
    const out = await fetchOsv(qs, { fetch: fx.fetch });
    expect(out.osvData).toEqual([]);
    expect(out.skipped).toEqual(qs.map((q) => skip(q, reason)));
  });

  it("an oversized querybatch response is response-too-large and cancelled", async () => {
    const fx = createFixtureFetch();
    const handle = fx.register({
      method: "POST",
      url: BATCH_URL,
      stream: [new Uint8Array(3_000_000), new Uint8Array(3_000_000), new Uint8Array(3_000_000)],
    });
    const q = py("a");
    const out = await fetchOsv([q], { fetch: fx.fetch });
    expect(out.skipped).toEqual([skip(q, "response-too-large")]);
    expect(handle.cancelCalls).toBeGreaterThanOrEqual(1);
  });

  it("a failed chunk does not stop later chunks", async () => {
    const fx = createFixtureFetch();
    const [a, b] = [py("a"), py("b")];
    const fetch = scriptedBatches(fx, [
      () => {
        throw new FetchTransportError("timeout", "scripted");
      },
      emptyResults,
    ]);
    const out = await fetchOsv([a, b], { fetch }, { batchSize: 1 });
    expect(out.skipped).toEqual([skip(a, "timeout")]);
    expect(postedBatches(fx).length).toBe(2);
  });

  it("returns empty results for empty input without any request", async () => {
    const fx = createFixtureFetch();
    expect(await fetchOsv([], { fetch: fx.fetch })).toEqual({ osvData: [], skipped: [] });
    expect(fx.requests).toEqual([]);
  });
});

// ---- mapping -------------------------------------------------------------------------------

async function mapOne(
  d: Record<string, unknown>,
  q: Q = py("oldlib", "==1.2.0"),
): Promise<OsvVulnerability[]> {
  const fx = createFixtureFetch();
  registerBatch(fx, [{ vulns: [{ id: d.id as string }] }]);
  registerDetail(fx, d.id as string, d);
  const out = await fetchOsv([q], { fetch: fx.fetch });
  expect(out.skipped).toEqual([]);
  return out.osvData;
}

describe("fetchOsv: severity mapping (R5.9)", () => {
  it.each([
    ["CRITICAL", "CRITICAL"],
    ["HIGH", "HIGH"],
    ["LOW", "LOW"],
    ["MODERATE", "MEDIUM"],
    ["MEDIUM", "MEDIUM"],
    ["moderate", "MEDIUM"],
    ["high", "HIGH"],
    ["SEVERE", "UNKNOWN"],
    ["", "UNKNOWN"],
    [5, "UNKNOWN"],
    [undefined, "UNKNOWN"],
  ])("database_specific.severity %j maps to %s", async (raw, expected) => {
    const [v] = await mapOne(detail("GHSA-sevr-sevr-sevr", { severity: raw }));
    expect(v!.severity).toBe(expected);
  });

  it("an absent database_specific block is UNKNOWN", async () => {
    const [v] = await mapOne({ id: "GHSA-sevr-sevr-sevr", affected: [] });
    expect(v!.severity).toBe("UNKNOWN");
  });
});

describe("fetchOsv: affectedVersionRange rendering (R5.9)", () => {
  const cases: Array<[string, Event[][], string]> = [
    ["introduced 0 + fixed", [[{ introduced: "0" }, { fixed: "1.3.0" }]], "<1.3.0"],
    ["introduced + fixed", [[{ introduced: "1.0.0" }, { fixed: "1.3.0" }]], ">=1.0.0,<1.3.0"],
    ["introduced only", [[{ introduced: "1.0.0" }]], ">=1.0.0"],
    ["introduced + last_affected", [[{ introduced: "1.0.0" }, { last_affected: "1.2.0" }]], ">=1.0.0,<=1.2.0"],
    ["introduced 0 + last_affected", [[{ introduced: "0" }, { last_affected: "1.2.0" }]], "<=1.2.0"],
    [
      "two intervals in one range",
      [[{ introduced: "1.0.0" }, { fixed: "1.1.0" }, { introduced: "2.0.0" }, { fixed: "2.1.0" }]],
      ">=1.0.0,<1.1.0 || >=2.0.0,<2.1.0",
    ],
    [
      "two range objects",
      [[{ introduced: "1.0.0" }, { fixed: "1.1.0" }], [{ introduced: "2.0.0" }]],
      ">=1.0.0,<1.1.0 || >=2.0.0",
    ],
  ];
  it.each(cases)("%s", async (_label, ranges, expected) => {
    const [v] = await mapOne(
      detail("GHSA-rang-rang-rang", { affected: [affected("PyPI", "oldlib", ...ranges)] }),
    );
    expect(v!.affectedVersionRange).toBe(expected);
  });

  it("falls back to ==<queried version> when the matching entry has no ranges", async () => {
    const [v] = await mapOne(
      detail("GHSA-rang-rang-rang", {
        affected: [{ package: { name: "oldlib", ecosystem: "PyPI" }, versions: ["1.2.0"] }],
      }),
    );
    expect(v!.affectedVersionRange).toBe("==1.2.0");
  });

  it("falls back to ==<queried version> for an npm query written with '='", async () => {
    const [v] = await mapOne(
      detail("GHSA-rang-rang-rang", { affected: [{ package: { name: "lib", ecosystem: "npm" } }] }),
      npm("lib", "=4.5.6"),
    );
    expect(v!.affectedVersionRange).toBe("==4.5.6");
  });

  it("uses the affected entry matching the package name and ecosystem", async () => {
    const [v] = await mapOne(
      detail("GHSA-rang-rang-rang", {
        affected: [
          affected("npm", "oldlib", [{ introduced: "0" }, { fixed: "9.9.9" }]),
          affected("PyPI", "otherlib", [{ introduced: "0" }, { fixed: "8.8.8" }]),
          affected("PyPI", "oldlib", [{ introduced: "0" }, { fixed: "1.3.0" }]),
        ],
      }),
    );
    expect(v!.affectedVersionRange).toBe("<1.3.0");
  });

  it("matches PyPI names under PEP 503 normalization and reports the name as written", async () => {
    const [v] = await mapOne(
      detail("GHSA-rang-rang-rang", {
        affected: [affected("PyPI", "old-lib", [{ introduced: "0" }, { fixed: "1.3.0" }])],
      }),
      py("Old_Lib", "==1.2.0"),
    );
    expect(v).toMatchObject({ affectedPackage: "Old_Lib", affectedVersionRange: "<1.3.0" });
  });
});

describe("fetchOsv: output shape (R5.9)", () => {
  it("emits exactly the four OsvVulnerability fields; unknown keys are stripped", async () => {
    const d = { ...detail("GHSA-shap-shap-shap", { severity: "LOW" }), summary: "x", details: "y", references: [] };
    const out = await mapOne(d);
    expect(out).toEqual([
      { id: "GHSA-shap-shap-shap", severity: "LOW", affectedPackage: "oldlib", affectedVersionRange: "<1.3.0" },
    ]);
    expect(Object.keys(out[0]!).sort()).toEqual(["affectedPackage", "affectedVersionRange", "id", "severity"]);
  });
});

describe("fetchOsv: alias collapse (R5.9)", () => {
  async function two(a: Record<string, unknown>, b: Record<string, unknown>, qs: Q[], results: unknown[]) {
    const fx = createFixtureFetch();
    registerBatch(fx, results);
    registerDetail(fx, a.id as string, a);
    registerDetail(fx, b.id as string, b);
    return fetchOsv(qs, { fetch: fx.fetch });
  }

  it("collapses a PYSEC and a GHSA advisory for one package, preferring GHSA", async () => {
    const pysec = detail("PYSEC-2019-0001", { aliases: ["GHSA-xxxx-yyyy-zzzz", "CVE-2019-00000"] });
    const ghsa = detail("GHSA-xxxx-yyyy-zzzz", { aliases: ["CVE-2019-00000"], severity: "HIGH" });
    const out = await two(pysec, ghsa, [py("oldlib")], [
      { vulns: [{ id: "PYSEC-2019-0001" }, { id: "GHSA-xxxx-yyyy-zzzz" }] },
    ]);
    expect(out.osvData).toEqual([
      { id: "GHSA-xxxx-yyyy-zzzz", severity: "HIGH", affectedPackage: "oldlib", affectedVersionRange: "<1.3.0" },
    ]);
  });

  it("collapses advisories that only share a CVE alias", async () => {
    const pysec = detail("PYSEC-2019-0001", { aliases: ["CVE-2019-00000"] });
    const ghsa = detail("GHSA-xxxx-yyyy-zzzz", { aliases: ["CVE-2019-00000"], severity: "HIGH" });
    const out = await two(pysec, ghsa, [py("oldlib")], [
      { vulns: [{ id: "GHSA-xxxx-yyyy-zzzz" }, { id: "PYSEC-2019-0001" }] },
    ]);
    expect(out.osvData.map((v) => v.id)).toEqual(["GHSA-xxxx-yyyy-zzzz"]);
  });

  it("collapses to one record even when no GHSA id is in the group", async () => {
    const a = detail("PYSEC-2019-0001", { aliases: ["CVE-2019-00000"] });
    const b = detail("OSV-2019-0002", { aliases: ["CVE-2019-00000"] });
    const out = await two(a, b, [py("oldlib")], [{ vulns: [{ id: "PYSEC-2019-0001" }, { id: "OSV-2019-0002" }] }]);
    expect(out.osvData.length).toBe(1);
  });

  it("does not collapse unrelated advisories", async () => {
    const a = detail("GHSA-aaaa-aaaa-aaaa", { aliases: ["CVE-2020-1"] });
    const b = detail("GHSA-bbbb-bbbb-bbbb", { aliases: ["CVE-2020-2"] });
    const out = await two(a, b, [py("oldlib")], [{ vulns: [{ id: "GHSA-aaaa-aaaa-aaaa" }, { id: "GHSA-bbbb-bbbb-bbbb" }] }]);
    expect(out.osvData.map((v) => v.id)).toEqual(["GHSA-aaaa-aaaa-aaaa", "GHSA-bbbb-bbbb-bbbb"]);
  });

  it("keeps one record per package when an alias group affects several dependencies", async () => {
    const shared = (id: string) =>
      detail(id, {
        aliases: ["CVE-2020-9"],
        affected: [
          affected("PyPI", "one", [{ introduced: "0" }, { fixed: "2" }]),
          affected("PyPI", "two", [{ introduced: "0" }, { fixed: "3" }]),
        ],
      });
    const out = await two(shared("PYSEC-2020-0009"), shared("GHSA-9999-9999-9999"), [py("one"), py("two")], [
      { vulns: [{ id: "PYSEC-2020-0009" }, { id: "GHSA-9999-9999-9999" }] },
      { vulns: [{ id: "PYSEC-2020-0009" }, { id: "GHSA-9999-9999-9999" }] },
    ]);
    expect(out.osvData.map((v) => [v.affectedPackage, v.id])).toEqual([
      ["one", "GHSA-9999-9999-9999"],
      ["two", "GHSA-9999-9999-9999"],
    ]);
  });
});

describe("fetchOsv: deterministic ordering (D6, R5.10)", () => {
  it("sorts by (affectedPackage, id) regardless of query and response order", async () => {
    const fx = createFixtureFetch();
    const mk = (id: string, pkg: string) =>
      detail(id, { affected: [affected("PyPI", pkg, [{ introduced: "0" }, { fixed: "1" }])] });
    registerBatch(fx, [
      { vulns: [{ id: "GHSA-zzzz-zzzz-zzzz" }] },
      { vulns: [{ id: "GHSA-bbbb-bbbb-bbbb" }, { id: "GHSA-aaaa-aaaa-aaaa" }] },
    ]);
    registerDetail(fx, "GHSA-zzzz-zzzz-zzzz", mk("GHSA-zzzz-zzzz-zzzz", "zebra"));
    registerDetail(fx, "GHSA-bbbb-bbbb-bbbb", mk("GHSA-bbbb-bbbb-bbbb", "alpha"));
    registerDetail(fx, "GHSA-aaaa-aaaa-aaaa", mk("GHSA-aaaa-aaaa-aaaa", "alpha"));
    const out = await fetchOsv([py("zebra"), py("alpha")], { fetch: fx.fetch });
    expect(out.osvData.map((v) => [v.affectedPackage, v.id])).toEqual([
      ["alpha", "GHSA-aaaa-aaaa-aaaa"],
      ["alpha", "GHSA-bbbb-bbbb-bbbb"],
      ["zebra", "GHSA-zzzz-zzzz-zzzz"],
    ]);
  });
});
