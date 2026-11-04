// @necro/github: PyPI and npm registry fetchers. Never throw; one dependency, one outcome.
// Requirements: R5.2, R5.4, R5.5, R5.6, R5.8, R5.9, R6.3.
// Design: "External data" > pipeline step 2 and "Registry mapping".
import type { RegistryEntry } from "@necro/oracle";
import { MAX_REGISTRY_JSON_BYTES } from "./constants.js";
import { externalRequest } from "./github-client.js";
import { FetchTransportError, type FetchPort, type FetchResponse } from "./ports.js";
import { NpmDocSchema, NpmVersionSchema } from "./schemas/npm.js";
import { PypiDocSchema } from "./schemas/pypi.js";

export type RegistrySkipReason =
  | "timeout"
  | "network"
  | "rate-limited"
  | "http-error"
  | "invalid-response"
  | "response-too-large"
  | "no-published-files"
  | "invalid-name";

export type RegistryOutcome =
  | { readonly status: "ok"; readonly entry: RegistryEntry }
  | { readonly status: "absent" }
  | { readonly status: "skipped"; readonly reason: RegistrySkipReason };

export interface RegistryDeps {
  readonly fetch: FetchPort;
}

export interface RegistryOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const PYPI_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const MAX_NAME_LENGTH = 214;
const NPM_ACCEPT = "application/vnd.npm.install-v1+json";

/** PEP 503: runs of "-", "_", "." collapse to "-", lower-cased. */
export function pep503Name(name: string): string {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

/** "@scope/name" -> "@scope%2Fname"; unscoped names are unchanged. */
export function encodeNpmName(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}

export function isValidPypiName(name: string): boolean {
  return name.length <= MAX_NAME_LENGTH && PYPI_NAME_RE.test(name);
}

export function isValidNpmName(name: string): boolean {
  return name.length <= MAX_NAME_LENGTH && NPM_NAME_RE.test(name);
}

type Body = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: RegistrySkipReason };

async function readCappedJson(res: FetchResponse): Promise<Body> {
  if (res.body === null) return { ok: false, reason: "invalid-response" };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REGISTRY_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "response-too-large" };
    }
    chunks.push(value);
  }
  if (total === 0) return { ok: false, reason: "invalid-response" };
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: "invalid-response" };
  }
}

function skipped(reason: RegistrySkipReason): RegistryOutcome {
  return { status: "skipped", reason };
}

/** Shared request + failure mapping; `map` receives parsed JSON of a 2xx response. */
async function fetchRegistry(
  fetchPort: FetchPort,
  url: string,
  opts: RegistryOptions,
  map: (json: unknown) => RegistryOutcome,
): Promise<RegistryOutcome> {
  let res: FetchResponse;
  try {
    res = await externalRequest({ fetch: fetchPort }, url, opts);
  } catch (e) {
    return skipped(e instanceof FetchTransportError && e.kind === "timeout" ? "timeout" : "network");
  }
  try {
    if (res.status === 404) {
      cancel(res);
      return { status: "absent" };
    }
    if (res.status === 429) {
      cancel(res);
      return skipped("rate-limited");
    }
    if (res.status < 200 || res.status > 299) {
      cancel(res);
      return skipped("http-error");
    }
    const body = await readCappedJson(res);
    if (!body.ok) return skipped(body.reason);
    return map(body.value);
  } catch {
    return skipped("network");
  }
}

function cancel(res: FetchResponse): void {
  if (res.body !== null) res.body.cancel().catch(() => undefined);
}

function toIso(s: string): string | undefined {
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const PY_PREFIX = "Programming Language :: Python :: ";
const INACTIVE = "Development Status :: 7 - Inactive";

function pypiPy2Only(classifiers: readonly string[]): boolean {
  let has2 = false;
  let has3 = false;
  for (const c of classifiers) {
    if (!c.startsWith(PY_PREFIX)) continue;
    const parts = c.slice(PY_PREFIX.length).split(" :: ");
    const major = parts[0] ?? "";
    if (/^2(\.|$)/.test(major)) {
      has2 = true;
      if (parts[1] === "Only") return true;
    } else if (/^3(\.|$)/.test(major)) {
      has3 = true;
    }
  }
  return has2 && !has3;
}

export async function fetchPypiEntry(
  name: string,
  deps: RegistryDeps,
  opts: RegistryOptions = {},
): Promise<RegistryOutcome> {
  if (!isValidPypiName(name)) return skipped("invalid-name");
  const url = `https://pypi.org/pypi/${pep503Name(name)}/json`;
  return fetchRegistry(deps.fetch, url, opts, (json) => {
    const parsed = PypiDocSchema.safeParse(json);
    if (!parsed.success) return skipped("invalid-response");
    const { info, urls } = parsed.data;
    if (urls.length === 0) return skipped("no-published-files");
    let latest = -Infinity;
    for (const u of urls) {
      const t = Date.parse(u.upload_time_iso_8601);
      if (!Number.isNaN(t) && t > latest) latest = t;
    }
    if (latest === -Infinity) return skipped("invalid-response");
    return {
      status: "ok",
      entry: {
        name: info.name,
        latestVersion: info.version,
        yanked: info.yanked === true,
        isDeprecated: info.classifiers.includes(INACTIVE),
        py2Only: pypiPy2Only(info.classifiers),
        publishedAt: new Date(latest).toISOString(),
      },
    };
  });
}

export async function fetchNpmEntry(
  name: string,
  deps: RegistryDeps,
  opts: RegistryOptions = {},
): Promise<RegistryOutcome> {
  if (!isValidNpmName(name)) return skipped("invalid-name");
  const url = `https://registry.npmjs.org/${encodeNpmName(name)}`;
  // externalRequest builds the headers; add the abbreviated-metadata Accept on the way to the port.
  const withAccept: FetchPort = (req) => deps.fetch({ ...req, headers: { ...req.headers, Accept: NPM_ACCEPT } });
  return fetchRegistry(withAccept, url, opts, (json) => {
    const parsed = NpmDocSchema.safeParse(json);
    if (!parsed.success) return skipped("invalid-response");
    const doc = parsed.data;
    if (doc.modified === undefined) return skipped("invalid-response");
    const publishedAt = toIso(doc.modified);
    if (publishedAt === undefined) return skipped("invalid-response");
    const latest = doc["dist-tags"].latest;
    const version = NpmVersionSchema.safeParse(doc.versions[latest]);
    const deprecated = version.success ? version.data.deprecated : undefined;
    return {
      status: "ok",
      entry: {
        name: doc.name,
        latestVersion: latest,
        yanked: false,
        isDeprecated: deprecated !== undefined && deprecated !== "",
        py2Only: false,
        publishedAt,
      },
    };
  });
}
