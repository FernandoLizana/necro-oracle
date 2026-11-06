// apps/web/src/server/handlers/resurrect.ts
//
// Feature: resurrection-engine, task 13.2.
//
// The Resurrection_Route handler `handleResurrect` (design: "Resurrection_Route",
// "Error Handling"). It mirrors `handleReading`'s pipeline shape: the shared
// guard steps (method -> limiter -> body -> strict request-schema parse) run
// PRE-STREAM and return a plain Error_Envelope; once the request schema passes
// the handler commits to a `200 application/x-ndjson` stream and carries every
// subsequent outcome — a Phase_Line per resurrection phase, time-bounded
// Skip_Note_Lines, and exactly ONE terminal Result_Line or Error_Line — as
// lines of that stream.
//
// The route drives the local Coven_Runner (SELECT -> PRE_PASS -> LLM_PASS ->
// VALIDATE -> REDIAGNOSE -> DIFF). The runner needs a `RitualInput`
// (snapshot + completed reading + target + spread); the route sources it the
// same way the Reading_Route does — summon the pinned ref, run a reading with
// the requested spread — then resurrects against that reading. A summon that
// yields a reading with NO draws means no completed reading is in scope, so the
// route rejects with a reading-required `Error_Line` (R1.6). In demo mode the
// input is loaded from the `lich-py2` graveyard fixtures instead, the Mock
// `LlmPort` is wired, outbound network is blocked, and EVERY line carries the
// `[DEMO]` prefix (task 16.2 helpers).
//
// Spend breakers (R11.3-R11.5): before the Ritual runs, the route reads the two
// spend breakers. An OPEN llm breaker makes it run the Ritual WITHOUT an
// `LlmPort` (so the runner skips the LLM_Pass and emits its Degraded skip-note);
// an OPEN sandbox breaker makes it omit the `SandboxPort` AND emit a route-level
// skip-note (the runner only emits the sandbox skip-note for an injected-but-
// unavailable sandbox, so the route states the breaker-skip itself). Either way
// the Ritual continues with the remaining passes and completes with partial
// results.
//
// Redaction / error mapping (R12.1, R12.2): every string leaving the stream is
// run through `redactDeep` with the GitHub token and the LLM key; every error
// goes through `mapError`. The coven data model adds machine codes
// (`BUDGET_EXHAUSTED`, `PAIR_UNKNOWN`, `PAIR_DUPLICATE`, `REDIAGNOSIS_FAILED`,
// `DEMO_FIXTURE_MISSING`) that the oracle `NecroErrorCodeSchema` — which
// `ErrorLineSchema` reuses — does NOT include. So a coven code is translated
// onto its oracle equivalent by `mapEngineError` BEFORE `mapError`, so the
// emitted `Error_Line` validates against `ResurrectStreamLineSchema` (R9.6).
//
// Stream-line validation (R9.5, R9.6): every line is validated against
// `ResurrectStreamLineSchema` before being written; a line that fails is NOT
// written and the stream terminates with a redacted `Error_Line`.
//
// Serverless-safe (R10.3): an Overall_Budget bounds the whole run and is
// scheduled at handler entry through the injectable `setTimer` seam, so the
// Response resolves immediately and a test can trip the budget with a fake
// clock. The route config pins `maxDuration = 50`, the budget fires below that,
// and the runner's own 45 s wall-clock budget keeps it inside the window.
//
// _Requirements: R1.1, R1.6, R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R10.3, R11.1, R11.2, R11.3, R11.4, R11.5, R12.1, R12.2_

import {
  createDemoPorts,
  installNetworkBlockGuard,
  prefixDemoLine,
  type LedgerPort,
  type LlmPort,
  type PhaseEmit,
  type RitualInput,
  type RitualPorts,
  type SandboxPort,
} from "@necro/coven";
import { parseRepoRef } from "@necro/github";
import { NecroError, type NecroErrorCode } from "@necro/oracle/client";
import type { ReadingOpts } from "@necro/oracle";

import { ResurrectRequestSchema } from "../../protocol/schemas.js";
import {
  ResurrectStreamLineSchema,
  type ResurrectStreamLine,
} from "../../protocol/resurrect-stream.js";
import type { ResurrectDeps } from "../deps.js";
import { mapError } from "../error-map.js";
import { redactDeep } from "../redact.js";
import { checkLimit, errorResponse, methodNotAllowed, readJsonBody } from "./guard.js";

/**
 * The Overall_Budget: a 48 s deadline for the whole Ritual, below the 50 s
 * serverless backstop (`maxDuration = 50`) and above the runner's own 45 s
 * wall-clock budget, so the runner's `BUDGET_EXHAUSTED` terminal state (which
 * returns partial results) normally wins the race and the route backstop only
 * fires if the runner itself hangs.
 */
const OVERALL_BUDGET_MS = 48_000;

/** A handle to a scheduled budget timer; cancelling prevents a late fire. */
export type TimerHandle = { cancel(): void };

/** Schedule `cb` to run `ms` from now, returning a cancellable handle. */
export type SetTimer = (ms: number, cb: () => void) => TimerHandle;

/**
 * The Resurrection_Route deps: the `ResurrectDeps` plus one optional budget
 * seam. In production `setTimer` is undefined and a `setTimeout`-backed timer is
 * used; tests inject a fake-clock timer so the budget is deterministic.
 */
export interface ResurrectHandlerDeps extends ResurrectDeps {
  readonly setTimer?: SetTimer;
}

/** The fixed Oracle-voice message for a request body that fails the schema. */
const INVALID_REQUEST_MESSAGE =
  "The offering is malformed.\n" +
  "Name a public repository, a commit sha, a playable spread, and an optional target.";

/** The reading-required message when no completed reading is in scope (R1.6). */
const NO_READING_MESSAGE =
  "The cards are not yet cast.\nRun a reading before you call for resurrection.";

/** The oracle-voice message for the Overall_Budget backstop. */
const OVERALL_TIMEOUT_MESSAGE =
  "The rite ran past the appointed hour.\n" +
  "The veil closed before the resurrection could finish.";

/** The route-level skip-note when the sandbox spend breaker is open (R11.4). */
const SANDBOX_BREAKER_SKIP_NOTE =
  "The deeper crypt is sealed to spare the coffers.\n" +
  "Sandbox spending is paused; validated with the Target_Parser alone.";

/**
 * A `setTimeout`-backed `SetTimer` for production, where no fake clock is
 * injected. Not exercised by the handler tests (they inject a fake-clock timer).
 */
const defaultSetTimer: SetTimer = (ms, cb) => {
  const id = setTimeout(cb, ms);
  return {
    cancel() {
      clearTimeout(id);
    },
  };
};

/**
 * Translate any coven-only machine code onto the oracle `NecroErrorCode` the
 * `ErrorLineSchema` (reused in `ResurrectStreamLineSchema`) accepts, PRESERVING
 * the error's oracle-voice `userMessage` and cause. The coven data model
 * extends the oracle code set with `BUDGET_EXHAUSTED`, `PAIR_UNKNOWN`,
 * `PAIR_DUPLICATE`, `REDIAGNOSIS_FAILED` and `DEMO_FIXTURE_MISSING`, none of
 * which `NecroErrorCodeSchema` knows; a raw coven code would make the emitted
 * `Error_Line` fail `ResurrectStreamLineSchema` (R9.6). This is the single
 * mapping point: an oracle code passes through unchanged; a coven code is
 * rewritten to the closest oracle code so the line validates while the message
 * the user sees is untouched. A non-NecroError is left for `mapError` to collapse
 * into the generic `UPSTREAM_UNAVAILABLE` fallback (R12.2).
 */
function mapEngineError(err: unknown): unknown {
  if (!(err instanceof NecroError)) return err;
  const oracleCode = COVEN_TO_ORACLE_CODE[err.code];
  if (oracleCode === undefined) return err; // already an oracle code
  return new NecroError(oracleCode, err.userMessage, err.cause);
}

/**
 * The coven-only codes and the oracle code each maps to. `BUDGET_EXHAUSTED` and
 * `REDIAGNOSIS_FAILED` are timeout/unavailability-shaped faults, so they map to
 * `NETWORK_TIMEOUT` / `UPSTREAM_UNAVAILABLE`; `PAIR_UNKNOWN` / `PAIR_DUPLICATE`
 * are bad-request-shaped (an unsupported or mis-registered pair) and map to
 * `VALIDATION_FAILED`; `DEMO_FIXTURE_MISSING` is a server misconfiguration and
 * maps to `UPSTREAM_UNAVAILABLE`. Any code not listed here is already an oracle
 * code and is left as-is.
 */
const COVEN_TO_ORACLE_CODE: Record<string, NecroErrorCode | undefined> = {
  BUDGET_EXHAUSTED: "NETWORK_TIMEOUT",
  REDIAGNOSIS_FAILED: "UPSTREAM_UNAVAILABLE",
  PAIR_UNKNOWN: "VALIDATION_FAILED",
  PAIR_DUPLICATE: "VALIDATION_FAILED",
  DEMO_FIXTURE_MISSING: "UPSTREAM_UNAVAILABLE",
};

/**
 * Handle one `POST /api/resurrect`. Guard failures (method, limiter, body
 * guard, request-schema) return a plain Error_Envelope BEFORE any streaming;
 * once the schema passes the handler commits to a `200 application/x-ndjson`
 * stream and carries every outcome — success or failure — as a line of it.
 */
export async function handleResurrect(
  req: Request,
  deps: ResurrectHandlerDeps,
): Promise<Response> {
  const setTimer = deps.setTimer ?? defaultSetTimer;

  // 1. Method guard (R11.1 shares the Reading_Route guards) — before any spend.
  if (req.method !== "POST") {
    return methodNotAllowed(req);
  }

  // 2. Rate limit BEFORE any GitHub work (R11.1/R11.2). A denial returns a 429
  //    with Retry-After PRE-STREAM.
  const limited = await checkLimit(req, deps, "resurrect");
  if (limited !== null) return limited;

  // 3. Body guards: content-type, size, JSON.
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  // 4. Strict wire-schema validation (R9.1): a celtic spread or a non
  //    40-hex-lowercase ref is rejected here, PRE-STREAM, as a 400
  //    Error_Envelope — nothing reaches GitHub or the runner.
  const parsedBody = ResurrectRequestSchema.safeParse(body.value);
  if (!parsedBody.success) {
    return errorResponse(400, "VALIDATION_FAILED", INVALID_REQUEST_MESSAGE);
  }
  const request = parsedBody.data;

  // The secret set redacted out of every outgoing line (R12.3, R13.2).
  const githubToken = deps.env.get("GITHUB_TOKEN");
  const llmKey = deps.env.get("NECRO_LLM_API_KEY");
  const now = new Date(deps.clock.nowMs()).toISOString();
  const demo = request.demo === true;

  // 5. Begin streaming. The whole Ritual runs inside the stream's `start` so the
  //    Response resolves immediately and a test can trip the Overall_Budget with
  //    a fake clock while a phase promise is pending.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;

      // Serialize + validate + redact ONE line, then enqueue it. Returns true
      // when the line was written, false when it failed validation (the caller
      // then terminates with a redacted Error_Line). Demo lines get the single
      // `[DEMO]` prefix at this one serialization choke point (R14.3).
      const enqueueValidated = (line: ResurrectStreamLine): boolean => {
        const redacted = redactDeep(line, githubToken);
        const reRedacted = redactDeep(redacted, llmKey);
        const parsed = ResurrectStreamLineSchema.safeParse(reRedacted);
        if (!parsed.success) return false;
        const serialized = JSON.stringify(parsed.data);
        const out = demo ? prefixDemoLine(serialized) : serialized;
        controller.enqueue(encoder.encode(out + "\n"));
        return true;
      };

      // Write a non-terminal line (phase / skip-note). An invalid line never
      // reaches the wire; instead the stream terminates with a redacted
      // Error_Line (R9.6).
      const write = (line: ResurrectStreamLine): void => {
        if (finished) return;
        if (!enqueueValidated(line)) {
          terminateInvalid();
        }
      };

      // Terminate with exactly one Error_Line for a given thrown value (R9.3).
      const terminateError = (err: unknown): void => {
        if (finished) return;
        const mapped = mapError(mapEngineError(err), githubToken);
        finished = true;
        // The mapped body is an oracle-code envelope; `enqueueValidated` redacts
        // it once more for the LLM key and validates it before writing. An
        // oracle-code envelope always validates; if it somehow did not we close
        // regardless rather than loop.
        enqueueValidated({ error: mapped.body.error });
        controller.close();
      };

      // Terminate because a built line failed ResurrectStreamLineSchema (R9.6):
      // do NOT write the offending line; emit a fixed redacted Error_Line.
      const terminateInvalid = (): void => {
        if (finished) return;
        finished = true;
        const mapped = mapError(
          new NecroError(
            "UPSTREAM_UNAVAILABLE",
            "A reply from the circle came back malformed.\n" +
              "The rite was stopped before a broken line could escape.",
          ),
          githubToken,
        );
        // This fixed envelope is an oracle code and always validates.
        enqueueValidated({ error: mapped.body.error });
        controller.close();
      };

      // Write the single terminal Result_Line (R9.3) and close.
      const writeResult = (result: ResurrectStreamLine): void => {
        if (finished) return;
        if (!enqueueValidated(result)) {
          terminateInvalid();
          return;
        }
        finished = true;
        controller.close();
      };

      // Wire the Overall_Budget: on fire, emit a NETWORK_TIMEOUT Error_Line and
      // close (R10.3). Cancelled once a terminal line is written.
      const overall = setTimer(OVERALL_BUDGET_MS, () => {
        terminateError(new NecroError("NETWORK_TIMEOUT", OVERALL_TIMEOUT_MESSAGE));
      });
      const cancelOverall = (): void => overall.cancel();

      // The monotonic reporter the runner drives: one Phase_Line per phase, a
      // Skip_Note_Line per skip. Both are forwarded through `write`, so an
      // invalid line terminates the stream.
      const emit: PhaseEmit = {
        phase: (phase) => {
          write({ phase });
        },
        skipNote: (note) => {
          write({ skip: true, note });
        },
      };

      void runRitual({
        deps,
        request,
        now,
        demo,
        emit,
        writeResult,
        terminateError,
        isFinished: () => finished,
        cancelOverall,
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Source the `RitualInput`, decide port injection from the spend breakers, drive
 * the runner, and write the terminal line. Any throw after streaming began is
 * carried as a final `{ error }` line (status is already 200). The sandbox
 * breaker-skip note is emitted by the route itself (the runner only emits a
 * sandbox skip-note for an injected-but-unavailable sandbox).
 */
async function runRitual(args: {
  deps: ResurrectHandlerDeps;
  request: {
    ref: string;
    target?: string | undefined;
    spread: "fates" | "necropsy";
    demo?: true | undefined;
  };
  now: string;
  demo: boolean;
  emit: PhaseEmit;
  writeResult: (line: ResurrectStreamLine) => void;
  terminateError: (err: unknown) => void;
  isFinished: () => boolean;
  cancelOverall: () => void;
}): Promise<void> {
  const {
    deps,
    request,
    now,
    demo,
    emit,
    writeResult,
    terminateError,
    isFinished,
    cancelOverall,
  } = args;

  // A demo blocks outbound network for the whole run (R14.2); restored in
  // `finally`. For a live run this is a no-op guard we never install.
  let restoreNetwork: (() => void) | null = null;

  try {
    // Decide the ports from the spend breakers (R11.3-R11.5). An open breaker
    // means the corresponding port is OMITTED so the runner degrades.
    const llmOpen = deps.breakers.llmOpen();
    const sandboxOpen = deps.breakers.sandboxOpen();

    // Assemble the RitualInput + RitualPorts. Demo and live diverge here.
    let input: RitualInput;
    let ports: RitualPorts;

    if (demo) {
      if (deps.loadDemoInput === undefined || deps.demoLlm === undefined) {
        // Demo requested but unsupported in this deployment — a server fault.
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "No replay is kept in this crypt.\nDemo mode is not available here.",
        );
      }
      input = await deps.loadDemoInput(now);
      if (isFinished()) return;
      restoreNetwork = installNetworkBlockGuard();
      // The demo always runs with the Mock LlmPort and no sandbox (R14.4).
      ports = createDemoPorts({
        llm: deps.demoLlm,
        clock: deps.clock,
        ledger: deps.makeLedger(),
      });
    } else {
      // Live: source the in-scope reading the same way the Reading_Route does —
      // summon the pinned ref, then run a reading with the requested spread.
      const parsedRef = parseRepoRef(request.ref);
      const summonResult = await deps.github.summon(parsedRef);
      if (isFinished()) return;

      const readOpts: ReadingOpts = { spreadKind: request.spread, now };
      const reading = await deps.runReading(summonResult.snapshot, readOpts);
      if (isFinished()) return;

      // R1.6: no completed reading in scope — a reading with no draws means the
      // cards were never cast. Reject with the reading-required Error_Line.
      if (reading.draws.length === 0) {
        terminateError(new NecroError("VALIDATION_FAILED", NO_READING_MESSAGE));
        return;
      }

      input = {
        pairId: "python2->python3",
        snapshot: summonResult.snapshot,
        reading,
        target: parseTarget(request.target),
        spread: request.spread,
        now,
        demo: false,
      };

      // A route-level skip-note for an OPEN sandbox breaker (R11.4): the runner
      // only emits the sandbox skip-note for an injected-but-unavailable
      // sandbox, so the route states the breaker-skip itself, then omits the
      // SandboxPort so the runner validates with the Target_Parser alone.
      if (sandboxOpen) {
        await emit.skipNote(SANDBOX_BREAKER_SKIP_NOTE);
        if (isFinished()) return;
      }

      ports = buildPorts({
        clock: deps.clock,
        ledger: deps.makeLedger(),
        // Open llm breaker => omit the LlmPort so the runner skips the LLM_Pass
        // and emits its own Degraded skip-note (R11.3). Degraded_Mode (no key)
        // leaves `deps.llm` undefined too — either way the pass is skipped.
        llm: llmOpen ? undefined : deps.llm,
        // Open sandbox breaker => omit the SandboxPort (R11.4/R11.5).
        sandbox: sandboxOpen ? undefined : deps.sandbox,
      });
    }

    if (isFinished()) return;

    // Drive the runner. It emits phases/skip-notes through `emit` and returns a
    // terminal outcome: `result` always, `error` non-null only on budget
    // exhaustion (partial results survive, R10.4).
    const outcome = await deps.runner.run(input, ports, emit);
    if (isFinished()) return;

    if (outcome.error !== null) {
      // Budget-exhausted (or another returned terminal error): the partial
      // RitualResult rides alongside, but the stream's single terminal line is
      // the Error_Line (R9.3). The partial files are carried in the ledger /
      // not re-emitted here.
      terminateError(outcome.error);
      return;
    }

    // Happy path: the single terminal Result_Line.
    writeResult({ result: outcome.result });
  } catch (err) {
    // Any throw after streaming began -> a final { error } line at 200 (R9.3).
    terminateError(err);
  } finally {
    if (restoreNetwork !== null) restoreNetwork();
    cancelOverall();
  }
}

/**
 * Build the `RitualPorts` for a live Ritual, omitting any absent optional port
 * so the runner reads an ABSENT key (exactOptionalPropertyTypes) rather than an
 * explicit `undefined` — the runner treats an absent `llm`/`sandbox` as "that
 * pass is skipped / Target_Parser only".
 */
function buildPorts(args: {
  clock: RitualPorts["clock"];
  ledger: LedgerPort;
  llm: LlmPort | undefined;
  sandbox: SandboxPort | undefined;
}): RitualPorts {
  const base: { clock: RitualPorts["clock"]; ledger: LedgerPort } = {
    clock: args.clock,
    ledger: args.ledger,
  };
  const withLlm = args.llm === undefined ? base : { ...base, llm: args.llm };
  return args.sandbox === undefined ? withLlm : { ...withLlm, sandbox: args.sandbox };
}

/**
 * Parse the optional request `target` string into the coven `ResurrectTarget`.
 * The wire request carries a single optional string (a card id or a file path);
 * absent => a bare run over all py2 candidates (R1.4). A token containing a `/`
 * or ending in `.py` is treated as a file path (R1.3); anything else is a card
 * id (R1.2). Semantic validation (existence, py2 classification) happens in the
 * runner's SELECT phase, so this is a parse-level discrimination only.
 */
function parseTarget(target: string | undefined): RitualInput["target"] {
  if (target === undefined || target === "") return { kind: "bare" };
  if (target.includes("/") || target.endsWith(".py")) {
    return { kind: "file", path: target };
  }
  return { kind: "card", card: target };
}
