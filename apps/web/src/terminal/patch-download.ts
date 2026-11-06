// apps/web/src/terminal/patch-download.ts
//
// Feature: resurrection-engine, task 14.7 — offer the unified Patch of a
// completed Ritual as a client-side download (design: "Diff and Patch",
// "Browser/terminal rendering"; R7.3, R7.4).
//
// A completed `RitualResult` carries the whole unified diff inline as
// `patch: string` (empty string when nothing changed, R7.4). This module turns
// that string into a downloadable `.patch` artifact entirely in the browser —
// no server round-trip (R7.3) — by wrapping it in a `Blob` with the
// `text/x-patch` mime and handing the user an object-URL they can save.
//
// The work is split in two so task 14.8's unit test can drive it with injected
// DOM / URL mocks instead of real browser globals:
//
//   - `buildPatchDownload(patch, ref, urlApi)` is the pure-ish BUILDER. Given
//     the patch text, a repo reference (for the filename) and a `UrlApi`
//     (defaulting to the global `URL`), it returns the `{ blob, url, filename }`
//     artifact — or `null` for an empty patch, so an empty Ritual offers no
//     download rather than a zero-byte file (R7.4). It never throws and never
//     touches the DOM.
//   - `triggerPatchDownload(artifact, doc, urlApi)` is the side-effecting
//     TRIGGER. It creates an anchor, clicks it, and revokes the object URL,
//     reaching the DOM only through the injected `document` so the trigger can
//     be exercised without a real one.
//
// Client boundary (R16.4): this module imports only `@necro/ui-crt` types and
// touches no `@necro/github`, `@necro/coven`, the oracle main entry, or
// `node:*`. It uses only the standard `Blob`, `URL` and DOM constructors, with
// no `eval` / `new Function` / non-literal dynamic import.
//
// _Requirements: R7.3, R7.4_

import type { RitualResponse } from "@necro/ui-crt";

/** The IANA media type for a unified diff / patch artifact. */
export const PATCH_MIME = "text/x-patch";

/** The filename extension used for the downloadable patch artifact. */
export const PATCH_EXTENSION = "patch";

/**
 * The slice of the browser `URL` API the builder and trigger depend on. Pulled
 * out as an interface so a unit test can inject a mock that records the created
 * / revoked object URLs without a real browser (task 14.8).
 */
export interface UrlApi {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

/** The slice of `document` the trigger needs: create an anchor and host it. */
export interface DownloadDocument {
  readonly createElement: (tagName: "a") => HTMLAnchorElement;
  readonly body: Pick<HTMLElement, "appendChild" | "removeChild">;
}

/** A built, ready-to-save patch artifact. */
export interface PatchDownload {
  /** The patch bytes wrapped as a `text/x-patch` Blob. */
  readonly blob: Blob;
  /** An object URL for the blob; the caller must revoke it after use. */
  readonly url: string;
  /** The suggested download filename, e.g. `necro-<ritual>.patch`. */
  readonly filename: string;
}

/**
 * Resolve the global `URL` as a `UrlApi`, used as the default when no explicit
 * API is injected. Kept behind a function so merely importing this module never
 * dereferences `URL` at module scope (the trigger runs only in the browser).
 */
function globalUrlApi(): UrlApi {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * Derive a safe, stable download filename from a repo reference. The ref
 * (`owner/name@sha`) is reduced to ASCII `[A-Za-z0-9._-]`, collapsing every
 * other run to a single `-`, so a slash, `@`, or other path-hostile character
 * can never leak into the suggested name. An empty or all-stripped ref falls
 * back to a fixed `necro` stem, yielding `necro.patch`. The result always ends
 * in `.patch` and never contains a path separator.
 */
export function patchFilename(ref: string): string {
  const stem = ref
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const base = stem.length > 0 ? stem : "necro";
  return `${base}.${PATCH_EXTENSION}`;
}

/**
 * Build a downloadable patch artifact from a patch string and a repo reference.
 *
 * Returns `null` for an empty patch (nothing changed, R7.4) so the caller can
 * omit / disable the download affordance rather than offer a zero-byte file;
 * returns `{ blob, url, filename }` otherwise. Pure apart from the single
 * `createObjectURL` call on the injected (or global) `UrlApi`; never throws and
 * never reaches the DOM.
 *
 * @param patch  the unified diff text (`RitualResult.patch`)
 * @param ref    the repo reference, used only to name the file
 * @param urlApi the URL API to create the object URL with (defaults to global)
 */
export function buildPatchDownload(
  patch: string,
  ref: string,
  urlApi: UrlApi = globalUrlApi(),
): PatchDownload | null {
  // An empty patch means the Ritual changed nothing (R7.4): offer no download
  // rather than a valid-but-empty artifact, and never throw.
  if (patch.length === 0) {
    return null;
  }
  const blob = new Blob([patch], { type: PATCH_MIME });
  const url = urlApi.createObjectURL(blob);
  return { blob, url, filename: patchFilename(ref) };
}

/**
 * Build the patch download for a whole `RitualResult`, naming the file from the
 * Ritual id (always present, URL-safe) so the artifact is identifiable even
 * without the repo ref in scope. Returns `null` on an empty patch (R7.4).
 */
export function buildRitualPatchDownload(
  result: Pick<RitualResponse, "patch" | "ritualId">,
  urlApi: UrlApi = globalUrlApi(),
): PatchDownload | null {
  return buildPatchDownload(result.patch, result.ritualId, urlApi);
}

/**
 * Trigger a browser download of a built patch artifact with no server
 * round-trip (R7.3): create an anchor pointing at the object URL, set its
 * `download` to the suggested filename, click it, detach it, and revoke the
 * object URL so the blob is released. The DOM and URL are reached only through
 * the injected `document` / `urlApi`, so task 14.8 can drive this with mocks.
 *
 * The anchor is appended and removed around the click for Firefox, which only
 * honours a programmatic click on a connected anchor. The object URL is revoked
 * in a `finally` so a click that throws still releases the blob.
 */
export function triggerPatchDownload(
  artifact: PatchDownload,
  doc: DownloadDocument,
  urlApi: UrlApi = globalUrlApi(),
): void {
  const anchor = doc.createElement("a");
  anchor.href = artifact.url;
  anchor.download = artifact.filename;
  anchor.rel = "noopener";
  doc.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    doc.body.removeChild(anchor);
    urlApi.revokeObjectURL(artifact.url);
  }
}

/**
 * Convenience one-shot used by the terminal download affordance: build the
 * artifact for a `RitualResult` and, if there is a non-empty patch, immediately
 * trigger its download. Returns `true` when a download was triggered and
 * `false` when there was nothing to download (empty patch, R7.4). Defaults to
 * the real `document` / `URL`, resolved lazily so importing this module touches
 * no browser global.
 */
export function downloadRitualPatch(
  result: Pick<RitualResponse, "patch" | "ritualId">,
  doc: DownloadDocument = document,
  urlApi: UrlApi = globalUrlApi(),
): boolean {
  const artifact = buildRitualPatchDownload(result, urlApi);
  if (artifact === null) {
    return false;
  }
  triggerPatchDownload(artifact, doc, urlApi);
  return true;
}
