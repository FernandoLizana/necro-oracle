// Task 31.1: golden offline end-to-end test (summon -> fetchExternalData -> runReading).
// Test-first: fails until the golden fixtures exist (task 31.2) and the summoner / external-data
// modules are implemented. Requirements: R5.2, R5.10, R9.4, R10.5.
// Design: "Integration test (offline)". Offline: FixtureFetch + FixedClock only; the global fetch
// is disabled by vitest.setup.ts.
//
// Pipeline under test (only fixture-backed ports):
//   1. GitHubSummoner.summon("<owner>/<name>") over recorded api.github.com JSON + an in-memory
//      codeload tarball -> RepoSnapshot.
//   2. fetchExternalData(snapshot, { fetch, clock }) over recorded PyPI / npm / OSV JSON
//      -> { registryData, osvData }.
//   3. runReading(snapshot, { spreadKind: "necropsy", registryData, osvData, now }) from @necro/oracle.
//
// ---- FIXTURE LAYOUT CONTRACT (task 31.2 must author exactly this) ------------------------------
// Root: packages/github/fixtures/golden/
//
//   api/repo.json       GET /repos/{owner}/{name}               (full_name gives owner/name; the
//   api/commit.json     GET /repos/{owner}/{name}/commits/{default_branch}  commit's `sha` is the
//   api/pulls.json      GET .../pulls?state=open&sort=created&direction=asc&per_page=1   pinned sha)
//   api/release.json    GET .../releases/latest
//                       Same shapes as fixtures/api/success/*.json. Not private, not archived-by-
//                       surprise, no redirect: exactly 4 REST calls + 1 codeload download.
//
//   tarball.json        JSON array of in-memory tar entries, paths RELATIVE to the repository root:
//                         [{ "path": "setup.py", "body": "..." }, { "path": "src/", "dir": true }, ...]
//                       The test prefixes `${owner}-${name}-${sha}/` (codeload layout) and gzips it
//                       with makeTarGz. It must contain py2 sources (print statements etc.), at
//                       least one manifest pinning a vulnerable dependency exactly (`==x.y.z`), and a
//                       production file with a Devil trigger or the vulnerable pin (OSV) so that
//                       both The Tower and The Devil are drawn. `.github/workflows` present or
//                       absent as designed.
//
//   registry/pypi/<pep503-name>.json   body of GET https://pypi.org/pypi/<name>/json
//   registry/npm/<name>.json           body of GET https://registry.npmjs.org/<name> (unscoped only)
//                       One file per queried dependency; the file basename is the URL name. Every
//                       dependency of every manifest in tarball.json that has a registry fixture is
//                       expected in registryData under `dep.name.toLowerCase()`. Dependencies
//                       WITHOUT a fixture are not registered: their request is unregistered, which
//                       the fixture fetch rejects, so they must be absent from the tarball manifests
//                       (or the test fails loudly rather than silently skipping).
//
//   osv/batch.json      response body of POST https://api.osv.dev/v1/querybatch
//   osv/<ID>.json       response body of GET https://api.osv.dev/v1/vulns/<ID>, one per id
//                       referenced by batch.json.
//
// Expected result, next to this test: src/expected-reading.json = the normalized Reading
// (see `normalize`: `id` replaced by "<uuid>"). Regenerate it deliberately with
//   NECRO_UPDATE_GOLDEN=1 pnpm --filter @necro/github test -- golden
// and review the diff; a change to it must come with a reason in the same commit.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllManifests, runReading, type Reading } from "@necro/oracle";
import { describe, expect, it } from "vitest";
import { fetchExternalData } from "./external-data.js";
import type { SummonerDeps } from "./ports.js";
import { GitHubSummoner } from "./snapshot.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.resolve(HERE, "../fixtures/golden");
const EXPECTED_PATH = path.join(HERE, "expected-reading.json");

const NOW = "2026-01-01T00:00:00.000Z";
const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";

const readJson = (...parts: string[]): unknown => {
  const file = path.join(GOLDEN, ...parts);
  if (!existsSync(file)) throw new Error(`missing golden fixture: fixtures/golden/${parts.join("/")} (task 31.2)`);
  return JSON.parse(readFileSync(file, "utf8"));
};
const listJson = (...parts: string[]): string[] => {
  const dir = path.join(GOLDEN, ...parts);
  if (!existsSync(dir)) throw new Error(`missing golden fixture dir: fixtures/golden/${parts.join("/")} (task 31.2)`);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
};

interface TarballEntry {
  path: string;
  body?: string;
  dir?: boolean;
}

/** Registers every golden fixture on a fresh fixture fetch; returns the pieces the test needs. */
function arrange() {
  const repoJson = readJson("api", "repo.json") as { full_name: string; default_branch: string };
  const commitJson = readJson("api", "commit.json") as { sha: string };
  const [owner, name] = repoJson.full_name.split("/") as [string, string];
  const sha = commitJson.sha;
  const repo = `${API}/repos/${owner}/${name}`;
  const fx = createFixtureFetch();

  fx.register({ url: repo, json: repoJson });
  fx.register({ url: `${repo}/commits/${repoJson.default_branch}`, json: commitJson });
  fx.register({ url: `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`, json: readJson("api", "pulls.json") });
  fx.register({ url: `${repo}/releases/latest`, json: readJson("api", "release.json") });

  const prefix = `${owner}-${name}-${sha}/`;
  const entries = readJson("tarball.json") as TarballEntry[];
  const tarEntries: RawTarEntry[] = [
    { name: prefix, typeflag: "5" },
    ...entries.map((e): RawTarEntry =>
      e.dir === true ? { name: `${prefix}${e.path}`, typeflag: "5" } : { name: `${prefix}${e.path}`, body: e.body ?? "" },
    ),
  ];
  fx.register({ url: `${CODELOAD}/${owner}/${name}/tar.gz/${sha}`, body: makeTarGz(tarEntries) });

  const pypi = listJson("registry", "pypi");
  const npm = listJson("registry", "npm");
  for (const n of pypi) fx.register({ url: `https://pypi.org/pypi/${n}/json`, json: readJson("registry", "pypi", `${n}.json`) });
  for (const n of npm) fx.register({ url: `https://registry.npmjs.org/${n}`, json: readJson("registry", "npm", `${n}.json`) });

  fx.register({ method: "POST", url: "https://api.osv.dev/v1/querybatch", json: readJson("osv", "batch.json") });
  for (const id of listJson("osv").filter((f) => f !== "batch")) {
    fx.register({ url: `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, json: readJson("osv", `${id}.json`) });
  }

  const clock = fixedClock(Date.parse(NOW));
  const deps: SummonerDeps = { fetch: fx.fetch, clock, env: { get: () => undefined } };
  return { fx, deps, owner, name, pypi, npm };
}

/** Runs the whole offline pipeline once from scratch (fresh summoner, no shared cache). */
async function runPipeline() {
  const { fx, deps, owner, name, pypi, npm } = arrange();
  const summoned = await new GitHubSummoner(deps).summon(`${owner}/${name}`);
  const external = await fetchExternalData(summoned.snapshot, { fetch: fx.fetch, clock: deps.clock });
  const manifests = parseAllManifests(summoned.snapshot);
  const reading = await runReading(summoned.snapshot, {
    spreadKind: "necropsy",
    registryData: external.registryData,
    osvData: external.osvData,
    now: NOW,
  });
  return { reading, external, manifests, fx, pypi, npm };
}

/** The Reading id is a fresh random UUID per run; everything else must be reproducible. */
function normalize(reading: Reading): Reading {
  expect(reading.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return { ...reading, id: "<uuid>" };
}

describe("golden offline end-to-end (R5.2, R5.10, R9.4, R10.5)", () => {
  it("draws The Tower and The Devil and matches expected-reading.json", async () => {
    const { reading } = await runPipeline();
    const cards = reading.draws.map((d) => d.card);
    expect(cards).toContain("tower");
    expect(cards).toContain("devil");
    expect(reading.errors).toEqual([]);

    const actual = normalize(reading);
    if (process.env["NECRO_UPDATE_GOLDEN"] === "1") {
      writeFileSync(EXPECTED_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(EXPECTED_PATH, "utf8")));
  });

  it("registryData keys are dep.name.toLowerCase() with no ecosystem prefix, as the Tower looks them up (R5.10)", async () => {
    const { external, manifests, pypi, npm } = await runPipeline();
    const lowered = new Set(manifests.flatMap((m) => m.dependencies.map((d) => d.name.toLowerCase())));
    const keys = [...external.registryData.keys()];

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toBe(key.toLowerCase());
      expect(key).not.toMatch(/^(pypi|npm):/);
      // Every key must be reachable by tower.ts's `registryData.get(dep.name.toLowerCase())`.
      expect(lowered.has(key), `registryData key "${key}" matches no dependency name`).toBe(true);
    }
    // Every recorded registry fixture is consumed through that same key.
    const recorded = new Set([...pypi, ...npm].map((n) => n.toLowerCase()));
    const normalizedKeys = new Set(keys.map((k) => k.replace(/[-_.]+/g, "-")));
    for (const n of recorded) expect(normalizedKeys.has(n.replace(/[-_.]+/g, "-")), `no entry for fixture ${n}`).toBe(true);
    expect(external.osvData.length).toBeGreaterThan(0);
  });

  it("is byte-for-byte reproducible across two runs (R9.4)", async () => {
    const a = await runPipeline();
    const b = await runPipeline();
    const bytes = (r: Awaited<ReturnType<typeof runPipeline>>) =>
      JSON.stringify({
        reading: normalize(r.reading),
        registryData: [...r.external.registryData.entries()],
        osvData: r.external.osvData,
        skipped: r.external.skipped,
      });
    expect(bytes(a)).toBe(bytes(b));
    expect(a.fx.requests.map((r) => `${r.method} ${r.url}`)).toEqual(b.fx.requests.map((r) => `${r.method} ${r.url}`));
  });
});
