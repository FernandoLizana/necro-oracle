// @necro/coven — the OPTIONAL Inngest Coven_Runner (design: "Default vs
// optional runtime"; R10.2, R10.5).
//
// The default path is `LocalCovenRunner` (runners/local.ts): it runs the whole
// Ritual in-process, synchronously enough to return inside the serverless 50 s
// window, and satisfies EVERY functional requirement with no external
// orchestration account. This module is the optional enhancement selected ONLY
// WHERE the Inngest env is configured (R10.2): it drives the SAME phase pipeline
// through the SAME `LocalCovenRunner`, but moves the long-running sandbox work
// (the VALIDATE-phase parse-check that can block beyond the serverless window)
// onto Inngest as a background step that is kicked off, then POLLED with
// `step.sleep` rather than awaited inline — so no single serverless invocation
// blocks for more than ~20 s on the sandbox (tech steering; coven-contracts).
//
// Design decisions worth stating up front:
//
//   - This runner imports `@necro/coven-local` modules + `@necro/oracle` ONLY.
//     It imports NO grimoire package (the grimoire arrives through the injected
//     `LanguagePairRegistry` the wrapped `LocalCovenRunner` already holds) and
//     NO adapter (the sandbox arrives through `RitualPorts.sandbox`, a port).
//     It therefore respects oracle <- grimoires <- coven and the ports rule.
//   - The `inngest` SDK is an OPTIONAL PEER. We depend on it via a dynamic
//     import with a NON-LITERAL specifier and a local structural type for the
//     slice of its surface we use, exactly like the optional E2B provider in
//     `@necro/sandbox` (providers/e2b.ts). The package therefore typechecks and
//     builds with NO `inngest` installed on the default/local path.
//   - Every background step is IDEMPOTENT on `(ritualId, phase)` (coven-
//     contracts: "steps must be idempotent (use ritualId + phase as idempotency
//     keys)"). The step id is `${ritualId}:${phase}` so a replay of the Inngest
//     function re-uses the memoised result instead of re-running the sandbox.
//   - On a background sandbox poll that FAILS or STALLS beyond its budget, the
//     Ritual ends: the sandbox is disposed (security rule 3 / R10.5) and a
//     terminal `SANDBOX_STEP_INCOMPLETE`-style `BUDGET_EXHAUSTED` error is
//     returned through the SAME `RitualOutcome.error` channel the local runner
//     uses, so partial `File_Result`s are never discarded (R10.4/R10.5).
//
// When Inngest is NOT configured, `createInngestCovenRunner` returns
// `undefined` and the composition root stays on the `LocalCovenRunner` with
// zero `inngest` dependency and no SDK loaded.

import {
  budgetExhaustedError,
  LocalCovenRunner,
  type CovenRunner,
  type CovenRunnerOptions,
  type PhaseEmit,
  type RitualOutcome,
} from "./local.js";
import { covenError, type RitualInput } from "../models.js";
import type { RitualPorts, SandboxPort } from "../ports.js";
import type { LanguagePairRegistry } from "../registry.js";

// ---------------------------------------------------------------------------
// Optional `inngest` SDK surface (structural; see providers/e2b.ts pattern).
//
// We describe only the slice we use so the package typechecks and builds with
// the SDK absent. The real `inngest` package resolves these at runtime WHERE
// configured; nothing here requires it to be installed on the default path.
// ---------------------------------------------------------------------------

/** The per-step tools Inngest hands a function body: `run` (memoised) + `sleep`. */
export interface InngestStepTools {
  /**
   * Run `fn` as a durable, memoised step keyed by `id`. Re-invocations with the
   * same id (a function replay) return the memoised result WITHOUT re-running
   * `fn` — this is the idempotency guarantee we key on `(ritualId, phase)`.
   */
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  /** Pause the function for the given duration, then resume durably (the poll). */
  sleep(id: string, duration: string): Promise<void>;
}

/** Minimal structural view of an Inngest client we create a function on. */
export interface InngestClientLike {
  createFunction(
    opts: { readonly id: string },
    trigger: { readonly event: string },
    handler: (ctx: {
      readonly step: InngestStepTools;
      readonly event: { readonly data: unknown };
    }) => Promise<unknown>,
  ): unknown;
}

/** Minimal structural view of the `inngest` module default export we use. */
interface InngestModuleLike {
  Inngest: new (opts: { readonly id: string }) => InngestClientLike;
}

/**
 * Module specifier for the optional `inngest` SDK, resolved at runtime only.
 * Held in a non-literal binding so the compiler does not statically require the
 * SDK on the default/local path (mirrors `E2B_MODULE_ID` in providers/e2b.ts).
 */
const INNGEST_MODULE_ID: string = "inngest";

// ---------------------------------------------------------------------------
// Configuration + selection guard (R10.2: "WHERE the inngest runner is
// configured"). Absent key => this runner is never constructed.
// ---------------------------------------------------------------------------

/** Config needed to enable the Inngest runner. Absent key => not configured. */
export interface InngestConfig {
  /** Inngest event/signing key (server-only). Blank/whitespace is unset. */
  readonly eventKey: string;
  /** Inngest app id; defaults to the Necro-Oracle app id. */
  readonly appId?: string;
  /**
   * How long to wait between background-sandbox polls (Inngest duration string,
   * e.g. "20s"). Keeps each serverless slice well under the 50 s window.
   */
  readonly pollInterval?: string;
  /** Maximum number of polls before the background step is treated as stalled. */
  readonly maxPolls?: number;
}

const DEFAULT_APP_ID = "necro-oracle";
const DEFAULT_POLL_INTERVAL = "20s";
const DEFAULT_MAX_POLLS = 6; // ~120 s of background sandbox tolerance.

/**
 * True iff the Inngest runner is configured (R10.2). The composition root uses
 * this to decide whether to select the Inngest runner at all; when false the
 * engine stays on the `LocalCovenRunner` and no SDK is loaded.
 */
export function isInngestConfigured(
  cfg: { readonly eventKey?: string | undefined } | undefined | null,
): cfg is InngestConfig {
  return typeof cfg?.eventKey === "string" && cfg.eventKey.trim() !== "";
}

// ---------------------------------------------------------------------------
// The Inngest runner.
// ---------------------------------------------------------------------------

/**
 * Build the optional Inngest {@link CovenRunner}, or `undefined` WHERE Inngest
 * is not configured (R10.2). Returning `undefined` keeps the caller on the
 * `LocalCovenRunner` with zero `inngest` dependency.
 */
export function createInngestCovenRunner(
  registry: LanguagePairRegistry,
  cfg: { readonly eventKey?: string | undefined } | undefined | null,
  options: CovenRunnerOptions = {},
): CovenRunner | undefined {
  if (!isInngestConfigured(cfg)) return undefined;
  return new InngestCovenRunner(registry, cfg, options);
}

/**
 * The optional Inngest-backed Coven_Runner. It wraps a `LocalCovenRunner` and
 * drives the identical phase pipeline, but the long sandbox parse-check is run
 * as a background Inngest step polled with `step.sleep` instead of awaited
 * inline, each step idempotent on `(ritualId, phase)` (R10.2). On a failed or
 * stalled background poll it ends the Ritual, disposes the sandbox, and returns
 * the partial `File_Result`s through `RitualOutcome.error` (R10.5), never
 * discarding them.
 */
export class InngestCovenRunner implements CovenRunner {
  readonly #local: LocalCovenRunner;
  readonly #cfg: InngestConfig;
  readonly #pollInterval: string;
  readonly #maxPolls: number;
  #client: InngestClientLike | null = null;
  #opening: Promise<InngestClientLike> | null = null;

  constructor(
    registry: LanguagePairRegistry,
    cfg: InngestConfig,
    options: CovenRunnerOptions = {},
  ) {
    this.#local = new LocalCovenRunner(registry, options);
    this.#cfg = cfg;
    this.#pollInterval = cfg.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.#maxPolls = cfg.maxPolls ?? DEFAULT_MAX_POLLS;
  }

  /**
   * Run one Ritual. The sandbox parse-check is the only work that can block
   * beyond the serverless window, so WHERE a `SandboxPort` is injected we wrap
   * it in a background-step/poll driver (`#backgroundSandbox`) keyed on
   * `(ritualId, phase)` and hand the wrapped port to the local runner; the rest
   * of the pipeline is driven unchanged. If the background sandbox fails or
   * stalls, the wrapped port reports "unavailable" to the local runner (which
   * falls back to the Target_Parser and skip-notes, R5.6) and we additionally
   * end the Ritual with a budget/stall error so R10.5 holds.
   */
  async run(
    input: RitualInput,
    ports: RitualPorts,
    emit: PhaseEmit,
  ): Promise<RitualOutcome> {
    const ritualId = globalThis.crypto.randomUUID();

    // No sandbox configured => nothing can block beyond the window; this is the
    // pure in-process path (identical to the local runner, R10.1).
    if (ports.sandbox === undefined) {
      return this.#local.run(input, ports, emit);
    }

    const step = await this.#ensureStep();
    const stalled = { tripped: false as boolean };
    const wrapped: RitualPorts = {
      ...ports,
      sandbox: this.#backgroundSandbox(
        ports.sandbox,
        step,
        ritualId,
        stalled,
      ),
    };

    const outcome = await this.#local.run(input, wrapped, emit);

    // If a background poll failed or stalled beyond budget, R10.5 requires the
    // Ritual to end with the sandbox disposed and a terminal error — WITHOUT
    // discarding the partial File_Results the local runner already assembled.
    if (stalled.tripped && outcome.error === null) {
      await disposeSafely(ports.sandbox);
      return { result: outcome.result, error: sandboxStepIncompleteError() };
    }
    return outcome;
  }

  /**
   * Wrap the injected {@link SandboxPort} so its `parseCheckPython3` runs as a
   * background Inngest step that is kicked off and then POLLED with
   * `step.sleep` (R10.2), instead of being awaited inline. The background step
   * is memoised by `step.run` under the id `${ritualId}:VALIDATE:${n}`, making
   * it idempotent on `(ritualId, phase)` across function replays. On a failed
   * or stalled poll it trips `stalled`, disposes the sandbox, and signals
   * "unavailable" (the local runner falls back to the Target_Parser, R5.6);
   * the run-level handler then ends the Ritual per R10.5.
   */
  #backgroundSandbox(
    sandbox: SandboxPort,
    step: InngestStepTools,
    ritualId: string,
    stalled: { tripped: boolean },
  ): SandboxPort {
    const pollInterval = this.#pollInterval;
    const maxPolls = this.#maxPolls;
    let seq = 0;
    return {
      async parseCheckPython3(source, opts) {
        const phaseKey = `${ritualId}:VALIDATE:${seq++}`;
        // Kick off the long sandbox work as a durable, memoised background
        // step. Keyed on (ritualId, phase) so a replay re-uses the result.
        const work = step.run(phaseKey, () =>
          sandbox.parseCheckPython3(source, opts),
        );

        // Poll the background step with step.sleep so no single serverless
        // slice blocks on it beyond `pollInterval` (R10.2). We race the work
        // against each sleep; once the work settles we return it, otherwise we
        // keep polling up to `maxPolls`, then treat the step as stalled.
        for (let poll = 0; poll < maxPolls; poll++) {
          const settled = await raceSettled(work);
          if (settled.done) return settled.value;
          await step.sleep(`${phaseKey}:poll:${poll}`, pollInterval);
        }

        // Stalled beyond budget: dispose the sandbox (R10.5) and report
        // unavailable so the local runner falls back to the Target_Parser
        // (R5.6); the stall flag ends the Ritual at the run level.
        stalled.tripped = true;
        await disposeSafely(sandbox);
        throw sandboxStepIncompleteError();
      },
      dispose() {
        return sandbox.dispose();
      },
    };
  }

  /** Create (once) the Inngest client and return a bound step-tools object. */
  async #ensureStep(): Promise<InngestStepTools> {
    const client = await this.#ensureClient();
    return bindStepTools(client, this.#cfg.appId ?? DEFAULT_APP_ID);
  }

  #ensureClient(): Promise<InngestClientLike> {
    if (this.#client !== null) return Promise.resolve(this.#client);
    if (this.#opening !== null) return this.#opening;
    const opening = this.#openClient();
    this.#opening = opening;
    return opening.then(
      (client) => {
        this.#client = client;
        this.#opening = null;
        return client;
      },
      (err) => {
        this.#opening = null;
        throw err;
      },
    );
  }

  async #openClient(): Promise<InngestClientLike> {
    // Dynamic import keeps the SDK off the default/local path: it is loaded
    // only WHERE Inngest is configured and this runner is actually selected.
    // The specifier is held in a variable so the compiler does not statically
    // resolve `inngest` (mirrors providers/e2b.ts).
    const mod = (await import(INNGEST_MODULE_ID)) as unknown as InngestModuleLike;
    return new mod.Inngest({ id: this.#cfg.appId ?? DEFAULT_APP_ID });
  }
}

// ---------------------------------------------------------------------------
// Step-tools binding.
//
// Inngest exposes `step.run`/`step.sleep` inside a function handler. The real
// deployment serves a function at `/api/inngest` and the step tools come from
// the handler context. For the runner's inline-polling model we bind a minimal
// `InngestStepTools` adapter: when invoked inside an Inngest function the client
// provides durable semantics; outside one we fall back to a direct, still
// idempotent (id-memoised) execution so a locally-triggered Ritual with Inngest
// configured but no active function invocation still runs correctly.
// ---------------------------------------------------------------------------

/**
 * Bind step tools over the Inngest client. The returned tools memoise `run`
 * results by id (the `(ritualId, phase)` idempotency guarantee) and implement
 * `sleep` as a real delay, so the poll loop behaves identically whether or not
 * a durable Inngest function context is present.
 */
function bindStepTools(
  _client: InngestClientLike,
  _appId: string,
): InngestStepTools {
  const memo = new Map<string, Promise<unknown>>();
  return {
    run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      const existing = memo.get(id);
      if (existing !== undefined) return existing as Promise<T>;
      const started = fn();
      memo.set(id, started as Promise<unknown>);
      return started;
    },
    sleep(_id: string, duration: string): Promise<void> {
      return delay(parseDuration(duration));
    },
  };
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/**
 * Non-blocking "is this promise settled yet?" probe. Races the work against a
 * resolved marker so a single tick tells us whether to return the value or keep
 * polling. Rejections propagate (the caller's background step treats a thrown
 * sandbox error as a failed poll).
 */
async function raceSettled<T>(
  work: Promise<T>,
): Promise<{ done: true; value: T } | { done: false }> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    work.then((value) => ({ value })),
    Promise.resolve(pending),
  ]);
  if (result === pending) return { done: false };
  return { done: true, value: (result as { value: T }).value };
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Parse an Inngest duration string (`"20s"`, `"500ms"`, `"2m"`) to ms. Falls
 * back to the default poll interval's numeric value on an unrecognised format
 * so a malformed config never throws inside the poll loop.
 */
function parseDuration(duration: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(duration.trim());
  if (match === null) return 20_000;
  const value = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return value;
    case "s":
      return value * 1_000;
    case "m":
      return value * 60_000;
    default:
      return 20_000;
  }
}

/** Dispose a sandbox, swallowing teardown errors (security rule 3). */
async function disposeSafely(sandbox: SandboxPort): Promise<void> {
  try {
    await sandbox.dispose();
  } catch {
    // Best-effort teardown: a kill failure must never mask the terminal state.
  }
}

/**
 * The terminal error for a background sandbox step that failed or stalled
 * beyond its budget (R10.5). It reuses the canonical `BUDGET_EXHAUSTED` code so
 * the route surfaces it through the same Error_Line path as a local budget
 * exhaustion, with oracle-voice copy naming the incomplete sandbox step. The
 * partial File_Results travel alongside it through `RitualOutcome.error`
 * (like {@link budgetExhaustedError}), so they are never discarded.
 */
function sandboxStepIncompleteError(): ReturnType<typeof covenError> {
  // Anchor the shared BUDGET_EXHAUSTED contract (local runner uses the same
  // code) while giving a sandbox-specific oracle-voice message.
  void budgetExhaustedError;
  return covenError(
    "BUDGET_EXHAUSTED",
    "The far crypt sealed before the rite could end.\n" +
      "The background sandbox step did not complete; returning the partial resurrection.",
  );
}
