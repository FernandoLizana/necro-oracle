// apps/web/src/terminal/load-zip-builder.ts
//
// Feature: lovers-binding, task 12.1 — the lazy loader for the client-side ZIP
// builder behind the Lovers "Download pair" affordance (design C.6; R22.1,
// R31.1).
//
// `loadZipBuilder` lazily imports the `buildPairZip` builder as its OWN browser
// chunk and memoises the resulting promise. The `import()` target is a string
// literal, so the bundler emits the ZIP machinery as a separate dynamic chunk
// fetched only the first time a user clicks "Download pair" — never at page
// load. This keeps the terminal initial route within the <= 250 KB gzipped
// budget (R31.2), exactly mirroring the resurrection-view / Demo_Bundle /
// sound-engine / background-theme chunk splits: each reaches its heavy code
// through a literal-path dynamic import so it lands in its own chunk.
//
// The `webpackChunkName: "lovers-zip"` magic comment names the emitted chunk so
// the budget gate (`scripts/check-web-budget.mjs`, task 15.1) can find it by
// name and assert it is distinct from the `lovers-view` chunk and non-initial —
// the module filename is otherwise replaced by a numeric module id in a
// production build.
//
// On any failure the memo is cleared so a later download attempt retries the
// load, matching the resurrection / Demo_Bundle loaders' retry contract.
//
// Client boundary (R16.4): the ZIP builder is CLIENT-SIDE ONLY. This seam and
// the module it loads import no server module, `@necro/github`, `@necro/coven`
// runtime, the oracle main entry, or `node:*` — only a TYPE from `@necro/coven`
// (erased at build time).
//
// NOTE (task 12.1): `./zip-builder.js` is a STUB today (the signature
// `buildPairZip(pair): Promise<Blob>` only); task 12.2 / the ZIP task fills in
// the real in-browser ZIP assembly (python/, js/, contract/, README). The seam
// below already resolves it to a distinct non-initial chunk so task 15.1 can
// assert it.
//
// _Requirements: R22.1, R31.1_

import type { buildPairZip } from "./zip-builder.js";

/** The lazily-loaded client-side ZIP builder: `buildPairZip(pair) => Promise<Blob>`. */
export type ZipBuilder = typeof buildPairZip;

/** Memoised in-flight / resolved load promise; cleared on failure so retry works. */
let memo: Promise<ZipBuilder> | undefined;

/**
 * Load and memoise the client-side ZIP builder from its own chunk.
 *
 * The literal-path dynamic import keeps the ZIP machinery out of the terminal
 * initial route and in its own lazily-loaded `lovers-zip` chunk (R31.1). The
 * memo guarantees repeated calls return the same builder; on failure the memo
 * is cleared so a subsequent call re-attempts the load.
 */
export function loadZipBuilder(): Promise<ZipBuilder> {
  if (memo !== undefined) return memo;

  const attempt = (async (): Promise<ZipBuilder> => {
    const mod = await import(
      /* webpackChunkName: "lovers-zip" */ "./zip-builder.js"
    );
    return mod.buildPairZip;
  })();

  // Clear the memo on rejection so a retry re-attempts; keep it on success.
  memo = attempt.catch((err) => {
    if (memo === attempt) memo = undefined;
    throw err;
  });

  return memo;
}
