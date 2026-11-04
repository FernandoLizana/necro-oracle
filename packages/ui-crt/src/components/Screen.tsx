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
// _Requirements: R9.2, R9.3, R9.8, R15.11_

import "../crt.css";

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
