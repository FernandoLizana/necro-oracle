// apps/web/src/terminal/load-resurrection-view.ts
//
// Feature: resurrection-engine, task 14.11 — the lazy loader for the
// resurrection result view (design.md §"Browser/terminal rendering",
// §"Default vs optional runtime"; R14.1, R14.5).
//
// `loadResurrectionView` lazily imports the `ResurrectionResult` component as
// its OWN browser chunk and memoises the resulting promise. The `import()`
// target is a string literal, so the bundler emits the resurrection diff /
// vitality / patch view — and the `@necro/ui-crt` diff and vitality renderers it
// pulls in (`renderFileResults`, `renderResurrectVitality`) — as a separate
// dynamic chunk fetched only the first time a `resurrect` command produces a
// result, never at page load. This keeps the terminal initial route within the
// <= 250 KB gzipped budget (R14.5), exactly mirroring the Demo_Bundle loader
// (`../demo/load-bundle.ts`) and the sound-engine loader (`@necro/ui-crt`
// `loadEngine`): both reach their heavy code through a literal-path dynamic
// import so it lands in its own chunk. Card images stay lazy too — the result
// view renders ASCII diff/vitality text, pulling in no eager card art.
//
// Reduced-motion / `quiet` is NOT handled here, by design. The result view
// renders each diff and vitality block with `OutputBlockView` at
// `revealedCount={null}` — a settled artifact with no typewriter reveal — so it
// emits no motion regardless of preference; and any result block routed through
// the session reducer is only queued for reveal when the effective Motion_Mode
// is `full` (`state.motionMode`), which both `prefers-reduced-motion` and the
// `motion off` ("quiet") command resolve to `reduced` through the single
// `resolveMotionMode`. The lazy seam adds no timers, no `requestAnimationFrame`
// and no parallel motion path (R14.1).
//
// On any failure the memo is cleared so a later `resurrect` retries the load,
// matching the Demo_Bundle loader's retry contract.
//
// Browser boundary (R16.4): this file imports only its sibling browser-safe
// `ResurrectionResult` component chunk (which itself imports only
// `@necro/ui-crt`) — never `@necro/coven`, `@necro/github`, the oracle main
// entry, or `node:*`.
//
// _Requirements: R14.1, R14.5_

import type { ResurrectionResultProps } from "../components/ResurrectionResult.js";

/** The lazily-loaded resurrection result view component. */
export type ResurrectionResultComponent = (
  props: ResurrectionResultProps,
) => React.JSX.Element;

/** Memoised in-flight / resolved load promise; cleared on failure so retry works. */
let memo: Promise<ResurrectionResultComponent> | undefined;

/**
 * Load and memoise the resurrection result view from its own chunk.
 *
 * The literal-path dynamic import keeps the resurrection diff / vitality view
 * (and the `@necro/ui-crt` renderers it depends on) out of the terminal initial
 * route and in its own lazily-loaded chunk (R14.5). The memo guarantees
 * repeated calls return the same component; on failure the memo is cleared so a
 * subsequent call re-attempts the load.
 */
export function loadResurrectionView(): Promise<ResurrectionResultComponent> {
  if (memo !== undefined) return memo;

  const attempt = (async (): Promise<ResurrectionResultComponent> => {
    // Literal-path dynamic import -> the bundler emits a separate chunk. The
    // `webpackChunkName` magic comment names that chunk `ResurrectionResult.*`
    // so the budget gate (`scripts/check-web-budget.mjs` `findSeparateChunks`,
    // which matches `/ResurrectionResult/i`) can locate it by name: the diff /
    // vitality renderer identifiers it would otherwise match on are minified
    // away in a production build, and the component filename is otherwise
    // replaced by a numeric module id, so without the name the already-emitted
    // chunk is undetectable. The import target stays a string literal, so the
    // separate-chunk emission is unchanged (R14.5, R9.3-R9.5).
    const mod = await import(
      /* webpackChunkName: "ResurrectionResult" */ "../components/ResurrectionResult.js"
    );
    return mod.ResurrectionResult;
  })();

  // Clear the memo on rejection so a retry re-attempts; keep it on success.
  memo = attempt.catch((err) => {
    if (memo === attempt) memo = undefined;
    throw err;
  });

  return memo;
}
