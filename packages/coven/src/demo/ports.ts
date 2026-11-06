// @necro/coven — Demo_Mode port assembly and the outbound-network guard
// (design: "Demo mode"; R14.2, R14.4). Browser-safe: imports the coven port
// types only — NO adapter package (`@necro/llm`, `@necro/sandbox`) and NO Node
// `fs`. The Mock `LlmPort` the demo wires is injected by the composition root
// (dependency direction: adapters are injected INTO coven through ports), never
// imported here.
//
// Two responsibilities:
//
//   1. `createDemoPorts` assembles the `RitualPorts` a demo Ritual runs with:
//      the injected Mock `LlmPort` (R14.4) and the clock/ledger, with the
//      OPTIONAL `SandboxPort` deliberately OMITTED so the demo touches no
//      micro-VM and no sandbox network — the deterministic Target_Parser alone
//      validates (R14.2/R14.5), which is exactly what the `lich-py2` fixtures
//      are authored for (Pre_Pass-sufficient, R16.1-R16.4).
//
//   2. `installNetworkBlockGuard` blocks any outbound network for the duration
//      of a demo Ritual: it replaces `globalThis.fetch` with a guard that
//      THROWS a typed `NecroError` rather than reaching the wire (R14.2), and
//      returns a restore function the caller invokes in a `finally` to put the
//      original `fetch` back. The Mock provider performs no I/O, so a well-behaved
//      demo never trips the guard; the guard is defence-in-depth so a stray
//      network call made anywhere during a demo fails loudly instead of leaking
//      out to the wire.

import { covenError } from "../models.js";
import type { ClockPort, LedgerPort, LlmPort, RitualPorts } from "../ports.js";

/**
 * The typed error the network guard throws when anything attempts an outbound
 * request during a demo Ritual (R14.2). oracle-voice, no path/secret/stack.
 */
export function demoNetworkBlockedError(): ReturnType<typeof covenError> {
  return covenError(
    "UPSTREAM_UNAVAILABLE",
    "The demo is sealed within the circle; no call may cross it.\n" +
      "Outbound network is blocked in demo mode.",
  );
}

/** The ports a demo Ritual needs: the injected Mock LLM plus clock + ledger. */
export interface DemoPortsInput {
  /** The deterministic, network-free Mock `LlmPort` (from `@necro/llm`). */
  readonly llm: LlmPort;
  readonly clock: ClockPort;
  readonly ledger: LedgerPort;
}

/**
 * Assemble the `RitualPorts` for a Demo_Mode Ritual (R14.4). The Mock `LlmPort`
 * is wired in; the OPTIONAL `SandboxPort` is omitted so the demo never spins up
 * a micro-VM and never reaches the sandbox network — the Target_Parser
 * validates, matching the Pre_Pass-sufficient `lich-py2` fixtures. `clock` and
 * `ledger` are the caller's injected ports so the demo ledger and budgets read
 * the same deterministic time as the rest of the engine.
 */
export function createDemoPorts(input: DemoPortsInput): RitualPorts {
  // `sandbox` is intentionally ABSENT (not `undefined`) — with
  // exactOptionalPropertyTypes the runner treats an absent key as "no sandbox"
  // and validates with the Target_Parser alone (R5.7).
  return {
    clock: input.clock,
    ledger: input.ledger,
    llm: input.llm,
  };
}

/**
 * A `fetch`-shaped function. We type the guard structurally rather than against
 * the DOM/Node `fetch` type so this module stays free of any lib-dom/global
 * coupling; the signature is wide enough to stand in wherever `globalThis.fetch`
 * is read.
 */
type FetchLike = (...args: readonly unknown[]) => Promise<unknown>;

/** The mutable global surface we read/write `fetch` on. `fetch` may be absent. */
interface FetchGlobal {
  fetch?: FetchLike;
}

/**
 * Block all outbound network for the duration of a demo Ritual (R14.2).
 *
 * Replaces `globalThis.fetch` with a guard that THROWS `demoNetworkBlockedError`
 * before reaching the wire, and returns a `restore` function that puts the
 * original `fetch` back. Call it around the demo run:
 *
 * ```ts
 * const restore = installNetworkBlockGuard();
 * try {
 *   await runner.run(demoInput, demoPorts, demoReporter);
 * } finally {
 *   restore();
 * }
 * ```
 *
 * The guard is synchronous to install and restore, idempotent-safe (restoring
 * twice is harmless), and never itself performs I/O. It is defence-in-depth: the
 * Mock provider and the sandbox-less demo ports make no network calls, so a
 * correct demo never trips it.
 */
export function installNetworkBlockGuard(): () => void {
  const g = globalThis as unknown as FetchGlobal;
  const original = g.fetch;

  const blocked: FetchLike = () => Promise.reject(demoNetworkBlockedError());
  g.fetch = blocked;

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    // Only restore if we are still the installed guard; if something replaced
    // fetch in the meantime, leave that in place rather than clobbering it.
    if (g.fetch !== blocked) return;
    if (original === undefined) {
      // There was no ambient fetch to begin with — remove the guard entirely
      // rather than assigning `undefined` (exactOptionalPropertyTypes).
      delete g.fetch;
    } else {
      g.fetch = original;
    }
  };
}
