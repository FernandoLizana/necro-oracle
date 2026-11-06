"use client";

// src/components/Screen.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The CRT screen chrome: it imports `crt.css`, wraps its children in the single
// `.crt-screen` scroll host, and renders the two aria-hidden effect layers
// (scanlines and flicker). The layers are CSS-only (no image, R9.8) and
// non-interactive. `Screen` holds no state; the live behaviour lives in
// `Terminal`.
//
// It also imports the additive Arcana_Visions stylesheet `arcana/arcana.css`
// (Spec 06, task 11) as a side effect, the same way it imports `crt.css`. Every
// Arcana_Visions surface (Spread_View, Fullscreen_Card_View, Necronomicon
// ritual, Seer landing) renders inside this shared `.crt` chrome, so bundling
// the pixel-card rules here guarantees they are present wherever a `.crt`
// screen is, without each new arcana component having to re-import the sheet.
// `arcana.css` only ADDS rules and rides the Spec 05 glitch contract; it never
// redefines a `crt.css` token or keyframe. Both are no-ops in the jsdom suites
// (vitest `css: false`); Next.js bundles them in production.
//
// _Requirements: R9.2, R9.3, R9.8, R15.11_

import "../crt.css";
import "../arcana/arcana.css";

/** Props for the screen chrome. */
export interface ScreenProps {
  /** The screen contents (log, command line, button row). */
  readonly children: React.ReactNode;
}

/** The CRT screen chrome with the scanline and flicker layers. */
export function Screen({ children }: ScreenProps): React.JSX.Element {
  return (
    <div className="crt-screen">
      {children}
      <div className="crt-layer crt-scanlines" aria-hidden="true" />
      <div className="crt-layer crt-flicker" aria-hidden="true" />
    </div>
  );
}
