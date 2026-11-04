// @necro/oracle — golden fixture test runner (task 34.2).
//
// For each golden fixture under packages/oracle/fixtures/<case>/ this test:
//   1. loads snapshot.json ({ ref, files, meta, createdAt }) and
//      expected-reading.json (the full Reading MINUS the `id` field),
//   2. builds a RepoSnapshot via buildSnapshotFromFileMap(ref, files,
//      { meta, createdAt }),
//   3. divines it with runReading(snapshot, { spreadKind: "necropsy",
//      now: createdAt }),
//   4. strips the fresh `id` from the actual reading and deep-equals the rest
//      against expected-reading.json. `createdAt` is deterministic (=== now)
//      so it is compared verbatim (R19.1, R19.5).
//
// The `secrets` fixture additionally proves that no raw secret ever reaches the
// reading: no Evidence.detail matches an AWS key or a private-key header, and
// the literal example AWS key never appears anywhere in the serialised reading
// (R20.2 masking).
//
// This is a TEST file, excluded from the browser-safe build, so `node:` imports
// are fine here. The tree-sitter WASM grammar is initialised once in
// vitest.setup.ts's beforeAll (no network — R3.1, R21.5, R21.6).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import { runReading, type Reading } from "./run.js";
import type { RepoMeta, RepoRef } from "../snapshot/types.js";

/** Directory holding the golden fixtures, resolved relative to this file. */
const FIXTURES_DIR = new URL("../../fixtures/", import.meta.url);

/** The seven golden fixture cases authored in task 34.1. */
const FIXTURE_CASES = [
  "py2-only",
  "straddling",
  "no-tests",
  "no-license",
  "archived",
  "clean",
  "secrets",
] as const;

/** Shape of each fixture's snapshot.json. */
interface FixtureSnapshot {
  ref: RepoRef;
  files: Record<string, string>;
  meta: RepoMeta;
  createdAt: string;
}

/** Read and parse a JSON file inside a fixture case directory. */
async function loadJson<T>(fixtureCase: string, file: string): Promise<T> {
  const path = fileURLToPath(new URL(`${fixtureCase}/${file}`, FIXTURES_DIR));
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Patterns that must never appear verbatim in evidence or the reading JSON. */
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const PRIVATE_KEY_HEADER_RE = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;

describe("golden fixtures (R19.1, R19.5, R20.2): the oracle divines each fixture to its recorded reading", () => {
  it.each(FIXTURE_CASES)(
    "fixture %s deep-equals its expected reading (id excluded)",
    async (fixtureCase) => {
      const snapshot = await loadJson<FixtureSnapshot>(fixtureCase, "snapshot.json");
      const expected = await loadJson<Omit<Reading, "id">>(
        fixtureCase,
        "expected-reading.json",
      );

      const built = buildSnapshotFromFileMap(snapshot.ref, snapshot.files, {
        meta: snapshot.meta,
        createdAt: snapshot.createdAt,
      });

      const reading = await runReading(built, {
        spreadKind: "necropsy",
        now: snapshot.createdAt,
      });

      // Strip only the non-deterministic `id`; everything else (including the
      // deterministic createdAt === now) is compared.
      const { id: _id, ...actualWithoutId } = reading;
      expect(actualWithoutId).toEqual(expected);
    },
  );

  it("secrets fixture masks every secret in evidence and in the serialised reading (R20.2)", async () => {
    const snapshot = await loadJson<FixtureSnapshot>("secrets", "snapshot.json");
    const built = buildSnapshotFromFileMap(snapshot.ref, snapshot.files, {
      meta: snapshot.meta,
      createdAt: snapshot.createdAt,
    });
    const reading = await runReading(built, {
      spreadKind: "necropsy",
      now: snapshot.createdAt,
    });

    // No Evidence.detail may contain a raw AWS key or private-key header.
    for (const draw of reading.draws) {
      for (const evidence of draw.evidence) {
        expect(evidence.detail).not.toMatch(AWS_KEY_RE);
        expect(evidence.detail).not.toMatch(PRIVATE_KEY_HEADER_RE);
      }
    }

    // The literal example AWS key must not survive anywhere in the reading.
    const serialised = JSON.stringify(reading);
    expect(serialised).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialised).not.toMatch(AWS_KEY_RE);
    expect(serialised).not.toMatch(PRIVATE_KEY_HEADER_RE);
  });
});
