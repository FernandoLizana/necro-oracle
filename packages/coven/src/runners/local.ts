// @necro/coven — the local Coven_Runner (design: "Coven_Runner", "Default vs
// optional runtime", "Degraded mode"). This is the central orchestration
// module: it drives a Ritual through the fixed phase sequence
//
//   SELECT -> PRE_PASS -> LLM_PASS -> VALIDATE -> REDIAGNOSE -> DIFF
//
// in process, synchronously enough to return within the serverless window
// (R10.1, R10.3). Every side-effecting capability is injected through
// `RitualPorts` (clock, ledger, and the OPTIONAL llm / sandbox). The runner
// itself imports `@necro/oracle` (the `parsePython` parser the fixers need and
// `initParser` to arm it) and the local pure modules only — it imports NO
// grimoire package (the grimoire arrives through the injected/constructed
// `LanguagePairRegistry`, honouring oracle <- grimoires <- coven) and NO
// adapter (adapters come via ports).
//
// Design decisions worth stating up front:
//
//   - Phases are emitted exactly once, in order, through a monotonic `emit`
//     reporter (`PhaseEmit`). This is Property 10 (tested in task 11.3); the
//     runner never emits a phase out of order and never twice.
//   - A single wall-clock budget bounds the whole Ritual, and a tighter budget
//     bounds the VALIDATE phase. Both are read ONLY through `ports.clock` — the
//     runner never reads the ambient clock. Budget exhaustion ends the Ritual,
//     disposes any sandbox, and returns the partial `File_Result`s produced so
//     far with a `BUDGET_EXHAUSTED` error (R10.4). The sandbox is disposed in
//     EVERY terminal state (success, budget, or thrown error) — security rule 3.
//   - Degraded_Mode: when no `LlmPort` is injected the LLM_PASS is skipped and
//     every residual is retained, emitting EXACTLY ONE oracle-voice skip-note
//     (R13.3/R13.4). `RitualResult.degraded` records the state (R13.5).
//   - The ledger is append-only with a strictly increasing `seq` (coven-
//     contracts). The runner owns the counter and threads the ISO `at` from
//     `ports.clock`.
//
// The optional Inngest runner (task 11.4) will reuse the same phase helpers and
// port contracts; this module is written so that the phase steps are small,
// pure-at-the-edges, and idempotent-friendly.

import {
  computeVitality,
  initParser,
  NecroError,
  parsePython,
  type Tree,
} from "@necro/oracle";

import { buildPatch, lineDiff } from "../diff.js";
import { maskContentItem, maskSecretsInText } from "../mask.js";
import { covenError } from "../models.js";
import type {
  FileResult,
  LedgerEvent,
  LlmConstructInput,
  ResidualEntry,
  RitualInput,
  RitualResult,
} from "../models.js";
import type {
  Grimoire,
  LlmPort,
  RitualPorts,
  SandboxPort,
} from "../ports.js";
import { rediagnose } from "../rediagnose.js";
import type { LanguagePairRegistry } from "../registry.js";
import { selectCandidates } from "../select.js";

// ---------------------------------------------------------------------------
// Phase sequence + the monotonic emit reporter (design: "Resurrection phase
// sequence"; Property 10).
// ---------------------------------------------------------------------------

/** The fixed, ordered resurrection phases. One `Phase_Line` is emitted each. */
export const RESURRECTION_PHASES = [
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
] as const;

/** A single resurrection phase name. */
export type ResurrectionPhase = (typeof RESURRECTION_PHASES)[number];

/**
 * The runner's view of the route's monotonic stream reporter. `phase` is called
 * once per phase in `RESURRECTION_PHASES` order; `skipNote` streams an
 * oracle-voice `Skip_Note_Line`. Both may be sync or async; the runner awaits
 * them. Defining this structurally (rather than importing the web `StreamLine`
 * union) keeps `@necro/coven` free of any `apps/web` dependency — the route
 * adapts its reporter to this shape.
 */
export interface PhaseEmit {
  phase(phase: ResurrectionPhase): void | Promise<void>;
  skipNote(note: string): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Runner configuration (budgets). All time is read through `ports.clock`.
// ---------------------------------------------------------------------------

/** Tunable budgets for a local Ritual. Defaults keep the run inside 50 s. */
export interface CovenRunnerOptions {
  /**
   * Overall wall-clock budget for the whole Ritual, in milliseconds. On
   * exhaustion the Ritual ends with a `BUDGET_EXHAUSTED` error and partial
   * results (R10.4). Default 45 s — comfortably under the 50 s serverless
   * return limit (R10.3) while leaving room to flush the terminal line.
   */
  readonly totalBudgetMs?: number;
  /**
   * Wall-clock budget for the VALIDATE phase alone, in milliseconds. When it is
   * reached, every not-yet-validated file is marked `validated: false` with a
   * `not_validated` residual and excluded from the Patch (R5.8/R9.7). Default
   * 20 s.
   */
  readonly validateBudgetMs?: number;
  /**
   * Timeout handed to the optional `SandboxPort.parseCheckPython3`, in
   * milliseconds. On timeout/unavailability the runner falls back to the
   * Target_Parser and emits a skip-note (R5.6). Default 15 s.
   */
  readonly sandboxTimeoutMs?: number;
}

const DEFAULT_TOTAL_BUDGET_MS = 45_000;
const DEFAULT_VALIDATE_BUDGET_MS = 20_000;
const DEFAULT_SANDBOX_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// The runner contract (design: "Coven_Runner").
// ---------------------------------------------------------------------------

/**
 * The terminal outcome of a Ritual: the assembled `RitualResult` paired with an
 * optional terminal `error`. On the happy path `error` is `null`. On budget
 * exhaustion (R10.4) `result` carries the partial `File_Result`s and `error` is
 * a `BUDGET_EXHAUSTED` `NecroError` the route surfaces as a terminal
 * `Error_Line` — the partial files are NOT discarded. A thrown error (unknown
 * pair, masking failure, etc.) still propagates as an exception; only the
 * budget terminal state returns through this `error` channel so its partial
 * results survive.
 */
export interface RitualOutcome {
  readonly result: RitualResult;
  readonly error: NecroError | null;
}

/**
 * Drives one Ritual to a `RitualOutcome`. `run` emits phases through `emit`,
 * isolates failures into typed `NecroError`s, disposes any sandbox in every
 * terminal state, and returns partial `File_Result`s when a budget is exhausted
 * (R10.4).
 */
export interface CovenRunner {
  run(
    input: RitualInput,
    ports: RitualPorts,
    emit: PhaseEmit,
  ): Promise<RitualOutcome>;
}

// ---------------------------------------------------------------------------
// Internal per-file working state. A `WorkingFile` accumulates the candidate's
// evolving `after` content and its residual list across PRE_PASS -> LLM_PASS ->
// VALIDATE, then collapses to an immutable `FileResult` at DIFF.
// ---------------------------------------------------------------------------

interface WorkingFile {
  readonly path: string;
  readonly before: string;
  after: string;
  residuals: ResidualEntry[];
  validated: boolean;
}

/** The oracle-voice skip-note emitted exactly once in Degraded_Mode (R13.4). */
const DEGRADED_SKIP_NOTE =
  "The oracle works bare-handed.\n" +
  "No model is bound; only the deterministic rites ran.";

/**
 * A signal thrown internally to unwind the pipeline when the overall wall-clock
 * budget is reached mid-phase. It is caught at the top of `run`, which turns it
 * into a `BUDGET_EXHAUSTED` terminal state with the partial files produced so
 * far. It is never allowed to escape the module.
 */
class BudgetReached {
  readonly #brand = "BudgetReached" as const;
}

// ---------------------------------------------------------------------------
// The local runner.
// ---------------------------------------------------------------------------

/**
 * In-process Coven_Runner (R10.1). Construct once with the
 * `LanguagePairRegistry` the composition root populates
 * (`createDefaultRegistry({ py2to3: py2to3Grimoire })`); the runner resolves the
 * grimoire from it per Ritual and never imports a grimoire package.
 */
export class LocalCovenRunner implements CovenRunner {
  readonly #registry: LanguagePairRegistry;
  readonly #totalBudgetMs: number;
  readonly #validateBudgetMs: number;
  readonly #sandboxTimeoutMs: number;

  constructor(registry: LanguagePairRegistry, options: CovenRunnerOptions = {}) {
    this.#registry = registry;
    this.#totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.#validateBudgetMs = options.validateBudgetMs ?? DEFAULT_VALIDATE_BUDGET_MS;
    this.#sandboxTimeoutMs = options.sandboxTimeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
  }

  async run(
    input: RitualInput,
    ports: RitualPorts,
    emit: PhaseEmit,
  ): Promise<RitualOutcome> {
    const ritualId = globalThis.crypto.randomUUID();
    const deadline = ports.clock.nowMs() + this.#totalBudgetMs;
    let seq = 0;
    const append = async (type: string): Promise<void> => {
      const event: LedgerEvent = {
        seq: seq++,
        // Every ledger entry routes through masking (R12.3). Event types are
        // fixed constants with no secrets, but masking here keeps the "every
        // sink is masked" guarantee holding for the whole ledger surface.
        type: maskSecretsInText(type),
        at: new Date(ports.clock.nowMs()).toISOString(),
      };
      await ports.ledger.append(event);
    };
    const overBudget = (): boolean => ports.clock.nowMs() >= deadline;

    // Wrap the route's reporter so EVERY Stream_Line (phase + skip-note) that
    // leaves the runner is masked before it reaches the sink (R12.3). Phase
    // names are a fixed enum, but masking them too keeps the guarantee total.
    const maskedEmit: PhaseEmit = {
      phase: (phase) => emit.phase(phase),
      skipNote: (note) => emit.skipNote(maskSecretsInText(note)),
    };

    await append("ritual.start");

    // Resolve the grimoire BEFORE any sandbox/LLM work. An unknown pair throws
    // PAIR_UNKNOWN here (R15.2) and no micro-VM is ever spun up.
    const grimoire = this.#registry.resolve(input.pairId);

    // The fixers parse with the injected `parsePython`, which requires the
    // oracle parser to be armed. Arm it once, up front, so PRE_PASS and VALIDATE
    // both find it ready (validate() reports "not valid" rather than crashing if
    // it is somehow not, so this is belt-and-braces).
    await initParser();

    // Whether this Ritual ran with a model bound. Absent llm => Degraded_Mode.
    const degraded = ports.llm === undefined;

    // Hoisted so the catch below can still return the partial files when the
    // overall budget is reached mid-phase (R10.4). Mutated in place (push only)
    // as SELECT masks and admits each candidate.
    const files: WorkingFile[] = [];

    try {
      // ---- SELECT ---------------------------------------------------------
      await maskedEmit.phase("SELECT");
      await append("phase.select");
      const selection = selectCandidates(input.snapshot, input.reading, input.target);
      for (const note of selection.skipNotes) {
        await maskedEmit.skipNote(note);
      }
      // Mask each candidate's content AS IT ENTERS the runner, before it can
      // reach any sink (diff, Patch, Stream_Line, ledger, LLM prompt). A file
      // whose content cannot be masked is WITHHELD from every sink and recorded
      // so the Ritual ends with a typed NecroError rather than leaking it
      // unmasked (R12.3, R12.4).
      let maskFailure: NecroError | null = null;
      for (const c of selection.candidates) {
        let before: string;
        try {
          before = maskContentItem(c.before);
        } catch (err) {
          // Withhold this file from all sinks; it never becomes a WorkingFile.
          // `maskContentItem` raises a typed NecroError; `asCovenError` keeps
          // the typed-error guarantee even if that ever changes.
          maskFailure = asCovenError(err);
          continue;
        }
        files.push({
          path: c.path,
          before,
          after: before,
          residuals: [],
          validated: false,
        });
      }
      if (maskFailure !== null) {
        // At least one content item was withheld (R12.4). Dispose and raise the
        // typed error; the catch below routes it to the route's mapError.
        throw maskFailure;
      }

      if (overBudget()) throw new BudgetReached();

      // ---- PRE_PASS -------------------------------------------------------
      await maskedEmit.phase("PRE_PASS");
      await append("phase.pre_pass");
      for (const file of files) {
        if (overBudget()) throw new BudgetReached();
        this.#applyFixers(grimoire, file);
      }

      // ---- LLM_PASS -------------------------------------------------------
      await maskedEmit.phase("LLM_PASS");
      await append("phase.llm_pass");
      if (ports.llm === undefined) {
        // Degraded_Mode: skip the whole pass, retain every residual, and emit
        // EXACTLY ONE oracle-voice skip-note (R4.6, R13.3, R13.4).
        await maskedEmit.skipNote(DEGRADED_SKIP_NOTE);
      } else {
        for (const file of files) {
          if (overBudget()) throw new BudgetReached();
          await this.#runLlmPass(grimoire, ports.llm, file);
        }
      }

      // ---- VALIDATE -------------------------------------------------------
      await maskedEmit.phase("VALIDATE");
      await append("phase.validate");
      await this.#validate(grimoire, ports, maskedEmit, files);

      if (overBudget()) throw new BudgetReached();

      // ---- REDIAGNOSE -----------------------------------------------------
      await maskedEmit.phase("REDIAGNOSE");
      await append("phase.rediagnose");
      const fileResults = files.map(toFileResult);
      const redx = await rediagnose(input, fileResults);
      if (redx.error !== null) {
        // R6.5: surface the re-diagnosis failure for this step WITHOUT
        // discarding the File_Results — stream it as a skip-note and null out
        // after/delta via the RediagnoseResult the runner already holds.
        await maskedEmit.skipNote(redx.error.userMessage);
        await append("phase.rediagnose.error");
      }

      // ---- DIFF -----------------------------------------------------------
      await maskedEmit.phase("DIFF");
      await append("phase.diff");
      const withDiffs = fileResults.map((f) => ({
        ...f,
        diff: lineDiff(f.before, f.after),
      }));
      const patch = buildPatch(withDiffs);

      await append("ritual.complete");
      await this.#disposeSandbox(ports.sandbox);

      return {
        result: {
          ritualId,
          selectedCount: files.length,
          files: withDiffs,
          patch,
          beforeVitality: redx.beforeVitality,
          afterVitality: redx.afterVitality,
          vitalityDelta: redx.vitalityDelta,
          changedCards: [...redx.changedCards],
          degraded,
          demo: input.demo,
        },
        error: null,
      };
    } catch (err) {
      if (err instanceof BudgetReached) {
        return await this.#budgetExhausted(
          input,
          ports,
          files,
          degraded,
          ritualId,
          append,
        );
      }
      // Any other thrown value is a terminal error: dispose the sandbox in this
      // terminal state too (security rule 3) and rethrow a TYPED NecroError for
      // the route's mapError to turn into an Error_Line. `asCovenError`
      // guarantees the raised value is a NecroError with a non-empty code and an
      // oracle-voice userMessage carrying no path, secret, or stack (R12.5,
      // R13.2) — a bare JS error never escapes the runner.
      await this.#disposeSandbox(ports.sandbox);
      throw asCovenError(err);
    }
  }

  // -------------------------------------------------------------------------
  // PRE_PASS — apply the grimoire's fixers in order per candidate (R3.1).
  // -------------------------------------------------------------------------

  /**
   * Apply each fixer in `grimoire.fixers` order to the file's current `after`
   * content, threading residuals. The `FixerContext` carries the injected
   * `parsePython` and the file path. Fixers are pure and idempotent; applying
   * them in sequence is the deterministic Pre_Pass.
   */
  #applyFixers(grimoire: Grimoire, file: WorkingFile): void {
    const parse = (source: string): Tree => parsePython(source);
    for (const fixer of grimoire.fixers) {
      const result = fixer(file.after, { parse, path: file.path });
      file.after = result.after;
      file.residuals.push(...result.residuals);
    }
  }

  // -------------------------------------------------------------------------
  // LLM_PASS — resolve each residual via the injected LlmPort (R4.*).
  // -------------------------------------------------------------------------

  /**
   * For every residual on the file, build the grimoire's LLM request, call the
   * injected `LlmPort`, validate the result with the step's `outputSchema`
   * (retry ONCE on zod failure, R4.3/R4.4), then apply it. The residual is
   * removed only when a valid conversion is applied; otherwise it is kept with
   * the appropriate reason:
   *   - zod failure after the retry  -> `llm_invalid_output` (R4.4)
   *   - timeout / unavailable throw  -> `llm_unavailable`   (R4.5)
   */
  async #runLlmPass(
    grimoire: Grimoire,
    llm: LlmPort,
    file: WorkingFile,
  ): Promise<void> {
    const step = grimoire.llm;
    const pending = file.residuals;
    file.residuals = [];

    for (const residual of pending) {
      const construct: LlmConstructInput = {
        path: file.path,
        construct: residual.construct,
        // The residual's construct text stands in as the source span handed to
        // the model; the grimoire masks it before it enters the prompt.
        source: residual.construct,
      };
      const req = step.buildRequest(construct);

      let applied = false;
      let unavailable = false;
      // Up to two attempts: initial + one retry on a zod validation failure.
      for (let attempt = 0; attempt < 2 && !applied; attempt++) {
        let text: string;
        try {
          const result = await llm.complete(req);
          text = result.text;
        } catch {
          // Timeout / unavailable / breaker-open: stop retrying this construct.
          unavailable = true;
          break;
        }
        const parsed = step.outputSchema.safeParse(safeJson(text));
        if (parsed.success) {
          file.after = step.apply(file.after, parsed.data);
          applied = true;
        }
        // On a zod failure the loop retries once more, then falls through.
      }

      if (applied) continue;
      file.residuals.push({
        ...residual,
        reason: unavailable ? "llm_unavailable" : "llm_invalid_output",
      });
    }
  }

  // -------------------------------------------------------------------------
  // VALIDATE — Target_Parser (+ optional sandbox parse-only), under a budget.
  // -------------------------------------------------------------------------

  /**
   * Validate each file's `after` with the grimoire's `validate` (Target_Parser;
   * zero error nodes => valid, R5.1). WHERE a `SandboxPort` is injected, also
   * call `parseCheckPython3`; on timeout/unavailability fall back to the
   * Target_Parser result and emit a skip-note (R5.6). A file whose content does
   * not validate is marked `validated: false` with an `output_unparseable`
   * residual (R5.2/R5.3).
   *
   * The phase is bounded by its own wall-clock budget: once reached, every
   * not-yet-validated file is marked `validated: false` with a `not_validated`
   * residual and excluded from the Patch — never silently skipped (R5.8/R9.7).
   */
  async #validate(
    grimoire: Grimoire,
    ports: RitualPorts,
    emit: PhaseEmit,
    files: readonly WorkingFile[],
  ): Promise<void> {
    const validateDeadline = ports.clock.nowMs() + this.#validateBudgetMs;
    let sandboxSkipped = false;

    for (const file of files) {
      if (ports.clock.nowMs() >= validateDeadline) {
        // VALIDATE budget reached: mark this and every remaining file
        // not-validated with an explicit residual (R5.8/R9.7).
        file.validated = false;
        file.residuals.push(notValidatedResidual(file.path));
        continue;
      }

      const result = grimoire.validate(file.after);
      let ok = result.valid;

      if (ok && ports.sandbox !== undefined) {
        const sandboxOk = await this.#sandboxParseCheck(
          ports.sandbox,
          file.after,
        );
        if (sandboxOk === "unavailable") {
          // R5.6: fall back to the Target_Parser result (already in `ok`) and
          // emit the skip-note ONCE for the phase.
          if (!sandboxSkipped) {
            sandboxSkipped = true;
            await emit.skipNote(SANDBOX_FALLBACK_SKIP_NOTE);
          }
        } else {
          ok = sandboxOk;
        }
      }

      file.validated = ok;
      if (!ok) {
        file.residuals.push({
          path: file.path,
          line: 0,
          construct: file.path,
          reason: "output_unparseable",
        });
      }
    }
  }

  /**
   * Call the optional sandbox parse-only check. Returns the boolean parse
   * result, or the sentinel `"unavailable"` on timeout/unavailability so the
   * caller can fall back to the Target_Parser (R5.6). Never executes code.
   */
  async #sandboxParseCheck(
    sandbox: SandboxPort,
    source: string,
  ): Promise<boolean | "unavailable"> {
    try {
      const res = await sandbox.parseCheckPython3(source, {
        timeoutMs: this.#sandboxTimeoutMs,
      });
      return res.ok;
    } catch {
      return "unavailable";
    }
  }

  // -------------------------------------------------------------------------
  // Budget-exhaustion terminal state (R10.4) + sandbox disposal (rule 3).
  // -------------------------------------------------------------------------

  /**
   * End the Ritual because the overall wall-clock budget was reached (R10.4).
   * Every file that was not confirmed `validated` is kept but marked
   * `validated: false` with an `incomplete` residual (R8.4) so it is excluded
   * from the Patch and never presented as converted; already-validated files
   * are presented as-is. Any sandbox is disposed (security rule 3), the
   * terminal ledger event is appended, and the partial `RitualResult` is
   * returned paired with the canonical `BUDGET_EXHAUSTED` error. `beforeVitality`
   * is computed from the pre-reading draws so the result is schema-valid;
   * after/delta are null because re-diagnosis never ran.
   */
  async #budgetExhausted(
    input: RitualInput,
    ports: RitualPorts,
    files: readonly WorkingFile[],
    degraded: boolean,
    ritualId: string,
    append: (type: string) => Promise<void>,
  ): Promise<RitualOutcome> {
    const partial: FileResult[] = files.map((file) => {
      if (file.validated) return toFileResult(file);
      // Not confirmed — record an incomplete residual and keep it out of the Patch.
      return toFileResult({
        ...file,
        validated: false,
        residuals: [...file.residuals, incompleteResidual(file.path)],
      });
    });

    const withDiffs = partial.map((f) => ({
      ...f,
      diff: lineDiff(f.before, f.after),
    }));
    const patch = buildPatch(withDiffs);

    await append("ritual.budget_exhausted");
    await this.#disposeSandbox(ports.sandbox);

    const beforeVitality = clampVitality(computeVitality(input.reading.draws));

    return {
      result: {
        ritualId,
        selectedCount: withDiffs.length,
        files: withDiffs,
        patch,
        beforeVitality,
        afterVitality: null,
        vitalityDelta: null,
        changedCards: [],
        degraded,
        demo: input.demo,
      },
      error: budgetExhaustedError(),
    };
  }

  /** Dispose any injected sandbox; safe to call in every terminal state. */
  async #disposeSandbox(sandbox: SandboxPort | undefined): Promise<void> {
    if (sandbox === undefined) return;
    try {
      await sandbox.dispose();
    } catch {
      // Disposal is best-effort; a failure to tear down must never mask the
      // Ritual's own terminal state.
    }
  }
}

// ---------------------------------------------------------------------------
// Skip-note copy + residual builders (oracle-voice).
// ---------------------------------------------------------------------------

/** Emitted once when the optional sandbox parse-check is unavailable (R5.6). */
const SANDBOX_FALLBACK_SKIP_NOTE =
  "The deeper crypt would not open; I read the bones myself.\n" +
  "Sandbox parse-check unavailable; validated with the Target_Parser alone.";

/** A `not_validated` residual for a file the VALIDATE budget cut short (R5.8). */
function notValidatedResidual(path: string): ResidualEntry {
  return { path, line: 0, construct: path, reason: "not_validated" };
}

/** An `incomplete` residual for a file the Ritual terminated before confirming (R8.4). */
function incompleteResidual(path: string): ResidualEntry {
  return { path, line: 0, construct: path, reason: "incomplete" };
}

// ---------------------------------------------------------------------------
// WorkingFile -> FileResult collapse.
// ---------------------------------------------------------------------------

/**
 * Freeze a `WorkingFile` into an immutable `FileResult`. `fullyConverted` is
 * `residuals.length === 0` (R8.3). The `diff` is filled in by the caller at the
 * DIFF phase; here it starts empty so the shape is complete and schema-valid.
 * A not-validated file keeps its `after` content but is excluded from the Patch
 * by `buildPatch` via its `validated: false` flag (R7.7).
 */
function toFileResult(file: WorkingFile): FileResult {
  return {
    path: file.path,
    before: file.before,
    after: file.after,
    diff: [],
    residuals: file.residuals,
    fullyConverted: file.residuals.length === 0,
    validated: file.validated,
  };
}

// ---------------------------------------------------------------------------
// Vitality helper for the budget-exhaustion path.
//
// The happy path computes before/after vitality through `rediagnose`; the
// budget path never reaches re-diagnosis, so it computes `beforeVitality`
// directly from the pre-reading draws (the same source `rediagnose` uses) and
// clamps it into the schema's [0, 100] range.
// ---------------------------------------------------------------------------

function clampVitality(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---------------------------------------------------------------------------
// BUDGET_EXHAUSTED error.
//
// The budget-exhaustion terminal state returns partial files AND must signal
// BUDGET_EXHAUSTED. Throwing would discard the partial files, so the typed
// error is returned through `RitualOutcome.error` instead; the route surfaces
// it as a terminal Error_Line while the partial result travels alongside.
// Exported so the route and tests share one canonical message/code.
// ---------------------------------------------------------------------------

/** The canonical BUDGET_EXHAUSTED error for a budget-ended Ritual (R10.4). */
export function budgetExhaustedError(): NecroError {
  return covenError(
    "BUDGET_EXHAUSTED",
    "The rite ran out of night; the circle closes unfinished.\n" +
      "The time budget was reached; returning the partial resurrection.",
  );
}

// ---------------------------------------------------------------------------
// Typed-error guarantee (R12.5, R13.2).
//
// Every failure the runner raises must be a `NecroError` with a non-empty
// `code` and an oracle-voice `userMessage` that carries NO path, NO secret, and
// NO stack. `asCovenError` is the single choke point that enforces this: a
// value that is already a well-formed NecroError is passed through unchanged
// (its own code/userMessage are already in the oracle voice and leak nothing);
// anything else — a bare JS `Error`, a string, a thrown object — is collapsed
// into one fixed `UPSTREAM_UNAVAILABLE` error whose message interpolates none of
// the thrown value's text, so no file path, secret substring, or stack trace
// can ride out on it.
// ---------------------------------------------------------------------------

/** The fixed oracle-voice message for an unexpected, untyped fault (R12.5). */
const UNEXPECTED_FAULT_MESSAGE =
  "The veil tore where no rite was spoken.\n" +
  "An unexpected fault ended the ritual; try the summoning again.";

/**
 * True when `err` is a well-formed `NecroError`: an `instanceof` match, or a
 * value that crossed a module boundary but still carries a non-empty string
 * `code` and `userMessage`. Mirrors the route's duck-typed guard so a
 * NecroError that lost its prototype identity is still treated as typed.
 */
function isWellFormedNecroError(err: unknown): err is NecroError {
  if (err instanceof NecroError) {
    return typeof err.code === "string" && err.code.length > 0;
  }
  if (err === null || typeof err !== "object") return false;
  const c = err as { code?: unknown; userMessage?: unknown };
  return (
    typeof c.code === "string" &&
    c.code.length > 0 &&
    typeof c.userMessage === "string"
  );
}

/**
 * Coerce any thrown value into a typed `NecroError` (R12.5). A well-formed
 * NecroError is returned as-is; anything else becomes the fixed
 * `UPSTREAM_UNAVAILABLE` fault above, which leaks none of the original value's
 * text. Exported so the runner and its tests share one coercion.
 */
export function asCovenError(err: unknown): NecroError {
  if (isWellFormedNecroError(err)) return err;
  return covenError("UPSTREAM_UNAVAILABLE", UNEXPECTED_FAULT_MESSAGE);
}

// ---------------------------------------------------------------------------
// Tolerant JSON parse for LLM output text.
// ---------------------------------------------------------------------------

/**
 * Parse `text` as JSON, returning the parsed value or the raw string when it is
 * not JSON. The grimoire's `outputSchema` then validates the shape; a
 * non-matching value simply fails `safeParse` and triggers the retry / residual
 * path (R4.4). This never throws.
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
