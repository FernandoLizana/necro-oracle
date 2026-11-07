// apps/web/src/terminal/lovers-view-port.ts
//
// Feature: lovers-binding, task 14.4 — the live `LoversViewPort` (the lovers
// twin of `resurrect-view-port.ts`; design §C.6, R22.1, R31.1).
//
// `createLoversViewPort` returns a port that lazily yields the `LoversView`
// component through `loadLoversView`. The single `() => loadLoversView()`
// reference is the whole point of this seam: `load-lovers-view.ts` is otherwise
// dead code (no runtime module imports it), so the bundler tree-shakes it away
// and never emits a distinct `lovers-view` chunk, which would make the budget
// gate (`scripts/check-web-budget.mjs`) unable to locate it. Wiring this port
// into `createBrowserPorts` makes the loader reachable from the module graph,
// so the literal-path dynamic import inside `loadLoversView`
// (`import("../components/LoversView.js")`) lands in its own lazily-loaded chunk
// — fetched only the first time a `lovers` binding result is shown, never at
// page load — keeping the terminal initial route within the <= 250 KB gzipped
// budget (R31.1, R31.2). This mirrors `createResurrectViewPort` exactly: both
// reach heavy code through a literal-path dynamic import so it is emitted as a
// separate chunk.
//
// Browser boundary (R16.4): this file imports only its sibling browser-safe
// `load-lovers-view` loader — never `@necro/coven` runtime, `@necro/github`,
// the oracle main entry, or `node:*`.
//
// _Requirements: R22.1, R31.1_

import { loadLoversView } from "./load-lovers-view.js";
import type { LoversViewComponent } from "./load-lovers-view.js";

/**
 * A port that lazily yields the DMG Lovers split-view component from its own
 * bundler chunk. The concrete component type (`LoversViewComponent`) lives here
 * in `apps/web`; `@necro/ui-crt` keeps only a minimal structural
 * `() => Promise<unknown>` shape for this port (`LoversViewPort`) so the
 * design-system package never depends on an `apps/web` type (dependency
 * direction). This concrete port is assignable to that structural shape because
 * `Promise<LoversViewComponent>` is assignable to `Promise<unknown>`.
 */
export type LoversViewPort = () => Promise<LoversViewComponent>;

/**
 * The live port — a literal-path dynamic import that keeps the `lovers-view`
 * chunk separate (R31.1). Returning `() => loadLoversView()` makes
 * `load-lovers-view.ts` reachable from the module graph so the bundler emits
 * the distinct lovers-view chunk; the memoised loader itself handles
 * retry-on-failure.
 */
export function createLoversViewPort(): LoversViewPort {
  return () => loadLoversView();
}
