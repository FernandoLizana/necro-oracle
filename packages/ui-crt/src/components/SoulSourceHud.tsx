// src/components/SoulSourceHud.tsx
//
// Feature: lovers-binding, task 10.6.
//
// The screen-only Soul_Source HUD indicator (design §D.6, R24.4). It renders a
// single always-present HUD line stating the active Soul_Source —
// `SOUL SOURCE: ORACLE` or `SOUL SOURCE: YOURS` — driven purely by
// `SessionState.soulSource` through `soulSourceHudModel(state)`.
//
// R24.4 requires the MODE indicator (ORACLE vs YOURS) AND the souls-spent
// attribution for the active source. The souls-spent figure (tokens / cost)
// comes from the settled resurrection / lovers RESULT (`UsageAggregate`), which
// is not yet mirrored into ui-crt `SessionState`; so `model.soulsSpent` is
// `null` today and this component renders the MODE indicator alone. The
// `soulsSpent` path below is the documented rendering seam: when a live figure
// is wired into session state and surfaced by `soulSourceHudModel`, the cost /
// tokens render here attributed to the active mode with no further change.
//
// A11y (§D.6, tarot-ux): the indicator is an `aria-live="polite"` status so a
// screen reader announces a source change once; it carries ONE plain-text
// accessible line; it is authored entirely in the strict 4-shade DMG palette
// (`landing.css`, `var(--dmg-*)` only) so the terminal palette guard stays
// green, and its `--dmg-3`-on-`--dmg-0` text clears the 4.5:1 contrast floor.
// No key value is ever rendered — only the ORACLE / YOURS mode word.
//
// This is a screen only: no ports, no data fetching, no clock, no network.
//
// _Requirements: R24.4_
//
// _Design: D.6 HUD + a11y_

import type { SoulSourceHudModel } from "../landing/landing-model.js";

/** Props for the Soul_Source HUD indicator (design §D.6). */
export interface SoulSourceHudProps {
  /** The Soul_Source HUD view-model from `soulSourceHudModel(state)`. */
  readonly model: SoulSourceHudModel;
}

/** Format the souls-spent attribution line for the active source (seam). */
function soulsSpentLabel(model: SoulSourceHudModel): string | null {
  const spent = model.soulsSpent;
  if (spent === null) return null;
  // Display-only, redaction-safe: cost (4 dp) + total tokens, attributed to the
  // active mode. Never a key, never per-call detail.
  return `SOULS SPENT (${model.mode}): $${spent.costUsd.toFixed(4)} · ${spent.tokens} tok`;
}

/**
 * The screen-only Soul_Source HUD indicator: the MODE line (ORACLE / YOURS) and,
 * once wired, the souls-spent attribution for the active source. Always present
 * so the active source is visible throughout the session.
 */
export function SoulSourceHud({
  model,
}: SoulSourceHudProps): React.JSX.Element {
  const spentLabel = soulsSpentLabel(model);
  const accessibleName =
    spentLabel === null ? model.label : `${model.label}. ${spentLabel}`;

  return (
    <div
      className="crt-soul-source"
      role="status"
      aria-live="polite"
      aria-label={accessibleName}
    >
      <span className="crt-soul-source-label">{model.label}</span>
      {spentLabel !== null ? (
        <span className="crt-soul-source-spent">{spentLabel}</span>
      ) : null}
    </div>
  );
}
