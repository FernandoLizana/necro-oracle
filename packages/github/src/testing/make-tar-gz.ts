import { gzipSync } from "node:zlib";
import { endOfArchive, entryBytes, tarHeader, type RawTarEntry } from "./raw-tar.js";

/** Concatenates the entries and the end-of-archive marker into an uncompressed tar. */
export function makeTar(entries: readonly RawTarEntry[]): Uint8Array {
  const parts = [...entries.map(entryBytes), endOfArchive()];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface LazyZeroFileOptions {
  readonly name: string;
  /** Declared and actual size of the zero-filled file, in bytes. */
  readonly size: number;
  /** Bytes per body chunk. Default 65_536. */
  readonly chunkSize?: number;
  /** Called with the byte length of every chunk produced. */
  readonly onPull?: (bytes: number) => void;
}

/**
 * A single zero-filled file as a tar, generated on demand (pull-based) so
 * huge archives never sit in memory. Byte-identical to
 * `makeTar([{ name, body: new Uint8Array(size) }])`.
 */
export function lazyZeroFileTar(options: LazyZeroFileOptions): ReadableStream<Uint8Array> {
  const { name, size, onPull } = options;
  const chunkSize = options.chunkSize ?? 65_536;
  const padLength = (512 - (size % 512)) % 512;
  let phase: "header" | "body" | "tail" | "done" = "header";
  let remaining = size;

  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        let chunk: Uint8Array;
        if (phase === "header") {
          chunk = tarHeader({ name }, size);
          phase = size > 0 ? "body" : "tail";
        } else if (phase === "body") {
          const n = Math.min(chunkSize, remaining);
          chunk = new Uint8Array(n);
          remaining -= n;
          if (remaining === 0) phase = "tail";
        } else if (phase === "tail") {
          chunk = new Uint8Array(padLength + endOfArchive().length);
          phase = "done";
        } else {
          controller.close();
          return;
        }
        onPull?.(chunk.length);
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
}

/** gzip of `lazyZeroFileTar`, still streamed. */
export function lazyZeroFileTarGz(options: LazyZeroFileOptions): ReadableStream<Uint8Array> {
  return lazyZeroFileTar(options).pipeThrough(
    new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
}

/** gzip of a tar built from an entry list. */
export function makeTarGz(entries: readonly RawTarEntry[]): Uint8Array {
  return new Uint8Array(gzipSync(makeTar(entries)));
}
