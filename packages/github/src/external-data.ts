// @necro/github: external data orchestrator (registries + OSV). Never throws for per-dependency failures.
// Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.8, R5.10, R5.11.
// Design: "External data" pipeline steps 1-4.
import type { Manifest, OsvVulnerability, RegistryEntry, RepoSnapshot } from "@necro/oracle";
import { parseAllManifests } from "@necro/oracle";
import { EXTERNAL_CONCURRENCY, MAX_REGISTRY_QUERIES, TIMEOUT_EXTERNAL_MS } from "./constants.js";
import { fetchOsv, type OsvQuery, type OsvSkipReason } from "./osv.js";
import type { ClockPort, FetchPort } from "./ports.js";
import { fetchNpmEntry, fetchPypiEntry, pep503Name, type RegistrySkipReason } from "./registries.js";

export type SkipReason = RegistrySkipReason | OsvSkipReason;

export interface SkippedDependency {
  readonly name: string;
  readonly ecosystem: "pypi" | "npm";
  readonly source: "registry" | "osv";
  readonly reason: SkipReason;
}

export interface ExternalDataResult {
  readonly registryData: Map<string, RegistryEntry>;
  readonly osvData: OsvVulnerability[];
  readonly skipped: SkippedDependency[];
}

export interface ExternalDataDeps {
  readonly fetch: FetchPort;
  readonly clock: ClockPort;
}

export interface ExternalDataOptions {
  readonly concurrency?: number;
  readonly timeoutMs?: number;
}

type Ecosystem = "pypi" | "npm";

interface Candidate {
  readonly name: string; // first spelling
  readonly lower: string;
  pinnedSpec: string | undefined;
  firstSpec: string;
}

const PY_PIN_RE = /^==[0-9A-Za-z][0-9A-Za-z.+!_-]*$/;
const NPM_PIN_RE = /^=?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isPinned(eco: Ecosystem, spec: string): boolean {
  return (eco === "pypi" ? PY_PIN_RE : NPM_PIN_RE).test(spec.trim());
}

function collect(manifests: readonly Manifest[]): Record<Ecosystem, Candidate[]> {
  const maps: Record<Ecosystem, Map<string, Candidate>> = { pypi: new Map(), npm: new Map() };
  for (const m of manifests) {
    const eco: Ecosystem = m.kind === "package_json" ? "npm" : "pypi";
    for (const d of m.dependencies) {
      const lower = d.name.toLowerCase();
      const spec = d.versionSpec;
      const cur = maps[eco].get(lower);
      if (cur === undefined) {
        maps[eco].set(lower, {
          name: d.name,
          lower,
          firstSpec: spec,
          pinnedSpec: isPinned(eco, spec) ? spec : undefined,
        });
      } else if (cur.pinnedSpec === undefined && isPinned(eco, spec)) {
        cur.pinnedSpec = spec;
      }
    }
  }
  const sorted = (m: Map<string, Candidate>): Candidate[] => [...m.values()].sort((a, b) => cmp(a.lower, b.lower));
  return { pypi: sorted(maps.pypi), npm: sorted(maps.npm) };
}

async function pool(tasks: readonly (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, tasks.length)) }, worker));
}

export async function fetchExternalData(
  input: RepoSnapshot | readonly Manifest[],
  deps: ExternalDataDeps,
  opts: ExternalDataOptions = {},
): Promise<ExternalDataResult> {
  const manifests: readonly Manifest[] = Array.isArray(input)
    ? (input as readonly Manifest[])
    : parseAllManifests(input as RepoSnapshot);
  const timeoutMs = Math.min(opts.timeoutMs ?? TIMEOUT_EXTERNAL_MS, TIMEOUT_EXTERNAL_MS);
  const concurrency = opts.concurrency ?? EXTERNAL_CONCURRENCY;

  const all = collect(manifests);
  const skipped: SkippedDependency[] = [];
  const queried: Record<Ecosystem, Candidate[]> = { pypi: [], npm: [] };
  for (const eco of ["pypi", "npm"] as const) {
    queried[eco] = all[eco].slice(0, MAX_REGISTRY_QUERIES);
    for (const c of all[eco].slice(MAX_REGISTRY_QUERIES)) {
      skipped.push({ name: c.name, ecosystem: eco, source: "registry", reason: "limit-exceeded" });
    }
  }

  // Group PyPI spellings by PEP 503 name: one request, fan out to every lowercased key.
  const pypiGroups = new Map<string, Candidate[]>();
  for (const c of queried.pypi) {
    const key = pep503Name(c.name);
    pypiGroups.set(key, [...(pypiGroups.get(key) ?? []), c]);
  }

  const pypiData = new Map<string, RegistryEntry>();
  const npmData = new Map<string, RegistryEntry>();
  const registrySkips = new Map<string, SkippedDependency>();
  const tasks: (() => Promise<void>)[] = [];
  const reqOpts = { timeoutMs };

  for (const group of pypiGroups.values()) {
    tasks.push(async () => {
      const outcome = await fetchPypiEntry(group[0]!.name, { fetch: deps.fetch }, reqOpts);
      for (const c of group) {
        if (outcome.status === "ok") pypiData.set(c.lower, outcome.entry);
        else if (outcome.status === "skipped") {
          registrySkips.set(`pypi:${c.lower}`, {
            name: c.name,
            ecosystem: "pypi",
            source: "registry",
            reason: outcome.reason,
          });
        }
      }
    });
  }
  for (const c of queried.npm) {
    tasks.push(async () => {
      const outcome = await fetchNpmEntry(c.lower, { fetch: deps.fetch }, reqOpts);
      if (outcome.status === "ok") npmData.set(c.lower, outcome.entry);
      else if (outcome.status === "skipped") {
        registrySkips.set(`npm:${c.lower}`, { name: c.name, ecosystem: "npm", source: "registry", reason: outcome.reason });
      }
    });
  }
  await pool(tasks, concurrency);

  const registryData = new Map<string, RegistryEntry>(pypiData);
  for (const [k, v] of npmData) registryData.set(k, v); // npm wins (R5.11)

  const regSkipList = [...registrySkips.values()].sort(
    (a, b) => cmp(a.ecosystem, b.ecosystem) * -1 || cmp(a.name.toLowerCase(), b.name.toLowerCase()),
  );
  skipped.sort((a, b) => cmp(a.ecosystem, b.ecosystem) * -1 || cmp(a.name.toLowerCase(), b.name.toLowerCase()));
  skipped.push(...regSkipList);

  // OSV: one query per (ecosystem, lowercased name); the first exactly-pinned spec when any.
  const osvQueries: OsvQuery[] = [];
  for (const eco of ["pypi", "npm"] as const) {
    for (const c of queried[eco]) {
      osvQueries.push({ name: c.name, ecosystem: eco, versionSpec: c.pinnedSpec ?? c.firstSpec });
    }
  }
  let osvData: OsvVulnerability[] = [];
  if (osvQueries.length > 0) {
    const osv = await fetchOsv(osvQueries, { fetch: deps.fetch }, { timeoutMs });
    osvData = osv.osvData;
    skipped.push(...osv.skipped);
  }

  return { registryData, osvData, skipped };
}
