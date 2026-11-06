// apps/web/src/terminal/patch-download.test.ts
//
// Feature: resurrection-engine, task 14.8.
//
// Unit tests for the client-side patch download builder/trigger in
// `./patch-download.ts` (task 14.7; design: "Diff and Patch",
// "Browser/terminal rendering"; R7.3, R7.4).
//
// Everything runs with INJECTED mocks and no real browser globals: a fake
// `UrlApi` records the `createObjectURL` / `revokeObjectURL` calls and a fake
// `DownloadDocument` hands out a stub anchor that records its `click()` and
// tracks append/remove from a fake body. There is NO real
// `URL.createObjectURL`, no real DOM mutation, and no network. `Blob` is a
// standard global (jsdom / Node) and is used verbatim so we can assert the
// artifact's mime and `.text()`.
//
// Coverage:
//   R7.3 — a non-empty patch builds a `text/x-patch` Blob whose text equals the
//          patch, a `.patch` filename derived from the ref/ritual id (sanitised
//          to [A-Za-z0-9._-], `necro.patch` fallback), and calls the injected
//          `createObjectURL`; the trigger makes an anchor with the right
//          href/download, clicks it, appends+removes it from the injected body,
//          and revokes the object URL; `downloadRitualPatch` returns `true`.
//   R7.4 — an empty patch makes `buildPatchDownload` / `buildRitualPatchDownload`
//          return `null`, `downloadRitualPatch` return `false` triggering
//          nothing, and never throws.
//
// _Requirements: R7.3, R7.4_

import type { RitualResponse } from "@necro/ui-crt";
import { describe, expect, it, vi } from "vitest";

import {
  buildPatchDownload,
  buildRitualPatchDownload,
  downloadRitualPatch,
  patchFilename,
  PATCH_EXTENSION,
  PATCH_MIME,
  triggerPatchDownload,
  type DownloadDocument,
  type PatchDownload,
  type UrlApi,
} from "./patch-download.js";

// --- fixtures --------------------------------------------------------------

/** A representative non-empty unified diff. */
const PATCH = [
  "--- a/necro.py",
  "+++ b/necro.py",
  "@@ -1,1 +1,1 @@",
  '-print "hi"',
  '+print("hi")',
  "",
].join("\n");

/** A repo reference the way the engine pins it: owner/name@sha. */
const REF = "octocat/hello-world@abc123";

/** A field-complete RitualResponse carrying a non-empty patch. */
function ritual(overrides: Partial<RitualResponse> = {}): RitualResponse {
  return {
    ritualId: "ritual-42",
    selectedCount: 1,
    files: [],
    patch: PATCH,
    beforeVitality: 10,
    afterVitality: 40,
    vitalityDelta: 30,
    changedCards: [],
    degraded: false,
    demo: false,
    ...overrides,
  };
}

// --- mocks -----------------------------------------------------------------

interface UrlApiMock extends UrlApi {
  readonly created: Blob[];
  readonly revoked: string[];
}

/**
 * A fake `UrlApi` that hands out predictable object URLs and records every
 * blob it was asked to wrap and every URL it was asked to revoke. No real
 * `URL.createObjectURL` is touched.
 */
function fakeUrlApi(): UrlApiMock {
  const created: Blob[] = [];
  const revoked: string[] = [];
  let n = 0;
  return {
    created,
    revoked,
    createObjectURL: vi.fn((blob: Blob) => {
      created.push(blob);
      n += 1;
      return `blob:mock/${n}`;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  };
}

interface StubAnchor {
  href: string;
  download: string;
  rel: string;
  readonly clicks: number;
  click: () => void;
}

interface DownloadDocumentMock extends DownloadDocument {
  readonly anchors: StubAnchor[];
  readonly appended: unknown[];
  readonly removed: unknown[];
}

/**
 * A fake `DownloadDocument` whose `createElement("a")` returns a stub anchor
 * recording its click count, and whose body records every append/remove. No
 * real DOM is mutated.
 */
function fakeDownloadDocument(): DownloadDocumentMock {
  const anchors: StubAnchor[] = [];
  const appended: unknown[] = [];
  const removed: unknown[] = [];
  return {
    anchors,
    appended,
    removed,
    createElement: vi.fn((tag: "a") => {
      expect(tag).toBe("a");
      let clicks = 0;
      const anchor = {
        href: "",
        download: "",
        rel: "",
        get clicks() {
          return clicks;
        },
        click: vi.fn(() => {
          clicks += 1;
        }),
      } as unknown as StubAnchor;
      anchors.push(anchor);
      // The trigger types this as HTMLAnchorElement; the stub carries the
      // three fields it actually touches plus click().
      return anchor as unknown as HTMLAnchorElement;
    }) as unknown as DownloadDocument["createElement"],
    body: {
      appendChild: vi.fn(<T>(node: T): T => {
        appended.push(node);
        return node;
      }) as unknown as HTMLElement["appendChild"],
      removeChild: vi.fn(<T>(node: T): T => {
        removed.push(node);
        return node;
      }) as unknown as HTMLElement["removeChild"],
    },
  };
}

// ===========================================================================
// buildPatchDownload / buildRitualPatchDownload — the BUILDER (R7.3, R7.4)
// ===========================================================================

describe("buildPatchDownload — non-empty patch (R7.3)", () => {
  it("wraps the patch in a text/x-patch Blob and calls the injected createObjectURL", async () => {
    const urlApi = fakeUrlApi();

    const artifact = buildPatchDownload(PATCH, REF, urlApi);

    expect(artifact).not.toBeNull();
    const built = artifact as PatchDownload;
    expect(built.blob).toBeInstanceOf(Blob);
    expect(built.blob.type).toBe(PATCH_MIME);
    expect(PATCH_MIME).toBe("text/x-patch");
    // The blob carries the patch bytes verbatim.
    expect(await built.blob.text()).toBe(PATCH);

    // The object URL came from the injected API, applied to that same blob.
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urlApi.created).toEqual([built.blob]);
    expect(built.url).toBe("blob:mock/1");
    // Nothing was revoked by the builder.
    expect(urlApi.revoked).toEqual([]);
  });

  it("derives a sanitised .patch filename from the ref", () => {
    const urlApi = fakeUrlApi();

    const built = buildPatchDownload(PATCH, REF, urlApi) as PatchDownload;

    expect(built.filename).toBe("octocat-hello-world-abc123.patch");
    expect(built.filename.endsWith(`.${PATCH_EXTENSION}`)).toBe(true);
    expect(PATCH_EXTENSION).toBe("patch");
    // No path separator can leak into the name.
    expect(built.filename).not.toContain("/");
    expect(built.filename).not.toContain("\\");
    // Only the allowed character class remains.
    expect(built.filename).toMatch(/^[A-Za-z0-9._-]+\.patch$/);
  });
});

describe("patchFilename — sanitisation and fallback (R7.3)", () => {
  it("collapses path-hostile characters to single dashes", () => {
    expect(patchFilename("a/b@c:d e")).toBe("a-b-c-d-e.patch");
  });

  it("falls back to necro.patch when the ref strips to nothing", () => {
    expect(patchFilename("")).toBe("necro.patch");
    expect(patchFilename("///@@@")).toBe("necro.patch");
    expect(patchFilename("   ")).toBe("necro.patch");
  });

  it("keeps already-safe characters intact", () => {
    expect(patchFilename("necro_1.2-3")).toBe("necro_1.2-3.patch");
  });
});

describe("buildRitualPatchDownload — names from the ritual id (R7.3)", () => {
  it("builds from RitualResponse.patch with a ritual-id filename", async () => {
    const urlApi = fakeUrlApi();

    const built = buildRitualPatchDownload(ritual(), urlApi) as PatchDownload;

    expect(built).not.toBeNull();
    expect(built.filename).toBe("ritual-42.patch");
    expect(built.blob.type).toBe(PATCH_MIME);
    expect(await built.blob.text()).toBe(PATCH);
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("the builder on an empty patch returns null and never throws (R7.4)", () => {
  it("buildPatchDownload('') -> null, no object URL created", () => {
    const urlApi = fakeUrlApi();

    const artifact = buildPatchDownload("", REF, urlApi);

    expect(artifact).toBeNull();
    expect(urlApi.createObjectURL).not.toHaveBeenCalled();
    expect(urlApi.revoked).toEqual([]);
  });

  it("buildRitualPatchDownload with an empty patch -> null", () => {
    const urlApi = fakeUrlApi();

    const artifact = buildRitualPatchDownload(ritual({ patch: "" }), urlApi);

    expect(artifact).toBeNull();
    expect(urlApi.createObjectURL).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// triggerPatchDownload — the side-effecting TRIGGER (R7.3)
// ===========================================================================

describe("triggerPatchDownload — anchor lifecycle (R7.3)", () => {
  it("creates an anchor with the right href/download, clicks it, appends+removes it, and revokes the URL", () => {
    const urlApi = fakeUrlApi();
    const doc = fakeDownloadDocument();
    const artifact: PatchDownload = {
      blob: new Blob([PATCH], { type: PATCH_MIME }),
      url: "blob:mock/7",
      filename: "octocat-hello-world-abc123.patch",
    };

    triggerPatchDownload(artifact, doc, urlApi);

    // Exactly one anchor, carrying the artifact's href + filename.
    expect(doc.createElement).toHaveBeenCalledTimes(1);
    expect(doc.anchors).toHaveLength(1);
    const anchor = doc.anchors[0]!;
    expect(anchor.href).toBe("blob:mock/7");
    expect(anchor.download).toBe("octocat-hello-world-abc123.patch");
    expect(anchor.clicks).toBe(1);

    // Appended then removed — the same anchor node, once each.
    expect(doc.appended).toEqual([anchor]);
    expect(doc.removed).toEqual([anchor]);

    // The object URL was revoked so the blob is released.
    expect(urlApi.revoked).toEqual(["blob:mock/7"]);
  });

  it("revokes the object URL and removes the anchor even when the click throws", () => {
    const urlApi = fakeUrlApi();
    const doc = fakeDownloadDocument();
    const artifact: PatchDownload = {
      blob: new Blob([PATCH], { type: PATCH_MIME }),
      url: "blob:mock/9",
      filename: "necro.patch",
    };
    // Make the created anchor's click throw.
    (doc.createElement as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (tag: "a") => {
        expect(tag).toBe("a");
        const anchor = {
          href: "",
          download: "",
          rel: "",
          clicks: 0,
          click: vi.fn(() => {
            throw new Error("click boom");
          }),
        } as unknown as StubAnchor;
        doc.anchors.push(anchor);
        return anchor as unknown as HTMLAnchorElement;
      },
    );

    expect(() => {
      triggerPatchDownload(artifact, doc, urlApi);
    }).toThrow("click boom");

    // finally-block cleanup still ran: anchor removed and URL revoked.
    expect(doc.removed).toEqual(doc.anchors);
    expect(urlApi.revoked).toEqual(["blob:mock/9"]);
  });
});

// ===========================================================================
// downloadRitualPatch — one-shot convenience (R7.3, R7.4)
// ===========================================================================

describe("downloadRitualPatch — triggers for a non-empty patch (R7.3)", () => {
  it("returns true and triggers a full anchor download", () => {
    const urlApi = fakeUrlApi();
    const doc = fakeDownloadDocument();

    const triggered = downloadRitualPatch(ritual(), doc, urlApi);

    expect(triggered).toBe(true);
    // A blob was created and an anchor clicked then revoked.
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1);
    expect(doc.anchors).toHaveLength(1);
    const anchor = doc.anchors[0]!;
    expect(anchor.clicks).toBe(1);
    expect(anchor.download).toBe("ritual-42.patch");
    expect(anchor.href).toBe("blob:mock/1");
    expect(doc.appended).toEqual([anchor]);
    expect(doc.removed).toEqual([anchor]);
    expect(urlApi.revoked).toEqual(["blob:mock/1"]);
  });
});

describe("downloadRitualPatch — empty patch triggers nothing (R7.4)", () => {
  it("returns false, creates no blob, touches no DOM, and never throws", () => {
    const urlApi = fakeUrlApi();
    const doc = fakeDownloadDocument();

    let triggered: boolean | undefined;
    expect(() => {
      triggered = downloadRitualPatch(ritual({ patch: "" }), doc, urlApi);
    }).not.toThrow();

    expect(triggered).toBe(false);
    expect(urlApi.createObjectURL).not.toHaveBeenCalled();
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();
    expect(doc.createElement).not.toHaveBeenCalled();
    expect(doc.anchors).toHaveLength(0);
    expect(doc.appended).toEqual([]);
    expect(doc.removed).toEqual([]);
  });
});
