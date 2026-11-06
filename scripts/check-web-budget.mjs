// scripts/check-web-budget.mjs
//
// Feature: 03-crt-terminal, task 31.2 — the web bundle budget / leak gate.
//
// Runs after `pnpm --filter @necro/web build` (design.md §"Bundle budget
// measurement"). It enforces three things on the built `apps/web/.next`:
//
//   1. (R16.1) The gzipped size of the terminal's INITIAL-ROUTE JavaScript is
//      at most BUDGET_BYTES (250_000 bytes, the strict decimal-KB reading of
//      "250 KB"). The initial-route set is the deduped union of the
//      app-build-manifest `pages["/page"]` + `pages["/layout"]`, the
//      build-manifest `rootMainFiles` and `polyfillFiles`, keeping only `.js`
//      files. Next's dynamic chunks (demo bundle, sound engine) are NOT listed
//      there, so they are excluded automatically (R16.12).
//
//   2. (R16.2) No forbidden marker survives into any `.next/static/**/*.js`
//      browser chunk: `api.github.com`, `codeload.github.com`, `GITHUB_TOKEN`,
//      `tree-sitter-python.wasm`, `tar-stream`. The oracle import-closure test
//      is the primary guard; this scan catches leaks through any other path.
//
//   3. (R16.12 + Arcana_Visions R8.9/R11.2) The demo bundle, the sound engine,
//      the resurrection result view and the Background_Theme synthesis engine
//      each exist as a separate dynamic chunk, distinct from one another and
//      from the initial route. The resurrection view is lazy-loaded through
//      `apps/web/src/terminal/load-resurrection-view.ts`
//      (`import("../components/ResurrectionResult.js")`), so the heavy diff /
//      vitality / patch renderers it pulls in never land in the initial route.
//      The Background_Theme engine is lazy-loaded through
//      `@necro/ui-crt` `load-background-theme.ts`
//      (`import("./background-theme-engine.js")`), so the Web Audio chiptune
//      synthesiser never enters the first Terminal_Route render. The theme
//      engine shares the sound engine's `createOscillator` / `createGain`
//      content markers, so it is disambiguated by theme-specific markers
//      (`MAX_THEME_GAIN`, `createBackgroundThemeEngine`, `scheduleLoop`) and by
//      the `background-theme` name fragment.
//
// The pure helpers (BUDGET_BYTES, FORBIDDEN_MARKERS, collectInitialRouteJs,
// scanForbiddenMarkers, findSeparateChunks) are exported with NO side effects
// so `apps/web/src/budget.test.ts` can exercise them offline against synthetic
// manifests. The CLI runner at the bottom is guarded by an
// `import.meta.url === pathToFileURL(process.argv[1]).href` main check, so
// importing this module never reads the filesystem or exits the process.
//
// _Requirements: R16.1, R16.2, R16.12_

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// ── Pure, exported contract ──────────────────────────────────────────────────

/**
 * The initial-route gzip ceiling, in bytes. Decimal KB (1000-based), the
 * stricter reading of the "≤ 250 KB gzipped" budget. (R16.1)
 * @type {number}
 */
export const BUDGET_BYTES = 250_000;

/**
 * Marker strings that must never survive into a browser chunk. Their presence
 * means server-only code (GitHub access, the tarball downloader, the
 * tree-sitter grammar) leaked into the client bundle. (R16.2)
 * @type {readonly string[]}
 */
export const FORBIDDEN_MARKERS = Object.freeze([
  "api.github.com",
  "codeload.github.com",
  "GITHUB_TOKEN",
  "tree-sitter-python.wasm",
  "tar-stream",
]);

/**
 * The deduped union of the initial-route JS files for the terminal route,
 * keeping only `.js` entries. Members:
 *   - app-build-manifest `pages["/page"]`
 *   - app-build-manifest `pages["/layout"]`
 *   - build-manifest `rootMainFiles`
 *   - build-manifest `polyfillFiles`
 *
 * CSS, API-route chunks, dynamic chunks (demo bundle / sound engine — not in
 * these lists) and the low-priority manifest helpers are all excluded: the
 * dynamic chunks because Next never lists them here, everything non-`.js`
 * because of the extension filter. Order is first-seen; duplicates collapse to
 * one entry. (R16.1, R16.12)
 *
 * @param {{ pages?: Record<string, readonly string[]> }} appManifest
 * @param {{ rootMainFiles?: readonly string[]; polyfillFiles?: readonly string[] }} buildManifest
 * @returns {string[]}
 */
export function collectInitialRouteJs(appManifest, buildManifest) {
  const pages = appManifest?.pages ?? {};
  const union = [
    ...(pages["/page"] ?? []),
    ...(pages["/layout"] ?? []),
    ...(buildManifest?.rootMainFiles ?? []),
    ...(buildManifest?.polyfillFiles ?? []),
  ];

  const seen = new Set();
  const out = [];
  for (const file of union) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".js")) continue; // drop CSS and non-JS
    if (seen.has(file)) continue; // dedupe
    seen.add(file);
    out.push(file);
  }
  return out;
}

/**
 * Return the forbidden markers found in one chunk's text. Empty array for clean
 * text. An optional `markers` list overrides the default FORBIDDEN_MARKERS
 * (used by tests). (R16.2)
 *
 * @param {string} fileText
 * @param {readonly string[]} [markers]
 * @returns {string[]}
 */
export function scanForbiddenMarkers(fileText, markers = FORBIDDEN_MARKERS) {
  const text = typeof fileText === "string" ? fileText : "";
  const found = [];
  for (const marker of markers) {
    if (text.includes(marker)) found.push(marker);
  }
  return found;
}

/**
 * Locate the demo-bundle chunk, the sound-engine chunk and the resurrection
 * result-view chunk among a list of chunk file names, as distinct dynamic
 * chunks. Matches by the stable source fragment Next derives chunk names from
 * when it can: the demo bundle comes from `bundle.generated.json`, the sound
 * engine from `engine.js` and the resurrection view from
 * `ResurrectionResult.js` (`import("./bundle.generated.json")` /
 * `import("./engine.js")` / `import("../components/ResurrectionResult.js")`), so
 * a chunk name containing `bundle.generated` is the demo chunk, one containing
 * `engine` is the sound chunk, and one containing `ResurrectionResult` is the
 * resurrection chunk. Returns `null` for a chunk that is absent so the CLI can
 * fail loudly. (R16.12)
 *
 * NOTE: Next does not always embed the source name in a lazy chunk's file name
 * (it may use a numeric module id), so the CLI runner falls back to a
 * content-based scan — see `findSeparateChunksByContent`. This name-based
 * helper is the pure, synchronous contract the test pins.
 *
 * The Arcana_Visions Background_Theme synthesis engine is a FOURTH such lazy
 * chunk: `apps/web/src/terminal/browser-ports.ts` wires `loadBackgroundTheme`,
 * whose string-literal `import("./background-theme-engine.js")` makes Next emit
 * the chiptune synthesiser as its own chunk, fetched only when the theme first
 * turns on after a user gesture — never in the first Terminal_Route render
 * (Arcana_Visions R8.9, R11.2). A chunk name containing `background-theme` is
 * that chunk. It is returned on the `backgroundTheme` field and must be a
 * separate, non-initial chunk distinct from demo / sound / resurrection.
 *
 * @param {readonly string[]} chunkNames
 * @returns {{ demo: string | null; sound: string | null; resurrection: string | null; backgroundTheme: string | null }}
 */
export function findSeparateChunks(chunkNames) {
  const names = Array.isArray(chunkNames) ? chunkNames : [];
  // Match the background-theme chunk FIRST so its name (which also contains the
  // substring "engine" via `background-theme-engine`) is not mistaken for the
  // Spec 05 sound engine chunk below.
  const backgroundTheme =
    names.find((n) => typeof n === "string" && /background-theme/.test(n)) ?? null;
  const demo =
    names.find((n) => typeof n === "string" && /bundle\.generated/.test(n)) ?? null;
  const sound =
    names.find(
      (n) =>
        typeof n === "string" &&
        n !== backgroundTheme &&
        (/\bengine\b|engine\./.test(n)),
    ) ?? null;
  const resurrection =
    names.find((n) => typeof n === "string" && /ResurrectionResult/i.test(n)) ?? null;
  return { demo, sound, resurrection, backgroundTheme };
}

// ── CLI-only helpers (filesystem; not part of the pinned pure contract) ───────

/** Markers that uniquely identify the demo-bundle chunk's *content*. */
const DEMO_CONTENT_MARKERS = ["lich-py2", "mixed-ruins", "green-garden"];
/** Markers that uniquely identify the sound-engine chunk's *content*. */
const SOUND_CONTENT_MARKERS = ["createOscillator", "OscillatorNode", "createGain"];
/**
 * Markers that uniquely identify the Background_Theme engine chunk's *content*.
 * The theme engine ALSO uses `createOscillator` / `OscillatorNode` /
 * `createGain`, so it would collide with SOUND_CONTENT_MARKERS; these markers
 * are stable identifiers that appear ONLY in `background-theme-engine.ts`
 * (`MAX_THEME_GAIN`, the factory `createBackgroundThemeEngine`, the internal
 * `scheduleLoop`), so the theme chunk is detected distinctly from the Spec 05
 * sound engine. (Arcana_Visions R8.9, R11.2)
 */
const BACKGROUND_THEME_CONTENT_MARKERS = [
  "MAX_THEME_GAIN",
  "createBackgroundThemeEngine",
  "scheduleLoop",
];
/** Markers that uniquely identify the resurrection result-view chunk's *content*. */
const RESURRECTION_CONTENT_MARKERS = [
  "renderFileResults",
  "renderResurrectVitality",
  "Residual_List",
];

/**
 * Recursively collect every `.js` file under `dir`, returning absolute paths.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/**
 * Content-based fallback for the CLI: scan the chunk files (which are NOT part
 * of the initial route) for the demo / sound markers so the gate still works
 * when Next names lazy chunks by numeric module id. Returns the relative chunk
 * names (POSIX separators) or null.
 *
 * The Background_Theme engine is matched BEFORE the sound engine: it shares the
 * `createOscillator` / `createGain` markers, so its theme-specific markers
 * (`MAX_THEME_GAIN` etc.) are checked first and the chunk is claimed as the
 * theme chunk, never miscounted as the Spec 05 sound engine.
 *
 * @param {readonly string[]} chunkAbsPaths — absolute paths of candidate chunk files
 * @param {ReadonlySet<string>} initialRouteSet — POSIX names already in the initial route
 * @param {string} staticDir — absolute `.next/static` dir for relativising names
 * @returns {{ demo: string | null; sound: string | null; resurrection: string | null; backgroundTheme: string | null }}
 */
function findSeparateChunksByContent(chunkAbsPaths, initialRouteSet, staticDir) {
  let demo = null;
  let sound = null;
  let resurrection = null;
  let backgroundTheme = null;
  for (const abs of chunkAbsPaths) {
    const rel = toPosix(join("static", relative(staticDir, abs)));
    if (initialRouteSet.has(rel)) continue; // skip initial-route files
    const text = readFileSync(abs, "utf8");
    if (demo === null && DEMO_CONTENT_MARKERS.every((m) => text.includes(m))) {
      demo = rel;
      continue;
    }
    // Background theme BEFORE sound: it also contains the sound markers, so its
    // unique markers must claim the chunk first (Arcana_Visions R8.9, R11.2).
    if (
      backgroundTheme === null &&
      BACKGROUND_THEME_CONTENT_MARKERS.some((m) => text.includes(m))
    ) {
      backgroundTheme = rel;
      continue;
    }
    if (sound === null && SOUND_CONTENT_MARKERS.some((m) => text.includes(m))) {
      sound = rel;
      continue;
    }
    if (
      resurrection === null &&
      RESURRECTION_CONTENT_MARKERS.some((m) => text.includes(m))
    ) {
      resurrection = rel;
    }
  }
  return { demo, sound, resurrection, backgroundTheme };
}

/** Normalise OS path separators to POSIX for stable manifest-style names. */
function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

function fmtBytes(n) {
  return `${n.toLocaleString("en-US")} B`;
}

// ── CLI runner ────────────────────────────────────────────────────────────────

/**
 * Run the full budget / leak / chunk-separation gate against a built
 * `apps/web/.next`. Returns an exit code (0 ok, 1 violation). Pure-ish: all I/O
 * is reads; it only logs and returns a code — it never calls process.exit, so
 * callers (and tests, if they ever opt in) stay in control.
 *
 * @param {string} webDir — absolute path to `apps/web`
 * @returns {number}
 */
export function runBudgetGate(webDir) {
  const nextDir = join(webDir, ".next");
  const staticDir = join(nextDir, "static");

  const appManifestPath = join(nextDir, "app-build-manifest.json");
  const buildManifestPath = join(nextDir, "build-manifest.json");

  for (const p of [appManifestPath, buildManifestPath]) {
    try {
      statSync(p);
    } catch {
      console.error(
        `check-web-budget: missing ${toPosix(relative(webDir, p))}. Run \`pnpm --filter @necro/web build\` first.`,
      );
      return 1;
    }
  }

  const appManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
  const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));

  let failed = false;

  // 1. Initial-route gzip budget. ────────────────────────────────────────────
  const initialRoute = collectInitialRouteJs(appManifest, buildManifest);
  let total = 0;
  const rows = [];
  for (const rel of initialRoute) {
    const abs = join(nextDir, ...rel.split("/"));
    let gz = 0;
    try {
      gz = gzipSync(readFileSync(abs)).length;
    } catch {
      console.error(`check-web-budget: initial-route file not found on disk: ${rel}`);
      failed = true;
      continue;
    }
    total += gz;
    rows.push({ rel, gz });
  }

  console.log("Initial-route JS (gzipped):");
  for (const { rel, gz } of rows.sort((a, b) => b.gz - a.gz)) {
    console.log(`  ${fmtBytes(gz).padStart(12)}  ${rel}`);
  }
  console.log(`  ${"".padStart(12, "-")}`);
  console.log(`  ${fmtBytes(total).padStart(12)}  TOTAL (budget ${fmtBytes(BUDGET_BYTES)})`);

  if (total > BUDGET_BYTES) {
    console.error(
      `check-web-budget: FAIL — initial-route JS is ${fmtBytes(total)} gzipped, over the ${fmtBytes(BUDGET_BYTES)} budget.`,
    );
    failed = true;
  } else {
    console.log(
      `check-web-budget: OK — initial-route JS ${fmtBytes(total)} ≤ ${fmtBytes(BUDGET_BYTES)}.`,
    );
  }

  // 2. Forbidden-marker scan over every static chunk. ─────────────────────────
  let staticJs = [];
  try {
    staticJs = collectJsFiles(staticDir);
  } catch {
    console.error(`check-web-budget: no ${toPosix(relative(webDir, staticDir))} directory.`);
    return 1;
  }

  let leaks = 0;
  for (const abs of staticJs) {
    const rel = toPosix(join("static", relative(staticDir, abs)));
    const found = scanForbiddenMarkers(readFileSync(abs, "utf8"));
    if (found.length > 0) {
      console.error(`check-web-budget: FAIL — ${rel} contains forbidden marker(s): ${found.join(", ")}`);
      leaks += found.length;
    }
  }
  if (leaks === 0) {
    console.log(`check-web-budget: OK — no forbidden markers in ${staticJs.length} static JS chunks.`);
  } else {
    failed = true;
  }

  // 3. Demo bundle and sound engine are separate chunks. ──────────────────────
  const initialSet = new Set(initialRoute);
  const chunkNames = staticJs.map((abs) => toPosix(join("static", relative(staticDir, abs))));

  // Try name-based first (covers builds that embed the source name), then fall
  // back to a content scan (Next may name lazy chunks by numeric module id).
  let { demo, sound, resurrection, backgroundTheme } = findSeparateChunks(chunkNames);
  if (
    demo === null ||
    sound === null ||
    resurrection === null ||
    backgroundTheme === null
  ) {
    const byContent = findSeparateChunksByContent(staticJs, initialSet, staticDir);
    demo = demo ?? byContent.demo;
    sound = sound ?? byContent.sound;
    resurrection = resurrection ?? byContent.resurrection;
    backgroundTheme = backgroundTheme ?? byContent.backgroundTheme;
  }

  if (demo === null) {
    console.error("check-web-budget: FAIL — demo-bundle chunk not found as a separate chunk.");
    failed = true;
  } else if (initialSet.has(demo)) {
    console.error(`check-web-budget: FAIL — demo bundle ${demo} is in the initial route, not a lazy chunk.`);
    failed = true;
  } else {
    console.log(`check-web-budget: OK — demo bundle is a separate chunk (${demo}).`);
  }

  if (sound === null) {
    console.error("check-web-budget: FAIL — sound-engine chunk not found as a separate chunk.");
    failed = true;
  } else if (initialSet.has(sound)) {
    console.error(`check-web-budget: FAIL — sound engine ${sound} is in the initial route, not a lazy chunk.`);
    failed = true;
  } else if (sound === demo) {
    console.error("check-web-budget: FAIL — demo bundle and sound engine resolved to the same chunk.");
    failed = true;
  } else {
    console.log(`check-web-budget: OK — sound engine is a separate chunk (${sound}).`);
  }

  // The resurrection result view must also be a separate, non-initial chunk so
  // its heavy diff/vitality/patch renderers never load at page open. (R16.12)
  if (resurrection === null) {
    console.error("check-web-budget: FAIL — resurrection result-view chunk not found as a separate chunk.");
    failed = true;
  } else if (initialSet.has(resurrection)) {
    console.error(`check-web-budget: FAIL — resurrection view ${resurrection} is in the initial route, not a lazy chunk.`);
    failed = true;
  } else if (resurrection === demo || resurrection === sound) {
    console.error("check-web-budget: FAIL — resurrection view resolved to the same chunk as the demo bundle or sound engine.");
    failed = true;
  } else {
    console.log(`check-web-budget: OK — resurrection result view is a separate chunk (${resurrection}).`);
  }

  // The Background_Theme synthesis engine must also be a separate, non-initial
  // chunk so the chiptune synthesiser never loads in the first Terminal_Route
  // render — it is fetched only after the theme turns on post-gesture.
  // (Arcana_Visions R8.9, R11.2)
  if (backgroundTheme === null) {
    console.error("check-web-budget: FAIL — background-theme engine chunk not found as a separate chunk.");
    failed = true;
  } else if (initialSet.has(backgroundTheme)) {
    console.error(`check-web-budget: FAIL — background-theme engine ${backgroundTheme} is in the initial route, not a lazy chunk.`);
    failed = true;
  } else if (
    backgroundTheme === demo ||
    backgroundTheme === sound ||
    backgroundTheme === resurrection
  ) {
    console.error("check-web-budget: FAIL — background-theme engine resolved to the same chunk as the demo bundle, sound engine or resurrection view.");
    failed = true;
  } else {
    console.log(`check-web-budget: OK — background-theme engine is a separate chunk (${backgroundTheme}).`);
  }

  return failed ? 1 : 0;
}

// Guard the CLI entry so importing this module (e.g. from budget.test.ts) has
// no side effects: no filesystem reads, no process exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));
  const code = runBudgetGate(webDir);
  process.exit(code);
}
