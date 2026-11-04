// apps/web/src/demo/build-demo.ts
//
// Feature: 03-crt-terminal, task 29.2 — the Demo_Bundle generator.
//
// `buildDemoBundle` drives the REAL oracle (`runReading`) over the on-disk
// graveyard fixtures to produce a Demo_Bundle: a record keyed by Demo_Name,
// each entry a `{ fates, necropsy }` pair of validated Reading_Responses. It is
// used by BOTH the P23 property test (which compares each entry to a fresh
// `runReading` on the same fixture) and `scripts/demo-bundle/generate.ts`
// (which serialises the result to `bundle.generated.json`).
//
// Everything runs offline against the fixtures: no network, LLM, or sandbox
// call is made. The clock is fixed to `DEMO_NOW` and the ref is overridden to
// the graveyard identity BEFORE `runReading` so the spread seed (`ref.sha`) and
// `reading.createdAt` are stable across runs. The minted `reading.id` is
// replaced with a deterministic, UUID-shaped `demoId` so re-running the
// generator produces byte-identical output (Q3, R18.13).
//
// _Requirements: R18.3, R18.8, R18.9, R18.10, R18.12, R18.13, R16.12_

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runReading } from "@necro/oracle";
import { buildSnapshotFromDirectory } from "@necro/oracle/node";
import type {
  OsvVulnerability,
  RegistryEntry,
  RepoMeta,
} from "@necro/oracle";

import { DEMO_CATALOG } from "@necro/ui-crt";
import type { DemoBundle, PlayableSpread, ReadingResponse } from "@necro/ui-crt";

/**
 * The fixed clock for every demo reading. Passed as `now` to `runReading` and
 * as `createdAt` to the snapshot builder, so `reading.createdAt === DEMO_NOW`
 * in every bundled response and the reading is fully deterministic.
 */
export const DEMO_NOW = "2026-01-15T12:00:00.000Z";

/** The two spreads every Demo is rendered for, in authored order. */
const SPREADS: readonly PlayableSpread[] = ["fates", "necropsy"];

/** The shape of each fixture's `demo.json` manifest. */
interface DemoManifest {
  readonly sha: string;
  readonly defaultBranch: string;
  readonly stars: number;
  readonly hasWorkflowsDir: boolean;
  readonly meta: RepoMeta;
}

/**
 * A deterministic, UUID-shaped id for one `(name, spread)` demo reading.
 *
 * The id is derived from `sha256(`${name}:${spread}`)`: the first 16 bytes of
 * the digest are laid out as a canonical 8-4-4-4-12 UUID, with the version
 * nibble forced to `4` and the variant nibble to the `8..b` range so the
 * result passes `z.string().uuid()` (which `ReadingSchema.id` requires). The
 * same input always yields the same id, so the generated bundle is stable
 * across runs and machines.
 */
export function demoId(name: string, spread: PlayableSpread): string {
  const bytes = createHash("sha256")
    .update(`${name}:${spread}`)
    .digest();

  // Force the RFC-4122 version (4) and variant (10xx) bits so z.uuid() passes.
  const v = new Uint8Array(bytes.subarray(0, 16));
  v[6] = (v[6]! & 0x0f) | 0x40;
  v[8] = (v[8]! & 0x3f) | 0x80;

  const hex = Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Read and JSON-parse one fixture file under `<fixturesRoot>/<name>/`. */
async function readFixtureJson<T>(
  fixturesRoot: string,
  name: string,
  file: string,
): Promise<T> {
  const raw = await readFile(join(fixturesRoot, name, file), "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Build one Reading_Response for a single `(name, spread)` by driving the real
 * oracle over the fixture. Mirrors the P23 test's `freshResponse` exactly: the
 * ref is overridden to the graveyard identity before `runReading` (the spread
 * seed is `ref.sha`), and the only post-run change is the deterministic id.
 */
async function buildResponse(
  fixturesRoot: string,
  name: string,
  spread: PlayableSpread,
): Promise<ReadingResponse> {
  const demo = await readFixtureJson<DemoManifest>(fixturesRoot, name, "demo.json");
  const registry = await readFixtureJson<RegistryEntry[]>(
    fixturesRoot,
    name,
    "registry.json",
  );
  const osv = await readFixtureJson<OsvVulnerability[]>(
    fixturesRoot,
    name,
    "osv.json",
  );
  const registryData = new Map(registry.map((entry) => [entry.name, entry]));

  const snapshot = await buildSnapshotFromDirectory(
    join(fixturesRoot, name, "repo"),
    { createdAt: DEMO_NOW, meta: demo.meta },
  );

  // Override the neutral ref the directory builder synthesises with the
  // graveyard identity BEFORE runReading — the spread seed uses `ref.sha`.
  snapshot.ref = {
    owner: "graveyard",
    name,
    sha: demo.sha,
    defaultBranch: demo.defaultBranch,
  };

  const reading = await runReading(snapshot, {
    spreadKind: spread,
    registryData,
    osvData: osv,
    now: DEMO_NOW,
  });

  // Replace the freshly-minted random id with the deterministic demo id so the
  // generated bundle is byte-stable across runs (Q3, R18.13).
  reading.id = demoId(name, spread);

  return {
    summary: {
      ref: snapshot.ref,
      stars: demo.stars,
      hasWorkflowsDir: demo.hasWorkflowsDir,
      degradedFields: [],
      cache: "miss",
      fileCount: snapshot.files.length,
      truncated: snapshot.truncated,
      demo: true,
    },
    reading,
  };
}

/**
 * Build the whole Demo_Bundle: for every catalog entry and each of `fates` and
 * `necropsy`, run the real oracle over the fixture and assemble a validated
 * Reading_Response. The result is a plain record keyed by Demo_Name.
 *
 * @param fixturesRoot Absolute path to `fixtures/graveyard/` (trailing slash
 *   optional — paths are joined with `node:path`).
 */
export async function buildDemoBundle(fixturesRoot: string): Promise<DemoBundle> {
  const bundle: Record<
    string,
    { fates: ReadingResponse; necropsy: ReadingResponse }
  > = {};

  for (const entry of DEMO_CATALOG) {
    const name = entry.name;
    const [fates, necropsy] = await Promise.all(
      SPREADS.map((spread) => buildResponse(fixturesRoot, name, spread)),
    );
    bundle[name] = { fates: fates!, necropsy: necropsy! };
  }

  return bundle;
}
