// src/session/demo-seed.ts
//
// Feature: visual-necromancy, task 13.1.
//
// The pure seed-resolution helper the Visual_Layer uses to decide which seed
// feeds the Glitch_Effect transient corruption and the Rot_Transform. In Demo
// mode the seed is the fixed `DEMO_SEED`, so glitch params and rot outputs are
// reproducible across two renders of the same Demo reading (R9.1, R9.2); boot
// frames, card-reveal order, and resurrection-frame content derive solely from
// the Reading, the resurrection result, and `DEMO_SEED` (R9.3). Outside Demo
// mode the seed is derived deterministically from the Reading / ritual (the
// reading id, the ritual id, or the pinned ref sha) so a given reading still
// renders the same glitch/rot every time, without any clock or unseeded
// randomness.
//
// This module is pure: it reads `SessionState` only. No clock, network, DOM or
// unseeded randomness. The `bootSignal` fast-forward of the boot sequence does
// not touch seeding — demo seeding stays `DEMO_SEED` whether or not the boot is
// skipped (R12.5), because the seed is a function of the session's demo-ness and
// the Reading alone, never of the boot phase.
//
// _Requirements: R9.1, R9.3, R9.4, R12.5_

import { DEMO_SEED } from "../demo/catalog.js";
import type { SessionState } from "./state.js";

/**
 * Fold a string into an unsigned 32-bit seed with a small deterministic hash
 * (FNV-1a). Pure and stable: the same string always yields the same seed, with
 * no clock or randomness. Used only to derive a per-reading / per-ritual seed
 * outside Demo mode.
 */
function hashSeed(input: string): number {
  // FNV-1a 32-bit offset basis and prime.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space across all engines.
    hash = Math.imul(hash, 0x01000193);
  }
  // Ensure an unsigned 32-bit result so it reads as a plain non-negative seed.
  return hash >>> 0;
}

/**
 * Whether the session is a Demo session: a demo bundle has been loaded and the
 * current summary is flagged `demo`. Both conditions are required — a demo
 * bundle may be loaded while a live (non-demo) reading is on screen, and a
 * summary is only ever `demo` when it came from the bundle (design D6).
 */
export function isDemoSession(state: SessionState): boolean {
  return state.demoBundle !== null && state.summary?.demo === true;
}

/**
 * Resolve the seed that feeds the Glitch_Effect corruption and the
 * Rot_Transform for the current session.
 *
 * In Demo mode this is the fixed `DEMO_SEED` (R9.1), so two renders of the same
 * Demo reading produce the same glitch-parameter sequence and the same rot
 * outputs (R9.2). Outside Demo mode it is a deterministic function of the
 * Reading / ritual, derived in priority order from:
 *   1. the most recently settled resurrection's `ritualId` (the rot seed for a
 *      resurrection view),
 *   2. the last-played reading's `reading.id`,
 *   3. the pinned ref sha of the summon,
 * falling back to `DEMO_SEED` only when none of those is available (a fresh
 * session with nothing drawn yet). The result is always a stable, non-negative
 * 32-bit integer and never reads a clock or unseeded randomness.
 */
export function resolveSeed(state: SessionState): number {
  if (isDemoSession(state)) return DEMO_SEED;

  const ritualId = state.lastRitual?.ritualId;
  if (ritualId) return hashSeed(ritualId);

  const spread = state.lastSpread;
  const readingId = spread ? state.readings[spread]?.reading.id : undefined;
  if (readingId) return hashSeed(readingId);

  const sha = state.summary?.ref.sha;
  if (sha) return hashSeed(sha);

  return DEMO_SEED;
}
