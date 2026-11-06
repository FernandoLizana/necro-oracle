// @necro/grimoires-py2to3 — the lich-py2 deterministic-improvement demo test
// (resurrection-engine task 16.4; R16.1, R16.2, also R16.3/R16.4).
//
// This is the end-to-end demo assertion the whole engine hangs on: run the
// `lich-py2` Demo_Mode Ritual exactly as the server composes it and prove the
// resurrection IMPROVES the body — a positive `Vitality_Delta` and at least one
// changed card whose draw improved (the Judgement card clearing) — matching the
// pinned `fixtures/graveyard/lich-py2/golden.json` byte-for-byte on the values
// that matter.
//
// WHY THIS LIVES IN THE GRIMOIRE PACKAGE (not @necro/coven): the test needs the
// REAL `py2to3Grimoire` registered into the runner so the six deterministic
// Pre_Pass fixers actually transform the fixtures. `@necro/coven` must never
// import a grimoire package (dependency direction: oracle <- grimoires <-
// coven), so a coven-side test could only ever use a no-op STUB grimoire and
// could not clear a single card. This package already depends on `@necro/coven`
// and dev-depends on `@necro/llm`, so composing the runner + the Node demo
// loader + the Mock LlmPort + the real grimoire here is the only seam that both
// honours the dependency direction AND exercises the real transform.
//
// Everything runs OFFLINE and DETERMINISTICALLY (testing steering: no network,
// no LLM, no sandbox):
//   - the Node demo loader reads the on-disk graveyard fixtures and runs the
//     REAL oracle to produce the in-scope Reading (a local parse, permitted);
//   - the Mock `LlmPort` is network-free and deterministic — but the lich-py2
//     fixtures are authored Pre_Pass-sufficient (R16.4), so the deterministic
//     fixers alone clear the Judgement draw with NO LLM key needed;
//   - the demo ports omit the sandbox (Target_Parser validates), and the
//     outbound-network guard throws rather than reaching the wire;
//   - time is read only through an injected ClockPort pinned to the demo clock.
//
// APPLES-TO-APPLES RE-DIAGNOSIS (task 19.2):
//   `rediagnose` re-runs `runReading` on the overlay snapshot with the SAME
//   external data the pre-reading was divined with — the demo loader now puts
//   the fixture `registryData` (Tower dep freshness) and `osvData` (Devil
//   vulnerabilities) onto the `RitualInput`, and `rediagnose` threads them into
//   the overlay reading. So the Devil/Tower/Star/Death draws are identical in
//   both readings and only the Pre_Pass-fixed Judgement draw changes, exactly
//   as the pinned golden records. This test therefore asserts the FULL golden
//   byte-for-byte: beforeVitality 0, afterVitality 14, vitalityDelta 14, and
//   the single `judgement` changed card (present -> absent, improved).
//
// Validates: Requirements 16.1, 16.2

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createDemoPorts,
  createDefaultRegistry,
  installNetworkBlockGuard,
  LocalCovenRunner,
  RitualResultSchema,
  type ClockPort,
  type LedgerEvent,
  type LedgerPort,
  type PhaseEmit,
  type RitualResult,
} from "@necro/coven";
import { loadDemoRitualInput } from "@necro/coven/node";
import { createMockLlmPort } from "@necro/llm";
import { initParser } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { py2to3Grimoire } from "./index.js";

// ---------------------------------------------------------------------------
// Fixture paths + the pinned demo clock.
//
// This test file is at packages/grimoires/py2to3/src/<file>; five `..` climbs
// src -> py2to3 -> grimoires -> packages -> <repo root>, then into
// fixtures/graveyard/.
// ---------------------------------------------------------------------------

const FIXTURES_ROOT = fileURLToPath(
  new URL("../../../../fixtures/graveyard/", import.meta.url),
);
const GOLDEN_PATH = fileURLToPath(
  new URL(
    "../../../../fixtures/graveyard/lich-py2/golden.json",
    import.meta.url,
  ),
);

/** The fixed demo clock — the loader uses it as snapshot `createdAt` and reading `now`. */
const NOW = "2026-01-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

// ---------------------------------------------------------------------------
// The pinned golden (fixtures/graveyard/lich-py2/golden.json).
// ---------------------------------------------------------------------------

interface GoldenChangedCard {
  readonly card: string;
  readonly before?: {
    readonly present: boolean;
    readonly severity?: number;
    readonly orientation?: string;
  };
  readonly after?: { readonly present: boolean };
  readonly improved: boolean;
}

interface Golden {
  readonly beforeVitality: number;
  readonly afterVitality: number;
  readonly vitalityDelta: number;
  readonly changedCards: readonly GoldenChangedCard[];
}

async function readGolden(): Promise<Golden> {
  return JSON.parse(await readFile(GOLDEN_PATH, "utf8")) as Golden;
}

// ---------------------------------------------------------------------------
// Minimal injected ports. The runner reads time ONLY through `ClockPort`; a
// fixed clock pinned to the demo `now` keeps the budget comfortably open and
// the ledger timestamps deterministic. The ledger is a capturing no-op.
// ---------------------------------------------------------------------------

function fixedClock(): ClockPort {
  return { nowMs: () => NOW_MS };
}

function capturingLedger(): LedgerPort & { readonly events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    append(event: LedgerEvent): Promise<void> {
      events.push(event);
      return Promise.resolve();
    },
    events,
  };
}

/** A PhaseEmit that records the phases and skip-notes the runner streams. */
function recordingEmit(): PhaseEmit & {
  readonly phases: string[];
  readonly skipNotes: string[];
} {
  const phases: string[] = [];
  const skipNotes: string[] = [];
  return {
    phase(phase): void {
      phases.push(phase);
    },
    skipNote(note): void {
      skipNotes.push(note);
    },
    phases,
    skipNotes,
  };
}

/**
 * Compose and run the lich-py2 Demo_Mode Ritual exactly as the server does: the
 * Node demo loader builds the RitualInput from the on-disk fixtures, the real
 * py2to3 grimoire is registered, the Mock LlmPort + sandbox-less demo ports are
 * wired, the outbound-network guard is armed, and the local runner drives the
 * phase pipeline. Returns the terminal RitualResult (asserts no terminal error).
 */
async function runDemoRitual(): Promise<RitualResult> {
  const input = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });

  const registry = createDefaultRegistry({ py2to3: py2to3Grimoire });
  const runner = new LocalCovenRunner(registry);

  const ports = createDemoPorts({
    llm: createMockLlmPort(),
    clock: fixedClock(),
    ledger: capturingLedger(),
  });

  const emit = recordingEmit();

  // Defence-in-depth: block any outbound network for the run (the Mock provider
  // and sandbox-less ports make none, so this never trips on the happy path).
  const restore = installNetworkBlockGuard();
  try {
    const outcome = await runner.run(input, ports, emit);
    // A demo must complete cleanly — no budget exhaustion, no terminal fault.
    expect(outcome.error).toBeNull();
    // The result is schema-valid and flagged demo.
    const parsed = RitualResultSchema.parse(outcome.result);
    expect(parsed.demo).toBe(true);
    return parsed;
  } finally {
    restore();
  }
}

// The runner arms the oracle parser (initParser); the demo loader and the
// REDIAGNOSE overlay both run a real local reading. Initialise once up front.
beforeAll(async () => {
  await initParser();
});

describe("lich-py2 demo ritual (R16.1, R16.2): deterministic improvement", () => {
  it("matches the pinned golden vitality byte-for-byte (R16.1)", async () => {
    const [result, golden] = await Promise.all([runDemoRitual(), readGolden()]);

    // Re-diagnosis now runs apples-to-apples (same external data), so the
    // engine reproduces the golden's pinned vitality exactly: the body is dead
    // going in (0), rises to 14 after the Pre_Pass clears Judgement, for a
    // signed delta of +14.
    expect(result.beforeVitality).toBe(golden.beforeVitality);
    expect(result.afterVitality).toBe(golden.afterVitality);
    expect(result.vitalityDelta).toBe(golden.vitalityDelta);

    // Internal consistency: the reported delta is exactly after - before.
    expect(result.vitalityDelta).not.toBeNull();
    expect(result.afterVitality).not.toBeNull();
    expect(result.vitalityDelta).toBe(
      result.afterVitality! - result.beforeVitality,
    );
  });

  it("clears exactly the single Judgement card the golden pins (R16.2)", async () => {
    const [result, golden] = await Promise.all([runDemoRitual(), readGolden()]);

    // The golden pins exactly ONE changed card — Judgement, present -> absent,
    // improved. With external data threaded through re-diagnosis, Devil, Tower,
    // Star and Death are identical before and after, so the engine reports that
    // single changed card and no other. Assert the set exactly.
    const expected = golden.changedCards.map((gc) => {
      const change =
        gc.before?.present === true && gc.after?.present === false
          ? "removed"
          : gc.before?.present === false && gc.after?.present === true
            ? "added"
            : "severity";
      return { card: gc.card, change, improved: gc.improved };
    });

    expect(result.changedCards).toEqual(expected);
    // Guard the golden's own expectation: exactly one card, the Judgement.
    expect(result.changedCards).toHaveLength(1);
    expect(result.changedCards[0]!.card).toBe("judgement");
    expect(result.changedCards[0]!.change).toBe("removed");
    expect(result.changedCards[0]!.improved).toBe(true);
  });

  it("leaves every unchanged card out of the changed-card set (R16.2)", async () => {
    const [result, golden] = await Promise.all([runDemoRitual(), readGolden()]);

    // Every card the golden records as present-and-unchanged before AND after
    // (death, devil, star, tower) must NOT appear in the changed-card set — the
    // apples-to-apples re-diagnosis keeps their draws identical.
    const unchanged = (golden as unknown as {
      unchangedCardsPresentBeforeAndAfter?: readonly { card: string }[];
    }).unchangedCardsPresentBeforeAndAfter;
    expect(unchanged).toBeDefined();
    const changedIds = new Set(result.changedCards.map((c) => c.card));
    for (const uc of unchanged!) {
      expect(changedIds.has(uc.card), `card "${uc.card}" stays unchanged`).toBe(false);
    }
  });

  it("is deterministic — two independent demo runs agree byte-for-byte (R16.1, R16.2)", async () => {
    const a = await runDemoRitual();
    const b = await runDemoRitual();

    expect(a.beforeVitality).toBe(b.beforeVitality);
    expect(a.afterVitality).toBe(b.afterVitality);
    expect(a.vitalityDelta).toBe(b.vitalityDelta);
    expect(a.changedCards).toEqual(b.changedCards);
    expect(a.patch).toBe(b.patch);
  });
});
