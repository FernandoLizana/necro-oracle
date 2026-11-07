// apps/web/src/server/handlers/lovers.ts
//
// Feature: lovers-binding, task 11.6b — the Lovers_Route handler `handleLovers`
// (design C.5 "Lovers route", A.8 "single-request DEADLINE", D.4 "Transport",
// D.5 "Limits + error mapping + server-key soft-degrade"). It mirrors
// `handleResurrect`'s pipeline shape exactly:
//
//   PRE-STREAM guards (method -> per-IP limiter -> body -> strict schema ->
//   BYOK user-key parse) return a plain Error_Envelope BEFORE any streaming;
//   once the request schema passes the handler commits to a
//   `200 application/x-ndjson` stream and carries every outcome — one Lovers
//   phase line per phase (PLAN/GENERATE/VALIDATE/BIND), oracle-voice NOTICE
//   skip-notes, and exactly ONE terminal `{ result }` or `{ error }` line — as
//   lines of that stream.
//
// SOURCING THE RESURRECTED PYTHON 3 (R16.1). The Lovers binding takes the
// RESURRECTED Python 3 source as its input, never raw Python 2. So the route,
// like `handleResurrect`, summons the pinned ref and runs a reading with the
// requested spread (the in-scope reading), THEN resurrects the requested file
// through the shared `resurrectRunner` (SELECT -> ... -> DIFF) and takes that
// file's after-content as the LoversRunner `source`. In demo mode the
// resurrected source is loaded from the demo seam instead (Mock provider,
// network blocked) so the binding is deterministic and offline (R15.4).
//
// PRECONDITION (R14.4). Before any model call: (1) the in-scope reading MUST
// include THE LOVERS (VI) — else a typed `VALIDATION_FAILED` oracle-voice error
// and NO model call; (2) the file must be resurrectable with bindable top-level
// functions — the resurrect step must yield after-content for the file, and the
// LoversRunner's own `extractPlan` guards the bindable-function / size caps
// defence-in-depth, so an empty/unbindable file terminates with a typed
// `VALIDATION_FAILED` before any PLAN/GENERATE call.
//
// BYOK (D.4 / D.5). `parseUserKey` three-way: absent => soulSource ORACLE
// (server key / Mock default, the SEPARATE `NECRO_LOVERS_DAILY_CEILING` applied
// — R20.1); valid => soulSource YOURS (SKIP the server spend ceiling, KEEP the
// per-IP abuse limit — R24.2/R24.3, build the provider per request via
// `deps.makeUserLlm`); malformed => terminate PRE-STREAM with the typed
// `VALIDATION_FAILED` oracle-voice error (the value is never echoed). Model
// overrides (`request.models`) are honoured ONLY when YOURS (R40.2/R40.3); on
// ORACLE they are IGNORED and a single oracle-voice NOTICE line is emitted.
//
// SOFT-DEGRADE (R42 / D.5). On a SERVER-key (ORACLE) shortfall — no server key,
// demo, open spend breaker, timeout, ceiling, `402`/`429`/`401` — the route
// does NOT error-screen: the LoversRunner falls back to the deterministic
// template path and the route emits ONE oracle-voice NOTICE line. A USER-key
// (YOURS) `401`/`402` is the one HARD case (R28.1/R28.2): a typed
// `UPSTREAM_UNAVAILABLE` oracle-voice error, NO silent fallback to the server
// key — only the deterministic layer. (11.6c owns the exact NOTICE/degrade
// copy; schema-valid oracle-voice placeholders are used here so the control
// flow is complete today.)
//
// REDACTION / LOGGING (R19.4 / R27.2). Every outgoing line is validated against
// `LoversStreamLineSchema` before writing and redacted with BOTH the server
// `OPENROUTER_API_KEY` and the per-request user key (and the GitHub + legacy
// LLM tokens). Coven errors are mapped to oracle codes via `mapEngineError`
// BEFORE the line is built. Logs carry only `{ code, message, stack }` — never
// a request body, token, or env value.
//
// DEADLINE (A.8 / design C.6). The route config pins `maxDuration = 120` (the
// Vercel Fluid Compute limit permits it — design C.6 line 982); the route-level
// Overall_Budget backstop (below) fires below `maxDuration`, and the
// LoversRunner reads its own single-request deadline from the `totalBudgetMs`
// set at construction (composition), kept inside `maxDuration` minus the summon
// + resurrect headroom.
//
// _Requirements: R14.4, R19.1, R19.2, R19.3, R19.4, R19.5, R20.1, R24.2, R24.3,
//  R27.1, R28.1, R28.2, R36.3, R36.4, R37.3, R40.2, R40.3_

import {
  installNetworkBlockGuard,
  type LedgerPort,
  type LlmCachePort,
  type LlmPort,
  type LoversEmit,
  type LoversPorts,
  type LoversRunnerInput,
  type ModelRouterPort,
  type RitualInput,
  type RitualPorts,
} from "@necro/coven";
import { parseRepoRef } from "@necro/github";
import { NecroError, type NecroErrorCode } from "@necro/oracle/client";
import type { ReadingOpts } from "@necro/oracle";

import { LoversRequestSchema } from "../../protocol/schemas.js";
import {
  LoversStreamLineSchema,
  type LoversStreamLine,
} from "../../protocol/lovers-stream.js";
import type { LoversDeps, ResurrectedFile } from "../deps.js";
import { mapError } from "../error-map.js";
import { redactDeep } from "../redact.js";
import { parseUserKey, redactLine, USER_KEY_HEADER } from "../user-key.js";
import { checkLimit, errorResponse, methodNotAllowed, readJsonBody } from "./guard.js";

// ---------------------------------------------------------------------------
// Budget arithmetic (design A.8). The route config pins `maxDuration = 120`;
// the Overall_Budget backstop fires below it, and the LoversRunner reads a
// single request deadline derived from the budget remaining after the route
// has spent time on summon + resurrect.
// ---------------------------------------------------------------------------

/**
 * The Overall_Budget: a 115 s deadline for the whole lovers rite, below the
 * 120 s serverless backstop (`maxDuration = 120`), so the backstop only fires
 * if the route itself hangs after the runner's own deadline should have won.
 */
const OVERALL_BUDGET_MS = 115_000;

/** A handle to a scheduled budget timer; cancelling prevents a late fire. */
export type TimerHandle = { cancel(): void };

/** Schedule `cb` to run `ms` from now, returning a cancellable handle. */
export type SetTimer = (ms: number, cb: () => void) => TimerHandle;

/**
 * The Lovers_Route deps: the `LoversDeps` plus one optional budget seam. In
 * production `setTimer` is undefined and a `setTimeout`-backed timer is used;
 * tests inject a fake-clock timer so the budget is deterministic.
 */
export interface LoversHandlerDeps extends LoversDeps {
  readonly setTimer?: SetTimer;
}

/** Where the souls for this request are drawn from (D.4 / D.5). Mirrors resurrect. */
type SoulSource = "ORACLE" | "YOURS";

// --- Fixed oracle-voice copy ----------------------------------------------

/** The fixed oracle-voice message for a request body that fails the schema. */
const INVALID_REQUEST_MESSAGE =
  "The offering is malformed.\n" +
  "Name a public repository, a commit sha, a file to bind, and a playable spread.";

/**
 * The precondition error (R14.4, design C.5): THE LOVERS (VI) was not drawn, or
 * the file has no bindable top-level functions. Raised BEFORE any model call.
 */
const loversPreconditionMessage = (file: string): string =>
  "The Lovers did not rise in this spread.\n" +
  `THE LOVERS (VI) was not drawn, or ${file} has no bindable top-level functions.`;

/** The reading-required message when no completed reading is in scope (R14.4). */
const NO_READING_MESSAGE =
  "The cards are not yet cast.\nRun a reading before you call for a binding.";

/** The oracle-voice message for the Overall_Budget backstop. */
const OVERALL_TIMEOUT_MESSAGE =
  "The rite ran past the appointed hour.\n" +
  "The veil closed before the binding could finish.";

// --- Soft-degrade NOTICE seam (task 11.6c owns the exact copy) --------------
//
// The server-key (ORACLE) soft-degrade conditions are NEVER an error screen —
// the binding produces the deterministic template result and emits ONE
// oracle-voice NOTICE line (design "Degrade matrix", R42.1). The strings below
// are the design's degrade-matrix lines used as the seam placeholder so the
// control flow is complete and schema-valid today; 11.6c swaps in the final
// matrix copy.

/** NOTICE: no server key AND no user key — deterministic template only. */
const DEGRADE_NO_KEY_NOTICE =
  "The oracle reads with its own eyes.\n" +
  "No model configured; deterministic binding only.";

/** NOTICE: the LLM spend breaker is open — deterministic template only (soft). */
const DEGRADE_BREAKER_NOTICE =
  "The circle is sealed to spare the coffers.\n" +
  "Spend breaker open; deterministic binding only.";

/** NOTICE: model overrides ignored because soulSource is ORACLE (R40.2). */
const OVERRIDES_IGNORED_NOTICE =
  "The circle spends its own souls; your chosen names are set aside.\n" +
  "Model overrides ignored on SOUL SOURCE: ORACLE; set your own key to use them.";

/**
 * The HARD, typed BYOK auth failure (soulSource = YOURS, OpenRouter 401/402):
 * a typed oracle-voice error with NO silent fallback to the server key — the
 * only fallback is the deterministic layer (R28.1/R28.2). The control-flow seam
 * lives in the YOURS branch below; the error is observable to the route only
 * once the runner's PLAN/GENERATE threads provider auth errors outward (the
 * runner today swallows them into the deterministic fallback, so the YOURS hard
 * case is surfaced when a provider raises `UPSTREAM_UNAVAILABLE` to the route).
 */
const BYOK_AUTH_FAILED_MESSAGE =
  "Your soul was refused at the gate.\n" +
  "OpenRouter rejected your key (401/402); the oracle will not pay in your stead.";

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

/** The card id THE LOVERS (VI) carries in the deck (mirrors `loversEligible`). */
const LOVERS_CARD_ID = "lovers";

/**
 * Translate any coven-only machine code onto the oracle `NecroErrorCode` the
 * `ErrorLineSchema` (reused in `LoversStreamLineSchema`) accepts, preserving the
 * error's oracle-voice `userMessage` and cause. Mirrors the resurrect handler's
 * single mapping point so a coven code never makes the emitted `Error_Line`
 * fail the stream schema (R19.5). An oracle code passes through unchanged.
 */
function mapEngineError(err: unknown): unknown {
  if (!(err instanceof NecroError)) return err;
  const oracleCode = COVEN_TO_ORACLE_CODE[err.code];
  if (oracleCode === undefined) return err; // already an oracle code
  return new NecroError(oracleCode, err.userMessage, err.cause);
}

/** The coven-only codes and the oracle code each maps to (mirrors resurrect). */
const COVEN_TO_ORACLE_CODE: Record<string, NecroErrorCode | undefined> = {
  BUDGET_EXHAUSTED: "NETWORK_TIMEOUT",
  REDIAGNOSIS_FAILED: "UPSTREAM_UNAVAILABLE",
  PAIR_UNKNOWN: "VALIDATION_FAILED",
  PAIR_DUPLICATE: "VALIDATION_FAILED",
  DEMO_FIXTURE_MISSING: "UPSTREAM_UNAVAILABLE",
};

/**
 * Handle one `POST /api/lovers`. Guard failures (method, limiter, body guard,
 * request-schema, malformed user key) return a plain Error_Envelope BEFORE any
 * streaming; once the schema passes the handler commits to a
 * `200 application/x-ndjson` stream and carries every outcome as a line of it.
 */
export async function handleLovers(
  req: Request,
  deps: LoversHandlerDeps,
): Promise<Response> {
  const setTimer = deps.setTimer ?? defaultSetTimer;

  // 1. Method guard (R19.2 shares the resurrect guards) — before any spend.
  if (req.method !== "POST") {
    return methodNotAllowed(req);
  }

  // 2. Per-IP rate limit BEFORE any GitHub work (R19.2/R24.3). The SAME per-IP
  //    abuse chain the resurrect route uses, keyed by the `"lovers"` route, PLUS
  //    the SEPARATE server daily ceiling (R20.1). The per-IP limit is kept for
  //    BOTH soul sources; the server daily ceiling is skipped later for YOURS,
  //    but the per-IP chain always runs here PRE-STREAM.
  const limited = await checkLimit(req, deps, "lovers", deps.loversDailyCeiling);
  if (limited !== null) return limited;

  // 3. Body guards: content-type, size, JSON.
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  // 4. Strict wire-schema validation (R19.3): a celtic spread or a malformed
  //    ref/file is rejected here, PRE-STREAM, as a 400 Error_Envelope — nothing
  //    reaches GitHub or either runner.
  const parsedBody = LoversRequestSchema.safeParse(body.value);
  if (!parsedBody.success) {
    return errorResponse(400, "VALIDATION_FAILED", INVALID_REQUEST_MESSAGE);
  }
  const request = parsedBody.data;

  // 4b. BYOK user-key parse (D.4; R27.x). Three-way:
  //   - absent    => soulSource ORACLE (server key / Mock default);
  //   - valid     => soulSource YOURS (BYOK provider per request);
  //   - malformed => terminate PRE-STREAM with the typed VALIDATION_FAILED
  //                  oracle-voice error (the value is NEVER echoed).
  const parsedKey = parseUserKey(req.headers.get(USER_KEY_HEADER));
  if ("ok" in parsedKey && parsedKey.ok === false) {
    return errorResponse(
      400,
      parsedKey.error.code as NecroErrorCode,
      parsedKey.error.userMessage,
    );
  }
  const userKey: string | undefined =
    "ok" in parsedKey && parsedKey.ok === true ? parsedKey.key : undefined;
  const soulSource: SoulSource = userKey !== undefined ? "YOURS" : "ORACLE";

  // The secret set redacted out of EVERY outgoing line (R27.2): the GitHub
  // token, the legacy LLM key, the server `OPENROUTER_API_KEY`, and the
  // per-request user key.
  const githubToken = deps.env.get("GITHUB_TOKEN");
  const llmKey = deps.env.get("NECRO_LLM_API_KEY");
  const openrouterKey = deps.env.get("OPENROUTER_API_KEY");
  const now = new Date(deps.clock.nowMs()).toISOString();
  const demo = request.demo === true;

  // 5. Begin streaming. The whole binding runs inside the stream's `start` so
  //    the Response resolves immediately and a test can trip the Overall_Budget
  //    with a fake clock while a phase promise is pending.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;

      // Serialize + validate + redact ONE line, then enqueue it. Returns true
      // when written, false when it failed validation (the caller then
      // terminates with a redacted Error_Line).
      const enqueueValidated = (line: LoversStreamLine): boolean => {
        const redacted = redactDeep(line, githubToken);
        const reRedacted = redactDeep(redacted, llmKey);
        const scrubbed = redactLine(reRedacted, openrouterKey, userKey);
        const parsed = LoversStreamLineSchema.safeParse(scrubbed);
        if (!parsed.success) return false;
        controller.enqueue(encoder.encode(JSON.stringify(parsed.data) + "\n"));
        return true;
      };

      // Write a non-terminal line (phase / notice). An invalid line never
      // reaches the wire; instead the stream terminates with a redacted
      // Error_Line (R19.1).
      const write = (line: LoversStreamLine): void => {
        if (finished) return;
        if (!enqueueValidated(line)) {
          terminateInvalid();
        }
      };

      // Terminate with exactly one Error_Line for a given thrown value.
      const terminateError = (err: unknown): void => {
        if (finished) return;
        // Log ONLY the stable tag, the NecroError code (when present), the
        // message and the stack — never tokens, env, request body, or the
        // mapped `userMessage` (which may echo caller input) (R19.4).
        console.error(
          "[api/lovers] binding failed:",
          err instanceof NecroError ? err.code : undefined,
          err instanceof Error ? err.message : String(err),
          err instanceof Error ? err.stack : undefined,
        );
        const mapped = mapError(mapEngineError(err), githubToken);
        finished = true;
        enqueueValidated({ error: mapped.body.error });
        controller.close();
      };

      // Terminate because a built line failed the stream schema (R19.1): do NOT
      // write the offending line; emit a fixed redacted Error_Line.
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
        enqueueValidated({ error: mapped.body.error });
        controller.close();
      };

      // Write the single terminal Result_Line and close.
      const writeResult = (result: LoversStreamLine): void => {
        if (finished) return;
        if (!enqueueValidated(result)) {
          terminateInvalid();
          return;
        }
        finished = true;
        controller.close();
      };

      // Wire the Overall_Budget: on fire, emit a NETWORK_TIMEOUT Error_Line and
      // close. Cancelled once a terminal line is written.
      const overall = setTimer(OVERALL_BUDGET_MS, () => {
        terminateError(new NecroError("NETWORK_TIMEOUT", OVERALL_TIMEOUT_MESSAGE));
      });
      const cancelOverall = (): void => overall.cancel();

      void runBinding({
        deps,
        request,
        now,
        demo,
        soulSource,
        userKey,
        serverKeyPresent: openrouterKey !== undefined,
        write,
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
 * Source the resurrected Python 3 of the file, enforce the precondition, choose
 * the LLM port from the soul source + breakers, drive the LoversRunner, and
 * write the terminal line. Any throw after streaming began is carried as a
 * final `{ error }` line (status is already 200).
 */
async function runBinding(args: {
  deps: LoversHandlerDeps;
  request: {
    ref: string;
    file: string;
    targetLang: "javascript";
    spread: "fates" | "necropsy";
    models?: { fast?: string | undefined; strong?: string | undefined } | undefined;
    demo?: true | undefined;
  };
  now: string;
  demo: boolean;
  soulSource: SoulSource;
  userKey: string | undefined;
  serverKeyPresent: boolean;
  write: (line: LoversStreamLine) => void;
  writeResult: (line: LoversStreamLine) => void;
  terminateError: (err: unknown) => void;
  isFinished: () => boolean;
  cancelOverall: () => void;
}): Promise<void> {
  const {
    deps,
    request,
    now,
    demo,
    soulSource,
    userKey,
    serverKeyPresent,
    write,
    writeResult,
    terminateError,
    isFinished,
    cancelOverall,
  } = args;

  // A demo blocks outbound network for the whole run (R15.4); restored in
  // `finally`. For a live run this is a no-op guard we never install.
  let restoreNetwork: (() => void) | null = null;

  try {
    const llmOpen = deps.breakers.llmOpen();

    // --- Source the RESURRECTED Python 3 of the file (R16.1) -----------------
    let resurrected: ResurrectedFile;
    if (demo) {
      if (deps.loadDemoLovers === undefined || deps.demoLlm === undefined) {
        throw new NecroError(
          "UPSTREAM_UNAVAILABLE",
          "No replay is kept in this crypt.\nDemo mode is not available here.",
        );
      }
      resurrected = await deps.loadDemoLovers(now);
      if (isFinished()) return;
      restoreNetwork = installNetworkBlockGuard();
    } else {
      // Live: summon the pinned ref, run the in-scope reading, enforce the
      // LOVERS-drawn precondition (R14.4), then resurrect the file to Python 3.
      const parsedRef = parseRepoRef(request.ref);
      const summonResult = await deps.github.summon(parsedRef);
      if (isFinished()) return;

      const external = await deps.github.externalData(summonResult.snapshot);
      if (isFinished()) return;

      const readOpts: ReadingOpts = { spreadKind: request.spread, now };
      if (external.registryData.size > 0) readOpts.registryData = external.registryData;
      if (external.osvData.length > 0) readOpts.osvData = external.osvData;

      const reading = await deps.runReading(summonResult.snapshot, readOpts);
      if (isFinished()) return;

      // R14.4: no completed reading in scope — the cards were never cast.
      if (reading.draws.length === 0) {
        terminateError(new NecroError("VALIDATION_FAILED", NO_READING_MESSAGE));
        return;
      }

      // R14.4 precondition: THE LOVERS (VI) must be in the reading. The
      // `lovers` card id is matched as a widened string (mirrors
      // `loversEligible`) so this stays forward-compatible with the deck's
      // `lovers` detector. Not drawn => typed VALIDATION_FAILED, NO model call.
      const loversDrawn = reading.draws.some(
        (draw) => (draw.card as string) === LOVERS_CARD_ID,
      );
      if (!loversDrawn) {
        terminateError(
          new NecroError("VALIDATION_FAILED", loversPreconditionMessage(request.file)),
        );
        return;
      }

      // Resurrect the requested file to Python 3 (R16.1). The resurrect runner
      // runs deterministic-only here (no LlmPort injected) — the Lovers input
      // only needs the file's resurrected source, and keeping this step
      // deterministic spends no souls before the binding itself.
      const inputBase = {
        pairId: "python2->python3",
        snapshot: summonResult.snapshot,
        reading,
        target: { kind: "file", path: request.file } as const,
        spread: request.spread,
        now,
        demo: false,
      } satisfies RitualInput;
      const resurrectInput: RitualInput = {
        ...inputBase,
        ...(external.registryData.size > 0
          ? { registryData: external.registryData }
          : {}),
        ...(external.osvData.length > 0 ? { osvData: external.osvData } : {}),
      };
      const resurrectPorts = buildRitualPorts({
        clock: deps.clock,
        ledger: deps.makeLedger(),
      });
      const outcome = await deps.resurrectRunner.run(
        resurrectInput,
        resurrectPorts,
        { phase: () => undefined, skipNote: () => undefined },
      );
      if (isFinished()) return;

      // Find the resurrected after-content of the requested file. A file not in
      // the result (not a py2 candidate, or filtered out) means it is not
      // resurrectable — the precondition fails with NO model call (R14.4).
      const fileResult = outcome.result.files.find((f) => f.path === request.file);
      if (fileResult === undefined || fileResult.after.trim().length === 0) {
        terminateError(
          new NecroError("VALIDATION_FAILED", loversPreconditionMessage(request.file)),
        );
        return;
      }
      resurrected = { file: request.file, source: fileResult.after };
    }

    if (isFinished()) return;

    // --- Choose the LLM port for THIS request (D.4 / D.5) --------------------
    //
    // YOURS   build the BYOK provider PER REQUEST from the user key (works even
    //         with NO server key). The server spend ceiling is SKIPPED (the
    //         per-IP abuse limit ran PRE-STREAM — R24.2/R24.3). A BYOK 401/402
    //         is the HARD case: a typed oracle-voice error, never a silent
    //         fallback to the server key.
    // ORACLE  the server OpenRouter provider (`deps.llm`), subject to the spend
    //         breaker. A shortfall SOFT-degrades (NOTICE line, never an error):
    //         an open breaker, or no provider at all, omits the LlmPort so the
    //         runner runs the deterministic template path.
    let llmForRequest: LlmPort | undefined;
    if (soulSource === "YOURS") {
      llmForRequest =
        deps.makeUserLlm !== undefined && userKey !== undefined
          ? deps.makeUserLlm(userKey)
          : deps.llm;
      // YOURS deliberately IGNORES the server spend breaker (the user pays).
    } else {
      if (llmOpen) {
        llmForRequest = undefined;
        write({ skip: true, note: DEGRADE_BREAKER_NOTICE });
        if (isFinished()) return;
      } else if (deps.llm === undefined) {
        llmForRequest = undefined;
        if (!serverKeyPresent) {
          write({ skip: true, note: DEGRADE_NO_KEY_NOTICE });
          if (isFinished()) return;
        }
      } else {
        llmForRequest = deps.llm;
      }
    }

    // Model overrides are honoured ONLY when YOURS (R40.2/R40.3). On ORACLE the
    // override is set aside and a single oracle-voice NOTICE line is emitted;
    // `resolveModel` then receives `undefined`.
    let modelOverride: LoversRunnerInput["modelOverride"];
    const requestedModels = request.models;
    if (soulSource === "YOURS" && requestedModels !== undefined) {
      modelOverride = {
        ...(requestedModels.fast !== undefined ? { fast: requestedModels.fast } : {}),
        ...(requestedModels.strong !== undefined ? { strong: requestedModels.strong } : {}),
      };
    } else {
      modelOverride = undefined;
      if (soulSource === "ORACLE" && requestedModels !== undefined) {
        write({ skip: true, note: OVERRIDES_IGNORED_NOTICE });
        if (isFinished()) return;
      }
    }

    // In demo mode the Mock provider drives a deterministic, offline binding.
    const llmForRun: LlmPort | undefined = demo ? deps.demoLlm : llmForRequest;

    // The LoversRunner phase reporter: one `{ phase }` line per phase.
    const emit: LoversEmit = {
      phase: (phase) => {
        write({ phase });
      },
    };

    const loversPorts: LoversPorts = buildLoversPorts({
      clock: deps.clock,
      ledger: deps.makeLedger(),
      llm: llmForRun,
      router: deps.router,
      cache: deps.makeCache?.(),
    });

    const loversInput: LoversRunnerInput = {
      source: resurrected.source,
      file: resurrected.file,
      targetLang: "javascript",
      soulSource,
      demo,
      ...(modelOverride !== undefined ? { modelOverride } : {}),
    };

    // Drive the LoversRunner. It never throws for a model shortfall — it falls
    // back to the deterministic template path — so a thrown error here is a
    // genuine fault (precondition defence-in-depth, or a provider error threaded
    // outward). A YOURS 401/402 surfaces as UPSTREAM_UNAVAILABLE: the HARD case,
    // mapped to the typed oracle-voice error below with NO server-key fallback.
    const result = await deps.loversRunner.run(loversInput, loversPorts, emit);
    if (isFinished()) return;

    writeResult({ result });
  } catch (err) {
    // A YOURS-key OpenRouter 401/402 threaded out of the runner stays the one
    // HARD typed case (R28.1/R28.2): surface it as the typed oracle-voice
    // UPSTREAM_UNAVAILABLE error, never a silent fallback to the server key.
    if (soulSource === "YOURS" && isByokAuthFailure(err)) {
      terminateError(new NecroError("UPSTREAM_UNAVAILABLE", BYOK_AUTH_FAILED_MESSAGE));
    } else {
      terminateError(err);
    }
  } finally {
    if (restoreNetwork !== null) restoreNetwork();
    cancelOverall();
  }
}

/**
 * Is `err` an OpenRouter authorization/payment failure (`401`/`402`) threaded
 * out of a provider? The OpenRouter provider maps `401`/`402` onto
 * `UPSTREAM_UNAVAILABLE` (design A.2), so a `NecroError` with that code raised
 * on a YOURS request is treated as the HARD BYOK auth failure.
 */
function isByokAuthFailure(err: unknown): boolean {
  return err instanceof NecroError && err.code === "UPSTREAM_UNAVAILABLE";
}

/**
 * Build the `RitualPorts` for the deterministic file-resurrection step, omitting
 * any absent optional port (exactOptionalPropertyTypes) so the runner reads an
 * ABSENT `llm`/`sandbox` and runs deterministic-only.
 */
function buildRitualPorts(args: {
  clock: RitualPorts["clock"];
  ledger: LedgerPort;
}): RitualPorts {
  return { clock: args.clock, ledger: args.ledger };
}

/**
 * Build the `LoversPorts`, omitting any absent optional port so the runner
 * reads an ABSENT `llm`/`router`/`cache` (the deterministic template path) when
 * none is provided.
 */
function buildLoversPorts(args: {
  clock: LoversPorts["clock"];
  ledger: LedgerPort;
  llm: LlmPort | undefined;
  router: ModelRouterPort | undefined;
  cache: LlmCachePort | undefined;
}): LoversPorts {
  const base: { clock: LoversPorts["clock"]; ledger: LedgerPort } = {
    clock: args.clock,
    ledger: args.ledger,
  };
  const withLlm = args.llm === undefined ? base : { ...base, llm: args.llm };
  const withRouter =
    args.router === undefined ? withLlm : { ...withLlm, router: args.router };
  return args.cache === undefined ? withRouter : { ...withRouter, cache: args.cache };
}
