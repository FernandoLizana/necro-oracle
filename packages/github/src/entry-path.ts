// Pure helpers for tarball entry paths and binary sniffing (R3.3, R3.5, R3.6, R3.13).
// No I/O; repository content is treated strictly as data.

// TODO: prefer shared constants from ./constants.js once task 8.2 lands.
const VENDORED_SEGMENTS: ReadonlySet<string> = new Set([
  ".git",
  "bower_components",
  "node_modules",
  "site-packages",
  "third_party",
  "vendor",
]);
const BINARY_SNIFF_BYTES = 8000;

export type NormalizedEntry =
  | { kind: "path"; path: string }
  | { kind: "traversal" }
  | { kind: "root" };

/** Normalize a raw tar entry name: reject traversal, drop the top-level prefix. */
export function normalizeEntryPath(rawName: string): NormalizedEntry {
  if (rawName.includes("\0")) return { kind: "traversal" };
  if (rawName.startsWith("/") || rawName.startsWith("\\")) return { kind: "traversal" };
  if (/^[A-Za-z]:/.test(rawName)) return { kind: "traversal" };

  const raw = rawName.split(/[\\/]/);
  if (raw.includes("..")) return { kind: "traversal" };

  const segments = raw.filter((s) => s !== "" && s !== ".");
  const rest = segments.slice(1); // drop <owner>-<repo>-<sha> prefix
  if (rest.length === 0) return { kind: "root" };
  return { kind: "path", path: rest.join("/") };
}

/** True when any "/"-separated segment is a vendored directory name. */
export function isVendoredPath(path: string): boolean {
  return path.split("/").some((s) => VENDORED_SEGMENTS.has(s));
}

/** True when a NUL byte occurs within the first 8000 bytes. */
export function isBinarySample(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}
