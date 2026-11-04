// src/snapshot/builder-directory.test.ts
//
// Unit tests (test-first) for buildSnapshotFromDirectory — the Node-only
// snapshot builder exported exclusively from `@necro/oracle/node`
// (src/node.ts). The real implementation (builder-directory.ts + node.ts
// wiring) lands in task 9.2, so these tests are EXPECTED RED until then.
//
// Design API (design.md, Snapshot builders — Node-only entry point):
//   buildSnapshotFromDirectory(
//     dir: string,
//     opts: { meta?: RepoMeta; createdAt: string }
//   ): Promise<RepoSnapshot>
//     // rejects with NecroError { code: "SNAPSHOT_DIR_NOT_FOUND" } if path missing
//     // requires an explicit createdAt; never calls Date.now() / new Date().
//
// The builder reads a real directory tree, delegates shaping to
// buildSnapshotFromFileMap, and derives a neutral RepoRef from the directory
// (the design signature takes only `dir` + `opts`, so no caller-supplied ref
// is threaded through — the tests assert the resulting snapshot shape, not a
// specific owner/name).
//
// Covers: R2.3, R2.4

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSnapshotFromDirectory } from "./builder-directory.js";
import { NecroError } from "../util/errors.js";

// --- Fixtures -------------------------------------------------------------

const CREATED_AT = "2026-11-03T12:00:00.000Z";

/** UTF-8 byte length, matching the 1 MB per-file size filter (R2.6). */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Track temp dirs created per test so afterEach can clean them up even when
// an assertion throws mid-test.
let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "necro-snapshot-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// --- R2.3: reads an existing directory into a snapshot ---------------------

describe("R2.3: buildSnapshotFromDirectory reads an existing directory", () => {
  it("populates files and contents from the directory tree, including nested files", async () => {
    const dir = await makeTempDir();
    const pyContent = "print('hi')\n";
    const readmeContent = "# graveyard\n";
    const tsContent = "export const x: number = 1;\n";

    await writeFile(join(dir, "a.py"), pyContent, "utf8");
    await writeFile(join(dir, "README.md"), readmeContent, "utf8");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "b.ts"), tsContent, "utf8");

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });

    // Every file is recorded, with the nested file keyed by its POSIX-style
    // relative path (forward slashes) so detectors read a stable, OS-neutral key.
    const paths = snapshot.files.map((f) => f.path).sort();
    expect(paths).toEqual(["README.md", "a.py", "sub/b.ts"]);

    // contents is a runtime Map keyed by the same relative paths (R2.1).
    expect(snapshot.contents).toBeInstanceOf(Map);
    expect(snapshot.contents.get("a.py")).toBe(pyContent);
    expect(snapshot.contents.get("README.md")).toBe(readmeContent);
    expect(snapshot.contents.get("sub/b.ts")).toBe(tsContent);
  });

  it("assigns lang by extension via the shared file-map builder", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "a.py"), "x = 1\n", "utf8");
    await writeFile(join(dir, "README.md"), "# docs\n", "utf8");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "b.ts"), "const y = 2;\n", "utf8");

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });
    const langByPath = new Map(snapshot.files.map((f) => [f.path, f.lang]));

    expect(langByPath.get("a.py")).toBe("python");
    expect(langByPath.get("sub/b.ts")).toBe("ts");
    expect(langByPath.get("README.md")).toBe("other");
  });

  it("computes FileEntry size as UTF-8 byte length", async () => {
    const dir = await makeTempDir();
    const content = "x = 'ééé'\n"; // multi-byte chars → bytes > chars
    await writeFile(join(dir, "u.py"), content, "utf8");

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });
    const entry = snapshot.files.find((f) => f.path === "u.py");

    expect(entry?.size).toBe(byteLength(content));
  });

  it("returns a well-formed RepoSnapshot with a derived ref carried through", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "a.py"), "x = 1\n", "utf8");

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });

    // The signature takes only `dir` + `opts`, so the ref is synthesized/neutral
    // rather than caller-supplied. Assert the shape: all RepoRef fields present
    // as non-empty strings.
    expect(snapshot.ref).toBeDefined();
    expect(typeof snapshot.ref.owner).toBe("string");
    expect(snapshot.ref.owner.length).toBeGreaterThan(0);
    expect(typeof snapshot.ref.name).toBe("string");
    expect(snapshot.ref.name.length).toBeGreaterThan(0);
    expect(typeof snapshot.ref.sha).toBe("string");
    expect(snapshot.ref.sha.length).toBeGreaterThan(0);
    expect(typeof snapshot.ref.defaultBranch).toBe("string");
    expect(snapshot.ref.defaultBranch.length).toBeGreaterThan(0);

    // Base shape sanity.
    expect(snapshot.manifests).toEqual([]);
    expect(snapshot.oversizeFiles).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.contents).toBeInstanceOf(Map);
  });

  it("defaults meta to neutral values when omitted (R2.5)", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "a.py"), "x = 1\n", "utf8");

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });

    expect(snapshot.meta).toEqual({
      pushedAt: null,
      isArchived: false,
      openIssueCount: 0,
      openPRCount: 0,
      oldestOpenPRAgeDays: null,
      latestReleaseAt: null,
      licenseKey: null,
    });
  });

  it("builds an empty, well-formed snapshot for an empty directory", async () => {
    const dir = await makeTempDir();

    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt: CREATED_AT });

    expect(snapshot.files).toEqual([]);
    expect(snapshot.contents.size).toBe(0);
    expect(snapshot.oversizeFiles).toEqual([]);
    expect(snapshot.truncated).toBe(false);
  });
});

// --- R2.3: createdAt honoured verbatim (no Date.now()) ---------------------

describe("R2.3: honours the explicit createdAt (never reads the clock)", () => {
  it("sets createdAt to the supplied opts.createdAt", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "a.py"), "x = 1\n", "utf8");

    const createdAt = "1999-12-31T23:59:59.000Z";
    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt });

    expect(snapshot.createdAt).toBe(createdAt);
  });

  it("does not derive createdAt from the current time", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "a.py"), "x = 1\n", "utf8");

    const createdAt = "2000-01-01T00:00:00.000Z";
    const before = Date.now();
    const snapshot = await buildSnapshotFromDirectory(dir, { createdAt });

    expect(snapshot.createdAt).toBe(createdAt);
    expect(new Date(snapshot.createdAt).getTime()).toBeLessThan(before);
  });
});

// --- R2.4: missing / inaccessible path rejects -----------------------------

describe("R2.4: missing or inaccessible directory rejects with SNAPSHOT_DIR_NOT_FOUND", () => {
  it("rejects with NecroError(SNAPSHOT_DIR_NOT_FOUND) for a non-existent path", async () => {
    const dir = await makeTempDir();
    const missing = join(dir, "does-not-exist");

    await expect(
      buildSnapshotFromDirectory(missing, { createdAt: CREATED_AT }),
    ).rejects.toBeInstanceOf(NecroError);

    await expect(
      buildSnapshotFromDirectory(missing, { createdAt: CREATED_AT }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_DIR_NOT_FOUND" });
  });

  it("rejects when the path points at a file rather than a directory", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "not-a-dir.py");
    await writeFile(filePath, "x = 1\n", "utf8");

    await expect(
      buildSnapshotFromDirectory(filePath, { createdAt: CREATED_AT }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_DIR_NOT_FOUND" });
  });
});
