// Entry path normalization and binary sniff (task 12.1). Requirements: R3.3, R3.5, R3.6, R3.13.
// Contract assumed for 12.3 (src/entry-path.ts, pure):
//   type NormalizedEntry =
//     | { kind: "path"; path: string }   // "/"-joined segments, top-level prefix removed
//     | { kind: "traversal" }            // NUL, absolute, C: drive, or any ".." segment (split on "/" and "\")
//     | { kind: "root" }                 // nothing left after dropping empty/"." segments and the prefix
//   normalizeEntryPath(rawName: string): NormalizedEntry
//   isVendoredPath(path: string): boolean              // any "/" segment in VENDORED_SEGMENTS
//   isBinarySample(bytes: Uint8Array): boolean         // NUL within the first BINARY_SNIFF_BYTES (8000) bytes
import { describe, expect, it } from "vitest";
import { isBinarySample, isVendoredPath, normalizeEntryPath } from "./entry-path.js";

const PREFIX = "octo-repo-0123abc";

describe("normalizeEntryPath (R3.3, R3.13)", () => {
  it("strips the top-level <owner>-<repo>-<sha>/ prefix", () => {
    expect(normalizeEntryPath(`${PREFIX}/src/app.py`)).toEqual({ kind: "path", path: "src/app.py" });
    expect(normalizeEntryPath(`${PREFIX}/README.md`)).toEqual({ kind: "path", path: "README.md" });
  });

  it("drops empty and '.' segments", () => {
    expect(normalizeEntryPath(`${PREFIX}//src/./a//b.py`)).toEqual({ kind: "path", path: "src/a/b.py" });
    expect(normalizeEntryPath(`./${PREFIX}/./x.txt`)).toEqual({ kind: "path", path: "x.txt" });
  });

  it("drops a trailing slash on directory entries", () => {
    expect(normalizeEntryPath(`${PREFIX}/.github/workflows/`)).toEqual({
      kind: "path",
      path: ".github/workflows",
    });
  });

  it("returns root for the top-level directory entry", () => {
    expect(normalizeEntryPath(`${PREFIX}/`)).toEqual({ kind: "root" });
    expect(normalizeEntryPath(PREFIX)).toEqual({ kind: "root" });
    expect(normalizeEntryPath("./")).toEqual({ kind: "root" });
    expect(normalizeEntryPath("")).toEqual({ kind: "root" });
  });

  it.each([
    ["parent segment", `${PREFIX}/../evil.py`],
    ["leading parent", "../evil.py"],
    ["nested parent", `${PREFIX}/a/b/../../../c`],
    ["trailing parent", `${PREFIX}/a/..`],
    ["backslash traversal", `${PREFIX}\\..\\evil.py`],
    ["mixed separator traversal", `${PREFIX}/a\\..\\..\\evil.py`],
    ["absolute posix", "/etc/passwd"],
    ["absolute after prefix-like", `/${PREFIX}/a.py`],
    ["drive letter backslash", "C:\\Windows\\system32"],
    ["drive letter slash", "C:/Windows/system32"],
    ["drive letter relative", "C:evil.py"],
    ["lowercase drive", "d:/x"],
    ["NUL byte", `${PREFIX}/a\0.py`],
    ["NUL only", "\0"],
  ])("rejects %s as traversal", (_label, raw) => {
    expect(normalizeEntryPath(raw)).toEqual({ kind: "traversal" });
  });

  it("does not treat names merely containing dots as traversal", () => {
    expect(normalizeEntryPath(`${PREFIX}/..foo/bar..py/...`)).toEqual({
      kind: "path",
      path: "..foo/bar..py/...",
    });
  });
});

describe("isVendoredPath (R3.5)", () => {
  it.each([".git", "bower_components", "node_modules", "site-packages", "third_party", "vendor"])(
    "flags %s at the root, nested, and as a directory entry",
    (name) => {
      expect(isVendoredPath(`${name}/a.js`)).toBe(true);
      expect(isVendoredPath(`src/${name}/a.js`)).toBe(true);
      expect(isVendoredPath(`a/b/c/${name}/d/e.js`)).toBe(true);
      expect(isVendoredPath(name)).toBe(true);
      expect(isVendoredPath(`a/${name}`)).toBe(true);
    },
  );

  it("does not flag lookalike names or ordinary paths", () => {
    expect(isVendoredPath("src/app.py")).toBe(false);
    expect(isVendoredPath("vendors/a.js")).toBe(false);
    expect(isVendoredPath("my_vendor/a.js")).toBe(false);
    expect(isVendoredPath("node_modules2/a.js")).toBe(false);
    expect(isVendoredPath(".github/workflows/ci.yml")).toBe(false);
    expect(isVendoredPath("docs/vendor.md")).toBe(false);
    expect(isVendoredPath("")).toBe(false);
  });
});

describe("isBinarySample (R3.6)", () => {
  it("detects a NUL at byte 0", () => {
    expect(isBinarySample(new Uint8Array([0]))).toBe(true);
  });

  it("detects a NUL at byte 7999 (last byte inside the window)", () => {
    const bytes = new Uint8Array(8000).fill(0x61);
    bytes[7999] = 0;
    expect(isBinarySample(bytes)).toBe(true);
  });

  it("ignores a NUL at byte 8000 (first byte outside the window)", () => {
    const bytes = new Uint8Array(8001).fill(0x61);
    bytes[8000] = 0;
    expect(isBinarySample(bytes)).toBe(false);
  });

  it("treats empty and NUL-free samples as text", () => {
    expect(isBinarySample(new Uint8Array(0))).toBe(false);
    expect(isBinarySample(new TextEncoder().encode("print('héllo')\n"))).toBe(false);
    expect(isBinarySample(new Uint8Array(8000).fill(0xff))).toBe(false);
  });
});
