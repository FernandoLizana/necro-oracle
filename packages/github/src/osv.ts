// OSV client: querybatch + vulnerability detail, mapped to OsvVulnerability (R5.3, R5.5, R5.8, R5.9).
// Design: D6, "External data" step 3, "OSV mapping". Never throws for per-dependency failures.
import type { OsvVulnerability } from "@necro/oracle";
import {
  EXTERNAL_CONCURRENCY,
  MAX_OSV_DETAIL_FETCHES,
  MAX_OSV_JSON_BYTES,
  OSV_BATCH_SIZE,
  TIMEOUT_EXTERNAL_MS,
} from "./constants.js";
import { externalRequest, headersFor } from "./github-client.js";
import { FetchTransportError, type FetchPort, type FetchResponse } from "./ports.js";
import { OsvBatchResponseSchema, OsvVulnSchema, type OsvVuln } from "./schemas/osv.js";

export type OsvSkipReason =
  | "version-not-pinned"
  | "timeout"
  | "network"
  | "rate-limited"
  | "http-error"
  | "invalid-response"
  | "response-too-large"
  | "limit-exceeded";

export interface OsvQuery {
  readonly name: string;
  readonly ecosystem: "pypi" | "npm";
  readonly versionSpec: string;
}

export interface OsvSkippedDependency {
  readonly name: string;
  readonly ecosystem: "pypi" | "npm";
  readonly source: "osv";
  readonly reason: OsvSkipReason;
}

export interface OsvResult {
  readonly osvData: OsvVulnerability[];
  readonly skipped: OsvSkippedDependency[];
}

export interface OsvOptions {
  readonly timeoutMs?: number;
  readonly batchSize?: number;
  readonly maxDetailFetches?: number;
}

const BATCH_URL = "https://api.osv.dev/v1/querybatch";
const detailUrl = (id: string): string => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`;

class OsvFailure extends Error {
  constructor(readonly reason: OsvSkipReason) {
    super(reason);
  }
}

// ---- pinning ---------------------------------------------------------------------------

const PY_PIN_RE = /^==([0-9A-Za-z][0-9A-Za-z.+!_-]*)$/;
const NPM_PIN_RE = /^=?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

function pinnedVersion(q: OsvQuery): string | undefined {
  const m = (q.ecosystem === "pypi" ? PY_PIN_RE : NPM_PIN_RE).exec(q.versionSpec.trim());
  return m?.[1];
}

// ---- transport -------------------------------------------------------------------------

function cancel(res: FetchResponse): void {
  if (res.body !== null) res.body.cancel().catch(() => undefined);
}

function toFailure(e: unknown): OsvFailure {
  if (e instanceof OsvFailure) return e;
  if (e instanceof FetchTransportError) return new OsvFailure(e.kind);
  return new OsvFailure("network");
}

async function readJson(res: FetchResponse): Promise<unknown> {
  if (res.status === 429) {
    cancel(res);
    throw new OsvFailure("rate-limited");
  }
  if (res.status < 200 || res.status > 299) {
    cancel(res);
    throw new OsvFailure("http-error");
  }
  if (res.body === null) throw new OsvFailure("invalid-response");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OSV_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OsvFailure("response-too-large");
      }
      chunks.push(value);
    }
  } catch (e) {
    throw toFailure(e);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new OsvFailure("invalid-response");
  }
}

async function postBatch(
  fetchPort: FetchPort,
  queries: readonly { package: { name: string; ecosystem: string }; version: string }[],
  timeoutMs: number,
): Promise<ReturnType<typeof OsvBatchResponseSchema.parse>> {
  let json: unknown;
  try {
    const res = await fetchPort({
      url: BATCH_URL,
      method: "POST",
      headers: { ...headersFor(BATCH_URL, undefined), "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
      timeoutMs,
      redirect: "manual",
    });
    json = await readJson(res);
  } catch (e) {
    throw toFailure(e);
  }
  const parsed = OsvBatchResponseSchema.safeParse(json);
  if (!parsed.success) throw new OsvFailure("invalid-response");
  return parsed.data;
}

async function getDetail(fetchPort: FetchPort, id: string, timeoutMs: number): Promise<OsvVuln> {
  let json: unknown;
  try {
    const res = await externalRequest({ fetch: fetchPort }, detailUrl(id), { timeoutMs });
    json = await readJson(res);
  } catch (e) {
    throw toFailure(e);
  }
  const parsed = OsvVulnSchema.safeParse(json);
  if (!parsed.success) throw new OsvFailure("invalid-response");
  return parsed.data;
}

// ---- mapping ---------------------------------------------------------------------------

type Severity = OsvVulnerability["severity"];

function mapSeverity(d: OsvVuln): Severity {
  const raw = d.database_specific?.["severity"];
  if (typeof raw !== "string") return "UNKNOWN";
  switch (raw.toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "LOW":
      return "LOW";
    case "MODERATE":
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "UNKNOWN";
  }
}

function normalizeName(ecosystem: "pypi" | "npm", name: string): string {
  return ecosystem === "pypi" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
}

function renderRange(events: readonly Record<string, string>[]): string[] {
  const out: string[] = [];
  let introduced: string | undefined;
  const close = (upper: string | undefined): void => {
    const parts: string[] = [];
    if (introduced !== undefined && introduced !== "0") parts.push(`>=${introduced}`);
    if (upper !== undefined) parts.push(upper);
    if (parts.length > 0) out.push(parts.join(","));
    else if (introduced !== undefined) out.push(">=0");
    introduced = undefined;
  };
  let open = false;
  for (const ev of events) {
    if (ev["introduced"] !== undefined) {
      if (open) close(undefined);
      introduced = ev["introduced"];
      open = true;
    } else if (ev["fixed"] !== undefined) {
      close(`<${ev["fixed"]}`);
      open = false;
    } else if (ev["last_affected"] !== undefined) {
      close(`<=${ev["last_affected"]}`);
      open = false;
    }
  }
  if (open) close(undefined);
  return out;
}

function affectedRange(d: OsvVuln, q: OsvQuery, version: string): string {
  const want = normalizeName(q.ecosystem, q.name);
  const ecosystem = q.ecosystem === "pypi" ? "PyPI" : "npm";
  const parts: string[] = [];
  for (const a of d.affected ?? []) {
    if (a.package === undefined || a.package.ecosystem !== ecosystem) continue;
    if (normalizeName(q.ecosystem, a.package.name) !== want) continue;
    for (const r of a.ranges ?? []) {
      if (r.type === "GIT") continue;
      parts.push(...renderRange(r.events));
    }
  }
  return parts.length > 0 ? parts.join(" || ") : `==${version}`;
}

/** Collapses alias groups (shared ids/aliases) to one record, preferring a GHSA id. */
function collapse(records: readonly { vuln: OsvVuln; rec: OsvVulnerability }[]): OsvVulnerability[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const { vuln } of records) {
    find(vuln.id);
    for (const alias of vuln.aliases ?? []) union(vuln.id, alias);
  }
  const best = new Map<string, OsvVulnerability>();
  const better = (a: string, b: string): boolean => {
    const ga = a.startsWith("GHSA-");
    const gb = b.startsWith("GHSA-");
    if (ga !== gb) return ga;
    return a < b;
  };
  for (const { vuln, rec } of records) {
    const root = find(vuln.id);
    const cur = best.get(root);
    if (cur === undefined || better(rec.id, cur.id)) best.set(root, rec);
  }
  return [...best.values()];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- main ------------------------------------------------------------------------------

export async function fetchOsv(
  queries: readonly OsvQuery[],
  deps: { readonly fetch: FetchPort },
  opts: OsvOptions = {},
): Promise<OsvResult> {
  const timeoutMs = Math.min(opts.timeoutMs ?? TIMEOUT_EXTERNAL_MS, TIMEOUT_EXTERNAL_MS);
  const batchSize = Math.max(1, opts.batchSize ?? OSV_BATCH_SIZE);
  const maxDetail = opts.maxDetailFetches ?? MAX_OSV_DETAIL_FETCHES;

  const skips = new Map<number, OsvSkipReason>();
  const skip = (i: number, reason: OsvSkipReason): void => {
    if (!skips.has(i)) skips.set(i, reason);
  };

  const pinned: { index: number; version: string }[] = [];
  queries.forEach((q, index) => {
    const version = pinnedVersion(q);
    if (version === undefined) skip(index, "version-not-pinned");
    else pinned.push({ index, version });
  });

  // Dependency index -> reported ids.
  const reported = new Map<number, Set<string>>();
  for (let start = 0; start < pinned.length; start += batchSize) {
    const chunk = pinned.slice(start, start + batchSize);
    try {
      const body = await postBatch(
        deps.fetch,
        chunk.map((p) => ({
          package: {
            name: queries[p.index]!.name,
            ecosystem: queries[p.index]!.ecosystem === "pypi" ? "PyPI" : "npm",
          },
          version: p.version,
        })),
        timeoutMs,
      );
      if (body.results.length !== chunk.length) throw new OsvFailure("invalid-response");
      body.results.forEach((r, i) => {
        const index = chunk[i]!.index;
        if (r.next_page_token !== undefined) {
          skip(index, "response-too-large");
          return;
        }
        const ids = new Set((r.vulns ?? []).map((v) => v.id));
        if (ids.size > 0) reported.set(index, ids);
      });
    } catch (e) {
      const reason = toFailure(e).reason;
      for (const p of chunk) skip(p.index, reason);
    }
  }

  // Detail fetches: distinct ids sorted ascending, first N fetched.
  const allIds = [...new Set([...reported.values()].flatMap((s) => [...s]))].sort(cmp);
  const fetchIds = allIds.slice(0, Math.max(0, maxDetail));
  const overCap = new Set(allIds.slice(fetchIds.length));
  const details = new Map<string, OsvVuln>();
  const failed = new Map<string, OsvSkipReason>();
  for (let i = 0; i < fetchIds.length; i += EXTERNAL_CONCURRENCY) {
    await Promise.all(
      fetchIds.slice(i, i + EXTERNAL_CONCURRENCY).map(async (id) => {
        try {
          details.set(id, await getDetail(deps.fetch, id, timeoutMs));
        } catch (e) {
          failed.set(id, toFailure(e).reason);
        }
      }),
    );
  }

  const versionOf = new Map(pinned.map((p) => [p.index, p.version]));
  const output: OsvVulnerability[] = [];
  const indices = [...reported.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const q = queries[index]!;
    const records: { vuln: OsvVuln; rec: OsvVulnerability }[] = [];
    for (const id of [...reported.get(index)!].sort(cmp)) {
      const d = details.get(id);
      if (d !== undefined) {
        records.push({
          vuln: d,
          rec: {
            id: d.id,
            severity: mapSeverity(d),
            affectedPackage: q.name,
            affectedVersionRange: affectedRange(d, q, versionOf.get(index)!),
          },
        });
      } else if (overCap.has(id)) skip(index, "limit-exceeded");
      else skip(index, failed.get(id) ?? "invalid-response");
    }
    output.push(...collapse(records));
  }

  output.sort((a, b) => cmp(a.affectedPackage, b.affectedPackage) || cmp(a.id, b.id));
  const skipped: OsvSkippedDependency[] = [...skips.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, reason]) => ({
      name: queries[index]!.name,
      ecosystem: queries[index]!.ecosystem,
      source: "osv" as const,
      reason,
    }));
  return { osvData: output, skipped };
}
