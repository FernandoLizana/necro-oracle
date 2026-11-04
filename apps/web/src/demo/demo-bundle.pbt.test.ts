// apps/web/src/demo/demo-bundle.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 23: Demo bundle validity and equality
//
// TEST-FIRST (red). This suite is written against the generator contract in
// design.md ("Demo catalog, fixtures, generator and loader") and the fixtures
// authored in task 29.1, BEFORE the generator (task 29.2) exists. The imports
// of `buildDemoBundle`, `DEMO_NOW` and `demoId` from `./build-demo.js` fail to
// resolve until 29.2 lands `apps/web/src/demo/build-demo.ts`, so every test
// here is RED for the expected reason: the generator module is missing.
//
// Property 23 (R18.9, R18.12, R18.13): for every Demo in the Demo_Catalog and
// each of the `fates` and `necropsy` spreads, the bundled Reading_Response is
// valid against `ReadingResponseSchema` AND equals a fresh `runReading` on the
// same Demo_Fixture with the fixed `DEMO_NOW` clock and the fixture
// registry/OSV data, comparing every field EXCEPT the minted `reading.id`
// (which is checked for UUID shape and deterministic derivation via `demoId`).
//
// The catalog × {fates, necropsy} space is finite, so the property is checked
// exhaustively (no fast-check sampling needed). Everything runs offline: the
// generator and the fresh comparison both drive the real oracle against the
// on-disk fixtures; no network, LLM, or sandbox call is made.
//
// Validates: Requirements 18.9, 18.12, 18.13

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @necro/oracle (main, Node side) + the Node-only directory snapshot builder.
import { runReading } from "@necro/oracle";
import { buildSnapshotFromDirectory } from "@necro/oracle/node";
import type {
  RegistryEntry,
  OsvVulnerability,
  RepoMeta,
} from "@necro/oracle";

// The fixed catalog (client-safe) and the shared playable-spread type.
import { DEMO_CATALOG } from "@necro/ui-crt";
import type { PlayableSpread, ReadingResponse } from "@necro/ui-crt";

// The wire schema the bundled responses must validate against.
import { ReadingResponseSchema } from "../protocol/schemas.js";

// NOT YET IMPLEMENTED — task 29.2 adds apps/web/src/demo/build-demo.ts. These
// imports are the source of the expected red: the module does not exist yet.
import { buildDemoBundle, DEMO_NOW, demoId } from "./build-demo.js";

// --- fixture helpers -----------------------------------------------------

/** Absolute path to fixtures/graveyard/, resolved relative to the repo. */
const FIXTURES_ROOT = fileURLToPath(
  new URL("../../../../fixtures/graveyard/", import.meta.url),
);

/** The shape of each fixture's demo.json manifest. */
interface DemoManifest {
  readonly sha: string;
  readonly defaultBranch: string;
  readonly stars: number;
  readonly hasWorkflowsDir: boolean;
  readonly meta: RepoMeta;
}

const SPREADS: readonly PlayableSpread[] = ["fates", "necropsy"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read and JSON-parse one fixture file. */
async function readJson<T>(name: string, file: string): Promise<T> {
  const raw = await readFile(`${FIXTURES_ROOT}${name}/${file}`, "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Reproduce the generator's fresh run for one (demo, spread): read the fixture,
 * build the directory snapshot with the fixed clock + fixture meta, override
 * the ref to the graveyard identity BEFORE the reading (the spread seed is
 * `ref.sha`), then run the real oracle with the fixture registry/OSV data.
 * This is the independent oracle run that the bundle must equal field-for-field
 * (except the minted id).
 */
async function freshResponse(
  name: string,
  spread: PlayableSpread,
): Promise<ReadingResponse> {
  const demo = await readJson<DemoManifest>(name, "demo.json");
  const registry = await readJson<RegistryEntry[]>(name, "registry.json");
  const osv = await readJson<OsvVulnerability[]>(name, "osv.json");
  const registryData = new Map(registry.map((e) => [e.name, e]));

  const snapshot = await buildSnapshotFromDirectory(
    `${FIXTURES_ROOT}${name}/repo`,
    { createdAt: DEMO_NOW, meta: demo.meta },
  );
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

// --- Property 23 ---------------------------------------------------------

describe("P23 (R18.9, R18.12, R18.13): demo bundle equals a fresh runReading", () => {
  it("validates and equals a fresh run for every catalog entry × {fates, necropsy}", async () => {
    const bundle = await buildDemoBundle(FIXTURES_ROOT);

    for (const entry of DEMO_CATALOG) {
      const name = entry.name;
      expect(bundle[name], `bundle missing demo "${name}"`).toBeDefined();

      for (const spread of SPREADS) {
        const bundled = bundle[name]![spread];

        // R18.12: every bundled Reading_Response is valid against the schema.
        const parsed = ReadingResponseSchema.safeParse(bundled);
        expect(
          parsed.success,
          `schema failure for ${name}/${spread}: ${
            parsed.success ? "" : JSON.stringify(parsed.error.issues)
          }`,
        ).toBe(true);

        // The minted id is UUID-shaped and deterministically derived (R18.13).
        expect(bundled.reading.id).toMatch(UUID_RE);
        expect(bundled.reading.id).toBe(demoId(name, spread));

        // R18.9/R18.13: equals a fresh runReading on the same fixture, every
        // field except the minted id.
        const fresh = await freshResponse(name, spread);
        const stripId = (r: ReadingResponse): unknown => ({
          ...r,
          reading: { ...r.reading, id: "<id>" },
        });
        expect(stripId(bundled)).toEqual(stripId(fresh));

        // The fresh run's own id is also UUID-shaped (sanity on the oracle).
        expect(fresh.reading.id).toMatch(UUID_RE);
      }
    }
  });
});
