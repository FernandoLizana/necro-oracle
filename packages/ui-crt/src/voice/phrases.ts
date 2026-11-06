// @necro/ui-crt — fixed Oracle_Voice copy the terminal prints outside a card
// reading: the boot and pre-reading banners, the demo-replay label, the
// per-phase progress copy, the external-skip note and the vitality bands.
//
// Everything here is static, pure Oracle_Voice: mystical lines are ≤ 16 words
// and ≤ 72 columns, phase and skip copy carry a second technical line, there
// are no emoji, and `vitalityVoice` is a pure function of the score alone.
//
// The fixed phrases are copied verbatim from the `oracle-voice` steering
// "Fixed phrases" so the terminal boots in the canonical voice (R7.3). The
// phase copy gives each Reading_Phase its Progress_Line (R6.15); the skip note
// is the two-layer line shown when external enrichment is skipped (R6.21); the
// vitality bands narrate the 0–100 health score (R7.3, R7.4).
//
// _Requirements: R7.3, R7.4, R6.15, R6.21_

import type { ReadingPhase, ResurrectionPhase } from "../protocol.js";

/** The canonical boot banner (oracle-voice Fixed phrases). */
export const BOOT_PHRASE =
  "NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP";

/** The canonical line printed just before a reading begins. */
export const PRE_READING_PHRASE = "Shuffle. Cut. The repository speaks.";

/** The canonical line printed just before a resurrection ritual begins (R1.1). */
export const PRE_RESURRECTION_PHRASE =
  "The coven gathers. The dead code is called back to life.";

/**
 * Banner marking a reading replayed from the demo bundle rather than summoned
 * live, so judges can tell a fixture replay apart from a fresh ritual (R18.5).
 */
export const DEMO_LABEL = "DEMO REPLAY · a recorded reading, no live summon.";

/**
 * A two-layer Progress_Line: the mystical half the terminal glows and the
 * technical half that names the work. The technical line carries the phase
 * token verbatim so the client can key the progress display off it.
 */
export interface PhaseVoice {
  readonly mystical: string;
  readonly technical: string;
}

/**
 * One Progress_Line per Reading_Phase (R6.15). The key set is exactly the four
 * ordered phases; each technical line contains its own phase token (e.g.
 * "SUMMON") so a missing or renamed phase is caught by the example test.
 */
export const PHASE_VOICE: Readonly<Record<ReadingPhase, PhaseVoice>> = {
  SUMMON: {
    mystical: "The oracle calls the repository from its grave.",
    technical: "SUMMON: fetching public metadata and the pinned commit.",
  },
  DOWNLOAD: {
    mystical: "The body is drawn up, file by file.",
    technical: "DOWNLOAD: unpacking the snapshot for the detectors.",
  },
  EXTERNAL: {
    mystical: "She consults the registries of the living and the dead.",
    technical: "EXTERNAL: querying OSV, PyPI and npm for each dependency.",
  },
  READING: {
    mystical: "The cards fall. Each one carries its evidence.",
    technical: "READING: running detectors and laying out the spread.",
  },
};

/**
 * The two-line note shown when external enrichment is skipped (R6.21): a
 * mystical line, a newline, then the technical line naming what was skipped and
 * what the reading still rests on. Each physical line stays within 72 columns.
 */
export const EXTERNAL_SKIP_NOTE =
  "The mists hide the outer registries this time.\n" +
  "EXTERNAL skipped; the reading rests on the snapshot alone.";

/**
 * One Progress_Line per Resurrection_Phase (R9.2), surfaced by the terminal as
 * the resurrection stream reports each phase. The key set is exactly the six
 * ordered phases of the Ritual pipeline (SELECT, PRE_PASS, LLM_PASS, VALIDATE,
 * REDIAGNOSE, DIFF); each technical line carries its own phase token verbatim so
 * the client can key its progress display off it and a renamed phase is caught
 * by the example test. Pure Oracle_Voice: ASCII-only, no emoji, each physical
 * line within 72 columns and the mystical half ≤ 16 words.
 */
export const RESURRECT_PHASE_VOICE: Readonly<
  Record<ResurrectionPhase, PhaseVoice>
> = {
  SELECT: {
    mystical: "The oracle marks which corpses are worth raising.",
    technical: "SELECT: choosing the Python 2 files named by the cards.",
  },
  PRE_PASS: {
    mystical: "The deterministic rites rewrite what they safely can.",
    technical: "PRE_PASS: applying the mechanical Python 2 to 3 fixers.",
  },
  LLM_PASS: {
    mystical: "A bound spirit is asked to mend what rules could not.",
    technical: "LLM_PASS: converting the constructs the fixers left behind.",
  },
  VALIDATE: {
    mystical: "Each mended body is tested against the parser's gate.",
    technical: "VALIDATE: confirming each file parses as Python 3.",
  },
  REDIAGNOSE: {
    mystical: "The cards are laid again over the revived body.",
    technical: "REDIAGNOSE: re-reading the spread to measure the change.",
  },
  DIFF: {
    mystical: "The oracle draws the line between what was and is.",
    technical: "DIFF: assembling the before/after patch over fixed files.",
  },
};

/**
 * Narrate a 0–100 vitality score in one mystical line (≤ 16 words). Pure: the
 * same score always yields the same line. Three bands — a dead-low band, a
 * flickering middle band, and a living high band — keep the 0/50/100 endpoints
 * distinct (R7.3, R7.4).
 */
export function vitalityVoice(vitality: number): string {
  if (vitality < 34) {
    return "The body is cold; almost nothing stirs within.";
  }
  if (vitality < 67) {
    return "A faint pulse flickers, caught between death and life.";
  }
  return "Warmth returns; this one still has life to give.";
}
