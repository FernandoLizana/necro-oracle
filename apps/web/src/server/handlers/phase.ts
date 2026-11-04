// apps/web/src/server/handlers/phase.ts
//
// The pure, monotonic phase reporter for the Reading_Route stream
// (design.md D14 "Phase reporting is pure and monotonic").
//
// A reading advances through a fixed, ordered set of phases:
//   PHASE_ORDER = ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"]
// `advancePhase` is a pure state transition over that order. It never mutates
// its input, only ever moves forward, and emits each phase exactly once. The
// `createPhaseReporter` wrapper holds the mutable cursor and writes one wire
// line per emitted phase (a PhaseLine) plus skip notes (a SkipNoteLine).
//
// _Requirements: R6.14, R6.15, R6.16, R6.20_

import type { ReadingPhase } from "@necro/ui-crt";

// NOTE: the validated NDJSON line schemas live in `../../protocol/stream.ts`
// (task 19.2), which is being built concurrently. To keep this module's
// isolated typecheck green before that sibling lands, we model the two line
// shapes the reporter writes structurally here. These are structurally
// compatible with the `PhaseLine` / `SkipNoteLine` the stream schema parses.
// TODO(task 19.2): replace these local types with
//   `import type { StreamLine } from "../../protocol/stream.js";`

/** The wire line emitted when a reading phase is first reported (design D13). */
export type PhaseLine = { readonly phase: ReadingPhase };

/** The wire line emitted when external enrichment is skipped (design D13). */
export type SkipNoteLine = { readonly skip: true; readonly note: string };

/** The subset of the NDJSON stream union this reporter can write. */
export type StreamLine = PhaseLine | SkipNoteLine;

/**
 * The fixed order a reading advances through. `state.reported` is always a
 * prefix of this tuple.
 */
export const PHASE_ORDER = ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"] as const;

/**
 * The monotonic phase cursor: the ordered prefix of PHASE_ORDER reported so
 * far. Immutable — `advancePhase` returns a fresh state rather than mutating.
 */
export type PhaseState = { readonly reported: readonly ReadingPhase[] };

/** The empty cursor: nothing reported yet. */
export function initialPhaseState(): PhaseState {
  return { reported: [] };
}

/**
 * Thrown when a phase is reported out of order (a skip-ahead, or any phase that
 * is neither already reported nor the single next unreported phase). This is an
 * internal invariant violation, not a user-facing error.
 */
export class PhaseOrderError extends Error {
  constructor(phase: ReadingPhase, expected: ReadingPhase | undefined) {
    const next = expected === undefined ? "no further phase" : `"${expected}"`;
    super(`out-of-order phase "${phase}": expected ${next}`);
    this.name = "PhaseOrderError";
  }
}

/**
 * Pure phase transition. Given the current cursor and a requested phase:
 *   - already reported   -> `{ state, emit: false }` (state unchanged);
 *   - exactly the next unreported phase -> advances the cursor, `emit: true`;
 *   - anything else (skip-ahead / out of order) -> throws `PhaseOrderError`.
 * Never mutates `state`; `reported` stays a prefix of PHASE_ORDER.
 */
export function advancePhase(
  state: PhaseState,
  phase: ReadingPhase,
): { state: PhaseState; emit: boolean } {
  if (state.reported.includes(phase)) {
    return { state, emit: false };
  }
  const next = PHASE_ORDER[state.reported.length] as ReadingPhase | undefined;
  if (phase !== next) {
    throw new PhaseOrderError(phase, next);
  }
  return { state: { reported: [...state.reported, phase] }, emit: true };
}

/** Writes progress lines for a single reading as it advances. */
export interface PhaseReporter {
  /** Report a phase; writes one PhaseLine the first time only. */
  report(phase: ReadingPhase): void;
  /** Write a single skip note (external enrichment skipped). */
  skipNote(note: string): void;
}

/**
 * Build a reporter over a `write` sink. Holds a private mutable `PhaseState`;
 * `report` advances it and writes exactly one `PhaseLine` the first time each
 * phase is reported (nothing on repeats); `skipNote` writes one `SkipNoteLine`.
 */
export function createPhaseReporter(
  write: (line: StreamLine) => void,
): PhaseReporter {
  let state = initialPhaseState();
  return {
    report(phase: ReadingPhase): void {
      const { state: nextState, emit } = advancePhase(state, phase);
      state = nextState;
      if (emit) write({ phase });
    },
    skipNote(note: string): void {
      write({ skip: true, note });
    },
  };
}
