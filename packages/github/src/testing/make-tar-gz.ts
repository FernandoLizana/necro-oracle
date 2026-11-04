import { gzipSync } from "node:zlib";
import { endOfArchive, entryBytes, type RawTarEntry } from "./raw-tar.js";

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

/** gzip of a tar built from an entry list. */
export function makeTarGz(entries: readonly RawTarEntry[]): Uint8Array {
  return new Uint8Array(gzipSync(makeTar(entries)));
}
