// Task 25.2: property test P24 for the external data orchestrator.
// Test-first: fails until src/external-data.ts exists (task 25.5).
// API as documented in the header of src/external-data.test.ts.
import type { Manifest, ManifestKind } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fetchExternalData } from "./external-data.js";
import { FetchTransportError, type FetchPort, type FetchRequest } from "./ports.js";
import { fixedClock } from "./testing/fixed-clock.js";

const clock = fixedClock(Date.UTC(2026, 0, 1));
const encoder = new TextEncoder();

const PYPI_KINDS: readonly ManifestKind[] = ["requirements_txt", "setup_py", "pyproject_toml", "pipfile"];
const PYPI_VERSION = "1.0.0";
const NPM_VERSION = "2.0.0";

// ---- arbitraries (inline) ----

const LOWER = "abcdefghijklmnopqrstuvwxyz".split("");
const UPPER_OR_LOWER_ALNUM = [...LOWER, ...LOWER.map((c) => c.toUpperCase()), "0", "1"];

/** Small alphabet so collisions (case, PEP 503 separators, cross-ecosystem) are frequent. */
const arbPkgName: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("a", "b", "A", "B", "c"),
    fc.array(fc.constantFrom("a", "b", "A", "B", "-", "_", "."), { maxLength: 3 }),
    fc.constantFrom(...UPPER_OR_LOWER_ALNUM.slice(0, 6)),
  )
  .map(([h, mid, t]) => h + mid.join("") + t);

interface DepCase {
  readonly kind: ManifestKind;
  readonly name: string;
  readonly versionSpec: string;
}

const arbDep: fc.Arbitrary<DepCase> = fc.record({
  kind: fc.constantFrom<ManifestKind>(...PYPI_KINDS, "package_json"),
  name: arbPkgName,
  versionSpec: fc.constantFrom("", ">=1.0", "==1.2.3", "1.2.3", "^1.0.0"),
});

const arbDeps: fc.Arbitrary<DepCase[]> = fc.array(arbDep, { maxLength: 40 });
const arbTimeout: fc.Arbitrary<number | undefined> = fc.option(fc.integer({ min: 1, max: 120_000 }), {
  nil: undefined,
});

function toManifests(deps: readonly DepCase[]): Manifest[] {
  const byKind = new Map<ManifestKind, DepCase[]>();
  for (const d of deps) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  return [...byKind].map(([kind, ds]) => ({
    path: kind,
    kind,
    parsed: true,
    dependencies: ds.map((d) => ({ name: d.name, versionSpec: d.versionSpec, extras: [] })),
  }));
}

// ---- responder: answers any registry URL successfully, OSV with no vulnerabilities ----

function json(status: number, value: unknown) {
  const bytes = encoder.encode(JSON.stringify(value));
  return {
    status,
    headers: {},
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  };
}

function recordingFetch(): { fetch: FetchPort; requests: FetchRequest[] } {
  const requests: FetchRequest[] = [];
  const fetch: FetchPort = (req) => {
    requests.push(req);
    const url = new URL(req.url);
    if (url.hostname === "pypi.org") {
      const name = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      return Promise.resolve(
        json(200, {
          info: { name, version: PYPI_VERSION, classifiers: [] },
          urls: [{ upload_time_iso_8601: "2020-01-01T00:00:00.000000Z" }],
        }),
      );
    }
    if (url.hostname === "registry.npmjs.org") {
      const name = decodeURIComponent(url.pathname.slice(1));
      return Promise.resolve(
        json(200, {
          name,
          "dist-tags": { latest: NPM_VERSION },
          versions: { [NPM_VERSION]: { name, version: NPM_VERSION } },
          modified: "2024-01-02T03:04:05.000Z",
        }),
      );
    }
    if (url.hostname === "api.osv.dev" && req.method === "POST") {
      const queries = (JSON.parse(req.body ?? "{}") as { queries?: unknown[] }).queries ?? [];
      return Promise.resolve(json(200, { results: queries.map(() => ({})) }));
    }
    return Promise.reject(new Error(`unexpected request ${req.method} ${req.url}`));
  };
  return { fetch, requests };
}

const isRegistryUrl = (u: string, host: string): boolean => new URL(u).hostname === host;

describe("P24 (R5.1, R5.2, R5.4, R5.9, R5.11, R6.3): registry data is keyed, deduplicated, and well-formed", () => {
  it("holds for any dependency list and successful responses", async () => {
    await fc.assert(
      fc.asyncProperty(arbDeps, arbTimeout, async (deps, timeoutMs) => {
        const { fetch, requests } = recordingFetch();
        const out = await fetchExternalData(
          toManifests(deps),
          { fetch, clock },
          timeoutMs === undefined ? undefined : { timeoutMs },
        );

        const pypiLower = new Set(deps.filter((d) => d.kind !== "package_json").map((d) => d.name.toLowerCase()));
        const npmLower = new Set(deps.filter((d) => d.kind === "package_json").map((d) => d.name.toLowerCase()));
        const allLower = new Set([...pypiLower, ...npmLower]);

        // Keys: lowercased input names only, no ecosystem prefix; all successes are present (R5.2, R5.9).
        expect(new Set(out.registryData.keys())).toEqual(allLower);

        // Entry shape (R5.9).
        for (const entry of out.registryData.values()) {
          expect(typeof entry.name).toBe("string");
          expect(typeof entry.latestVersion).toBe("string");
          expect(typeof entry.yanked).toBe("boolean");
          expect(typeof entry.isDeprecated).toBe("boolean");
          expect(typeof entry.py2Only).toBe("boolean");
          expect(typeof entry.publishedAt).toBe("string");
        }

        // Cross-ecosystem collision: exactly one entry, npm wins (R5.11).
        for (const key of allLower) {
          const expected = npmLower.has(key) ? NPM_VERSION : PYPI_VERSION;
          expect(out.registryData.get(key)?.latestVersion).toBe(expected);
        }

        // At most one request per lowercased name per ecosystem (R5.1).
        const pypiGets = requests.filter((r) => r.method === "GET" && isRegistryUrl(r.url, "pypi.org"));
        const npmGets = requests.filter((r) => r.method === "GET" && isRegistryUrl(r.url, "registry.npmjs.org"));
        expect(new Set(pypiGets.map((r) => r.url)).size).toBe(pypiGets.length);
        expect(new Set(npmGets.map((r) => r.url)).size).toBe(npmGets.length);
        expect(pypiGets.length).toBeLessThanOrEqual(pypiLower.size);
        expect(npmGets.length).toBeLessThanOrEqual(npmLower.size);

        // Timeouts bounded at 10 s whatever is supplied (R5.4).
        for (const r of requests) {
          expect(r.timeoutMs).toBeLessThanOrEqual(10_000);
          if (timeoutMs !== undefined) expect(r.timeoutMs).toBeLessThanOrEqual(timeoutMs);
        }

        // No Authorization header on any registry/OSV request (R6.3).
        for (const r of requests) {
          expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("regression: the same name in both ecosystems yields one npm entry", async () => {
    const { fetch } = recordingFetch();
    const out = await fetchExternalData(
      toManifests([
        { kind: "requirements_txt", name: "Shared", versionSpec: "" },
        { kind: "package_json", name: "shared", versionSpec: "" },
      ]),
      { fetch, clock },
    );
    expect(out.registryData.size).toBe(1);
    expect(out.registryData.get("shared")?.latestVersion).toBe(NPM_VERSION);
  });
});

// ---- Task 25.3: property test P25 (OSV data is honest and well-formed) ----
// Test-first: fails until src/external-data.ts exists (task 25.5).

const SEVERITY_RAW: readonly (string | undefined)[] = [
  "CRITICAL",
  "HIGH",
  "MODERATE",
  "MEDIUM",
  "low",
  "bogus",
  undefined,
];
const ALLOWED_SEVERITY = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

function expectedSeverity(raw: string | undefined): string {
  const up = raw?.toUpperCase();
  if (up === "CRITICAL" || up === "HIGH" || up === "LOW") return up;
  if (up === "MODERATE" || up === "MEDIUM") return "MEDIUM";
  return "UNKNOWN";
}

const hexOf = (s: string): string => Buffer.from(s, "utf8").toString("hex");
const fromHex = (h: string): string => Buffer.from(h, "hex").toString("utf8");
const severityRawFor = (name: string): string | undefined =>
  SEVERITY_RAW[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % SEVERITY_RAW.length];
/** Roughly half of the queried packages have advisories. */
const hasVulns = (name: string): boolean => name.length % 2 === 0;

interface QueryBody {
  package: { name: string; ecosystem: string };
  version: string;
}

/**
 * Registry requests succeed as in P24. OSV: every package with an even-length name has two
 * advisories (a GHSA and a PYSEC alias of the same flaw); the GHSA one carries severity.
 */
function osvRecordingFetch(): { fetch: FetchPort; queries: QueryBody[]; osvRequests: FetchRequest[] } {
  const base = recordingFetch();
  const queries: QueryBody[] = [];
  const osvRequests: FetchRequest[] = [];
  const fetch: FetchPort = (req) => {
    const url = new URL(req.url);
    if (url.hostname !== "api.osv.dev") return base.fetch(req);
    osvRequests.push(req);
    if (req.method === "POST") {
      const qs = (JSON.parse(req.body ?? "{}") as { queries?: QueryBody[] }).queries ?? [];
      queries.push(...qs);
      return Promise.resolve(
        json(200, {
          results: qs.map((q) => {
            if (!hasVulns(q.package.name)) return {};
            const tag = `${q.package.ecosystem}-${hexOf(q.package.name)}`;
            return { vulns: [{ id: `GHSA-${tag}` }, { id: `PYSEC-${tag}` }] };
          }),
        }),
      );
    }
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const [kind, ecosystem, hex] = id.split("-") as [string, string, string];
    const name = fromHex(hex ?? "");
    const tag = `${ecosystem}-${hex}`;
    const isGhsa = kind === "GHSA";
    const sev = severityRawFor(name);
    return Promise.resolve(
      json(200, {
        id,
        aliases: [isGhsa ? `PYSEC-${tag}` : `GHSA-${tag}`],
        ...(isGhsa && sev !== undefined ? { database_specific: { severity: sev } } : {}),
        affected: [
          {
            package: { name, ecosystem },
            ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.0.0" }] }],
          },
        ],
      }),
    );
  };
  return { fetch, queries, osvRequests };
}

const isPinned = (d: DepCase): boolean =>
  d.kind === "package_json" ? d.versionSpec === "1.2.3" : d.versionSpec === "==1.2.3";
const ecoOf = (d: DepCase): "pypi" | "npm" => (d.kind === "package_json" ? "npm" : "pypi");

describe("P25 (R5.3, R5.9): OSV data is honest and well-formed", () => {
  it("holds for any dependency list and fixture OSV responses", async () => {
    await fc.assert(
      fc.asyncProperty(arbDeps, async (deps) => {
        const { fetch, queries, osvRequests } = osvRecordingFetch();
        const out = await fetchExternalData(toManifests(deps), { fetch, clock });

        const pinned = deps.filter(isPinned);
        const pinnedKeys = new Set(pinned.map((d) => `${ecoOf(d)}:${d.name.toLowerCase()}`));
        const pinnedLower = new Set(pinned.map((d) => d.name.toLowerCase()));

        // Only exactly-pinned dependencies are queried, once per (ecosystem, lowercased name) (R5.3).
        const queriedKeys = queries.map(
          (q) => `${q.package.ecosystem === "npm" ? "npm" : "pypi"}:${q.package.name.toLowerCase()}`,
        );
        expect(new Set(queriedKeys)).toEqual(pinnedKeys);
        expect(queriedKeys.length).toBe(pinnedKeys.size);
        for (const q of queries) expect(q.version).toBe("1.2.3");
        if (pinned.length === 0) expect(osvRequests).toEqual([]);

        const queriedNames = new Set(queries.map((q) => q.package.name));
        const expectedRecords = queries.filter((q) => hasVulns(q.package.name));

        // Aliases collapse to one record per flaw, preferring the GHSA id (R5.9).
        expect(out.osvData).toHaveLength(expectedRecords.length);
        expect(new Set(out.osvData.map((v) => v.id)).size).toBe(out.osvData.length);

        for (const v of out.osvData) {
          // Oracle shape check.
          expect(typeof v.id).toBe("string");
          expect(v.id.length).toBeGreaterThan(0);
          expect(typeof v.affectedPackage).toBe("string");
          expect(typeof v.affectedVersionRange).toBe("string");
          expect(v.affectedVersionRange.length).toBeGreaterThan(0);
          // affectedPackage is a queried dependency name and never an unpinned one.
          expect(queriedNames.has(v.affectedPackage)).toBe(true);
          expect(pinnedLower.has(v.affectedPackage.toLowerCase())).toBe(true);
          // Severity in the allowed set; UNKNOWN when the source gives none.
          expect(ALLOWED_SEVERITY.has(v.severity)).toBe(true);
          expect(v.id.startsWith("GHSA-")).toBe(true);
          expect(v.severity).toBe(expectedSeverity(severityRawFor(v.affectedPackage)));
        }

        // Unpinned dependencies: skipped with version-not-pinned, absent from osvData.
        const osvSkips = out.skipped.filter((s) => s.source === "osv" && s.reason === "version-not-pinned");
        const unpinnedKeys = new Set(
          deps.map((d) => `${ecoOf(d)}:${d.name.toLowerCase()}`).filter((k) => !pinnedKeys.has(k)),
        );
        const skippedKeys = new Set(osvSkips.map((s) => `${s.ecosystem}:${s.name.toLowerCase()}`));
        for (const k of unpinnedKeys) expect(skippedKeys.has(k)).toBe(true);
        for (const k of skippedKeys) expect(pinnedKeys.has(k)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("regression: GHSA and PYSEC aliases of one flaw collapse to the GHSA record", async () => {
    const { fetch } = osvRecordingFetch();
    const out = await fetchExternalData(
      toManifests([{ kind: "requirements_txt", name: "ab", versionSpec: "==1.2.3" }]),
      { fetch, clock },
    );
    expect(out.osvData).toHaveLength(1);
    expect(out.osvData[0]?.id.startsWith("GHSA-")).toBe(true);
    expect(out.osvData[0]?.affectedPackage).toBe("ab");
  });
});

// ---- Task 25.4: property test P26 (per-dependency failures are isolated) ----
// Test-first: fails until src/external-data.ts exists (task 25.5).

type Outcome = "success" | "404" | "timeout" | "network" | "http-5xx" | "http-429" | "malformed" | "oversize";
type ExpectedReason = "timeout" | "network" | "http-error" | "rate-limited" | "invalid-response" | "response-too-large";

const OUTCOMES: readonly Outcome[] = [
  "success",
  "404",
  "timeout",
  "network",
  "http-5xx",
  "http-429",
  "malformed",
  "oversize",
];
const REASON_OF: Readonly<Record<Exclude<Outcome, "success" | "404">, ExpectedReason>> = {
  timeout: "timeout",
  network: "network",
  "http-5xx": "http-error",
  "http-429": "rate-limited",
  malformed: "invalid-response",
  oversize: "response-too-large",
};

const OVERSIZE_CHUNK = new Uint8Array(1_048_576).fill(0x20);

/** Lazily yields 12 MiB of whitespace, which is above every registry/OSV cap. */
function oversizeResponse(status: number) {
  let sent = 0;
  return {
    status,
    headers: {},
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 12) c.close();
        else {
          sent += 1;
          c.enqueue(OVERSIZE_CHUNK);
        }
      },
    }),
  };
}

/** A response (or transport failure) for a non-success outcome. */
function failingResponse(outcome: Exclude<Outcome, "success">): Promise<ReturnType<typeof json>> {
  switch (outcome) {
    case "404":
      return Promise.resolve(json(404, {}));
    case "timeout":
      return Promise.reject(new FetchTransportError("timeout", "simulated timeout"));
    case "network":
      return Promise.reject(new FetchTransportError("network", "simulated network failure"));
    case "http-5xx":
      return Promise.resolve(json(503, {}));
    case "http-429":
      return Promise.resolve(json(429, {}));
    case "malformed":
      return Promise.resolve({
        status: 200,
        headers: {},
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode("{not valid json"));
            c.close();
          },
        }),
      });
    case "oversize":
      return Promise.resolve(oversizeResponse(200));
  }
}

interface OutcomeCase {
  readonly base: string;
  readonly upper: boolean;
  readonly eco: "pypi" | "npm";
  readonly outcome: Outcome;
}

const nameOf = (c: OutcomeCase): string => (c.upper ? c.base.toUpperCase() : c.base);

/** Names are unique (case-insensitively) across ecosystems so each outcome maps to one dependency. */
const arbOutcomeCases: fc.Arbitrary<OutcomeCase[]> = fc.uniqueArray(
  fc.record({
    base: fc
      .array(fc.constantFrom(...LOWER.slice(0, 8)), { minLength: 2, maxLength: 4 })
      .map((cs) => cs.join("")),
    upper: fc.boolean(),
    eco: fc.constantFrom<"pypi" | "npm">("pypi", "npm"),
    outcome: fc.constantFrom<Outcome>(...OUTCOMES),
  }),
  { selector: (c) => c.base, maxLength: 14 },
);

function toOutcomeManifests(cases: readonly OutcomeCase[], versionSpec: (c: OutcomeCase) => string): Manifest[] {
  return toManifests(
    cases.map((c) => ({
      kind: c.eco === "npm" ? ("package_json" as const) : ("requirements_txt" as const),
      name: nameOf(c),
      versionSpec: versionSpec(c),
    })),
  );
}

/** Registry endpoints answer per the dependency's assigned outcome; OSV answers per `osv`. */
function outcomeFetch(cases: readonly OutcomeCase[], osv: Outcome): FetchPort {
  const byBase = new Map(cases.map((c) => [c.base, c.outcome] as const));
  const ok = recordingFetch().fetch;
  return (req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.osv.dev") {
      return osv === "success" ? ok(req) : failingResponse(osv === "404" ? "http-5xx" : osv);
    }
    const raw =
      url.hostname === "pypi.org"
        ? decodeURIComponent(url.pathname.split("/")[2] ?? "")
        : decodeURIComponent(url.pathname.slice(1));
    const outcome = byBase.get(raw.toLowerCase());
    if (outcome === undefined) return Promise.reject(new Error(`unexpected request ${req.method} ${req.url}`));
    return outcome === "success" ? ok(req) : failingResponse(outcome);
  };
}

describe("P26 (R5.5, R5.6, R5.7, R5.8, R7.6, R7.9): per-dependency failures are isolated", () => {
  it("registry failures never throw, never remove other data, and are reported once with the matching reason", async () => {
    await fc.assert(
      fc.asyncProperty(arbOutcomeCases, async (cases) => {
        const out = await fetchExternalData(
          toOutcomeManifests(cases, () => ""),
          { fetch: outcomeFetch(cases, "success"), clock },
        );

        // registryData holds exactly the successes (R5.5, R5.7).
        const successes = cases.filter((c) => c.outcome === "success").map((c) => c.base);
        expect([...out.registryData.keys()].sort()).toEqual([...successes].sort());

        // 404 is absent from registryData and from skipped (R5.6); the other failures appear once (R5.5, R5.8).
        const expected = cases
          .filter((c) => c.outcome !== "success" && c.outcome !== "404")
          .map((c) => `${c.eco}:${nameOf(c)}:${REASON_OF[c.outcome as keyof typeof REASON_OF]}`)
          .sort();
        const actual = out.skipped
          .filter((s) => s.source === "registry")
          .map((s) => `${s.ecosystem}:${s.name}:${s.reason}`)
          .sort();
        expect(actual).toEqual(expected);

        // A pypi failure never removes npm data and vice versa: every success is present regardless (R7.6).
        for (const c of cases.filter((x) => x.outcome === "success")) expect(out.registryData.has(c.base)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("an OSV failure skips every pinned dependency but keeps all registry data", async () => {
    const arbOsvFailure = fc.constantFrom<Exclude<Outcome, "success" | "404">>(
      "timeout",
      "network",
      "http-5xx",
      "http-429",
      "malformed",
      "oversize",
    );
    await fc.assert(
      fc.asyncProperty(
        arbOutcomeCases.map((cs) => cs.map((c) => ({ ...c, outcome: "success" as const }))),
        arbOsvFailure,
        async (cases, osvFailure) => {
          const pin = (c: OutcomeCase): string => (c.eco === "npm" ? "1.2.3" : "==1.2.3");
          const out = await fetchExternalData(
            toOutcomeManifests(cases, pin),
            { fetch: outcomeFetch(cases, osvFailure), clock },
          );

          // Registry data survives the OSV failure (R5.7, R7.9).
          expect([...out.registryData.keys()].sort()).toEqual(cases.map((c) => c.base).sort());
          expect(out.osvData).toEqual([]);

          // Every pinned dependency is skipped once for OSV with the failure's reason (R5.8).
          const actual = out.skipped
            .filter((s) => s.source === "osv")
            .map((s) => `${s.ecosystem}:${s.name}:${s.reason}`)
            .sort();
          const expected = cases.map((c) => `${c.eco}:${nameOf(c)}:${REASON_OF[osvFailure]}`).sort();
          expect(actual).toEqual(expected);
          expect(out.skipped.filter((s) => s.source === "registry")).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("regression: a 404 and a timeout side by side leave the good package intact", async () => {
    const cases: OutcomeCase[] = [
      { base: "good", upper: false, eco: "pypi", outcome: "success" },
      { base: "gone", upper: true, eco: "pypi", outcome: "404" },
      { base: "slow", upper: false, eco: "npm", outcome: "timeout" },
    ];
    const out = await fetchExternalData(
      toOutcomeManifests(cases, () => ""),
      { fetch: outcomeFetch(cases, "success"), clock },
    );
    expect([...out.registryData.keys()]).toEqual(["good"]);
    expect(out.skipped.filter((s) => s.source === "registry")).toEqual([
      { name: "slow", ecosystem: "npm", source: "registry", reason: "timeout" },
    ]);
  });
});
