// Feature: 02-github-summoner, Property 21: Archive entry paths are safe and repository-relative
// Test-first: fails until task 21.5 lands `tar-extract.ts`. API per the header of tar-extract.test.ts.
import { randomBytes } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbTarEntries } from "../test/arbitraries.js";
import { isVendoredPath } from "./entry-path.js";
import { SummonerError } from "./errors.js";
import { extractTarball } from "./tar-extract.js";
import { makeTarGz } from "./testing/make-tar-gz.js";

const bodyOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const BIG = { maxCompressedBytes: 1e9, maxUncompressedBytes: 1e9, maxEntries: 1e9 };

describe("P21 (R3.3, R3.4, R3.5, R3.13, R4.6): archive entry paths are safe and repository-relative", () => {
  it("extracted keys are clean, relative, non-vendored regular files; hasWorkflowsDir is exact", async () => {
    await fc.assert(
      fc.asyncProperty(arbTarEntries, async (c) => {
        const tree = await extractTarball(bodyOf(makeTarGz(c.entries)), BIG);

        // Prototype safety, including a file named `__proto__`.
        expect(Object.getPrototypeOf(tree.files)).toBeNull();
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
        expect(Object.keys(Object.prototype)).toEqual([]);

        const keys = Object.keys(tree.files);
        for (const key of keys) {
          expect(key.startsWith("/")).toBe(false);
          expect(key.includes("\\")).toBe(false);
          expect(/^[A-Za-z]:/.test(key)).toBe(false);
          const segments = key.split("/");
          expect(segments.includes("..")).toBe(false);
          expect(segments.includes("")).toBe(false);
          expect(isVendoredPath(key)).toBe(false);
        }

        // Exactly the clean regular files, with their last-written content.
        expect([...keys].sort()).toEqual([...c.expectedFiles.keys()].sort());
        for (const [path, content] of c.expectedFiles) {
          expect(Object.hasOwn(tree.files, path)).toBe(true);
          expect(tree.files[path]).toBe(content);
        }

        expect(tree.hasWorkflowsDir).toBe(c.expectedHasWorkflowsDir);
      }),
      { numRuns: 1000 },
    );
  });

  it("regression: a file named __proto__ is an ordinary own key", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([{ name: `o-r-${"0".repeat(40)}/__proto__`, body: "polluted" }])),
      BIG,
    );
    expect(Object.keys(tree.files)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(tree.files)).toBeNull();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

// Feature: 02-github-summoner, Property 6: Compressed download cap
// Test-first: fails until task 21.5 (`tar-extract.ts`) lands; the openTarball wiring lands with 18.5.
//
// ASSUMED `GitHubClient.openTarball` API (task 18; design "Tarball path selection"):
//   openTarball(ref: RepoRef, signal?: AbortSignal):
//     Promise<{ body: ReadableStream<Uint8Array>; contentLength: number | null }>
// Both download paths (no token -> codeload.github.com; token -> api.github.com + one redirect) hand
// the builder the same `{ body, contentLength }` pair, and the builder calls
// `extractTarball(body, limits, { contentLength })`. The cap logic lives entirely in
// `extractTarball`, so this property drives it directly with the two shapes either path can
// produce: (a) a declared Content-Length over the cap, (b) no/understated Content-Length with
// a body that streams past the cap. The path-selection side is covered by P15 / task 18 tests.
const makeTracked = (chunks: Uint8Array[]) => {
  const state = { pulls: 0, cancels: 0 };
  let at = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++;
        if (at >= chunks.length) return controller.close();
        controller.enqueue(chunks[at++]!);
      },
      cancel() {
        state.cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, state };
};

const splitInto = (total: number, sizes: readonly number[]): Uint8Array[] => {
  const out: Uint8Array[] = [];
  let left = total;
  for (let i = 0; left > 0; i++) {
    const n = Math.min(left, sizes[i % sizes.length]!);
    out.push(new Uint8Array(n).fill(7));
    left -= n;
  }
  return out;
};

/**
 * Real gzip of a valid tar holding one incompressible file (so the gzip is > `size` bytes),
 * chunked: both the decoder and the tar parser accept every byte before the cap trips.
 */
const gzipChunks = (size: number, sizes: readonly number[]): Uint8Array[] => {
  const gz = makeTarGz([{ name: `o-r-${"0".repeat(40)}/blob.bin`, body: randomBytes(size) }]);
  const out: Uint8Array[] = [];
  for (let at = 0, i = 0; at < gz.length; i++) {
    const n = sizes[i % sizes.length]!;
    out.push(gz.subarray(at, at + n));
    at += n;
  }
  return out;
};

const settle = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
};

describe("P6 (R3.9, R3.15, R3.16): compressed download cap", () => {
  const arbCap = fc.integer({ min: 1024, max: 65_536 });
  const arbSizes = fc.array(fc.integer({ min: 1, max: 9000 }), { minLength: 1, maxLength: 6 });
  const limitsFor = (cap: number) => ({
    maxCompressedBytes: cap,
    maxUncompressedBytes: 1e9,
    maxEntries: 1e9,
  });

  it("a streamed body crossing the cap rejects DOWNLOAD_TOO_LARGE (compressed), cancels upstream, yields no tree", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCap,
        fc.integer({ min: 1, max: 20_000 }),
        arbSizes,
        fc.constantFrom<number | null>(null, 0, 1), // absent / understated Content-Length
        async (cap, extra, sizes, declared) => {
          // Valid gzip prefix, so the compressed cap (not a header error) is what trips.
          const { body, state } = makeTracked(gzipChunks(cap + extra, sizes));
          const err = await settle(
            extractTarball(body, limitsFor(cap), { contentLength: declared }),
          );
          expect(err).toBeInstanceOf(SummonerError);
          expect((err as SummonerError).code).toBe("DOWNLOAD_TOO_LARGE");
          expect((err as SummonerError).details.limit).toBe("compressed");
          expect(state.cancels).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a declared Content-Length over the cap rejects before any byte is read and cancels upstream", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCap,
        fc.integer({ min: 1, max: 1_000_000 }),
        arbSizes,
        async (cap, extra, sizes) => {
          const { body, state } = makeTracked(splitInto(cap + extra, sizes));
          const err = await settle(
            extractTarball(body, limitsFor(cap), { contentLength: cap + extra }),
          );
          expect(err).toBeInstanceOf(SummonerError);
          expect((err as SummonerError).code).toBe("DOWNLOAD_TOO_LARGE");
          expect((err as SummonerError).details.limit).toBe("compressed");
          expect(state.pulls).toBe(0);
          expect(state.cancels).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a body at or under the cap is never rejected for size (boundary)", async () => {
    const gz = makeTarGz([{ name: `o-r-${"0".repeat(40)}/a.txt`, body: "hi" }]);
    const tree = await extractTarball(bodyOf(gz), limitsFor(gz.length), {
      contentLength: gz.length,
    });
    expect(tree.files["a.txt"]).toBe("hi");
  });
});

// Feature: 02-github-summoner, Property 11: Uncompressed and entry-count caps
// Test-first: fails until task 21.5 (`tar-extract.ts`) lands. Small injected limits; the real
// `Readable.fromWeb` + `tar-stream` bridge is exercised (no stubs).
import { makeTar } from "./testing/make-tar-gz.js";
import type { RawTarEntry } from "./testing/raw-tar.js";

const P11_PREFIX = `o-r-${"0".repeat(40)}/`;

/** Entry kinds: kept text, vendored (skipped), symlink with a body (skipped), node_modules (skipped). */
const arbP11Entry = (i: number): fc.Arbitrary<RawTarEntry> =>
  fc.tuple(fc.constantFrom("kept", "vendored", "symlink", "modules"), fc.integer({ min: 0, max: 3000 })).map(
    ([kind, size]): RawTarEntry => {
      const body = "z".repeat(size);
      switch (kind) {
        case "kept":
          return { name: `${P11_PREFIX}src/f${i}.txt`, body };
        case "vendored":
          return { name: `${P11_PREFIX}vendor/v${i}.js`, body };
        case "symlink":
          return { name: `${P11_PREFIX}l${i}`, typeflag: "2", linkname: "/etc/passwd", body };
        default:
          return { name: `${P11_PREFIX}node_modules/p${i}/i.js`, body };
      }
    },
  );

const arbP11Entries = (min: number, max: number): fc.Arbitrary<RawTarEntry[]> =>
  fc
    .integer({ min, max })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbP11Entry(i))));

const NO_CAPS = { maxCompressedBytes: 1e9, maxUncompressedBytes: 1e9, maxEntries: 1e9 };

describe("P11 (R3.10, R3.11): uncompressed and entry-count caps", () => {
  it("a cap below the total decompressed size (headers, padding, skipped bytes included) rejects DOWNLOAD_TOO_LARGE (uncompressed); at the total it passes", async () => {
    await fc.assert(
      fc.asyncProperty(arbP11Entries(1, 20), fc.nat(), async (entries, pick) => {
        const total = makeTar(entries).length;
        const cap = 1 + (pick % (total - 1)); // 1 .. total-1
        const err = await settle(
          extractTarball(bodyOf(makeTarGz(entries)), { ...NO_CAPS, maxUncompressedBytes: cap }),
        );
        expect(err).toBeInstanceOf(SummonerError);
        expect((err as SummonerError).code).toBe("DOWNLOAD_TOO_LARGE");
        expect((err as SummonerError).details.limit).toBe("uncompressed");

        const tree = await extractTarball(bodyOf(makeTarGz(entries)), {
          ...NO_CAPS,
          maxUncompressedBytes: total,
        });
        expect(tree.stats.entries).toBe(entries.length);
      }),
      { numRuns: 100 },
    );
  });

  it("more entries than maxEntries rejects DOWNLOAD_TOO_LARGE (entries), skipped entries included; at the cap it passes", async () => {
    await fc.assert(
      fc.asyncProperty(arbP11Entries(2, 50), fc.nat(), async (entries, pick) => {
        const n = entries.length;
        const cap = 1 + (pick % (n - 1)); // 1 .. n-1
        const err = await settle(
          extractTarball(bodyOf(makeTarGz(entries)), { ...NO_CAPS, maxEntries: cap }),
        );
        expect(err).toBeInstanceOf(SummonerError);
        expect((err as SummonerError).code).toBe("DOWNLOAD_TOO_LARGE");
        expect((err as SummonerError).details.limit).toBe("entries");

        const tree = await extractTarball(bodyOf(makeTarGz(entries)), { ...NO_CAPS, maxEntries: n });
        expect(tree.stats.entries).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});
