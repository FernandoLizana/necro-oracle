// apps/web/src/terminal/browser-ports.ts
//
// Feature: 03-crt-terminal, task 27.2 — the browser `TerminalPorts` factory
// (design.md §"Browser adapters"; R12.8, R16.4).
//
// `createBrowserPorts` assembles every side effect the Terminal reaches into
// one `TerminalPorts` bundle, built from real browser globals:
//   - `api`        — `createApiPort` over the system `fetch`.
//   - `storage`    — `window.localStorage`, wrapped in try/catch so a disabled
//                     or full store never throws (only `necro.motion` /
//                     `necro.sound` are ever written, enforced upstream, D12).
//   - `media`      — the reduced-motion media query, with a `change` listener.
//   - `visibility` — `document.visibilityState`, with a `visibilitychange`
//                     listener.
//   - `frames`     — `requestAnimationFrame` / `cancelAnimationFrame` +
//                     `performance.now`.
//   - `sound`      — `loadEngine` (the lazy Web Audio engine chunk).
//   - `demo`       — `loadDemoBundle` (the lazy, validated Demo_Bundle).
//   - `backgroundTheme` — `loadBackgroundTheme` (the lazy Web Audio chiptune
//                     engine chunk) + an `isTest` signal so the theme stays
//                     silent in a Playwright / CI run (Arcana_Visions, R8.10).
//   - `resurrectView` — `createResurrectViewPort()` (the lazy resurrection
//                     result-view chunk), whose single live reference keeps
//                     `load-resurrection-view.ts` in the module graph so the
//                     heavy `ResurrectionResult` view is emitted as its own
//                     non-initial chunk (oracle-landing-polish, Part B bug 2,
//                     R9.1-R9.5).
//
// Every adapter is built INSIDE the factory, so merely importing this module
// touches no browser global — it is safe to import from a client component
// without a module-scope `window` access. The client boundary (R16.4) is
// respected: this file imports only `@necro/ui-crt` and sibling browser modules
// (`api-client`, `../demo/load-bundle`, `./resurrect-view-port`), never
// `@necro/github`, the oracle main entry, or `node:*`.
//
// _Requirements: R12.8, R16.4_

import { loadBackgroundTheme, loadEngine } from "@necro/ui-crt";
import type {
  DemoPort,
  FramePort,
  MediaPort,
  StoragePort,
  TerminalPorts,
  VisibilityPort,
} from "@necro/ui-crt";

import type { PatchDownloadPort } from "@necro/ui-crt";

import { loadDemoBundle } from "../demo/load-bundle.js";
import { createApiPort } from "./api-client.js";
import { createResurrectViewPort } from "./resurrect-view-port.js";

/** The reduced-motion media query used by the `media` port. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A `StoragePort` over `window.localStorage` that never throws: a `get` on a
 * blocked/unavailable store resolves to `null`, and a `set` is a best-effort
 * no-op on failure. Only `necro.motion` and `necro.sound` are ever written by
 * callers (D12), so a quota failure cannot lose Output_Log data.
 */
function createStoragePort(): StoragePort {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A disabled or full store must never surface to the reducer.
      }
    },
  };
}

/**
 * A `MediaPort` over the reduced-motion media query. `subscribe` attaches a
 * `change` listener and returns an unsubscribe that detaches it, so a system
 * motion-preference change updates the mode without reload (R10.6).
 */
function createMediaPort(): MediaPort {
  // The query is resolved lazily rather than at construction: a client
  // component's `useMemo` initializer runs during the server render too, where
  // `window.matchMedia` does not exist. Deferring the lookup keeps the port
  // constructable on the server (so the static shell still renders, R1.5) and
  // live in the browser; a missing `matchMedia` resolves to "no preference".
  const resolveQuery = (): MediaQueryList | null => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    return window.matchMedia(REDUCED_MOTION_QUERY);
  };

  return {
    prefersReducedMotion() {
      return resolveQuery()?.matches ?? false;
    },
    subscribe(cb) {
      const query = resolveQuery();
      if (query === null) {
        return () => {
          // No media query available (server / unsupported): nothing to detach.
        };
      }
      const listener = (event: MediaQueryListEvent): void => {
        cb(event.matches);
      };
      query.addEventListener("change", listener);
      return () => {
        query.removeEventListener("change", listener);
      };
    },
  };
}

/**
 * A `VisibilityPort` over `document.visibilityState`. `subscribe` attaches a
 * `visibilitychange` listener (used to pause the sound hum when hidden) and
 * returns an unsubscribe.
 */
function createVisibilityPort(): VisibilityPort {
  return {
    visible() {
      return document.visibilityState === "visible";
    },
    subscribe(cb) {
      const listener = (): void => {
        cb(document.visibilityState === "visible");
      };
      document.addEventListener("visibilitychange", listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
      };
    },
  };
}

/**
 * A `FramePort` over `requestAnimationFrame` / `cancelAnimationFrame` and
 * `performance.now`. The reveal loop only runs while a reveal is queued in full
 * motion, so no idle rAF loop exists (R16.9).
 */
function createFramePort(): FramePort {
  return {
    now() {
      return performance.now();
    },
    request(cb) {
      return requestAnimationFrame(cb);
    },
    cancel(handle) {
      cancelAnimationFrame(handle);
    },
  };
}

/** A `DemoPort` backed by the lazy, validated Demo_Bundle loader. */
function createDemoPort(): DemoPort {
  return {
    load: () => loadDemoBundle(),
  };
}

/**
 * Whether the terminal is running under an automation/test harness, forwarded
 * into the pure `backgroundThemeActive` gate so the Background_Theme NEVER
 * starts in a Playwright / headless or CI run (Arcana_Visions, R8.10). A
 * detected WebDriver automation (the Playwright e2e runs) or a non-production
 * `NODE_ENV` (test builds) both count as a test run; a normal browser load
 * resolves to `false`. SSR-guarded: with no `navigator` it resolves from the
 * env alone.
 */
function detectTestRun(): boolean {
  if (typeof navigator !== "undefined" && navigator.webdriver === true) {
    return true;
  }
  return process.env.NODE_ENV === "test";
}

/**
 * A `PatchDownloadPort` that offers a completed Ritual's unified Patch as a
 * client-side `.patch` download (R7.3). The heavy `Blob`/`URL`/anchor helper is
 * reached through a literal-path dynamic import so it lands in its OWN chunk,
 * fetched only the first time a resurrection patch is downloaded and never at
 * page load — keeping the terminal initial route within the <= 250 KB budget
 * (R14.5), exactly like the Demo_Bundle and sound-engine loaders. An empty
 * patch is a graceful no-op (`downloadRitualPatch` returns `false`, R7.4); any
 * load/trigger failure is swallowed so the terminal never throws from a click.
 */
function createPatchDownloadPort(): PatchDownloadPort {
  return async (patch, ritualId) => {
    try {
      const mod = await import("./patch-download.js");
      mod.downloadRitualPatch({ patch, ritualId });
    } catch {
      // A failed chunk load or a DOM trigger error must never surface to the
      // terminal; the patch also renders inline in the log, so the download is
      // a best-effort convenience.
    }
  };
}

/**
 * Build the full `TerminalPorts` bundle from real browser globals. Called only
 * from the client `TerminalScreen` after mount, so every global reference is
 * live by the time it runs.
 */
export function createBrowserPorts(): TerminalPorts {
  return {
    api: createApiPort(globalThis.fetch.bind(globalThis)),
    demo: createDemoPort(),
    storage: createStoragePort(),
    media: createMediaPort(),
    visibility: createVisibilityPort(),
    frames: createFramePort(),
    sound: loadEngine,
    patchDownload: createPatchDownloadPort(),
    // The lazy Background_Theme engine chunk + the test/CI signal. The theme
    // still plays only once the pure gate turns true (sound on, after a user
    // gesture, visible) AND `isTest` is false, so a Playwright / CI run stays
    // silent (R8.10).
    backgroundTheme: loadBackgroundTheme,
    isTest: detectTestRun(),
    // The lazy resurrection result-view port (oracle-landing-polish, Part B bug
    // 2). This single live reference keeps `load-resurrection-view.ts` reachable
    // from the module graph, so the bundler emits the heavy `ResurrectionResult`
    // diff/vitality/patch view as its OWN chunk — fetched only the first time a
    // `resurrect` result is mounted, never at page load — keeping the terminal
    // initial route within the <= 250 KB gzipped budget (R9.1-R9.5, R14.5),
    // exactly like the demo / sound / background-theme / patch-download seams.
    resurrectView: createResurrectViewPort(),
  };
}
