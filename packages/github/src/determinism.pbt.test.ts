// Task 28.3: property test P10 (offline determinism) over summon + fetchExternalData.
// Test-first: fails until src/snapshot.ts (task 28.7) and src/external-data.ts exist.
//
// API assumed (design.md "Summoner and builder", "External data"; header of src/snapshot.test.ts):
//   createSummoner(deps: { fetch, clock, env }, opts?) -> GitHubSummoner
//   summoner.summon(input: string) -> Promise<{ snapshot, extras, cache }>   (4 REST calls on a miss)
//   fetchExternalData(snapshot, { fetch, clock }) -> Promise<{ registryData: Map, osvData, skipped }>
// Each run uses a FRESH summoner (fresh cache) and a FRESH scripted FetchPort answering from the generated
// world only. globalThis.fetch is replaced with a throwing guard so any fallback to a real network is caught.
import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fetchExternalData } from "./external-data.js";
import { FetchTransportError, type EnvPort, type FetchPort, type FetchResponse } from "./ports.js";
import { createSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { makeTarGz } from "./testing/make-tar-gz.js";

const OWNER = "graveyard";
const NAME = "relic";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PREFIX = `${OWNER}-${NAME}-${SHA}/`;
const encoder = new TextEncoder();

// ---- inline arbitraries ----

type Outcome =
  | { readonly kind: "ok" }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "transport"; readonly transport: "timeout" | "network" }
  | { readonly kind: "malformed" };

const arbOutcome: fc.Arbitrary<Outcome> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Outcome>({ kind: "ok" }) },
  fc.constantFrom(404, 429, 500, 503).map((status): Outcome => ({ kind: "status", status })),
  fc.constantFrom<"timeout" | "network">("timeout", "network").map(
    (transport): Outcome => ({ kind: "transport", transport }),
  ),
  fc.constant<Outcome>({ kind: "malformed" }),
);

const arbDepName = fc.constantFrom("flask", "requests", "django", "Jinja2", "six", "pyyaml");
const arbDeps = fc.uniqueArray(fc.tuple(arbDepName, fc.constantFrom("1.0.0", "2.3.4", "0.9")), {
  selector: ([n]) => n.toLowerCase(),
  maxLength: 5,
});

interface World {
  readonly token: string | undefined;
  readonly deps: readonly (readonly [string, string])[];
  readonly stars: number;
  readonly repo: Outcome;
  readonly pulls: Outcome;
  readonly release: Outcome;
  readonly tarball: Outcome;
  readonly registry: Readonly<Record<string, Outcome>>;
  readonly osv: Outcome;
  readonly osvVulnerable: boolean;
  readonly startMs: number;
}

const arbWorld: fc.Arbitrary<World> = arbDeps.chain((deps) =>
  fc.record({
    token: fc.option(fc.constant("ghp_P10Abcdefghijklmnopqrstuvwxyz0123456789"), { nil: undefined }),
    deps: fc.constant(deps),
    stars: fc.integer({ min: 0, max: 100_000 }),
    repo: fc.oneof({ weight: 5, arbitrary: fc.constant<Outcome>({ kind: "ok" }) }, arbOutcome),
    pulls: arbOutcome,
    release: arbOutcome,
    tarball: fc.oneof({ weight: 5, arbitrary: fc.constant<Outcome>({ kind: "ok" }) }, arbOutcome),
    registry: fc
      .tuple(...deps.map(() => arbOutcome))
      .map((os) => Object.fromEntries(deps.map(([n], i) => [n.toLowerCase(), os[i] as Outcome]))),
    osv: arbOutcome,
    osvVulnerable: fc.boolean(),
    startMs: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
  }),
);

// ---- scripted offline world ----

function json(status: number, value: unknown): FetchResponse {
  const bytes = encoder.encode(JSON.stringify(value));
  return {
    status,
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  };
}

function raw(status: number, text: string): FetchResponse {
  const bytes = encoder.encode(text);
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

const empty = (status: number, headers: Record<string, string> = {}): FetchResponse => ({
  status,
  headers,
  body: null,
});

function answer(o: Outcome, ok: () => FetchResponse): FetchResponse {
  switch (o.kind) {
    case "ok":
      return ok();
    case "status":
      return empty(o.status);
    case "malformed":
      return raw(200, "{not json");
    case "transport":
      throw new FetchTransportError(o.transport, `scripted ${o.transport}`);
  }
}

function tarResponse(world: World): FetchResponse {
  const requirements = world.deps.map(([n, v]) => `${n}==${v}`).join("\n") + "\n";
  const gz = makeTarGz([
    { name: PREFIX, typeflag: "5" },
    { name: `${PREFIX}README.md`, body: "# relic\n" },
    { name: `${PREFIX}requirements.txt`, body: requirements },
    { name: `${PREFIX}src/main.py`, body: "print 'hi'\n" },
  ]);
  return {
    status: 200,
    headers: { "content-type": "application/x-gzip" },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(gz.slice());
        c.close();
      },
    }),
  };
}

function scriptedFetch(world: World): FetchPort {
  const base = `/repos/${OWNER}/${NAME}`;
  return (req) => {
    try {
      const url = new URL(req.url);
      const host = url.hostname;
      if (host === "api.github.com") {
        if (url.pathname === base) {
          return Promise.resolve(
            answer(world.repo, () =>
              json(200, {
                name: NAME,
                full_name: `${OWNER}/${NAME}`,
                owner: { login: OWNER },
                default_branch: "main",
                private: false,
                archived: false,
                pushed_at: "2019-03-14T09:26:53Z",
                stargazers_count: world.stars,
                open_issues_count: 3,
                license: { spdx_id: "MIT" },
              }),
            ),
          );
        }
        if (url.pathname.startsWith(`${base}/commits/`)) return Promise.resolve(json(200, { sha: SHA }));
        if (url.pathname === `${base}/pulls`) return Promise.resolve(answer(world.pulls, () => json(200, [])));
        if (url.pathname === `${base}/releases/latest`) {
          return Promise.resolve(answer(world.release, () => json(200, { published_at: "2018-12-25T00:00:00Z" })));
        }
        if (url.pathname === `${base}/tarball/${SHA}`) {
          return Promise.resolve(
            empty(302, { location: `https://codeload.github.com/${OWNER}/${NAME}/legacy.tar.gz/${SHA}` }),
          );
        }
      }
      if (host === "codeload.github.com") {
        return Promise.resolve(answer(world.tarball, () => tarResponse(world)));
      }
      if (host === "pypi.org") {
        const name = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const o = world.registry[name] ?? world.registry[name.replace(/-/g, "")] ?? { kind: "status", status: 404 };
        return Promise.resolve(
          answer(o as Outcome, () =>
            json(200, {
              info: { name, version: "9.9.9", classifiers: [] },
              urls: [{ upload_time_iso_8601: "2020-01-01T00:00:00.000000Z" }],
            }),
          ),
        );
      }
      if (host === "api.osv.dev" && req.method === "POST") {
        const queries = (JSON.parse(req.body ?? "{}") as { queries?: unknown[] }).queries ?? [];
        return Promise.resolve(
          answer(world.osv, () =>
            json(200, {
              results: queries.map(() => (world.osvVulnerable ? { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] } : {})),
            }),
          ),
        );
      }
      if (host === "api.osv.dev" && url.pathname.startsWith("/v1/vulns/")) {
        return Promise.resolve(
          json(200, {
            id: decodeURIComponent(url.pathname.split("/")[3] ?? ""),
            database_specific: { severity: "HIGH" },
            affected: [],
          }),
        );
      }
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.reject(new Error(`P10 scripted fetch: unexpected request ${req.method} ${req.url}`));
  };
}

// ---- one run, serialized ----

function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Map) return { __map: [...v.entries()] };
    if (v instanceof Set) return { __set: [...v.values()] };
    return v;
  });
}

type RunResult =
  | { readonly ok: true; readonly out: string }
  | { readonly ok: false; readonly necro: boolean; readonly code: string | null };

async function runOnce(world: World): Promise<RunResult> {
  const env: EnvPort = { get: (k) => (k === "GITHUB_TOKEN" ? world.token : undefined) };
  const deps = { fetch: scriptedFetch(world), clock: fixedClock(world.startMs), env };
  const summoner = createSummoner(deps);
  try {
    const summoned = await summoner.summon(`${OWNER}/${NAME}`);
    const external = await fetchExternalData(summoned.snapshot, { fetch: deps.fetch, clock: deps.clock });
    return {
      ok: true,
      out: serialize({
        snapshot: summoned.snapshot,
        extras: summoned.extras,
        cache: summoned.cache,
        registryData: external.registryData,
        osvData: external.osvData,
        skipped: external.skipped,
      }),
    };
  } catch (e) {
    return { ok: false, necro: e instanceof NecroError, code: e instanceof NecroError ? e.code : null };
  }
}

async function guarded<T>(run: () => Promise<T>): Promise<{ value: T; realFetchCalls: number }> {
  const g = globalThis as { fetch?: unknown };
  const original = g.fetch;
  let calls = 0;
  g.fetch = () => {
    calls += 1;
    return Promise.reject(new Error("P10: real network access attempted"));
  };
  try {
    return { value: await run(), realFetchCalls: calls };
  } finally {
    g.fetch = original;
  }
}

describe("P10 (R3.14, R9.4, R9.5, R9.6): offline determinism", () => {
  it("repeated summon + fetchExternalData runs are byte-for-byte equal and never touch a real network", async () => {
    await fc.assert(
      fc.asyncProperty(arbWorld, async (world) => {
        const { value, realFetchCalls } = await guarded(async () => {
          const first = await runOnce(world);
          const second = await runOnce(world);
          return { first, second };
        });
        expect(realFetchCalls).toBe(0);
        expect(value.second).toEqual(value.first);
      }),
      { numRuns: 200 },
    );
  });

  it("transport failures and malformed bodies surface as NecroError (GitHub) or skipped (registry/OSV), never as a throw of another kind", async () => {
    await fc.assert(
      fc.asyncProperty(arbWorld, async (world) => {
        const { value, realFetchCalls } = await guarded(() => runOnce(world));
        expect(realFetchCalls).toBe(0);
        if (!value.ok) {
          expect(value.necro).toBe(true);
          expect(value.code).not.toBeNull();
        } else {
          const parsed = JSON.parse(value.out) as { skipped: { reason: string }[] };
          expect(Array.isArray(parsed.skipped)).toBe(true);
        }
        // Required GitHub calls failing must fail the summon; they must not be papered over.
        if (world.repo.kind !== "ok" && world.repo.kind !== "status") expect(value.ok).toBe(false);
        if (world.tarball.kind !== "ok") expect(value.ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("is independent of the wall clock: the snapshot createdAt comes from the injected ClockPort", async () => {
    await fc.assert(
      fc.asyncProperty(arbWorld, async (world) => {
        const ok: World = { ...world, repo: { kind: "ok" }, tarball: { kind: "ok" } };
        const { value } = await guarded(() => runOnce(ok));
        if (!value.ok) return; // optional/required outcomes elsewhere are covered by the other properties
        const parsed = JSON.parse(value.out) as { snapshot: { createdAt: string } };
        expect(parsed.snapshot.createdAt).toBe(new Date(world.startMs).toISOString());
      }),
      { numRuns: 100 },
    );
  });
});
