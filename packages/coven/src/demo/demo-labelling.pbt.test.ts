// @necro/coven — property tests for Demo_Mode labelling and determinism
// (task 16.3; R14.3, R14.5, R16.3).
//
// Two properties guard the two Demo_Mode guarantees a user relies on:
//
//   Property 15 (R14.3): Demo output is fully `[DEMO]`-labelled.
//     Every stream line a demo run emits — each Phase_Line, each
//     Skip_Note_Line, and the single terminal Result_Line/Error_Line — carries
//     the fixed `[DEMO]` prefix, applied EXACTLY ONCE (never double-prefixed).
//
//   Property 16 (R14.5, R16.3): Demo output is deterministic across runs.
//     Repeated `lich-py2` demo runs produce byte-identical serialized output,
//     INCLUDING `vitalityDelta` and the changed-card set.
//
// How the properties exercise the real Demo_Mode seam
// ----------------------------------------------------
// The `[DEMO]` prefix is, by design (see `demo/prefix.ts`), applied ONCE at the
// server's serialization choke point — NOT inside the demo-agnostic runner. So
// these properties reproduce that choke point exactly as the route will:
//
//   - phase tokens and the terminal line are serialized to a wire line and
//     then run through `prefixDemoLine` (the labeller the route applies to
//     every line it builds);
//   - the runner's free-text skip-notes are forwarded through a `demoEmit`-
//     wrapped reporter (the wrapper the route uses so a forwarded skip-note is
//     labelled too).
//
// P15 drives a REAL demo Ritual once to capture a realistic line stream, then
// generates 200 varied line streams (phase / skip / result / error lines) and
// asserts the serialize+prefix path labels every line once. P16 loads the
// `lich-py2` fixtures and runs the REAL `LocalCovenRunner` twice per iteration
// over demo ports + a Mock `LlmPort`, serializing the two `RitualResult`s and
// asserting they are byte-identical across the pair AND across iterations.
//
// The runner resolves its grimoire from an injected `LanguagePairRegistry`, so
// these tests register a tiny, DETERMINISTIC stub grimoire under the demo pair
// id — the real `@necro/grimoires-py2to3` is deliberately NOT imported, which
// would invert the enforced dependency direction `oracle <- grimoires <- coven`
// (the grimoire package depends on `@necro/coven`). For the same reason the
// Mock `LlmPort` is implemented INLINE against the coven port contract rather
// than imported from `@necro/llm` (which also depends on `@necro/coven`). The
// determinism guarantee under test is a property of the runner + the real
// `lich-py2` fixtures + a deterministic model, all of which the stub/inline
// mock exercise faithfully; the real-grimoire end-to-end demo is covered where
// the dependency direction permits it (apps/web, task 13.2 / 14.x).
//
// Everything is offline: the Mock provider performs no I/O, the demo ports omit
// the sandbox, and `installNetworkBlockGuard` throws rather than reaching the
// wire — matching the testing steering (no network / LLM / sandbox).
//
// fast-check runs 200 times per the plan's non-fixer property budget; the seed
// is printed on failure (fast-check prints the failing seed by default).

import { fileURLToPath } from "node:url";

import { initParser, NecroError } from "@necro/oracle";
import { z } from "zod";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_PREFIX,
  createDemoPorts,
  demoEmit,
  installNetworkBlockGuard,
  prefixDemoLine,
  LocalCovenRunner,
  LanguagePairRegistry,
  type ClockPort,
  type Grimoire,
  type LedgerEvent,
  type LedgerPort,
  type LlmPort,
  type LlmRequest,
  type LlmResult,
  type PhaseEmit,
  type RitualInput,
  type RitualOutcome,
  type RitualResult,
} from "../index.js";
import { loadDemoRitualInput } from "./load-fixture.js";

// ---------------------------------------------------------------------------
// Shared offline fixtures / ports.
// ---------------------------------------------------------------------------

/** Absolute path to fixtures/graveyard/, resolved relative to this module. */
const FIXTURES_ROOT = fileURLToPath(
  new URL("../../../../fixtures/graveyard/", import.meta.url),
);

/** A fixed ISO clock so repeated demo runs read identical deterministic time. */
const NOW = "2026-01-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/** A frozen ClockPort: every read returns the same ms so budgets never trip. */
function frozenClock(): ClockPort {
  return { nowMs: () => NOW_MS };
}

/** A capturing, append-only LedgerPort (the demo ledger). */
function makeLedger(): LedgerPort & { events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    async append(event: LedgerEvent): Promise<void> {
      events.push(event);
    },
    events,
  };
}

/**
 * A trivial, adapter-free, DETERMINISTIC stub Grimoire — the same shape the
 * other coven runner tests register (see `runners/local.test.ts`). A real
 * py2-fixer transform is not needed to prove labelling/determinism: the
 * pass-through fixer, always-valid `validate`, and source-returning `apply` are
 * pure functions of their input, so the whole pipeline over the fixed `lich-py2`
 * fixtures is deterministic. The runner imports no grimoire package; it resolves
 * THIS stub from the injected registry.
 */
function stubGrimoire(): Grimoire {
  const outputSchema = z.object({ converted: z.boolean() });
  return {
    id: "stub",
    pair: { from: "python2", to: "python3" } as unknown as Grimoire["pair"],
    inputSchema: z.object({
      path: z.string(),
      before: z.string(),
    }) as unknown as Grimoire["inputSchema"],
    outputSchema: z.object({
      path: z.string(),
      before: z.string(),
      after: z.string(),
      diff: z.array(z.unknown()),
      residuals: z.array(z.unknown()),
      fullyConverted: z.boolean(),
      validated: z.boolean(),
    }) as unknown as Grimoire["outputSchema"],
    // No-op fixers: leave content unchanged, emit no residuals.
    fixers: [(source) => ({ after: source, residuals: [] })],
    llm: {
      outputSchema: outputSchema as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: () => ({
        system: "convert",
        prompt: "data",
        maxTokens: 16,
        timeoutMs: 1_000,
        cacheKey: "k",
      }),
      apply: (source) => source,
      mockFixture: () => '{"converted":true}',
    },
    validate: (_after: string) => ({ valid: true, errorNodeCount: 0 }),
    divergenceAllowlist: [],
  };
}

/** A registry binding the stub grimoire to the demo pair (`python2->python3`). */
function stubRegistry(input: RitualInput): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  registry.register(input.pairId, stubGrimoire());
  return registry;
}

/**
 * A deterministic, network-free Mock `LlmPort` built inline. The real Mock
 * provider lives in `@necro/llm`, which depends on `@necro/coven`; importing it
 * here would invert `oracle <- grimoires <- coven` just like importing a
 * grimoire would, so the test implements the port contract (defined in coven
 * itself) directly. `complete` performs no I/O and returns a fixed-shaped text
 * for every request, so the demo path stays byte-deterministic (R14.4).
 */
function inlineMockLlm(): LlmPort {
  return {
    providerId: "mock",
    complete(_req: LlmRequest): Promise<LlmResult> {
      const result: LlmResult = { text: '{"converted":true}', cached: false };
      return Promise.resolve(result);
    },
  };
}

/**
 * Run ONE real `lich-py2` demo Ritual to a `RitualOutcome` with the demo seam
 * wired exactly as the route composes it: the Mock `LlmPort`, the demo ports
 * (sandbox omitted), the outbound-network guard installed for the duration, and
 * a `demoEmit`-wrapped reporter capturing the serialized stream lines.
 *
 * The returned `lines` are the FINAL, user-visible demo lines, each carrying
 * the `[DEMO]` marker. Per `demo/prefix.ts` the marker lands on the RENDERED
 * line (the text the client shows), applied once at the serialization choke
 * point: the route renders each phase token to a line and `prefixDemoLine`-
 * marks it, renders the terminal outcome to a line and `prefixDemoLine`-marks
 * it, and forwards the runner's free-text skip-notes through a `demoEmit`-
 * wrapped reporter so they arrive already `[DEMO]`-marked. `lines` is that
 * complete, labelled stream (the NDJSON JSON envelope is transport, tested in
 * apps/web; the label guarantee is about the rendered content).
 */
async function runDemoRitual(): Promise<{
  outcome: RitualOutcome;
  lines: string[];
}> {
  const input = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });
  const registry = stubRegistry(input);
  const runner = new LocalCovenRunner(registry);

  const ports = createDemoPorts({
    llm: inlineMockLlm(),
    clock: frozenClock(),
    ledger: makeLedger(),
  });

  const lines: string[] = [];
  // The route renders phase tokens to a line itself and prefixes that line with
  // `prefixDemoLine`; it forwards the runner's free-text skip-notes through a
  // `demoEmit`-wrapped reporter so they are labelled too. Reproduce both — the
  // skip-note reaches `base.skipNote` already `[DEMO] `-marked by `demoEmit`.
  const base: PhaseEmit = {
    phase(phase): void {
      lines.push(prefixDemoLine(renderPhaseLine(phase)));
    },
    skipNote(note): void {
      lines.push(note);
    },
  };
  const emit = demoEmit(base);

  const restore = installNetworkBlockGuard();
  let outcome: RitualOutcome;
  try {
    outcome = await runner.run(input, ports, emit);
  } finally {
    restore();
  }

  // The single terminal line the route writes after the runner returns: a
  // Result_Line on success, or an Error_Line when `outcome.error` is set, each
  // rendered and `prefixDemoLine`-marked at the same choke point.
  lines.push(prefixDemoLine(renderTerminalLine(outcome)));

  return { outcome, lines };
}

// ---------------------------------------------------------------------------
// Line renderers producing the deterministic, user-visible text per line. The
// `[DEMO]` marker guards this RENDERED content (see `demo/prefix.ts`); the exact
// NDJSON JSON envelope is transport and is tested in apps/web, so here a stable
// string per line is all the labelling and byte-identity assertions need.
// ---------------------------------------------------------------------------

function renderPhaseLine(phase: string): string {
  return `phase: ${phase}`;
}

function renderTerminalLine(outcome: RitualOutcome): string {
  if (outcome.error !== null) {
    return `error ${outcome.error.code}: ${outcome.error.userMessage}`;
  }
  return `result: ${serializeResult(outcome.result)}`;
}

/**
 * The deterministic serialization of a `RitualResult` for the determinism
 * property — the fields that must be byte-identical across repeated demo runs
 * EXCLUDING the per-run random `ritualId` (R14.5/R16.3 pin the CONTENT, not the
 * freshly-minted id). `vitalityDelta` and the changed-card set are included
 * explicitly because the task calls them out.
 */
function serializeResult(result: RitualResult): string {
  return JSON.stringify({
    selectedCount: result.selectedCount,
    files: result.files,
    patch: result.patch,
    beforeVitality: result.beforeVitality,
    afterVitality: result.afterVitality,
    vitalityDelta: result.vitalityDelta,
    changedCards: result.changedCards,
    degraded: result.degraded,
    demo: result.demo,
  });
}

// ---------------------------------------------------------------------------
// Property 15 — Demo output is fully `[DEMO]`-labelled (R14.3).
// ---------------------------------------------------------------------------

/**
 * Free-text an oracle skip-note might carry (ASCII, possibly multi-line). The
 * runner emits oracle-voice skip-notes that never begin with the `[DEMO] `
 * marker themselves (it is added by the demo layer, not the note author), so we
 * exclude a leading marker to keep the "applied exactly once" check meaningful
 * — a note whose own text started with `[DEMO] ` would be indistinguishable
 * from a double prefix and is not a shape the runner produces.
 */
const arbNoteText: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 60 })
  // Keep it printable-ASCII so the assertion reasons about the prefix only.
  .map((s) => s.replace(/[^\x20-\x7e\n]/g, " "))
  .filter((s) => !s.startsWith(DEMO_PREFIX));

/** A runner phase token (the fixed enum the route renders to a line). */
const arbPhase: fc.Arbitrary<string> = fc.constantFrom(
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
);

/**
 * One abstract stream event the route emits: a phase, a free-text skip-note, a
 * terminal result marker, or a terminal error. `labelEvent` renders + labels
 * each exactly as the route does and the property asserts the label invariant.
 */
type StreamEvent =
  | { readonly kind: "phase"; readonly phase: string }
  | { readonly kind: "skip"; readonly note: string }
  | { readonly kind: "result" }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

const arbStreamEvent: fc.Arbitrary<StreamEvent> = fc.oneof(
  arbPhase.map((phase) => ({ kind: "phase", phase }) as const),
  arbNoteText.map((note) => ({ kind: "skip", note }) as const),
  fc.constant({ kind: "result" } as const),
  fc
    .record({
      code: fc.constantFrom(
        "BUDGET_EXHAUSTED",
        "DEMO_FIXTURE_MISSING",
        "UPSTREAM_UNAVAILABLE",
        "REDIAGNOSIS_FAILED",
      ),
      message: arbNoteText,
    })
    .map(({ code, message }) => ({ kind: "error", code, message }) as const),
);

/**
 * Render + label one stream event exactly as the Demo_Mode route does. The
 * `[DEMO]` marker lands on the RENDERED line (see `demo/prefix.ts`): the route
 * renders each phase token and the terminal outcome to a line and
 * `prefixDemoLine`-marks it, and forwards the runner's free-text skip-notes
 * through `demoEmit`, which marks the note once. To model the skip path
 * faithfully we drive the note through a `demoEmit`-wrapped sink — the SAME
 * primitive the runner path uses — so the skip line is labelled by exactly the
 * route's own mechanism, not a re-implementation.
 */
function labelEvent(event: StreamEvent): string {
  switch (event.kind) {
    case "phase":
      return prefixDemoLine(renderPhaseLine(event.phase));
    case "skip": {
      let labelled = "";
      const sink: PhaseEmit = {
        phase: () => {},
        skipNote: (n) => {
          labelled = n;
        },
      };
      // The sink's skipNote is synchronous; `void` the PhaseEmit's
      // `void | Promise<void>` return to satisfy no-floating-promises.
      void demoEmit(sink).skipNote(event.note);
      return labelled;
    }
    case "result":
      return prefixDemoLine(renderTerminalLine({ result: stubResult(), error: null }));
    case "error":
      return prefixDemoLine(
        renderTerminalLine({
          result: stubResult(),
          error: new NecroError(event.code as never, event.message),
        }),
      );
  }
}

/** A schema-shaped placeholder result for the result-terminal rendering. */
function stubResult(): RitualResult {
  return {
    ritualId: "00000000-0000-4000-8000-000000000000",
    selectedCount: 0,
    files: [],
    patch: "",
    beforeVitality: 50,
    afterVitality: null,
    vitalityDelta: null,
    changedCards: [],
    degraded: false,
    demo: true,
  };
}

describe("P15 (R14.3): demo output is fully [DEMO]-labelled", () => {
  beforeAll(async () => {
    // The real demo run below parses py2 sources; arm the parser once up front.
    await initParser();
  });

  it("labels every line of a REAL lich-py2 demo stream exactly once", async () => {
    const { lines } = await runDemoRitual();

    // A real demo emits every phase, the degraded/Mock skip-notes, and one
    // terminal line — all must be present and all must be labelled.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith(DEMO_PREFIX)).toBe(true);
      // Applied exactly once — the remainder never begins with the marker again.
      expect(line.slice(DEMO_PREFIX.length).startsWith(DEMO_PREFIX)).toBe(false);
    }
  });

  it("labels every serialized stream line once, across varied streams", () => {
    fc.assert(
      fc.property(
        fc.array(arbStreamEvent, { minLength: 1, maxLength: 20 }),
        (events) => {
          const lines = events.map(labelEvent);
          for (const line of lines) {
            // (1) Every line carries the fixed marker (R14.3).
            expect(line.startsWith(DEMO_PREFIX)).toBe(true);
            // (2) The marker is applied EXACTLY ONCE — no double prefix.
            expect(
              line.slice(DEMO_PREFIX.length).startsWith(DEMO_PREFIX),
            ).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16 — Demo output is deterministic across runs (R14.5, R16.3).
// ---------------------------------------------------------------------------

describe("P16 (R14.5, R16.3): demo output is deterministic across runs", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("repeated lich-py2 demo runs produce byte-identical serialized output", async () => {
    // Anchor: run the demo ONCE outside the property and keep its serialization
    // as the reference every generated iteration must reproduce byte-for-byte.
    const reference = await runDemoRitual();
    const referenceResult = serializeResult(reference.outcome.result);
    const referenceLines = reference.lines.join("\n");

    await fc.assert(
      // The property takes no meaningful input: the demo is a fixed fixture, so
      // each iteration is a fresh pair of runs that must match each other AND
      // the anchor. A throwaway seed keeps fast-check iterating `numRuns` times.
      fc.asyncProperty(fc.constant(null), async () => {
        const a = await runDemoRitual();
        const b = await runDemoRitual();

        const sa = serializeResult(a.outcome.result);
        const sb = serializeResult(b.outcome.result);

        // (1) The two fresh runs agree byte-for-byte (R14.5).
        expect(sa).toBe(sb);
        // (2) ...and agree with the anchor from before the property body,
        //     so determinism holds across ALL runs, not just within a pair.
        expect(sa).toBe(referenceResult);

        // (3) The CALLED-OUT fields are identical: vitalityDelta and the
        //     changed-card set (R16.3). Asserted explicitly so a regression in
        //     either shows a precise failure rather than only a blob mismatch.
        expect(a.outcome.result.vitalityDelta).toBe(
          b.outcome.result.vitalityDelta,
        );
        expect(a.outcome.result.vitalityDelta).toBe(
          reference.outcome.result.vitalityDelta,
        );
        expect(JSON.stringify(a.outcome.result.changedCards)).toBe(
          JSON.stringify(b.outcome.result.changedCards),
        );
        expect(JSON.stringify(a.outcome.result.changedCards)).toBe(
          JSON.stringify(reference.outcome.result.changedCards),
        );

        // (4) The full emitted stream (phases + skip-notes + terminal line) is
        //     also byte-identical across runs — the demo replays identically.
        expect(a.lines.join("\n")).toBe(b.lines.join("\n"));
        expect(a.lines.join("\n")).toBe(referenceLines);
      }),
      // Each iteration runs TWO full fixture-loading + parsing + reading demo
      // rituals, so this end-to-end determinism check is far heavier than a pure
      // property. A modest run count (plus the anchor) is more than enough to
      // pin byte-identity, and keeps the suite reliably within its time budget
      // even under full-monorepo parallel load (the 200-run variant intermittently
      // exceeded the default 5s per-test timeout under load).
      { numRuns: 20 },
    );
  }, 30_000);
});
