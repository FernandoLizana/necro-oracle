// apps/web/src/server/handlers/readings.ts
//
// Feature: 03-crt-terminal, task 26.2.
//
// The Reading_Route handler `handleReading` (design.md §"Streamed progress and
// time budgets", decisions D13 NDJSON transport, D14 pure monotonic phase
// reporter, D15 Overall_Budget/External_Sub_Budget; §"Handler pipeline"). It
// drives one reading through the shared guard pipeline, then streams an NDJSON
// body: one Progress_Event (phase) line per Reading_Phase as it begins, an
// optional skip-note line when external enrichment is skipped, and a final
// `{ result }` (a validated Reading_Response) or `{ error }` (an
// Error_Envelope) line.
//
// Two time budgets are scheduled through the injectable `setTimer` seam so the
// tests can drive them with a fake clock (design D15 — "all timers in tests are
// driven by ClockPort"). BOTH budgets are scheduled SYNCHRONOUSLY at handler
// entry (before any `await`), as deadlines "from request receipt" (design D15):
//   - Overall_Budget   40 s: on fire, write a final { error: NETWORK_TIMEOUT }
//                            line and close; a flag suppresses any later write.
//                            Cancelled once the final { result } line is sent.
//   - External_Sub_Budget 10 s: its signal races `github.externalData`; a
//                            timeout (or an externalData result carrying a
//                            non-empty `skipped`) makes `decideExternalSkip`
//                            skip enrichment — the route emits a skip-note and
//                            calls `runReading` with `registryData`/`osvData`
//                            both OMITTED (R6.22), never fabricating data.
// Scheduling at entry (not deep in the pipeline) is what lets a test advance
// its fake clock a single microtask after calling the handler and still trip
// the budget while a phase promise it controls is pending.
//
// Everything leaving the stream is token-redacted: mapped errors via the error
// mapper, and the whole Reading_Response via `redactDeep`, so a token echoed in
// `reading.errors[].userMessage` never reaches the wire (R14.7). The snapshot's
// runtime file `contents` and file list never cross the boundary — only
// `toSummonSummary`'s public fields plus the oracle Reading do (R6.6, R12.11).
//
// Pipeline order (shares guard steps 1-3 with the Summon_Route):
//   1. method guard: non-POST -> 405 + Allow: POST (pre-stream)
//   2. checkLimit BEFORE any GitHub work -> 429 on denial (R12.9, R13.1)
//   3. readJsonBody -> 400/413 on a body-guard failure (pre-stream)
//   4. ReadingRequestSchema.safeParse (strict; rejects celtic and non-40-hex /
//      uppercase refs per Q15/R6.4) -> 400 VALIDATION_FAILED Error_Envelope,
//      PRE-STREAM (no NDJSON, no github.summon)
//   5. begin streaming (200 application/x-ndjson, no-store, nosniff); run the
//      SUMMON/DOWNLOAD/EXTERNAL/READING pipeline under the Overall_Budget,
//      validate + redact the Reading_Response, write the final { result } line.
//   6. any throw after streaming began -> final { error } line at status 200.
//
// _Requirements: R6.4, R6.5, R6.6, R6.7, R6.11, R6.14, R6.16, R6.19, R6.20, R6.22, R12.8, R12.9, R12.10, R12.11, R14.7_

import { parseRepoRef, type ExternalDataResult } from "@necro/github";
import { NecroError } from "@necro/oracle/client";
import type { ReadingOpts } from "@necro/oracle";
import type { ReadingResponse } from "@necro/ui-crt";

import { ReadingRequestSchema, ReadingResponseSchema } from "../../protocol/schemas.js";
import type { StreamLine } from "../../protocol/stream.js";
import type { RouteDeps } from "../deps.js";
import { mapError } from "../error-map.js";
import { redactDeep, redactSecrets } from "../redact.js";
import { NECRO_CANARY } from "../canary.js";
import { decideExternalSkip, EXTERNAL_SUB_BUDGET_MS } from "./external-skip.js";
import { checkLimit, errorResponse, methodNotAllowed, readJsonBody } from "./guard.js";
import { createPhaseReporter } from "./phase.js";
import { toSummonSummary } from "./summon.js";

/** The Overall_Budget: a 40 s deadline per reading (design.md D15). */
const OVERALL_BUDGET_MS = 40_000;

/** A handle to a scheduled budget timer; cancelling prevents a late fire. */
export type TimerHandle = { cancel(): void };

/** Schedule `cb` to run `ms` from now, returning a cancellable handle. */
export type SetTimer = (ms: number, cb: () => void) => TimerHandle;

/**
 * The Reading_Route deps: the shared `RouteDeps` plus one optional budget seam.
 * In production `setTimer` is undefined and the handler falls back to a
 * `setTimeout`-backed timer; in tests it is injected with a fake-clock timer so
 * both budgets are deterministic.
 */
export interface ReadingDeps extends RouteDeps {
  readonly setTimer?: SetTimer;
}

/** The fixed Oracle-voice message for a request body that fails the schema. */
const INVALID_REQUEST_MESSAGE =
  "The offering is malformed.\nName a public repository, a commit sha, and a playable spread.";

/**
 * A `setTimeout`-backed `SetTimer` for production, where no fake clock is
 * injected. Not exercised by the tests (they always inject a fake-clock timer).
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
 * Handle one `POST /api/readings`. Guard failures (method, limiter, body guard,
 * request-schema) return a plain Error_Envelope BEFORE any streaming begins;
 * once the schema passes, the handler commits to a `200 application/x-ndjson`
 * stream and carries every subsequent outcome — success or failure — as the
 * final line of that stream.
 */
export async function handleReading(req: Request, deps: ReadingDeps): Promise<Response> {
  const setTimer = deps.setTimer ?? defaultSetTimer;

  // Schedule BOTH budgets synchronously, up front, as deadlines from request
  // receipt (design D15). The external-budget signal is a promise resolved by
  // its timer; the overall-budget sets a flag + a callback invoked once the
  // stream controller exists. Scheduling here (before the async guards) is what
  // keeps the budgets deterministic under the fake clock.
  const budgets = startBudgets(setTimer);

  try {
    // 1. Method guard (R12.2) — before any limiter spend or GitHub work.
    if (req.method !== "POST") {
      return methodNotAllowed(req);
    }

    // 2. Rate limit BEFORE any GitHub request (R12.9, R13.1).
    const limited = await checkLimit(req, deps, "readings");
    if (limited !== null) return limited;

    // 3. Body guards: content-type, size, JSON (R12.1, R12.3).
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;

    // 4. Strict wire-schema validation (R6.4, Q15): a celtic spread or a non
    //    40-hex-lowercase ref is rejected here, PRE-STREAM, as an HTTP 400
    //    Error_Envelope — nothing reaches GitHub.
    const parsedBody = ReadingRequestSchema.safeParse(body.value);
    if (!parsedBody.success) {
      return errorResponse(400, "VALIDATION_FAILED", INVALID_REQUEST_MESSAGE);
    }
    const request = parsedBody.data;

    const token = deps.env.get("GITHUB_TOKEN");
    const now = new Date(deps.clock.nowMs()).toISOString();

    // 5. Begin streaming. The pipeline runs inside the stream's `start`, so the
    //    Response resolves immediately and a test can advance its fake clock to
    //    trip a budget while a phase promise is still pending.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let finished = false;
        const write = (line: StreamLine): void => {
          if (finished) return;
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        };
        const finish = (): void => {
          if (finished) return;
          finished = true;
          budgets.cancelOverall();
          controller.close();
        };

        // Wire the Overall_Budget to this controller. If it already fired
        // during the guards (flag set), emit the timeout line immediately.
        const onTimeout = (): void => {
          if (finished) return;
          const mapped = mapError(
            new NecroError(
              "NETWORK_TIMEOUT",
              "The reading ran past its allotted hour.\nThe veil closed before the oracle could finish.",
            ),
            token,
          );
          finished = true;
          controller.enqueue(encoder.encode(JSON.stringify({ error: mapped.body.error }) + "\n"));
          controller.close();
        };
        budgets.bindOverall(onTimeout);
        if (budgets.overallFired()) {
          onTimeout();
          return;
        }

        const reporter = createPhaseReporter(write);

        void runPipeline({
          deps,
          request,
          now,
          token,
          reporter,
          budgets,
          write,
          isFinished: () => finished,
          finish,
        });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } finally {
    // A pre-stream return never binds the overall timer; cancel it so no stray
    // callback lingers. (When streaming began, `bindOverall` has been called
    // and this cancel is a no-op unless the stream already finished.)
    budgets.cancelOverallIfUnbound();
  }
}

/** The budget bundle scheduled once, synchronously, at handler entry. */
interface Budgets {
  /**
   * Item 28: ARM the External_Sub_Budget timer AT the EXTERNAL phase (not at
   * request receipt), so a slow SUMMON/DOWNLOAD never shrinks external's full
   * 10 s window. Returns the deadline signal + a canceller the pipeline calls
   * once the external race settles. Called exactly once, at EXTERNAL.
   */
  armExternal(): { readonly deadline: Promise<void>; cancel(): void };
  /** Attach the stream's timeout emitter to the (already scheduled) overall timer. */
  bindOverall(onTimeout: () => void): void;
  /** Whether the overall timer fired before it was bound to a controller. */
  overallFired(): boolean;
  /** Cancel the Overall_Budget timer (called once the final line is written). */
  cancelOverall(): void;
  /** Cancel the overall timer only if it was never bound to a stream. */
  cancelOverallIfUnbound(): void;
}

/**
 * Schedule both budgets against the injected timer. The external deadline is a
 * promise that resolves when the 10 s timer fires; the overall timer sets a
 * `fired` flag and, once a controller is bound, invokes its `onTimeout`.
 */
function startBudgets(setTimer: SetTimer): Budgets {
  let onTimeout: (() => void) | null = null;
  let fired = false;
  let bound = false;

  const overall = setTimer(OVERALL_BUDGET_MS, () => {
    fired = true;
    if (onTimeout !== null) onTimeout();
  });

  return {
    // Item 28: the external timer is created HERE, when EXTERNAL begins, so its
    // 10 s window is measured from the EXTERNAL phase - never shrunk by the
    // time SUMMON + DOWNLOAD already spent. The pipeline cancels it when
    // externalData wins the race, so no pending timer lingers past completion.
    armExternal() {
      let resolveExternal!: () => void;
      const deadline = new Promise<void>((resolve) => {
        resolveExternal = resolve;
      });
      const external = setTimer(EXTERNAL_SUB_BUDGET_MS, () => resolveExternal());
      return {
        deadline,
        cancel() {
          external.cancel();
        },
      };
    },
    bindOverall(cb) {
      bound = true;
      onTimeout = cb;
    },
    overallFired() {
      return fired;
    },
    cancelOverall() {
      overall.cancel();
    },
    cancelOverallIfUnbound() {
      if (!bound) overall.cancel();
    },
  };
}

/**
 * Run the SUMMON -> DOWNLOAD -> EXTERNAL -> READING pipeline and write the
 * final line. Any throw after streaming began is carried as a final `{ error }`
 * line (status is already 200). `finish()` cancels the Overall_Budget timer, so
 * no late error can fire after the final line is written.
 */
async function runPipeline(args: {
  deps: ReadingDeps;
  request: { ref: string; spread: "fates" | "necropsy" };
  now: string;
  token: string | undefined;
  reporter: ReturnType<typeof createPhaseReporter>;
  budgets: Budgets;
  write: (line: StreamLine) => void;
  isFinished: () => boolean;
  finish: () => void;
}): Promise<void> {
  const { deps, request, now, token, reporter, budgets, write, isFinished, finish } = args;

  try {
    // a. SUMMON: pin and fetch the snapshot.
    reporter.report("SUMMON");
    const parsedRef = parseRepoRef(request.ref);
    const summonResult = await deps.github.summon(parsedRef);
    if (isFinished()) return;

    // b. DOWNLOAD: emitted exactly once even on a cache hit (R6.16) — the
    //    phase reporter guarantees once-only, so we never branch on cache.
    reporter.report("DOWNLOAD");

    // c. EXTERNAL: race external enrichment against the 10 s sub-budget signal.
    //    Item 28: the sub-budget is ARMED HERE, as the EXTERNAL phase begins,
    //    so its full 10 s window is never shrunk by a slow SUMMON/DOWNLOAD.
    reporter.report("EXTERNAL");
    const externalBudget = budgets.armExternal();
    const external = await raceExternal({
      deps,
      snapshot: summonResult.snapshot,
      externalDeadline: externalBudget.deadline,
    });
    // The race has settled either way; cancel the sub-budget timer so no
    // pending timer lingers past the reading's completion.
    externalBudget.cancel();
    if (isFinished()) return;
    const decision = decideExternalSkip({
      elapsedMs: external.elapsedMs,
      skipped: external.skipped,
    });
    if (decision.skip) {
      reporter.skipNote(decision.note);
    }

    // d. READING: run the oracle. On skip, omit registryData/osvData entirely
    //    (exactOptionalPropertyTypes — the keys must be ABSENT, not undefined)
    //    so nothing is fabricated (R6.22); otherwise pass the real references.
    reporter.report("READING");
    const readOpts: ReadingOpts =
      decision.skip || external.data === null
        ? { spreadKind: request.spread, now }
        : {
            spreadKind: request.spread,
            now,
            registryData: external.data.registryData,
            osvData: external.data.osvData,
          };
    const reading = await deps.runReading(summonResult.snapshot, readOpts);
    if (isFinished()) return;

    // e. Assemble, redact and validate the Reading_Response, then write the
    //    final { result } line. The redaction scrubs any token echoed inside
    //    the Reading (R14.7); the schema parse guards against a malformed
    //    Reading escaping as a bad result (R6.7). Only public summary fields
    //    plus the Reading cross the boundary — never snapshot contents (R6.6).
    const response: ReadingResponse = {
      summary: toSummonSummary(summonResult),
      reading,
    };
    const redacted = redactDeep(response, token);
    // SEC-10: the leak canary is always scrubbed from the response body.
    const canaried = redactDeep(redacted, NECRO_CANARY);
    const safe = ReadingResponseSchema.parse(canaried);

    if (isFinished()) return; // The Overall_Budget already closed the stream.
    write({ result: safe });
    finish();
  } catch (err) {
    // f. Any throw after streaming began -> a final { error } line at 200.
    if (isFinished()) return;
    // Server-side observability (Vercel runtime logs): the handler's catch
    // previously mapped the error onto the stream but logged NOTHING, so a
    // production failure like PARSER_INIT_FAILED was invisible in the logs.
    // Log ONLY the stable tag, the NecroError machine code (when present), the
    // message and the stack — never the token, env, request body, or the
    // mapped `userMessage` (which may echo caller input).
    const logSecrets = [token, NECRO_CANARY] as const;
    console.error(
      "[api/readings] reading pipeline failed:",
      err instanceof NecroError ? err.code : undefined,
      redactSecrets(err instanceof Error ? err.message : String(err), logSecrets),
      redactSecrets(err instanceof Error ? err.stack : undefined, logSecrets),
    );
    const mapped = mapError(err, token);
    write({ error: mapped.body.error });
    finish();
  }
}

/** The outcome of the External_Sub_Budget race. */
interface ExternalOutcome {
  /** The fetched data, or null when the sub-budget tripped first. */
  readonly data: ExternalDataResult | null;
  /** The elapsed time fed to `decideExternalSkip`. */
  readonly elapsedMs: number;
  /** Whether external data reported a per-dependency skip (non-empty `skipped`). */
  readonly skipped: boolean;
}

/**
 * Race `github.externalData` against the External_Sub_Budget signal. When the
 * signal wins, resolve with `data: null` and an `elapsedMs` over the budget so
 * `decideExternalSkip` skips; when the data wins, resolve with its value, the
 * measured elapsed, and `skipped = (result.skipped non-empty)`. The gateway
 * never throws for per-dependency failures, so this surfaces only the timeout
 * vs. data outcome (a true throw propagates and is mapped by the caller).
 */
function raceExternal(args: {
  deps: ReadingDeps;
  snapshot: Parameters<RouteDeps["github"]["externalData"]>[0];
  externalDeadline: Promise<void>;
}): Promise<ExternalOutcome> {
  const { deps, snapshot, externalDeadline } = args;
  const startMs = deps.clock.nowMs();

  const dataOutcome: Promise<ExternalOutcome> = deps.github
    .externalData(snapshot)
    .then((data) => ({
      data,
      elapsedMs: deps.clock.nowMs() - startMs,
      skipped: data.skipped.length > 0,
    }));

  const timeoutOutcome: Promise<ExternalOutcome> = externalDeadline.then(() => ({
    data: null,
    elapsedMs: EXTERNAL_SUB_BUDGET_MS + 1,
    skipped: false,
  }));

  return Promise.race([dataOutcome, timeoutOutcome]);
}
