"use client";

// apps/web/src/components/LoversView.tsx
//
// Feature: lovers-binding, task 12.2 — the real DMG Lovers split view (design
// C.6 "DMG Lovers view + viewport fit + overflow policy"; R21.1–R21.6, R22.1).
//
// The lazy-load seam `../terminal/load-lovers-view.ts` imports this module
// through a literal-path dynamic import so the bundler emits it as its own
// chunk, named `lovers-view` by that seam's `webpackChunkName` magic comment —
// so the whole split view (the pixel ritual, the three code panes, and the
// scoped stylesheet) stays off the initial terminal route (R31.1). The ZIP
// builder it reaches on "Download pair" is ITSELF a further distinct lazy chunk
// loaded through `../terminal/load-zip-builder.ts` (task 12.1), so the ZIP
// machinery is fetched only when a user actually downloads.
//
// What it renders (design C.6):
//   1. A short DMG pixel ritual: two pixel hearts stitched by a seam. The seam
//      shimmer animates ONLY inside a Motion_Zone (`data-motion="full"`); under
//      reduced motion / motion off there is NO running animation (R21.1). The
//      gating lives entirely in `lovers-view.css`, keyed off the ancestor
//      `.crt[data-motion=...]` attribute the `<Terminal>` root owns — exactly
//      the oracle-landing-polish / arcana Motion_Zone pattern.
//   2. A split view: the Python heart on the LEFT, the contract in the CENTER,
//      the JavaScript beloved on the RIGHT, each rendered from `result.pair`,
//      with the code rising line by line under full motion (R21.2).
//   3. A "Download pair" action (R22.1) that lazily loads the client-side ZIP
//      builder, builds a Blob from `result.pair`, and triggers a browser
//      download (Blob -> object URL -> anchor click), all CLIENT-SIDE.
//   4. The path used ("llm" vs "template") and the "souls spent"
//      (`result.soulsSpent` tokens + cost) in oracle voice, attributed to
//      `result.soulSource`.
//
// Strict 4-shade DMG palette, the bundled VT323 bitmap font, integer scaling,
// and the no-page-scroll viewport-fit overflow policy all live in the scoped
// `lovers-view.css` imported below (R21.3, R21.4, R21.5, R21.6).
//
// Client boundary (R16.4): this file imports only a TYPE from `@necro/coven`
// (`LoversResult`, erased at build time, so no adapter / `node:*` / oracle main
// entry reaches the browser bundle), React, and two sibling browser-safe
// terminal seams (`load-zip-builder`, which lazily loads the client ZIP
// builder). It performs no server round-trip and uses only the standard `Blob`,
// `URL`, and DOM constructors — no `eval` / `new Function` / non-literal import.
//
// _Requirements: R21.1, R21.2, R21.3, R21.4, R21.5, R21.6, R22.1, R31.1_

import { useId, useState } from "react";

import type { LoversResult } from "@necro/coven";

import { loadZipBuilder } from "../terminal/load-zip-builder.js";
import "./lovers-view.css";

/** Props for the DMG Lovers split view. */
export interface LoversViewProps {
  /** The completed, redaction-safe Lovers result to render. */
  readonly result: LoversResult;
}

/** The decorative pixel-heart glyph used in the ritual (aria-hidden). */
const HEART_GLYPH = "\u2665"; // ♥

/**
 * The per-pane stagger (ms) between successive rising code lines under full
 * motion. Small so even a long pane finishes its reveal quickly; the reveal
 * plays ONCE (not looping) and is fully disabled under reduced motion (R21.1).
 */
const RISE_STEP_MS = 24;

/** Cap on the staggered rise delay so a very long pane does not crawl in. */
const MAX_RISE_LINES = 40;

/** The oracle-voice download states shown beside the control (R22.1). */
type DownloadState =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string };

/**
 * Format the "souls spent" aggregate in oracle voice (two layers: a short
 * mystical line is rendered separately; this is the plain technical fact). The
 * cost is shown to 4 decimal places in USD; tokens are the summed prompt +
 * completion counts. Attributed to the `soulSource` that paid.
 */
function soulsSpentFact(result: LoversResult): string {
  const { promptTokens, completionTokens, costUsd } = result.soulsSpent;
  const totalTokens = promptTokens + completionTokens;
  const whose = result.soulSource === "YOURS" ? "your key" : "the oracle's key";
  const cost = `$${costUsd.toFixed(4)}`;
  // The path the accepted pair came from: the LLM, or the deterministic bridge.
  const pathWord = result.path === "llm" ? "the living tongue (LLM)" : "the old rite (template)";
  return `Souls spent on ${whose}: ${totalTokens} tokens, ${cost}; bound via ${pathWord}.`;
}

/**
 * Split a code artifact into its lines for the rising reveal (R21.2). A final
 * empty line from a trailing newline is dropped so the last visible line is
 * real code. Always returns at least one (possibly empty) line so the pane body
 * is never a zero-child element.
 */
function toLines(code: string): readonly string[] {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length > 0 ? lines : [""];
}

/**
 * One code pane: a titled, integer-scaled box whose body scrolls INTERNALLY
 * (R21.6) and whose lines rise one by one under full motion (R21.2). The
 * `<pre>` is a labelled region with the pane title as its accessible name.
 */
function CodePane({
  title,
  code,
  side,
}: {
  readonly title: string;
  readonly code: string;
  readonly side: "python" | "contract" | "javascript";
}): React.JSX.Element {
  const titleId = useId();
  const lines = toLines(code);
  return (
    <section className="crt-lovers-pane" data-side={side} aria-labelledby={titleId}>
      <h3 id={titleId} className="crt-lovers-pane-title">
        {title}
      </h3>
      <pre className="crt-lovers-panel crt-lovers-code" tabIndex={0}>
        {lines.map((line, index) => (
          <span
            key={index}
            className="crt-lovers-line"
            // Stagger the rise under full motion; capped so a long pane finishes
            // quickly. The CSS disables the animation entirely under reduced
            // motion, so this delay is inert there (R21.1).
            style={{
              ["--lov-rise-delay" as string]: `${Math.min(index, MAX_RISE_LINES) * RISE_STEP_MS}ms`,
            }}
          >
            {line === "" ? "\u00A0" : line}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}

/**
 * The real DMG Lovers split view. Renders the pixel-heart ritual, the
 * Python / contract / JavaScript split, the souls-spent + path attribution in
 * oracle voice, and the client-side "Download pair" affordance.
 */
export function LoversView({ result }: LoversViewProps): React.JSX.Element {
  const [download, setDownload] = useState<DownloadState>({ kind: "idle" });

  const onDownload = async (): Promise<void> => {
    // Guard against a double click while a build is already in flight.
    if (download.kind === "working") return;
    setDownload({ kind: "working" });
    try {
      // Lazily load the client-side ZIP builder from its own chunk (task 12.1
      // seam), then assemble the ZIP entirely in the browser (R22.1).
      const buildPairZip = await loadZipBuilder();
      const blob = await buildPairZip(result.pair);

      // Blob -> object URL -> anchor click: a pure client-side download, no
      // server round-trip. The anchor is appended + removed around the click
      // for Firefox, and the object URL is revoked afterwards to release it.
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${zipStem(result.file)}.zip`;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } finally {
        URL.revokeObjectURL(url);
      }
      setDownload({ kind: "done" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setDownload({ kind: "error", message });
    }
  };

  const soulsFact = soulsSpentFact(result);

  return (
    // A sectioning element (not a bare `div[role=region]`): a named <section>
    // is exposed as a region landmark AND scopes the <header> below so it is
    // the section's header, not the page `banner` (a <header> inside generic
    // content would be a top-level banner, which axe forbids nested in another
    // landmark — landmark-banner-is-top-level).
    <section className="crt-lovers" aria-label="The Lovers binding">
      {/* Header: the oracle-voice verdict + the souls-spent / path fact. */}
      <header className="crt-lovers-header crt-lovers-panel">
        <p className="crt-lovers-mystical">
          THE LOVERS. Two hearts, one contract, bound across the seam.
        </p>
        <p className="crt-lovers-technical">
          {`Python heart bound to a JavaScript beloved through a JSON contract (${result.plan.functions.length} function(s)).`}
        </p>
        <p className="crt-lovers-souls" role="status">
          {soulsFact}
        </p>
      </header>

      {/* The pixel ritual: two hearts stitched by a seam (R21.1). The seam
          shimmer animates only inside the Motion_Zone; the whole ritual is
          decorative, so it is aria-hidden and the binding is conveyed by the
          header and the panes' text. */}
      <div className="crt-lovers-ritual" aria-hidden="true">
        <span className="crt-lovers-heart crt-lovers-heart-py">{HEART_GLYPH}</span>
        <span className="crt-lovers-seam" />
        <span className="crt-lovers-heart crt-lovers-heart-js">{HEART_GLYPH}</span>
      </div>

      {/* The split view: Python left / contract center / JavaScript right
          (R21.2). Each pane scrolls internally (R21.6). */}
      <div className="crt-lovers-split">
        <CodePane title="PYTHON HEART" code={result.pair.pythonHeart} side="python" />
        <CodePane title="CONTRACT" code={result.pair.contractSchema} side="contract" />
        <CodePane title="JS BELOVED" code={result.pair.jsBeloved} side="javascript" />
      </div>

      {/* The "Download pair" action (R22.1): client-side ZIP + anchor download. */}
      <div className="crt-lovers-actions">
        <button
          type="button"
          className="crt-lovers-download"
          onClick={() => {
            void onDownload();
          }}
          disabled={download.kind === "working"}
          aria-label="Download the bound pair as a ZIP"
        >
          {download.kind === "working" ? "BINDING THE SCROLLS…" : "DOWNLOAD PAIR"}
        </button>
        <p className="crt-lovers-download-status" role="status" aria-live="polite">
          {downloadStatusText(download)}
        </p>
      </div>
    </section>
  );
}

/**
 * The oracle-voice line shown beside the download control for each state. Idle
 * is empty so the control reads cleanly before any attempt.
 */
function downloadStatusText(state: DownloadState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "working":
      return "The scrolls are being sealed in your hands.";
    case "done":
      return "The pair is yours. Run python/ and js/ together; the contract/ binds them.";
    case "error":
      return `The binding slipped from the circle. (${state.message})`;
  }
}

/**
 * Derive a safe ZIP filename stem from the bound file path. The repo-relative
 * path is reduced to ASCII `[A-Za-z0-9._-]`, collapsing every other run to a
 * single `-`, so a slash or path-hostile character can never leak into the
 * suggested name. An empty / all-stripped path falls back to `lovers-pair`.
 */
function zipStem(file: string): string {
  const stem = file
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem.length > 0 ? `lovers-${stem}` : "lovers-pair";
}
