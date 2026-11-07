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
//   - findSeparateChunks(chunkNames): { demo, sound, resurrection,
//     backgroundTheme } — locates the demo-bundle chunk, the sound-engine
//     chunk, the resurrection result-view chunk and the Arcana_Visions
//     Background_Theme engine chunk as distinct dynamic chunks. The theme chunk
//     shares the sound engine's Web Audio markers, so it is disambiguated by
//     name/content. (R16.12, Arcana_Visions R8.9/R11.2)
//
// The resurrection-engine terminal client (resurrection-engine task 14.11/14.12)
// adds the diff / vitality / patch result view, lazy-loaded through
// `apps/web/src/terminal/load-resurrection-view.ts`
// (`import("../components/ResurrectionResult.js")`). That heavy renderer must
// land in its OWN dynamic chunk — exactly like the demo bundle and the sound
// engine — so it never enters the terminal initial route and the ≤ 250 KB
// gzipped budget still holds (R14.1, R14.5). The additions below pin that:
// the resurrection chunk is NOT part of `collectInitialRouteJs`, and
// `findSeparateChunks` locates it as a distinct chunk.
//
// Validates: Requirements 16.1, 16.2, 16.12, 14.1, 14.5

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

type SeparateChunks = {
  readonly demo: string | null;
  readonly sound: string | null;
  readonly resurrection: string | null;
  readonly backgroundTheme: string | null;
};

describe("R16.12: demo bundle, sound engine and resurrection view are separate chunks", () => {
  it("locates the demo-bundle, sound-engine and resurrection chunks as distinct chunks", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunks;

    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
      "static/chunks/bundle.generated.<hash>.js",
      "static/chunks/engine.<hash>.js",
      "static/chunks/ResurrectionResult.<hash>.js",
    ];
    const { demo, sound, resurrection } = findSeparateChunks(chunkNames);
    expect(demo).not.toBeNull();
    expect(sound).not.toBeNull();
    expect(resurrection).not.toBeNull();
    // All three are distinct dynamic chunks.
    expect(new Set([demo, sound, resurrection]).size).toBe(3);
  });

  it("returns null for a missing lazy chunk so the script can fail loudly", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunks;

    const onlyInitial = ["static/chunks/webpack-aaa.js", "static/chunks/app/page-eee.js"];
    const { demo, sound, resurrection, backgroundTheme } = findSeparateChunks(onlyInitial);
    expect(demo).toBeNull();
    expect(sound).toBeNull();
    expect(resurrection).toBeNull();
    expect(backgroundTheme).toBeNull();
  });
});

// Arcana_Visions (R8.9, R11.2): the Background_Theme synthesis engine is a
// FOURTH lazy chunk, loaded only after the theme turns on post-gesture through
// `@necro/ui-crt` `load-background-theme.ts`
// (`import("./background-theme-engine.js")`). It must be located as its own
// separate, non-initial chunk, distinct from the demo / sound / resurrection
// chunks. Crucially the theme engine ALSO uses `createOscillator` /
// `OscillatorNode` / `createGain`, so a name/content detector that only knew
// the Spec 05 sound markers would misclassify it as the sound engine — the
// script disambiguates it by the `background-theme` name fragment and by
// theme-specific content markers. These examples pin that fourth field without
// weakening the demo/sound/resurrection contract above.
//
// Validates: Requirements 8.9, 11.2 (Arcana_Visions)
describe("Arcana_Visions R8.9/R11.2: the background-theme engine is a distinct lazy chunk", () => {
  it("locates the background-theme chunk alongside demo, sound and resurrection as four distinct chunks", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunks;

    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
      "static/chunks/bundle.generated.<hash>.js",
      "static/chunks/engine.<hash>.js",
      "static/chunks/ResurrectionResult.<hash>.js",
      "static/chunks/background-theme-engine.<hash>.js",
    ];
    const { demo, sound, resurrection, backgroundTheme } =
      findSeparateChunks(chunkNames);

    expect(demo).not.toBeNull();
    expect(sound).not.toBeNull();
    expect(resurrection).not.toBeNull();
    expect(backgroundTheme).not.toBeNull();

    // The theme chunk is positively identified by its name fragment.
    expect(backgroundTheme).toBe("static/chunks/background-theme-engine.<hash>.js");

    // All four are distinct dynamic chunks — and, in particular, the theme
    // chunk is NOT the same as the Spec 05 sound chunk even though its name also
    // contains the substring "engine".
    expect(new Set([demo, sound, resurrection, backgroundTheme]).size).toBe(4);
    expect(backgroundTheme).not.toBe(sound);
  });

  it("does not steal the sound-engine chunk when only the sound engine is present", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunks;

    // Only the Spec 05 sound engine is present (no background-theme chunk): the
    // sound field must still resolve, and backgroundTheme must be null rather
    // than claiming the sound chunk.
    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/engine.<hash>.js",
    ];
    const { sound, backgroundTheme } = findSeparateChunks(chunkNames);
    expect(sound).toBe("static/chunks/engine.<hash>.js");
    expect(backgroundTheme).toBeNull();
  });
});

describe("R14.1/R14.5: resurrection client stays off the terminal initial route", () => {
  it("never pulls the resurrection result-view chunk into collectInitialRouteJs", async () => {
    const mod = await loadScript();
    const collectInitialRouteJs = mod["collectInitialRouteJs"] as (
      app: unknown,
      build: unknown,
    ) => readonly string[];
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunks;

    // The lazy resurrection chunk is a real static JS file but — like the demo
    // bundle and sound engine — Next never lists it in the app/build manifests,
    // so it must be absent from the initial-route union no matter what.
    const RESURRECTION_CHUNK = "static/chunks/ResurrectionResult.<hash>.js";
    const initial = collectInitialRouteJs(APP_MANIFEST, BUILD_MANIFEST);
    expect(initial).not.toContain(RESURRECTION_CHUNK);

    // And it is positively identifiable as its own separate chunk, distinct
    // from the initial-route files, keeping the gzipped budget honest (R14.5).
    const allChunks = [...initial, RESURRECTION_CHUNK];
    const { resurrection } = findSeparateChunks(allChunks);
    expect(resurrection).toBe(RESURRECTION_CHUNK);
    expect(new Set(initial).has(RESURRECTION_CHUNK)).toBe(false);
  });

  it("keeps the measured initial-route gzip set under BUDGET_BYTES with the resurrection chunk excluded", async () => {
    const mod = await loadScript();
    const { BUDGET_BYTES } = mod as { BUDGET_BYTES: number };
    const collectInitialRouteJs = mod["collectInitialRouteJs"] as (
      app: unknown,
      build: unknown,
    ) => readonly string[];

    // Synthetic per-file gzip sizes for the initial route, plus a deliberately
    // heavy resurrection chunk. The gate only sums the initial-route union; the
    // resurrection chunk is a separate dynamic chunk and must NOT be counted.
    const gzById: Record<string, number> = {
      "static/chunks/webpack-aaa.js": 30_000,
      "static/chunks/main-app-bbb.js": 80_000,
      "static/chunks/app/layout-ccc.js": 20_000,
      "static/chunks/app/page-eee.js": 40_000,
      "static/chunks/681-ddd.js": 25_000,
      "static/chunks/polyfills-fff.js": 15_000,
      // Heavy diff/vitality/patch view — would blow the budget if eager.
      "static/chunks/ResurrectionResult.<hash>.js": 120_000,
    };

    const initial = collectInitialRouteJs(APP_MANIFEST, BUILD_MANIFEST);
    const measured = initial.reduce((sum, f) => sum + (gzById[f] ?? 0), 0);

    // The resurrection chunk is NOT in the initial route, so its weight does
    // not count against the budget and the route stays within 250 KB.
    expect(measured).toBeLessThanOrEqual(BUDGET_BYTES);
    // Sanity: counting the lazy chunk eagerly WOULD exceed the budget, which is
    // exactly why it must stay a separate chunk.
    expect(measured + gzById["static/chunks/ResurrectionResult.<hash>.js"]!).toBeGreaterThan(
      BUDGET_BYTES,
    );
  });
});

// Lovers_Binding (lovers-binding task 15.1, R22.1/R31.1): the DMG Lovers split
// view and the client-side ZIP builder are TWO further lazy chunks that must
// stay off the terminal initial route so the ≤ 250 KB gzipped budget (R16.1)
// still holds. They are lazy-loaded through literal-path dynamic imports:
//   - the view via `apps/web/src/terminal/load-lovers-view.ts`
//     (`import(/* webpackChunkName: "lovers-view" */ "../components/LoversView.js")`)
//   - the ZIP builder via `apps/web/src/terminal/load-zip-builder.ts`
//     (`import(/* webpackChunkName: "lovers-zip" */ "./zip-builder.js")`)
// so the bundler emits each as its OWN dynamic chunk — exactly like the demo
// bundle, the sound engine, the resurrection view and the background-theme
// engine. These offline assertions (synthetic manifests + chunk listings, no
// real `.next` build, no network) pin that:
//   1. `collectInitialRouteJs` NEVER pulls either lovers chunk into the initial
//      route (they are dynamic, so Next does not list them in the manifests);
//   2. `findSeparateChunks` locates the `lovers-view` and `lovers-zip` chunks as
//      distinct chunks, each distinct from demo / sound / resurrection /
//      background-theme AND from the initial route;
//   3. the measured initial-route gzip total stays ≤ BUDGET_BYTES even when both
//      lovers chunks are deliberately heavy, and counting either one eagerly
//      WOULD blow the budget — which is exactly why they must stay separate.
//
// Validates: Requirements 22.1, 31.1, 16.1

type SeparateChunksLovers = SeparateChunks & {
  readonly loversView: string | null;
  readonly loversZip: string | null;
};

describe("Lovers_Binding R22.1/R31.1: the Lovers view and ZIP builder are distinct lazy chunks", () => {
  const LOVERS_VIEW_CHUNK = "static/chunks/lovers-view.<hash>.js";
  const LOVERS_ZIP_CHUNK = "static/chunks/lovers-zip.<hash>.js";

  it("locates lovers-view and lovers-zip as their own chunks, each distinct from the other six lazy chunks", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunksLovers;

    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
      "static/chunks/bundle.generated.<hash>.js",
      "static/chunks/engine.<hash>.js",
      "static/chunks/ResurrectionResult.<hash>.js",
      "static/chunks/background-theme-engine.<hash>.js",
      LOVERS_VIEW_CHUNK,
      LOVERS_ZIP_CHUNK,
    ];
    const { demo, sound, resurrection, backgroundTheme, loversView, loversZip } =
      findSeparateChunks(chunkNames);

    // Both lovers chunks are positively identified by their name fragments.
    expect(loversView).toBe(LOVERS_VIEW_CHUNK);
    expect(loversZip).toBe(LOVERS_ZIP_CHUNK);

    // All six dynamic chunks are distinct from one another.
    expect(
      new Set([demo, sound, resurrection, backgroundTheme, loversView, loversZip]).size,
    ).toBe(6);

    // In particular the lovers chunks never collapse into the demo / sound /
    // resurrection / background-theme chunks.
    expect(loversView).not.toBe(sound);
    expect(loversView).not.toBe(resurrection);
    expect(loversView).not.toBe(backgroundTheme);
    expect(loversZip).not.toBe(loversView);
    expect(loversZip).not.toBe(sound);
  });

  it("returns null for both lovers chunks when only initial-route files are present", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunksLovers;

    const onlyInitial = ["static/chunks/webpack-aaa.js", "static/chunks/app/page-eee.js"];
    const { loversView, loversZip } = findSeparateChunks(onlyInitial);
    expect(loversView).toBeNull();
    expect(loversZip).toBeNull();
  });

  it("does not steal the sound-engine chunk — lovers names contain no 'engine' fragment", async () => {
    const mod = await loadScript();
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunksLovers;

    // The sound engine is present alongside both lovers chunks: the sound field
    // must still resolve to the engine chunk, and the lovers fields must each
    // claim their own chunk (neither "lovers-view" nor "lovers-zip" contains the
    // substring "engine").
    const chunkNames = [
      "static/chunks/engine.<hash>.js",
      LOVERS_VIEW_CHUNK,
      LOVERS_ZIP_CHUNK,
    ];
    const { sound, loversView, loversZip } = findSeparateChunks(chunkNames);
    expect(sound).toBe("static/chunks/engine.<hash>.js");
    expect(loversView).toBe(LOVERS_VIEW_CHUNK);
    expect(loversZip).toBe(LOVERS_ZIP_CHUNK);
  });

  it("never pulls either lovers chunk into collectInitialRouteJs", async () => {
    const mod = await loadScript();
    const collectInitialRouteJs = mod["collectInitialRouteJs"] as (
      app: unknown,
      build: unknown,
    ) => readonly string[];
    const findSeparateChunks = mod["findSeparateChunks"] as (
      chunkNames: readonly string[],
    ) => SeparateChunksLovers;

    // Like every other lazy chunk, Next never lists the lovers chunks in the
    // app/build manifests, so they must be absent from the initial-route union.
    const initial = collectInitialRouteJs(APP_MANIFEST, BUILD_MANIFEST);
    expect(initial).not.toContain(LOVERS_VIEW_CHUNK);
    expect(initial).not.toContain(LOVERS_ZIP_CHUNK);

    // And both are positively identifiable as their own separate chunks,
    // distinct from the initial-route files.
    const allChunks = [...initial, LOVERS_VIEW_CHUNK, LOVERS_ZIP_CHUNK];
    const { loversView, loversZip } = findSeparateChunks(allChunks);
    expect(loversView).toBe(LOVERS_VIEW_CHUNK);
    expect(loversZip).toBe(LOVERS_ZIP_CHUNK);
    expect(new Set(initial).has(LOVERS_VIEW_CHUNK)).toBe(false);
    expect(new Set(initial).has(LOVERS_ZIP_CHUNK)).toBe(false);
  });

  it("keeps the initial-route gzip total ≤ BUDGET_BYTES with both lovers chunks excluded", async () => {
    const mod = await loadScript();
    const { BUDGET_BYTES } = mod as { BUDGET_BYTES: number };
    const collectInitialRouteJs = mod["collectInitialRouteJs"] as (
      app: unknown,
      build: unknown,
    ) => readonly string[];

    // Synthetic per-file gzip sizes for the initial route, plus deliberately
    // heavy lovers chunks. The gate only sums the initial-route union; the
    // lovers chunks are separate dynamic chunks and must NOT be counted.
    const gzById: Record<string, number> = {
      "static/chunks/webpack-aaa.js": 30_000,
      "static/chunks/main-app-bbb.js": 80_000,
      "static/chunks/app/layout-ccc.js": 20_000,
      "static/chunks/app/page-eee.js": 40_000,
      "static/chunks/681-ddd.js": 25_000,
      "static/chunks/polyfills-fff.js": 15_000,
      // The DMG split view (three panes + scoped CSS) and the ZIP machinery —
      // either would blow the budget if eager.
      [LOVERS_VIEW_CHUNK]: 90_000,
      [LOVERS_ZIP_CHUNK]: 70_000,
    };

    const initial = collectInitialRouteJs(APP_MANIFEST, BUILD_MANIFEST);
    const measured = initial.reduce((sum, f) => sum + (gzById[f] ?? 0), 0);

    // Neither lovers chunk is in the initial route, so neither weight counts and
    // the route stays within 250 KB.
    expect(measured).toBeLessThanOrEqual(BUDGET_BYTES);
    // Sanity: counting either lazy chunk eagerly WOULD exceed the budget, which
    // is exactly why each must stay a separate chunk.
    expect(measured + gzById[LOVERS_VIEW_CHUNK]!).toBeGreaterThan(BUDGET_BYTES);
    expect(measured + gzById[LOVERS_ZIP_CHUNK]!).toBeGreaterThan(BUDGET_BYTES);
  });
});
