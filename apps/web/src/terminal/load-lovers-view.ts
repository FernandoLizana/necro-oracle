// apps/web/src/terminal/load-lovers-view.ts
//
// Feature: lovers-binding, task 12.1 — the lazy loader for the DMG Lovers split
// view (design C.6 "DMG Lovers view + viewport fit"; R22.1, R31.1).
//
// `loadLoversView` lazily imports the `LoversView` component as its OWN browser
// chunk and memoises the resulting promise. The `import()` target is a string
// literal, so the bundler emits the Lovers split view (two pixel hearts + seam,
// the Python / contract / JavaScript panes, and everything it pulls in) as a
// separate dynamic chunk fetched only the first time a `lovers` ritual produces
// a result — never at page load. This keeps the terminal initial route within
// the <= 250 KB gzipped budget (R31.2), exactly mirroring the resurrection-view
// loader (`./load-resurrection-view.ts`) and the Demo_Bundle loader
// (`../demo/load-bundle.ts`): both reach their heavy code through a literal-path
// dynamic import so it lands in its own chunk.
//
// The `webpackChunkName: "lovers-view"` magic comment names the emitted chunk
// so the budget gate (`scripts/check-web-budget.mjs`, task 15.1) can locate it
// by name — the component filename is otherwise replaced by a numeric module id
// in a production build, so without the stable name the already-emitted chunk is
// undetectable. This mirrors how the resurrection chunk is named
// (`webpackChunkName: "ResurrectionResult"`).
//
// On any failure the memo is cleared so a later `lovers` retries the load,
// matching the resurrection / Demo_Bundle loaders' retry contract.
//
// Browser boundary (R16.4): this file imports only a TYPE from its sibling
// browser-safe `LoversView` component (erased at build time) — never
// `@necro/coven` runtime, `@necro/github`, the oracle main entry, or `node:*`.
//
// NOTE (task 12.1): `../components/LoversView.js` is a STUB today; task 12.2
// fleshes out the real DMG split view. The seam below already resolves it to a
// distinct non-initial chunk so task 15.1 can assert it.
//
// _Requirements: R22.1, R31.1_

import type { LoversViewProps } from "../components/LoversView.js";

/** The lazily-loaded Lovers DMG split-view component. */
export type LoversViewComponent = (props: LoversViewProps) => React.JSX.Element;

/** Memoised in-flight / resolved load promise; cleared on failure so retry works. */
let memo: Promise<LoversViewComponent> | undefined;

/**
 * Load and memoise the Lovers DMG split view from its own chunk.
 *
 * The literal-path dynamic import keeps the Lovers view out of the terminal
 * initial route and in its own lazily-loaded `lovers-view` chunk (R31.1). The
 * memo guarantees repeated calls return the same component; on failure the memo
 * is cleared so a subsequent call re-attempts the load.
 */
export function loadLoversView(): Promise<LoversViewComponent> {
  if (memo !== undefined) return memo;

  const attempt = (async (): Promise<LoversViewComponent> => {
    const mod = await import(
      /* webpackChunkName: "lovers-view" */ "../components/LoversView.js"
    );
    return mod.LoversView;
  })();

  // Clear the memo on rejection so a retry re-attempts; keep it on success.
  memo = attempt.catch((err) => {
    if (memo === attempt) memo = undefined;
    throw err;
  });

  return memo;
}
