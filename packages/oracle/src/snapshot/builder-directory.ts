// src/snapshot/builder-directory.ts
//
// Node-only snapshot builder (task 9.2). Recursively reads a directory tree
// from disk via `node:fs/promises`, builds a path→content map keyed by
// POSIX-relative paths (forward slashes), derives a neutral RepoRef, and
// delegates all shaping (lang assignment, size filter, file cap, contents Map,
// neutral meta) to buildSnapshotFromFileMap (R2.3, R2.4).
//
// This module is Node-only and MUST be re-exported exclusively from
// src/node.ts (never src/index.ts), keeping the main bundle `fs`-free (R2.3).
//
// Covers: R2.3, R2.4

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { NecroError } from "../util/errors.js";
import {
  buildSnapshotFromFileMap,
  type SnapshotFromFileMapOpts,
} from "./builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "./types.js";

export type { SnapshotFromFileMapOpts };

/**
 * Recursively collect every file under `root`, keyed by its POSIX-relative
 * path (forward slashes), mapped to its UTF-8 text content. Directories are
 * descended into; their entries are not themselves recorded.
 */
async function collectFiles(
  root: string,
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absPath, files);
      continue;
    }
    if (entry.isFile()) {
      // Normalise to POSIX-style, OS-neutral relative keys so detectors read a
      // stable path regardless of the host platform's separator.
      const relPath = relative(root, absPath).split(sep).join("/");
      files[relPath] = await readFile(absPath, "utf8");
    }
  }
}

/**
 * Build a RepoSnapshot by reading a directory from disk.
 *
 * Reads the tree with `node:fs/promises`, shaping delegated to
 * buildSnapshotFromFileMap (so the 1 MB size filter and 5000-file cap apply
 * there). The RepoRef is synthesized/neutral — the signature takes only `dir`
 * + `opts`, so no caller-supplied ref is threaded through.
 *
 * @param dir  Absolute or relative path to the directory to read.
 * @param opts Shaping options; `createdAt` is required (no system clock reads).
 * @throws NecroError code `SNAPSHOT_DIR_NOT_FOUND` if `dir` is missing,
 *         inaccessible, or does not point at a directory.
 */
export async function buildSnapshotFromDirectory(
  dir: string,
  opts: SnapshotFromFileMapOpts,
): Promise<RepoSnapshot> {
  let isDir: boolean;
  try {
    isDir = (await stat(dir)).isDirectory();
  } catch (cause) {
    throw new NecroError(
      "SNAPSHOT_DIR_NOT_FOUND",
      `The crypt could not be opened: no directory lies at "${dir}". Check the path and try again.`,
      cause,
    );
  }
  if (!isDir) {
    throw new NecroError(
      "SNAPSHOT_DIR_NOT_FOUND",
      `The crypt could not be opened: "${dir}" is not a directory. Point the ritual at a directory, not a file.`,
    );
  }

  const files: Record<string, string> = {};
  await collectFiles(dir, dir, files);

  // Neutral, non-empty RepoRef derived from the directory (R2.3). The tests
  // only assert these fields are present, non-empty strings.
  const ref: RepoRef = {
    owner: "local",
    name: basename(dir) || "repo",
    sha: "0000000",
    defaultBranch: "main",
  };

  // Pass `meta` through only when supplied (exactOptionalPropertyTypes) so the
  // builder's neutral default applies when it is omitted (R2.5).
  const fileMapOpts: SnapshotFromFileMapOpts =
    opts.meta !== undefined
      ? { meta: opts.meta, createdAt: opts.createdAt }
      : { createdAt: opts.createdAt };

  return buildSnapshotFromFileMap(ref, files, fileMapOpts);
}
