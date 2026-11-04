// src/detectors/world.ts
//
// The World (XXI — Destiny After Resurrection).
//
// Unlike the eleven snapshot detectors, `computeWorldDraw` is NOT a standard
// Detector: it operates on a ritual `Verdict` plus a `vitalityDelta`, not on a
// RepoSnapshot + DetectorOpts. It produces the closing card of the destiny
// spread (or null when the body stays dead).
//
// Design API (design.md Components / R16.1):
//   computeWorldDraw(verdict: Verdict, vitalityDelta: number): CardDraw | null
//
// Rules (R16):
//   - R16.2: status "REVIVED"    → world draw, severity 2, orientation upright.
//   - R16.3: status "UNDEAD"     → world draw, severity 1, orientation reversed.
//   - R16.4: status "STILL_DEAD" → null (the spread assembler inserts the tower
//            draw as the closing card; that is the caller's concern, not here).
//   - R16.5: non-null draws surface the vitalityDelta value plus the passed and
//            failed gate ids from the verdict as evidence.
//
// Covers: R16.1, R16.2, R16.3, R16.4, R16.5

import type { CardDraw, Evidence, Verdict } from "../registry/schema.js";

/**
 * Render a gate-id list for an evidence detail. Returns "none" for an empty
 * list so the detail never degenerates into an empty fragment.
 */
function formatGates(gates: readonly string[]): string {
  return gates.length > 0 ? gates.join(", ") : "none";
}

export function computeWorldDraw(
  verdict: Verdict,
  vitalityDelta: number,
): CardDraw | null {
  // R16.4: a body that stays dead draws no World card; the destiny spread
  // assembler closes with the tower instead.
  if (verdict.status === "STILL_DEAD") {
    return null;
  }

  const revived = verdict.status === "REVIVED";

  // R16.5: the vitalityDelta value is surfaced verbatim so the UI and tests can
  // read the exact magnitude (positive, negative, or zero).
  const vitalityEvidence: Evidence = {
    kind: "vitality-delta",
    detail: `vitality changed by ${vitalityDelta}`,
    source: "sandbox",
  };

  // R16.5: both passed and failed gate ids appear in the evidence text.
  const gatesEvidence: Evidence = {
    kind: "verdict-gates",
    detail: `passed gates: ${formatGates(verdict.passedGates)}; failed gates: ${formatGates(
      verdict.failedGates,
    )}`,
    source: "sandbox",
  };

  const summary = revived
    ? `Resurrection complete: every gate held and vitality changed by ${vitalityDelta}.`
    : `Resurrection partial: the body walks undead with gaps remaining and vitality changed by ${vitalityDelta}.`;

  return {
    card: "world",
    // R16.2 / R16.3: REVIVED → sev 2 upright, UNDEAD → sev 1 reversed.
    severity: revived ? 2 : 1,
    orientation: revived ? "upright" : "reversed",
    evidence: [vitalityEvidence, gatesEvidence],
    summary,
    grimoires: [],
  };
}
