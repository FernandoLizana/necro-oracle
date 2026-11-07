// @necro/grimoires-py2to3 — the Python 2 -> Python 3 grimoire (shell).
//
// A grimoire is adapter-free: it imports `@necro/oracle` (for `parsePython` /
// snapshot types, used by the fixers and validate in later tasks) and
// `@necro/coven` (for the `Grimoire`/`Fixer`/`LlmStep` type contracts and the
// shared zod data models), but NO adapters — no `@necro/llm`, no
// `@necro/sandbox`. The runner injects ports; the grimoire only declares pure
// fixers and a declarative LLM step (dependency direction:
// oracle <- grimoires <- coven).
//
// This is the TASK 4.1 object SHELL: id "py2to3", the "python2->python3" pair,
// input/output schemas wired to the coven models, an EMPTY `fixers` array, and
// a PLACEHOLDER `llm` step. The six deterministic fixers (task 4.2), the real
// LLM step (task 5.1) and the real `validate()` (task 5.2) replace the
// placeholders without changing this exported shape.
//
// Cross-package consumers import the grimoire only through this `src/index.ts`
// barrel (structure rule: imports cross packages only via `src/index.ts`).

import {
  GrimoireInputSchema,
  FileResultSchema,
  PYTHON2_TO_PYTHON3,
  type Grimoire,
} from "@necro/coven";

import { FIXERS } from "./fixers/index.js";
import { CHUNK_STEP } from "./llm/chunk-step.js";
import { LLM_STEP } from "./llm/index.js";
import { validate } from "./validate.js";

/** Stable grimoire id; also the registry key segment (R15.4). */
export const GRIMOIRE_ID = "py2to3";

/**
 * The Python 2 -> Python 3 grimoire. Registered into the
 * Language_Pair_Registry under `PYTHON2_TO_PYTHON3` by the coven runner at
 * construction (task 7.1 / `createDefaultRegistry({ py2to3: py2to3Grimoire })`).
 *
 * The `llm` field is typed as `LlmStep<unknown>` on the `Grimoire` interface;
 * the concrete placeholder step is assigned here and widened to that contract.
 */
// --- Part B — chunked LLM_Pass structured edit schema + gate (task 5.3) ------
//
// ADDITIVE re-exports: the strict `ChunkEditSchema` (purpose `py2to3.chunk`)
// and the pure `acceptChunk` gate + its result types. These do not change the
// existing grimoire shape or behaviour; the runner (task 5.4) consumes them.
export {
  ChunkEditSchema,
  acceptChunk,
  PYTHON3_STDLIB_MODULES,
  type ChunkEdit,
  type ChunkGateResult,
  type ChunkRejectReason,
  type DiagnoseFn,
  type ParseFn,
} from "./chunk-gate.js";

// The declarative chunked LLM step the runner drives in Part B (task 5.4). It
// delegates its prompt to the shared `py2to3.chunk` template and plugs the pure
// `acceptChunk` gate into the coven `ChunkStep` contract.
export { CHUNK_STEP } from "./llm/chunk-step.js";

export const py2to3Grimoire: Grimoire = {
  id: GRIMOIRE_ID,
  pair: PYTHON2_TO_PYTHON3,
  inputSchema: GrimoireInputSchema,
  outputSchema: FileResultSchema,
  fixers: FIXERS,
  llm: LLM_STEP,
  // Part B (task 5.4): the chunked LLM_Pass step. The runner drives it ONLY
  // when a `ModelRouterPort` is also injected; otherwise the legacy single-tier
  // `llm` step runs, so this is purely additive (design B.2).
  chunk: CHUNK_STEP,
  validate,
  divergenceAllowlist: [],
};

export default py2to3Grimoire;
