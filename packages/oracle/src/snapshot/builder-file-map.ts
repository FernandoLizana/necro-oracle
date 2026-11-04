// src/snapshot/builder-file-map.ts
//
// Browser-safe snapshot builder (task 8.2). Shapes an in-memory file map into a
// RepoSnapshot: assigns a Lang per file by extension, computes UTF-8 byte sizes,
// applies the 1 MB per-file size filter (R2.6) and the 5000-file lexicographic
// cap (R2.7), builds the runtime contents Map (R2.1), and defaults meta to
// neutral values when omitted (R2.5).
//
// This module is the main-entry-safe builder: it imports NO Node `fs` APIs and
// must never call `Date.now()`/`new Date()` — `createdAt` is supplied verbatim.
//
// Covers: R2.1, R2.2, R2.5, R2.6, R2.7

import type { FileEntry, Lang, OversizeFileItem, RepoMeta, RepoRef, RepoSnapshot } from "./types.js";

export interface SnapshotFromFileMapOpts {
  /** Defaults to a neutral RepoMeta (isArchived: false, all counts 0, nulls). */
  meta?: RepoMeta;
  /** ISO 8601 UTC — required; builder never reads the system clock. */
  createdAt: string;
}

/** Per-file size limit in bytes (R2.6). A file exactly at this size is kept. */
const MAX_FILE_BYTES = 1_048_576;

/** Maximum number of files retained after the size filter (R2.7). */
const MAX_FILES = 5000;

/** Neutral RepoMeta applied when the caller omits `meta` (R2.5). */
const NEUTRAL_META: RepoMeta = {
  pushedAt: null,
  isArchived: false,
  openIssueCount: 0,
  openPRCount: 0,
  oldestOpenPRAgeDays: null,
  latestReleaseAt: null,
  licenseKey: null,
};

const UTF8_ENCODER = new TextEncoder();

/** UTF-8 byte length of a string (matches the on-disk/transport byte size). */
function byteLength(s: string): number {
  return UTF8_ENCODER.encode(s).length;
}

/** Assign a Lang from the file extension (R2.2); unknown families → "other". */
function langFromPath(path: string): Lang {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return "other";
  const ext = path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "py":
      return "python";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "ts":
    case "tsx":
    case "mts":
      return "ts";
    case "html":
    case "htm":
      return "html";
    default:
      return "other";
  }
}

/**
 * Deterministic, pure content hash (FNV-1a 32-bit) rendered as 8 hex chars.
 * The design does not mandate a git sha here; we only require a stable,
 * side-effect-free hash that is browser-safe (no node:crypto, no async).
 */
function contentSha(content: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i) & 0xff;
    // FNV prime multiply, kept in 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build a RepoSnapshot from an in-memory file map.
 *
 * Pipeline:
 *   1. Size filter — drop files whose UTF-8 byte length exceeds 1 MB,
 *      recording each in `oversizeFiles` (R2.6).
 *   2. File cap — if more than 5000 files survive, keep the first 5000 by
 *      lexicographic path order and set `truncated` (R2.7).
 *   3. Shape — build `FileEntry[]`, the `contents` Map, and default `meta`.
 */
export function buildSnapshotFromFileMap(
  ref: RepoRef,
  files: Record<string, string>,
  opts: SnapshotFromFileMapOpts,
): RepoSnapshot {
  const oversizeFiles: OversizeFileItem[] = [];
  const kept: string[] = [];

  // Step 1: size filter (R2.6). Only > 1 MB is skipped; exactly 1 MB is kept.
  for (const path of Object.keys(files)) {
    const content = files[path] ?? "";
    if (byteLength(content) > MAX_FILE_BYTES) {
      oversizeFiles.push({
        kind: "file_skipped",
        path,
        detail: "too large to divine",
        source: "static",
      });
      continue;
    }
    kept.push(path);
  }

  // Step 2: file cap (R2.7). Lexicographic order, first MAX_FILES retained.
  kept.sort();
  const truncated = kept.length > MAX_FILES;
  const retained = truncated ? kept.slice(0, MAX_FILES) : kept;

  // Step 3: shape FileEntry[] and the contents Map (R2.1).
  const entries: FileEntry[] = [];
  const contents = new Map<string, string>();
  for (const path of retained) {
    const content = files[path] ?? "";
    entries.push({
      path,
      size: byteLength(content),
      lang: langFromPath(path),
      sha: contentSha(content),
    });
    contents.set(path, content);
  }

  return {
    ref,
    files: entries,
    meta: opts.meta ?? NEUTRAL_META,
    manifests: [],
    contents,
    oversizeFiles,
    truncated,
    createdAt: opts.createdAt,
  };
}
