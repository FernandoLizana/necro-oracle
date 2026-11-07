// src/landing/landing-model.ts
//
// Feature: oracle-landing-polish, task 5.1.
//
// The pure visibility predicate and the HUD / preview view-models for the DMG
// Landing_State (design.md §"Pure module: landing visibility + HUD/preview
// model"). `landingVisible` is the single predicate that gates the whole
// Landing region; `hudModel` and `previewModel` distil the session + selection
// into the small, fixed shapes the screen-only `HudBar` / `PreviewWindow`
// components render.
//
// Everything here is total and pure: no clock, DOM, network, audio or storage.
// Degenerate inputs clamp or fall through rather than throwing.

import type { SessionState, SoulSource } from "../session/state.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import type { LandingRow } from "./repos.js";

/**
 * The one predicate that gates the whole Landing region (R1.1, R1.5). The
 * landing shows only on the fresh, post-boot, pre-command idle screen: it has
 * not been dismissed by a command, the boot sequence has finished, and no
 * command output or summon summary exists yet.
 *
 * The boot banner block (`kind: "boot"`) that `stepBoot` always appends as the
 * first Output_Block (R1.2) does NOT count as command output for this gate.
 * On the normal post-boot idle screen the boot banner is the only block, so a
 * log consisting solely of boot-kind blocks is treated as empty here — that is
 * the state the design's state machine calls "boot settles (log empty, no
 * summary)". Any non-boot block (echo/oracle/status/error, e.g. the "screen
 * cleared" status block left by `clear`) is real command output and hides the
 * landing. After `home` the log is literally empty, which also satisfies this.
 */
export function landingVisible(state: SessionState): boolean {
  return (
    !state.landingDismissed &&
    state.boot.phase === "done" &&
    state.log.every((b) => b.kind === "boot") &&
    state.summary === null
  );
}

/**
 * The fixed number of filled SOUL hearts shown in the HUD. The design leaves
 * the exact count open (1..5, "full"); a stable constant keeps the HUD purely
 * decorative chrome rather than a live gauge.
 */
export const SOUL_HEARTS = 3;

/** The HUD model: fixed label, SOUL hearts (full), PY2 curse active. */
export interface HudModel {
  readonly label: "NECRO-ORACLE";
  /** Count of filled hearts shown (fixed, 1..5). */
  readonly soulHearts: number;
  readonly py2Curse: "ACTIVE";
}

/**
 * Build the HUD view-model (R3.1, R3.2, R3.4). Total and constant: the HUD is
 * fixed decorative chrome — the label, a fixed full SOUL row, and the PY2 curse
 * marker — so every session yields the same model.
 */
export function hudModel(_state: SessionState): HudModel {
  return { label: "NECRO-ORACLE", soulHearts: SOUL_HEARTS, py2Curse: "ACTIVE" };
}

/**
 * The Soul_Source_HUD view-model (lovers-binding R24.4, design §D.6). It distils
 * the session's `soulSource` into the fixed HUD line text and the active-source
 * attribution the screen-only `SoulSourceHud` renders.
 *
 * `mode` is the required MODE indicator (R24.4): `ORACLE` vs `YOURS`, driven
 * purely by `state.soulSource`. `label` is the accessible, human-readable HUD
 * text (`SOUL SOURCE: ORACLE` / `SOUL SOURCE: YOURS`).
 *
 * `soulsSpent` is the souls-spent (tokens / cost) attribution for the ACTIVE
 * source. The resurrection / lovers RESULT carries the real `soulsSpent`
 * `UsageAggregate` (coven `RitualResult` / `LoversResult`), but that live number
 * is not yet mirrored into ui-crt `SessionState` — so this field is `null`
 * today and the HUD renders the MODE indicator alone (which R24.4 requires).
 * The field is the documented SEAM: once a `{ costUsd, tokens }` figure is
 * threaded into session state (e.g. an additive `lastSouls` slice fed from the
 * settled ritual/lovers result), this model surfaces it attributed to `mode`
 * and the HUD shows it with zero further component changes.
 */
export interface SoulSourceHudModel {
  /** The required MODE indicator (R24.4): the active Soul_Source. */
  readonly mode: SoulSource;
  /** The accessible HUD line text (`SOUL SOURCE: ORACLE` / `... YOURS`). */
  readonly label: `SOUL SOURCE: ${SoulSource}`;
  /**
   * The souls-spent attribution for the active source, or `null` when no live
   * figure is wired into session state yet (the documented seam above). When
   * present it is already attributed to `mode`.
   */
  readonly soulsSpent: SoulsSpent | null;
}

/**
 * The souls-spent figure the HUD attributes to the active Soul_Source (the
 * documented seam target). A redaction-safe, display-only pair: the US-dollar
 * cost and the total tokens for the active source's reading. Mirrors the
 * coven `UsageAggregate` fields the HUD would show, restated here as a plain
 * browser-safe type so `@necro/ui-crt` keeps no `@necro/coven` dependency.
 */
export interface SoulsSpent {
  /** Total US-dollar cost spent on the active source for this reading. */
  readonly costUsd: number;
  /** Total tokens (prompt + completion) spent on the active source. */
  readonly tokens: number;
}

/**
 * Build the Soul_Source_HUD view-model (R24.4, §D.6). Total and pure: the MODE
 * indicator is driven entirely by `state.soulSource`; `soulsSpent` is `null`
 * until a live figure is wired into session state (the documented seam on
 * `SoulSourceHudModel`). The returned `label` is the exact accessible HUD text.
 */
export function soulSourceHudModel(state: SessionState): SoulSourceHudModel {
  const mode = state.soulSource;
  return {
    mode,
    label: `SOUL SOURCE: ${mode}`,
    soulsSpent: null,
  };
}

/**
 * The oracle-voice ORACLE SAYS line shown while the ENTER row is selected: the
 * prompt to summon any repository through the NECRO> input. Oracle voice,
 * <= 72 columns, ASCII-only, no emoji.
 */
export const ENTER_ORACLE_SAYS = "Name any corpse and I shall summon it.";

/** The number of face-down card backs shown in the preview (eye/moon sigil). */
export const PREVIEW_CARD_BACKS = 3;

/** The preview model for the currently selected row. */
export interface PreviewModel {
  /** Whether the Seer portrait can be shown (manifest carries "seer"). */
  readonly showSeer: boolean;
  /** Three face-down backs (eye/moon sigil). */
  readonly cardBacks: 3;
  /** The selected repo's ORACLE SAYS line, or the ENTER prompt line. */
  readonly oracleSays: string;
}

/**
 * Build the preview view-model for the currently selected row (R6.1, R6.2,
 * R6.4). `showSeer` is driven purely by the manifest (`manifest.has("seer")`),
 * independent of boot phase; there are always three card backs; the ORACLE
 * SAYS line is the selected repo's authored line, or the ENTER prompt line for
 * the ENTER row. Total: both row kinds map to a defined line.
 */
export function previewModel(
  _state: SessionState,
  selected: LandingRow,
  manifest: ReadonlyMap<string, ArcanaAsset>,
): PreviewModel {
  const oracleSays =
    selected.kind === "repo" ? selected.repo.oracleSays : ENTER_ORACLE_SAYS;
  return {
    showSeer: manifest.has("seer"),
    cardBacks: PREVIEW_CARD_BACKS,
    oracleSays,
  };
}
