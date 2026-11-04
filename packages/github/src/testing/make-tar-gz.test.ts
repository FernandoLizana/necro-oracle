import { gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import tar from "tar-stream";
import { describe, expect, it } from "vitest";
import { lazyZeroFileTar, lazyZeroFileTarGz, makeTar, makeTarGz } from "./make-tar-gz.js";
import { entryBytes, endOfArchive } from "./raw-tar.js";

async function extractNames(source: ReadableStream<Uint8Array>): Promise<Array<{ name: string; size: number }>> {
  const ex = tar.extract();
  const out: Array<{ name: string; size: number }> = [];
  const done = new Promise<void>((resolve, reject) => {
    ex.on("entry", (header, stream, next) => {
      let size = 0;
      stream.on("data", (c: unknown) => {
        size += (c as Buffer).length;
      });
      stream.on("error", reject);
      stream.on("end", () => {
        out.push({ name: header.name, size });
        next();
      });
    });
    ex.on("finish", resolve);
    ex.on("error", reject);
  });
  Readable.fromWeb(source as unknown as NodeReadableStream<Uint8Array>).pipe(ex);
  await done;
  return out;
}

function webOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Response(bytes).body as ReadableStream<Uint8Array>;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("makeTar / makeTarGz (R9.4, R9.5)", () => {
  const entries = [
    { name: "r/", typeflag: "5" },
    { name: "r/a.txt", body: "alpha" },
    { name: "r/b.txt", body: "b".repeat(700) },
  ];

  it("concatenates entries and the end-of-archive marker byte-for-byte", () => {
    const tarBytes = makeTar(entries);
    const expected = [...entries.map(entryBytes), endOfArchive()];
    expect(tarBytes).toHaveLength(expected.reduce((n, p) => n + p.length, 0));
    expect(tarBytes.length % 512).toBe(0);
  });

  it("gzips to exactly the plain tar", () => {
    const gz = makeTarGz(entries);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(new Uint8Array(gunzipSync(gz))).toEqual(makeTar(entries));
  });

  it("round-trips through gunzip and tar-stream extract", async () => {
    const plain = webOf(makeTarGz(entries)).pipeThrough(new DecompressionStream("gzip"));
    expect(await extractNames(plain)).toEqual([
      { name: "r/", size: 0 },
      { name: "r/a.txt", size: 5 },
      { name: "r/b.txt", size: 700 },
    ]);
  });

  it("produces a valid empty archive from an empty entry list", async () => {
    expect(makeTar([])).toHaveLength(1024);
    expect(await extractNames(webOf(makeTar([])))).toEqual([]);
  });
});

describe("lazyZeroFileTar (R9.5)", () => {
  const name = "r/zeros.bin";

  it("produces the same bytes as the eager builder for a zero-filled file", async () => {
    const size = 3000;
    const lazy = await collect(lazyZeroFileTar({ name, size, chunkSize: 700 }));
    const eager = makeTar([{ name, body: new Uint8Array(size) }]);
    expect(lazy).toEqual(eager);
  });

  it("round-trips through tar-stream with the declared size", async () => {
    const size = 5 * 1024 * 1024 + 17;
    expect(await extractNames(lazyZeroFileTar({ name, size }))).toEqual([{ name, size }]);
  });

  it("is pulled lazily: reading one chunk does not generate the whole archive", async () => {
    let pulledBytes = 0;
    const size = 100 * 1024 * 1024;
    const stream = lazyZeroFileTar({ name, size, chunkSize: 65_536, onPull: (n) => (pulledBytes += n) });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    expect(pulledBytes).toBeLessThan(1024 * 1024);
  });

  it("gzip variant decompresses to the plain lazy archive", async () => {
    const size = 200_000;
    const plain = await collect(lazyZeroFileTar({ name, size }));
    const viaGz = await collect(lazyZeroFileTarGz({ name, size }).pipeThrough(new DecompressionStream("gzip")));
    expect(viaGz).toEqual(plain);
  });
});
