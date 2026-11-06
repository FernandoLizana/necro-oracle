// apps/web/src/terminal/arcana-manifest.ts
//
// Feature: 06-arcana-visions, task 19 — the app-side entry point that supplies
// the trusted arcana manifest to the `@necro/ui-crt` `<Terminal>`.
//
// Dependency rules (structure steering): `@necro/ui-crt` must never import the
// app's `public/` files, so the JSON import lives HERE, in `apps/web`, and the
// trusted `id -> ArcanaAsset` map is threaded down through `TerminalScreen`
// into `<Terminal manifest=...>`. The committed manifest at
// `apps/web/public/arcana/manifest.json` is imported as static data at build
// time (no network, R3.1) and validated at the boundary by the pure
// `loadManifest` (zod), which discards every generator bookkeeping field and
// keeps only the id, logical size and text bands each pixel card needs.
//
// The load runs once at module evaluation. A malformed manifest would throw a
// typed `NecroError` from `loadManifest`; that is the correct boundary
// behaviour, but to keep the Terminal_Route resilient (a corrupt manifest must
// never blank the terminal) we fall back to an empty map, which makes the
// Terminal render the Spec 05 ASCII spread exactly as if no manifest were
// supplied (the `<Terminal>` default). The failure is surfaced once as a
// dev-time console warning, never a user-visible terminal message.

import { loadManifest, type ArcanaAsset } from "@necro/ui-crt";

import manifestJson from "../../public/arcana/manifest.json" with { type: "json" };

/** The empty map used when the committed manifest cannot be trusted. */
const EMPTY: ReadonlyMap<string, ArcanaAsset> = new Map();

/**
 * The trusted arcana asset map the Terminal_Route hands to `<Terminal>`. Built
 * once from the committed JSON; an invalid manifest degrades to an empty map so
 * the terminal falls back to the ASCII spread rather than failing to render.
 */
export const ARCANA_MANIFEST: ReadonlyMap<string, ArcanaAsset> = (() => {
  try {
    return loadManifest(manifestJson);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[arcana] committed manifest failed validation; falling back to the ASCII spread.",
        error,
      );
    }
    return EMPTY;
  }
})();
