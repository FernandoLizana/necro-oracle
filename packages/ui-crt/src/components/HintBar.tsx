// src/components/HintBar.tsx
//
// Feature: oracle-landing-polish, task 8.1.
//
// The screen-only DMG hint bar at the bottom of the Landing_State (design
// §"Component: HudBar + HintBar"). It renders the fixed key-binding hint strip
// `▲▼ SELECT  A:SUMMON  B:DEMO  START:HELP` as plain DOM text (R7.1). The
// arrows and letters are purely decorative labels for the real key bindings,
// which live in the pure `landingKeyAction` handler — this component owns no
// behaviour, only the hint text.
//
// This is a screen only: no ports, no data fetching, no clock.
//
// _Requirements: R7.1_

/** The exact DMG hint strip text (R7.1). */
export const HINT_BAR_TEXT = "\u25b2\u25bc SELECT  A:SUMMON  B:DEMO  START:HELP";

/** The screen-only DMG hint bar. */
export function HintBar(): React.JSX.Element {
  return <div className="crt-landing-panel crt-landing-hint">{HINT_BAR_TEXT}</div>;
}
