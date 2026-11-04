/**
 * Minimal hand-rolled ustar writer for tests. It can emit pax global (`g`) and
 * extended (`x`) headers, GNU long-name (`L`) entries, and arbitrary typeflags.
 * In-memory only: no filesystem access.
 */

const BLOCK = 512;
const encoder = new TextEncoder();

export interface RawTarEntry {
  /** Name written into the 100-byte name field (truncated to 100 bytes). */
  readonly name: string;
  /** Single-character typeflag. Default "0" (regular file). */
  readonly typeflag?: string;
  /** Body bytes. Default empty. */
  readonly body?: Uint8Array | string;
  /** Overrides the size field (to emulate a header that lies). */
  readonly declaredSize?: number;
  readonly linkname?: string;
  readonly mode?: number;
}

function toBytes(body: Uint8Array | string | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array(0);
  return typeof body === "string" ? encoder.encode(body) : body;
}

function writeAscii(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  block.set(bytes.subarray(0, length), offset);
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  const digits = value.toString(8).padStart(length - 1, "0");
  writeAscii(block, offset, length, `${digits}\0`);
}

/** Builds one 512-byte ustar header block with a valid checksum. */
export function tarHeader(entry: RawTarEntry, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  writeAscii(block, 0, 100, entry.name);
  writeOctal(block, 100, 8, entry.mode ?? 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  block.fill(0x20, 148, 156); // checksum field counts as spaces
  writeAscii(block, 156, 1, entry.typeflag ?? "0");
  writeAscii(block, 157, 100, entry.linkname ?? "");
  writeAscii(block, 257, 6, "ustar\0");
  writeAscii(block, 263, 2, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  writeAscii(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Header block plus body padded to a 512-byte boundary. */
export function entryBytes(entry: RawTarEntry): Uint8Array {
  const body = toBytes(entry.body);
  const padded = new Uint8Array(Math.ceil(body.length / BLOCK) * BLOCK);
  padded.set(body);
  return concat([tarHeader(entry, entry.declaredSize ?? body.length), padded]);
}

/** Two zero blocks: the end-of-archive marker. */
export function endOfArchive(): Uint8Array {
  return new Uint8Array(BLOCK * 2);
}

/** One pax record: `<len> key=value\n`, where len counts its own digits. */
export function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`;
  const restLength = encoder.encode(rest).length;
  let len = restLength + 1;
  while (String(len).length + restLength !== len) len = String(len).length + restLength;
  return `${len}${rest}`;
}

/** Pax global header entry (typeflag `g`), as `git archive` emits with `comment=<sha>`. */
export function paxGlobalEntry(records: Readonly<Record<string, string>>): RawTarEntry {
  return {
    name: "pax_global_header",
    typeflag: "g",
    body: Object.entries(records).map(([k, v]) => paxRecord(k, v)).join(""),
  };
}

/** Pax extended header entry (typeflag `x`) applying to the next entry. */
export function paxExtendedEntry(records: Readonly<Record<string, string>>): RawTarEntry {
  return {
    name: "PaxHeader",
    typeflag: "x",
    body: Object.entries(records).map(([k, v]) => paxRecord(k, v)).join(""),
  };
}

/** GNU long-name entry (typeflag `L`) applying to the next entry. */
export function gnuLongNameEntry(longName: string): RawTarEntry {
  return { name: "././@LongLink", typeflag: "L", body: `${longName}\0` };
}
