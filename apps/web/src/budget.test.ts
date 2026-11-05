// apps/web — web bundle budget script checks (task 31.1, RED).
//
// These examples pin the contract of `scripts/check-web-budget.mjs`, the CI
// step that runs after `pnpm --filter @necro/web build` (design.md §"Bundle
// budget measurement"). The script does NOT exist yet, so the dynamic import
// below rejects and every test here fails for the expected reason — "module
// not yet implemented". That is the test-first RED; task 31.2 writes the
// script and turns these green.
//
// The script is required to export pure, injectable helpers so this suite can
// exercise its logic OFFLINE against synthetic manifests and chunk listings,
// with no real `.next` build and no network / LLM / sandbox:
//
//   - BUDGET_BYTES: number — the initial-route gzip ceiling, 250_000 bytes
//     (decimal KB, the stricter reading of "250 KB"). (R16.1)
//   - FORBIDDEN_MARKERS: readonly string[] — the marker strings that must never
//     survive into a browser chunk: `api.github.com`, `codeload.github.com`,
//     `GITHUB_TOKEN`, `tree-sitter-python.wasm`, `tar-stream`. (R16.2)
//   - collectInitialRouteJs(appManifest, buildManifest): string[] — the deduped
//     union of `app-build-manifest pages["/page"]` + `pages["/layout"]` +
//     `build-manifest rootMainFiles` + `polyfillFiles`, keeping only `.js`
//     files, so the dynamic demo/sound chunks are excluded. (R16.1, R16.12)
//   - scanForbiddenMarkers(fileText, markers?): string[] — the markers found in
//     one chunk's text. (R16.2)
//   - findSeparateChunks(chunkNames): { demo, sound } — locates the demo-bundle
//     chunk and the sound-engine chunk as distinct dynamic chunks. (R16.12)
//
// Validates: Requirements 16.1, 16.2, 16.12

import { describe, expect, it } from "vitest";

// The script lives at the repo root under scripts/. It does not exist yet, so
// this import rejects (ERR_MODULE_NOT_FOUND) — the expected RED. Loaded lazily
// inside each test so the whole file does not blow up at collection time and
// every assertion reports the same clear "not yet implemented" failure.
const SCRIPT_URL = new URL("../../../scripts/check-web-budget.mjs", import.meta.url);

async function loadScript(): Promise<Record<string, unknown>> {
  return (await import(SCRIPT_URL.href)) as Record<string, unknown>;
}

// Synthetic manifests shaped exactly like the Next 15 build output in this repo
// (apps/web/.next/{app-build-manifest,build-manifest}.json).
const APP_MANIFEST = {
  pages: {
    "/layout": [
      "static/chunks/webpack-aaa.js",
      "static/chunks/main-app-bbb.js",
      "static/chunks/app/layout-ccc.js",
    ],
    "/page": [
      "static/chunks/webpack-aaa.js",
      "static/chunks/main-app-bbb.js",
      "static/css/page.css",
      "static/chunks/681-ddd.js",
      "static/chunks/app/page-eee.js",
    ],
    "/api/readings/route": ["static/chunks/app/api/readings/route-xxx.js"],
  },
} as const;

const BUILD_MANIFEST = {
  polyfillFiles: ["static/chunks/polyfills-fff.js"],
  rootMainFiles: ["static/chunks/webpack-aaa.js", "static/chunks/main-app-bbb.js"],
  lowPriorityFiles: ["static/ggg/_buildManifest.js", "static/ggg/_ssgManifest.js"],
} as const;

describe("R16.1: initial-route JS set and gzip budget", () => {
  it("exposes a 250_000-byte decimal-KB budget", async () => {
    const { BUDGET_BYTES } = await loadScript();
    expect(BUDGET_BYTES).toBe(250_000);
  });

  it("collects the deduped initial-route .js union and excludes dynamic/CSS/low-priority files", async () => {
    const mod = await loadScript();
    const collectInitialRouteJs = mod["collectInitialRouteJs"] as (
      app: unknown,
      build: unknown,
    ) => readonly string[];

    const files = collectInitialRouteJs(APP_MANIFEST, BUILD_MANIFEST);
    const set = new Set(files);

    // Union members present.
    expect(set.has("static/chunks/webpack-aaa.js")).toBe(true);
    expect(set.has("static/chunks/main-app-bbb.js")).toBe(true);
    expect(set.has("static/chunks/app/layout-ccc.js")).toBe(true);
    expect(set.has("static/chunks/app/page-eee.js")).toBe(true);
    expect(set.has("static/chunks/681-ddd.js")).toBe(true);
    expect(set.has("static/chunks/polyfills-fff.js")).toBe(true);

    // Deduped: webpack + main-app appear once each even though they are in
    // both pages and rootMainFiles.
    expect(files.filter((f) => f === "static/chunks/webpack-aaa.js")).toHaveLength(1);
    expect(files.filter((f) => f === "static/chunks/main-app-bbb.js")).toHaveLength(1);

    // CSS is not JS.
    expect(set.has("static/css/page.css")).toBe(false);
    // The API route chunk is not part of the terminal initial route.
    expect(set.has("static/chunks/app/api/readings/route-xxx.js")).toBe(false);
    // Low-priority manifest helpers are excluded (R16.12 — not initial route).
    expect(set.has("static/ggg/_buildManifest.js")).toBe(false);
  });
});

describe("R16.2: forbidden-marker scan over browser chunks", () => {
  it("lists exactly the forbidden markers the design names", async () => {
    const { FORBIDDEN_MARKERS } = await loadScript();
    expect(new Set(FORBIDDEN_MARKERS as readonly string[])).toEqual(
      new Set([
        "api.github.com",
        "codeload.github.com",
        "GITHUB_TOKEN",
        "tree-sitter-python.wasm",
        "tar-stream",
      ]),
    );
  });

  it("finds a forbidden marker that leaked into a chunk", async () => {
    const mod = await loadScript();
    const scanForbiddenMarkers = mod["scanForbiddenMarkers"] as (
      text: string,
      markers?: readonly string[],
    ) => readonly string[];

    const leaked = 'fetch("https://api.github.com/repos/"+o);const T=process.env.GITHUB_TOKEN;';
    const found = scanForbiddenMarkers(leaked);
    expect(found).toContain("api.github.com");
    expect(found).toContain("GITHUB_TOKEN");
  });

  it("reports no markers for a clean client chunk", async () => {
    const mod = await loadScript();
    const scanForbiddenMarkers = mod["scanForbiddenMarkers"] as (
      text: string,
      markers?: readonly string[],
    ) => readonly string[];

    const clean = 'const phrase="NECRO-ORACLE v1.0";export{phrase};';
    expect(scanForbiddenMarkers(clean)).toEqual([]);
  });
});

describe("R16.12: demo bundle and sound engine are separate chunks", () => {
  it("locates the demo-bundle chunk and the sound-engine chunk as distinct chunks", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => { readonly demo: string | null; readonly sound: string | null };

    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
      "static/chunks/bundle.generated.<hash>.js",
      "static/chunks/engine.<hash>.js",
    ];
    const { demo, sound } = findSeparateChunks(chunkNames);
    expect(demo).not.toBeNull();
    expect(sound).not.toBeNull();
    expect(demo).not.toBe(sound);
  });

  it("returns null for a missing lazy chunk so the script can fail loudly", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => { readonly demo: string | null; readonly sound: string | null };

    const onlyInitial = ["static/chunks/webpack-aaa.js", "static/chunks/app/page-eee.js"];
    const { demo, sound } = findSeparateChunks(onlyInitial);
    expect(demo).toBeNull();
    expect(sound).toBeNull();
  });
});
