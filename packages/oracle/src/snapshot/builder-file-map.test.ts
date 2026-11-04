// src/snapshot/builder-file-map.test.ts
//
// Unit tests (test-first) for buildSnapshotFromFileMap — the browser-safe
// snapshot builder. The implementation (builder-file-map.ts, task 8.2) does
// not exist yet, so these tests are EXPECTED RED until that task lands.
//
// Design API (design.md, Snapshot builders section):
//   buildSnapshotFromFileMap(
//     ref: RepoRef,
//     files: Record<string, string>,
//     opts: { meta?: RepoMeta; createdAt: string }
//   ): RepoSnapshot
//
// Covers: R2.1, R2.2, R2.5, R2.6, R2.7

import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "./builder-file-map.js";
import type { RepoMeta, RepoRef } from "./types.js";

// --- Fixtures -------------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeefcafe",
  defaultBranch: "main",
};

const CREATED_AT = "2026-11-03T12:00:00.000Z";

/** UTF-8 byte length, matching the 1 MB per-file size filter (R2.6). */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

const ONE_MB = 1_048_576;

function build(
  files: Record<string, string>,
  opts?: { meta?: RepoMeta; createdAt?: string },
) {
  const createdAt = opts?.createdAt ?? CREATED_AT;
  // Omit `meta` entirely when not supplied so the builder applies its neutral
  // default (exactOptionalPropertyTypes forbids passing `meta: undefined`).
  return opts?.meta === undefined
    ? buildSnapshotFromFileMap(REF, files, { createdAt })
    : buildSnapshotFromFileMap(REF, files, { meta: opts.meta, createdAt });
}

// --- R2.2: language assignment by extension --------------------------------

describe("R2.2: lang assigned by file extension", () => {
  it("maps each extension family to the correct lang", () => {
    const snapshot = build({
      "a.py": "print('hi')",
      "b.js": "const x = 1;",
      "c.mjs": "export const y = 2;",
      "d.cjs": "module.exports = {};",
      "e.ts": "const z: number = 3;",
      "f.tsx": "export const C = () => null;",
      "g.mts": "export type T = string;",
      "h.html": "<html></html>",
      "i.htm": "<html></html>",
      "README.md": "# docs",
      "Makefile": "all:",
      "j.PY": "print('upper ext')",
    });

    const langByPath = new Map(snapshot.files.map((f) => [f.path, f.lang]));

    expect(langByPath.get("a.py")).toBe("python");
    expect(langByPath.get("b.js")).toBe("js");
    expect(langByPath.get("c.mjs")).toBe("js");
    expect(langByPath.get("d.cjs")).toBe("js");
    expect(langByPath.get("e.ts")).toBe("ts");
    expect(langByPath.get("f.tsx")).toBe("ts");
    expect(langByPath.get("g.mts")).toBe("ts");
    expect(langByPath.get("h.html")).toBe("html");
    expect(langByPath.get("i.htm")).toBe("html");
    // Non-source and unknown extensions fall through to "other".
    expect(langByPath.get("README.md")).toBe("other");
    expect(langByPath.get("Makefile")).toBe("other");
  });
});

// --- R2.1 / R2.2: file entries and contents --------------------------------

describe("R2.1 / R2.2: file entries and contents", () => {
  it("records a FileEntry per kept file with byte size and populates contents", () => {
    const files = {
      "a.py": "print('hi')",
      "b.ts": "const z: number = 3;",
    };
    const snapshot = build(files);

    expect(snapshot.files).toHaveLength(2);

    const entryA = snapshot.files.find((f) => f.path === "a.py");
    expect(entryA).toBeDefined();
    expect(entryA?.size).toBe(byteLength(files["a.py"]));
    expect(typeof entryA?.sha).toBe("string");

    // contents is a runtime Map keyed by path (R2.1).
    expect(snapshot.contents).toBeInstanceOf(Map);
    expect(snapshot.contents.get("a.py")).toBe(files["a.py"]);
    expect(snapshot.contents.get("b.ts")).toBe(files["b.ts"]);
  });

  it("carries the supplied ref through unchanged", () => {
    const snapshot = build({ "a.py": "x = 1" });
    expect(snapshot.ref).toEqual(REF);
  });

  it("computes size as UTF-8 byte length, not character count", () => {
    // "é" is 2 bytes in UTF-8 but 1 JS character.
    const content = "x = 'ééé'";
    const snapshot = build({ "u.py": content });
    const entry = snapshot.files.find((f) => f.path === "u.py");
    expect(entry?.size).toBe(byteLength(content));
    expect(entry?.size).toBeGreaterThan(content.length);
  });
});

// --- R2.6: oversize files -------------------------------------------------

describe("R2.6: files over 1 MB are skipped into oversizeFiles", () => {
  it("skips a > 1 MB file from files and contents, recording it in oversizeFiles", () => {
    const big = "a".repeat(ONE_MB + 1); // 1 byte over the limit (ASCII: 1 char = 1 byte)
    const snapshot = build({
      "huge.py": big,
      "small.py": "x = 1",
    });

    // Absent from files and contents.
    expect(snapshot.files.some((f) => f.path === "huge.py")).toBe(false);
    expect(snapshot.contents.has("huge.py")).toBe(false);

    // The small file survives.
    expect(snapshot.files.some((f) => f.path === "small.py")).toBe(true);
    expect(snapshot.contents.get("small.py")).toBe("x = 1");

    // Exact oversize evidence shape (R2.6).
    expect(snapshot.oversizeFiles).toContainEqual({
      kind: "file_skipped",
      path: "huge.py",
      detail: "too large to divine",
      source: "static",
    });
  });

  it("keeps a file exactly at the 1 MB boundary (only > 1 MB is skipped)", () => {
    const atLimit = "a".repeat(ONE_MB); // exactly 1,048,576 bytes
    const snapshot = build({ "edge.py": atLimit });

    expect(snapshot.files.some((f) => f.path === "edge.py")).toBe(true);
    expect(snapshot.contents.has("edge.py")).toBe(true);
    expect(snapshot.oversizeFiles).toHaveLength(0);
  });

  it("leaves oversizeFiles empty when no file exceeds the limit", () => {
    const snapshot = build({ "a.py": "x = 1", "b.py": "y = 2" });
    expect(snapshot.oversizeFiles).toEqual([]);
  });
});

// --- R2.7: file cap and truncation -----------------------------------------

describe("R2.7: more than 5000 files are capped lexicographically", () => {
  function makeManyFiles(count: number): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      // Zero-padded so lexicographic order matches numeric order.
      files[`f${String(i).padStart(6, "0")}.py`] = `x = ${i}`;
    }
    return files;
  }

  it("keeps the first 5000 lexicographic paths and sets truncated=true for > 5000", () => {
    const snapshot = build(makeManyFiles(5001));

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.files).toHaveLength(5000);

    const keptPaths = snapshot.files.map((f) => f.path);
    const expectedPaths = Object.keys(makeManyFiles(5001)).sort().slice(0, 5000);
    expect(keptPaths).toEqual(expectedPaths);

    // The dropped file (last lexicographically) is absent from contents.
    expect(snapshot.contents.has("f005000.py")).toBe(false);
    // A kept file is present.
    expect(snapshot.contents.has("f000000.py")).toBe(true);
  });

  it("sets truncated=false when there are exactly 5000 files", () => {
    const snapshot = build(makeManyFiles(5000));
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.files).toHaveLength(5000);
  });

  it("sets truncated=false when there are fewer than 5000 files", () => {
    const snapshot = build(makeManyFiles(3));
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.files).toHaveLength(3);
  });

  it("applies the size filter before the 5000-file cap", () => {
    // 5000 valid small files + 1 oversize file. After the size filter there are
    // exactly 5000 files, so truncated must be false and the oversize file is
    // recorded in oversizeFiles, not counted against the cap.
    const files = makeManyFiles(5000);
    files["zzz-huge.py"] = "a".repeat(ONE_MB + 1);

    const snapshot = build(files);

    expect(snapshot.files).toHaveLength(5000);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.oversizeFiles).toContainEqual({
      kind: "file_skipped",
      path: "zzz-huge.py",
      detail: "too large to divine",
      source: "static",
    });
  });
});

// --- R2.1: createdAt comes from opts, never the clock ----------------------

describe("R2.1: createdAt is taken verbatim from opts (no Date.now())", () => {
  it("sets createdAt to the supplied opts.createdAt", () => {
    const createdAt = "1999-12-31T23:59:59.000Z";
    const snapshot = build({ "a.py": "x = 1" }, { createdAt });
    expect(snapshot.createdAt).toBe(createdAt);
  });

  it("does not derive createdAt from the current time", () => {
    const createdAt = "2000-01-01T00:00:00.000Z";
    const before = Date.now();
    const snapshot = build({ "a.py": "x = 1" }, { createdAt });
    // The stored value is the supplied string, unrelated to "now".
    expect(snapshot.createdAt).toBe(createdAt);
    expect(new Date(snapshot.createdAt).getTime()).toBeLessThan(before);
  });
});

// --- R2.5: neutral default meta when omitted -------------------------------

describe("R2.5: neutral default meta applied when meta omitted", () => {
  it("defaults meta to neutral values", () => {
    const snapshot = build({ "a.py": "x = 1" });
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

  it("uses the supplied meta when provided", () => {
    const meta: RepoMeta = {
      pushedAt: "2026-01-01T00:00:00.000Z",
      isArchived: true,
      openIssueCount: 7,
      openPRCount: 3,
      oldestOpenPRAgeDays: 200,
      latestReleaseAt: "2025-06-01T00:00:00.000Z",
      licenseKey: "MIT",
    };
    const snapshot = build({ "a.py": "x = 1" }, { meta });
    expect(snapshot.meta).toEqual(meta);
  });
});

// --- Shape sanity ----------------------------------------------------------

describe("buildSnapshotFromFileMap base shape", () => {
  it("returns an empty, well-formed snapshot for no files", () => {
    const snapshot = build({});
    expect(snapshot.files).toEqual([]);
    expect(snapshot.contents).toBeInstanceOf(Map);
    expect(snapshot.contents.size).toBe(0);
    expect(snapshot.oversizeFiles).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.manifests).toEqual([]);
    expect(snapshot.createdAt).toBe(CREATED_AT);
  });
});
