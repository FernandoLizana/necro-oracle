// apps/web/src/terminal/zip-builder.ts
//
// Feature: lovers-binding, task 12.1 — STUB. The client-side ZIP builder for
// the Lovers "Download pair" affordance. The lazy-load seam
// `./load-zip-builder.ts` imports this module through a literal-path dynamic
// import so the bundler emits it as its own chunk, named `lovers-zip` by that
// seam's `webpackChunkName` magic comment — keeping the (heavier) ZIP
// machinery off the initial terminal route.
//
// The real builder (task 12.2 / the ZIP task) assembles the pair into a ZIP
// ENTIRELY IN THE BROWSER — no server round-trip — with the layout `python/`,
// `js/`, `contract/`, and a `README` carrying run instructions (design C.6;
// R22.1). This stub pins only the public signature
// `buildPairZip(pair): Promise<Blob>` so the seam resolves and typechecks; it
// MUST stay client-side (it never imports a server module, `@necro/github`,
// `@necro/coven` runtime, the oracle main entry, or `node:*`).
//
// TODO(task 12.2): implement the real client-side ZIP assembly (python/, js/,
// contract/, README) and remove the placeholder body below.
//
// _Requirements: R22.1, R31.1_

import type { LoversPair } from "@necro/coven";

/** The IANA media type for a ZIP artifact. */
export const ZIP_MIME = "application/zip";

/**
 * Build a downloadable ZIP of a Lovers pair CLIENT-SIDE (design C.6; R22.1).
 *
 * STUB: task 12.2 replaces this body with the real in-browser ZIP assembly
 * (layout `python/`, `js/`, `contract/`, and a `README`). The signature
 * `buildPairZip(pair): Promise<Blob>` is the stable contract the lazy seam
 * (`./load-zip-builder.ts`) loads and that task 12.2 fills in.
 */
export async function buildPairZip(_pair: LoversPair): Promise<Blob> {
  // Placeholder marker text ("buildPairZip") keeps this chunk content-detectable
  // by the budget gate's fallback scan until task 12.2 lands the real builder.
  return new Blob(["buildPairZip: not yet implemented (task 12.2)"], {
    type: ZIP_MIME,
  });
}
