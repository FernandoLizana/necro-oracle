// src/components/HudBar.tsx
//
// Feature: oracle-landing-polish, task 8.1.
//
// The screen-only DMG HUD bar at the top of the Landing_State (design
// §"Component: HudBar + HintBar"). It renders three fixed pieces of chrome as
// plain DOM text so a screen reader reads them: the `NECRO-ORACLE` label, a
// SOUL hearts row, and `PY2 CURSE: ACTIVE`.
//
// The individual heart glyphs are decorative (`aria-hidden`); the hearts row
// carries ONE text accessible label stating the soul status so assistive
// technology hears "SOUL: N of N" once rather than a run of filled-heart
// glyphs (R3.3). The view-model is built by `hudModel(state)` in
// `landing/landing-model.ts`; this component only renders it.
//
// This is a screen only: no ports, no data fetching, no clock. All text is
// ASCII/printable except the decorative heart glyph, which is aria-hidden and
// backed by the plain-text accessible label.
//
// _Requirements: R3.1, R3.2, R3.3, R3.4_

import type { HudModel } from "../landing/landing-model.js";

/** Props for the HUD bar (design §"Component: HudBar + HintBar"). */
export interface HudBarProps {
  /** The fixed HUD view-model from `hudModel(state)`. */
  readonly model: HudModel;
}

/** The filled SOUL heart glyph (decorative; aria-hidden). */
const HEART_GLYPH = "\u2665"; // ♥

/** The screen-only DMG HUD bar: label, SOUL hearts, PY2 curse. */
export function HudBar({ model }: HudBarProps): React.JSX.Element {
  const { label, soulHearts, py2Curse } = model;
  const soulLabel = `SOUL: ${soulHearts} of ${soulHearts}`;

  return (
    <div
      className="crt-landing-panel crt-landing-hud"
      role="group"
      aria-label="Oracle status"
    >
      <span className="crt-landing-hud-label">{label}</span>
      <span className="crt-landing-hud-hearts" role="img" aria-label={soulLabel}>
        {Array.from({ length: soulHearts }, (_, i) => (
          <span key={i} aria-hidden="true">
            {HEART_GLYPH}
          </span>
        ))}
      </span>
      <span className="crt-landing-hud-curse">{`PY2 CURSE: ${py2Curse}`}</span>
    </div>
  );
}
