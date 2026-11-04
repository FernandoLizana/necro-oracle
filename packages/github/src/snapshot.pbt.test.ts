// Task 27.2: property test P5 (per-file cap is preserved, not reimplemented).
// Test-first: fails until src/snapshot.ts exists (task 27.6). Offline: FixtureFetch + FixedClock only.
// API per the header of snapshot.test.ts:
//   new GitHubSummoner(deps: SummonerDeps, opts?).build(ref): Promise<RepoSnapshot>
// The expected snapshot is `buildSnapshotFromFileMap` applied directly to the text files the
// extractor kept (`extractTarball` run on the same archive bytes).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshotFromFileMap, type RepoRef } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEXT_FILE_CEILING_BYTES } from "./constants.js";
import { GitHubSummoner } from "./snapshot.js";
import { extractTarball } from "./tar-extract.js";
import { fixedClock } from "./testing/fixed-clock.js";
import { createFixtureFetch } from "./testing/fixture-fetch.js";
import { makeTarGz } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const START = Date.parse("2024-01-31T00:00:00Z");
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/api");
const REF: RepoRef = { owner: "graveyard", name: "relic", sha: SHA, defaultBranch: "main" };
const PREFIX = `graveyard-relic-${SHA}/`;

const fixtureJson = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, "success", file), "utf8"));

const bodyOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

type SizeKind = "small" | "exact" | "over" | "multiExact" | "multiOver";

/** Text bodies on both sides of the 1 MiB byte boundary, ASCII and multi-byte. */
function bodyFor(kind: SizeKind, seed: string): string {
  switch (kind) {
    case "small":
      return `small ${seed}\n`;
    case "exact":
      return "a".repeat(TEXT_FILE_CEILING_BYTES);
    case "over":
      return "a".repeat(TEXT_FILE_CEILING_BYTES + 1);
    case "multiExact": // 2 bytes per character: exactly 1 MiB in bytes
      return "\u00e9".repeat(TEXT_FILE_CEILING_BYTES / 2);
    case "multiOver": // 1 MiB + 1 byte, fewer characters than the ceiling
      return "\u00e9".repeat(TEXT_FILE_CEILING_BYTES / 2) + "a";
  }
}

const arbKinds = fc.array(fc.constantFrom<SizeKind>("small", "exact", "over", "multiExact", "multiOver"), {
  minLength: 1,
  maxLength: 6,
});

describe("P5 (R3.7, R3.8): per-file cap is preserved, not reimplemented", () => {
  // Feature: 02-github-summoner, Property 5: Per-file cap is preserved, not reimplemented
  // **Validates: Requirements R3.7, R3.8**
  it("the snapshot equals buildSnapshotFromFileMap on the kept text files; oversize files are listed, never retained", async () => {
    await fc.assert(
      fc.asyncProperty(arbKinds, fc.string({ maxLength: 8 }), async (kinds, seed) => {
        const entries: RawTarEntry[] = [{ name: PREFIX, typeflag: "5" }];
        const oversizePaths: string[] = [];
        kinds.forEach((kind, i) => {
          const p = `src/file${i}.txt`;
          const body = bodyFor(kind, seed);
          if (utf8Bytes(body) > TEXT_FILE_CEILING_BYTES) oversizePaths.push(p);
          entries.push({ name: `${PREFIX}${p}`, body });
        });
        const gz = makeTarGz(entries);

        const fx = createFixtureFetch();
        const repo = `${API}/repos/graveyard/relic`;
        fx.register({ url: repo, json: fixtureJson("repo.json") });
        fx.register({
          url: `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`,
          json: fixtureJson("pulls.json"),
        });
        fx.register({ url: `${repo}/releases/latest`, json: fixtureJson("release.json") });
        fx.register({ url: `${CODELOAD}/graveyard/relic/tar.gz/${SHA}`, body: gz });
        const summoner = new GitHubSummoner({
          fetch: fx.fetch,
          clock: fixedClock(START),
          env: { get: () => undefined },
        });

        const snap = await summoner.build(REF);

        // Reference: the extractor's kept text files fed straight to the oracle builder.
        const tree = await extractTarball(bodyOf(gz.slice()));
        const expected = buildSnapshotFromFileMap(snap.ref, tree.files, {
          meta: snap.meta,
          createdAt: snap.createdAt,
        });
        expect(snap).toEqual(expected);

        // Cap invariants.
        for (const [file, content] of snap.contents) {
          expect(utf8Bytes(content), file).toBeLessThanOrEqual(TEXT_FILE_CEILING_BYTES);
        }
        for (const entry of snap.files) {
          expect(entry.size, entry.path).toBeLessThanOrEqual(TEXT_FILE_CEILING_BYTES);
        }
        expect(snap.oversizeFiles.map((o) => o.path).sort()).toEqual([...oversizePaths].sort());
        for (const p of oversizePaths) {
          expect(snap.contents.has(p), p).toBe(false);
          expect(snap.files.some((f) => f.path === p), p).toBe(false);
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

// Task 27.3: property test P7 (file-count cap is preserved, not reimplemented).
// Test-first: fails until src/snapshot.ts exists (task 27.6).
const MAX_FILES = 5000;

describe("P7 (R3.7, R3.8): file-count cap is preserved, not reimplemented", () => {
  // Feature: 02-github-summoner, Property 7: File-count cap is preserved
  // **Validates: Requirements R3.7, R3.8**
  it("keeps exactly the first 5000 paths in lexicographic order and sets truncated only above the cap", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_FILES - 1, max: MAX_FILES + 60 }),
        fc.boolean(),
        async (count, reverse) => {
          // Unpadded numeric names so lexicographic order differs from creation order.
          const paths = Array.from({ length: count }, (_, i) => `d${i % 7}/f${i}.txt`);
          const archived = reverse ? [...paths].reverse() : paths;
          const entries: RawTarEntry[] = [{ name: PREFIX, typeflag: "5" }];
          for (const p of archived) entries.push({ name: `${PREFIX}${p}`, body: `body ${p}\n` });
          const gz = makeTarGz(entries);

          const fx = createFixtureFetch();
          const repo = `${API}/repos/graveyard/relic`;
          fx.register({ url: repo, json: fixtureJson("repo.json") });
          fx.register({
            url: `${repo}/pulls?state=open&sort=created&direction=asc&per_page=1`,
            json: fixtureJson("pulls.json"),
          });
          fx.register({ url: `${repo}/releases/latest`, json: fixtureJson("release.json") });
          fx.register({ url: `${CODELOAD}/graveyard/relic/tar.gz/${SHA}`, body: gz });
          const summoner = new GitHubSummoner({
            fetch: fx.fetch,
            clock: fixedClock(START),
            env: { get: () => undefined },
          });

          const snap = await summoner.build(REF);

          // Retained paths: first 5000 in lexicographic order, exactly.
          const expectedPaths = [...paths].sort().slice(0, MAX_FILES);
          expect(snap.files.map((f) => f.path)).toEqual(expectedPaths);
          expect([...snap.contents.keys()].sort()).toEqual(expectedPaths);
          expect(snap.truncated).toBe(count > MAX_FILES);

          // Caps are delegated to the oracle builder, not reimplemented.
          const tree = await extractTarball(bodyOf(gz.slice()));
          const expected = buildSnapshotFromFileMap(snap.ref, tree.files, {
            meta: snap.meta,
            createdAt: snap.createdAt,
          });
          expect(snap).toEqual(expected);
        },
      ),
      { numRuns: 8 },
    );
  }, 180_000);
});
