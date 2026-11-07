// apps/web/src/terminal/resurrect-view-port.ts
//
// Feature: oracle-landing-polish, task 11.1 — the live `ResurrectViewPort`
// (design.md §"apps/web: resurrection-view port"; Part B bug 2, R9.1, R9.8).
//
// `createResurrectViewPort` returns a port that lazily yields the
// `ResurrectionResult` view component through `loadResurrectionView`. The
// single `() => loadResurrectionView()` reference is the whole point of this
// seam: `load-resurrection-view.ts` is otherwise dead code (no runtime module
// imports it), so the bundler tree-shakes it away and never emits a distinct
// `ResurrectionResult` chunk, which makes `scripts/check-web-budget.mjs` fail.
// Wiring this port into `createBrowserPorts` (task 11.2) makes the loader
// reachable from the module graph, so the literal-path dynamic import inside
// `loadResurrectionView` (`import("../components/ResurrectionResult.js")`) lands
// in its own lazily-loaded chunk — fetched only the first time a `resurrect`
// result is shown, never at page load — keeping the terminal initial route
// within the <= 250 KB gzipped budget (R14.5). This mirrors
// `createPatchDownloadPort` in `browser-ports.ts`: both reach heavy code
// through a literal-path dynamic import so it is emitted as a separate chunk.
//
// Browser boundary (R16.4): this file imports only its sibling browser-safe
// `load-resurrection-view` loader — never `@necro/coven`, `@necro/github`, the
// oracle main entry, or `node:*`.
//
// _Requirements: R9.1, R9.8_

import { loadResurrectionView } from "./load-resurrection-view.js";
import type { ResurrectionResultComponent } from "./load-resurrection-view.js";

/**
 * A port that lazily yields the resurrection result-view component from its own
 * bundler chunk. The concrete component type (`ResurrectionResultComponent`)
 * lives here in `apps/web`; `@necro/ui-crt` keeps only a minimal structural
 * `() => Promise<unknown>` shape for this port so the design-system package
 * never depends on an `apps/web` type (dependency direction, R9.8). This
 * concrete port is assignable to that structural shape because
 * `Promise<ResurrectionResultComponent>` is assignable to `Promise<unknown>`.
 */
export type ResurrectViewPort = () => Promise<ResurrectionResultComponent>;

/**
 * The live port — a literal-path dynamic import that keeps the
 * `ResurrectionResult` chunk separate (R9.1). Returning
 * `() => loadResurrectionView()` makes `load-resurrection-view.ts` reachable
 * from the module graph so the bundler emits the distinct resurrection chunk;
 * the memoised loader itself handles retry-on-failure.
 */
export function createResurrectViewPort(): ResurrectViewPort {
  return () => loadResurrectionView();
}
