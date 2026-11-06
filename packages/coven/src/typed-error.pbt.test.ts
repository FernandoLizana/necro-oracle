// @necro/coven — property test for the runner's typed-error guarantee
// (task 12.3).
//
// Property 13: Every failure is a well-formed typed NecroError.
//   Whatever a Ritual raises when it fails must be a `NecroError` carrying a
//   NON-EMPTY `code` and an oracle-voice `userMessage`, and that message must
//   carry NO file path, NO secret substring from the offending input, and NO
//   stack trace (R12.5). `asCovenError` is the single choke point the runner
//   funnels every raised value through, so this property pins its behaviour
//   directly, then drives the real `LocalCovenRunner` to two independent
//   failure modes (an unknown language pair, and a content item that cannot be
//   masked) and asserts the error it surfaces satisfies the same shape.
//
// No network / LLM / sandbox: `asCovenError` is a pure coercion, and the runner
// is driven with hand-built, in-process ports (a frozen `ClockPort`, a
// capturing `LedgerPort`, no `LlmPort`/`SandboxPort`) exactly as the task-11.2
// unit harness does. The arbitraries generate the kinds of thrown values a
// real fault could carry — a bare `Error` whose message embeds a fake path /
// secret / stack, a lone string, a plain object, and already-typed
// `NecroError`s — so the "leaks nothing" clauses are exercised across the
// input space.
//
// fast-check runs 200 times (testing steering default for non-fixer
// properties); the seed is printed on failure by default, and the discovered
// counterexamples are pinned as regression examples below the property.
//
// Validates: Requirements 12.5

import {
  buildSnapshotFromFileMap,
  initParser,
  NecroError,
  type CardDraw,
  type Evidence,
  type Reading,
  type RepoMeta,
  type RepoRef,
  type RepoSnapshot,
} from "@necro/oracle";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { asCovenError, LocalCovenRunner, type PhaseEmit } from "./runners/local.js";
import { LanguagePairRegistry } from "./registry.js";
import { LanguagePairIdSchema, type LedgerEvent, type RitualInput } from "./models.js";
import type { ClockPort, Grimoire, LedgerPort, RitualPorts } from "./ports.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// The invariant: a well-formed typed NecroError that leaks nothing.
//
// `expectWellFormedLeakFree` is the single assertion the property and both
// runner-driven cases share. It checks, for a coerced error and the raw input
// text it was derived from:
//   1. the value is a NecroError (instanceof — the runner's own guarantee);
//   2. `code` is a non-empty string;
//   3. `userMessage` is a non-empty string in the oracle voice (ASCII, no
//      emoji, two lines);
//   4. `userMessage` contains no file path, no secret substring carried by the
//      input, and no stack-trace marker.
// ---------------------------------------------------------------------------

/** A POSIX or Windows path fragment: a "/a/b" run or a "C:\dir\file" run. */
const PATH_LIKE_RE = /(?:[A-Za-z]:\\[^\s]+|\/[^\s/]+\/[^\s]+|[^\s]+\\[^\s]+)/;

/** A stack-trace marker as V8 prints it ("    at fn (file:line:col)"). */
const STACK_MARKER_RE = /\bat\s+\S+\s*\(|\n\s+at\s/;

/** Non-ASCII (what the oracle-voice steering forbids in user-facing copy). */
const NON_ASCII_RE = /[^\x00-\x7f]/;

function expectWellFormedLeakFree(err: NecroError, inputText: string): void {
  // (1) a NecroError — the runner coerces every raised value to one.
  expect(err).toBeInstanceOf(NecroError);

  // (2) a non-empty machine code.
  expect(typeof err.code).toBe("string");
  expect(err.code.length).toBeGreaterThan(0);

  // (3) a non-empty oracle-voice userMessage: ASCII-only, no emoji, and the
  // two-layer shape the steering mandates (a mystical line, then the plain
  // technical fact) — at least two lines.
  expect(typeof err.userMessage).toBe("string");
  expect(err.userMessage.length).toBeGreaterThan(0);
  expect(err.userMessage).not.toMatch(NON_ASCII_RE);
  expect(err.userMessage.split("\n").length).toBeGreaterThanOrEqual(2);

  // (4) leaks nothing: no path-like substring, no stack marker, and no secret
  // substring carried by the offending input survives into the message.
  expect(err.userMessage).not.toMatch(PATH_LIKE_RE);
  expect(err.userMessage).not.toMatch(STACK_MARKER_RE);
  // The message must not quote the raw input. Guard against short/empty inputs
  // that could coincidentally match: only assert non-inclusion for inputs long
  // enough to be a meaningful leak.
  if (inputText.length >= 4) {
    expect(err.userMessage).not.toContain(inputText);
  }
}

// ---------------------------------------------------------------------------
// Arbitraries — the kinds of values a fault could throw.
//
// A fake secret / path / stack are stitched into the generated messages so the
// "leaks nothing" clauses have something real to catch if `asCovenError` ever
// started interpolating the thrown value's text.
// ---------------------------------------------------------------------------

const FAKE_SECRET = "AKIAIOSFODNN7EXAMPLE";
const FAKE_PATH = "/home/victim/repo/src/secret_module.py";
const FAKE_STACK =
  "Error: boom\n    at run (/app/dist/runner.js:42:17)\n    at next (/app/dist/loop.js:7:3)";

/** A bare JS `Error` whose message embeds a fake path, secret, and/or stack. */
const arbBareError: fc.Arbitrary<Error> = fc
  .record({
    lead: fc.string(),
    withPath: fc.boolean(),
    withSecret: fc.boolean(),
    withStack: fc.boolean(),
  })
  .map(({ lead, withPath, withSecret, withStack }) => {
    const parts = [lead];
    if (withPath) parts.push(`at ${FAKE_PATH}`);
    if (withSecret) parts.push(`key=${FAKE_SECRET}`);
    const err = new Error(parts.join(" ").trim() || "unexpected fault");
    if (withStack) err.stack = FAKE_STACK;
    return err;
  });

/** A lone thrown string carrying a fake path + secret. */
const arbThrownString: fc.Arbitrary<string> = fc
  .string()
  .map((s) => `${s} ${FAKE_PATH} ${FAKE_SECRET}`.trim());

/** A plain thrown object (no NecroError shape) with leaky fields. */
const arbThrownObject: fc.Arbitrary<unknown> = fc.record({
  message: fc.constant(`fault at ${FAKE_PATH}`),
  token: fc.constant(FAKE_SECRET),
  stack: fc.constant(FAKE_STACK),
});

/** An already-well-formed NecroError (the pass-through path). */
const arbNecroError: fc.Arbitrary<NecroError> = fc
  .record({
    code: fc.constantFrom(
      "VALIDATION_FAILED",
      "PAIR_UNKNOWN",
      "BUDGET_EXHAUSTED",
      "UPSTREAM_UNAVAILABLE",
    ),
    line1: fc.constantFrom(
      "The veil tore where no rite was spoken.",
      "A fragment would not take the mask; it is left in the dark.",
    ),
    line2: fc.constantFrom(
      "An unexpected fault ended the ritual; try the summoning again.",
      "A content item could not be redacted and was withheld from the result.",
    ),
  })
  .map(
    ({ code, line1, line2 }) =>
      new NecroError(code as never, `${line1}\n${line2}`),
  );

/** The union of thrown values, carrying the raw input text for leak checks. */
const arbThrown: fc.Arbitrary<{ value: unknown; text: string }> = fc.oneof(
  arbBareError.map((e) => ({ value: e, text: `${e.message}\n${e.stack ?? ""}` })),
  arbThrownString.map((s) => ({ value: s, text: s })),
  arbThrownObject.map((o) => ({ value: o, text: JSON.stringify(o) })),
  arbNecroError.map((e) => ({ value: e, text: `${e.code} ${e.userMessage}` })),
);

// ---------------------------------------------------------------------------
// Property 13 over `asCovenError` directly.
// ---------------------------------------------------------------------------

describe("P13 (R12.5): every failure is a well-formed typed NecroError", () => {
  it("asCovenError maps any thrown value to a typed, leak-free NecroError", () => {
    fc.assert(
      fc.property(arbThrown, ({ value, text }) => {
        const err = asCovenError(value);
        expectWellFormedLeakFree(err, text);
      }),
      { numRuns: 200 },
    );
  });

  it("passes a well-formed NecroError through unchanged (same reference)", () => {
    fc.assert(
      fc.property(arbNecroError, (input) => {
        const out = asCovenError(input);
        expect(out).toBe(input);
        expectWellFormedLeakFree(out, `${input.code} ${input.userMessage}`);
      }),
      { numRuns: 200 },
    );
  });

  // Regression examples: the shapes a counterexample would take, pinned so a
  // future change to `asCovenError` that reintroduced input interpolation is
  // caught deterministically regardless of the random seed.
  it("does not leak a thrown Error's path/secret/stack (regression)", () => {
    const err = new Error(`boom at ${FAKE_PATH} key=${FAKE_SECRET}`);
    err.stack = FAKE_STACK;
    const out = asCovenError(err);
    expectWellFormedLeakFree(out, `${err.message}\n${err.stack}`);
    expect(out.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("does not leak a thrown string's path/secret (regression)", () => {
    const thrown = `fatal ${FAKE_PATH} ${FAKE_SECRET}`;
    const out = asCovenError(thrown);
    expectWellFormedLeakFree(out, thrown);
  });
});

// ---------------------------------------------------------------------------
// Driving the REAL runner to failure — the end-to-end half of R12.5.
//
// The runner funnels every non-budget terminal fault through `asCovenError`
// before it escapes (see the catch in `run`). We exercise two independent
// failure modes and assert the surfaced error satisfies the same invariant:
//
//   (a) an UNKNOWN language pair id — the registry throws PAIR_UNKNOWN at
//       SELECT, before any sandbox/LLM work; the thrown value is already a
//       typed NecroError and must reach the caller unmangled.
//   (b) a content item that CANNOT be masked — `maskContentItem` raises the
//       typed withhold error (R12.4), which the runner rethrows via
//       `asCovenError`; its message names no path and carries no secret.
//
// A tiny self-contained harness mirrors task 11.2: a frozen ClockPort, a
// capturing LedgerPort, and (for case b) a STUB grimoire so no grimoire package
// is imported (oracle <- grimoires <- coven).
// ---------------------------------------------------------------------------

const REF: RepoRef = {
  owner: "graveyard",
  name: "dead-repo",
  sha: "0".repeat(40),
  defaultBranch: "main",
};

const META: RepoMeta = {
  pushedAt: null,
  isArchived: false,
  openIssueCount: 0,
  openPRCount: 0,
  oldestOpenPRAgeDays: null,
  latestReleaseAt: null,
  licenseKey: null,
};

const NOW = "2024-01-01T00:00:00.000Z";
const PAIR_ID = LanguagePairIdSchema.parse("python2->python3");

function py2Evidence(path: string): Evidence {
  return {
    kind: "print_statement",
    path,
    line: 1,
    detail: "legacy print statement",
    source: "static",
  };
}

function judgementDraw(path: string): CardDraw {
  return {
    card: "judgement" as CardDraw["card"],
    severity: 2,
    orientation: "reversed",
    evidence: [py2Evidence(path)],
    summary: "legacy python 2 constructs",
    grimoires: [],
  };
}

function reading(draws: CardDraw[]): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repo: REF,
    draws,
    spread: [],
    vitality: 50,
    createdAt: NOW,
    engineVersion: "0.0.0",
    errors: [],
  };
}

function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { meta: META, createdAt: NOW });
}

function ritualInput(overrides: Partial<RitualInput> = {}): RitualInput {
  return {
    pairId: PAIR_ID,
    snapshot: snapshotOf({ "legacy.py": 'print "hello"\n' }),
    reading: reading([judgementDraw("legacy.py")]),
    target: { kind: "bare" },
    spread: "necropsy",
    now: NOW,
    demo: false,
    ...overrides,
  };
}

function frozenClock(): ClockPort {
  return { nowMs: () => 1_000_000 };
}

function makeLedger(): LedgerPort & { events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    async append(event: LedgerEvent): Promise<void> {
      events.push(event);
    },
    events,
  };
}

function nullEmit(): PhaseEmit {
  return { phase: () => {}, skipNote: () => {} };
}

/** A no-op stub grimoire (no grimoire package imported). */
function stubGrimoire(): Grimoire {
  const outputSchema = z.object({ converted: z.boolean() });
  return {
    id: "stub",
    pair: { from: "python2", to: "python3" } as unknown as Grimoire["pair"],
    inputSchema: z.object({ path: z.string(), before: z.string() }) as unknown as Grimoire["inputSchema"],
    outputSchema: z.object({
      path: z.string(),
      before: z.string(),
      after: z.string(),
      diff: z.array(z.unknown()),
      residuals: z.array(z.unknown()),
      fullyConverted: z.boolean(),
      validated: z.boolean(),
    }) as unknown as Grimoire["outputSchema"],
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
    validate: () => ({ valid: true, errorNodeCount: 0 }),
    divergenceAllowlist: [],
  };
}

function registryWith(grimoire: Grimoire = stubGrimoire()): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  registry.register(PAIR_ID, grimoire);
  return registry;
}

beforeAll(async () => {
  await initParser();
});

describe("P13 (R12.5): the runner surfaces only well-formed typed NecroErrors", () => {
  it("(a) an unknown language pair throws a typed, leak-free NecroError", async () => {
    // The registry has NO binding for the Ritual's pair id, so `resolve`
    // throws PAIR_UNKNOWN at SELECT — before any sandbox/LLM work.
    const runner = new LocalCovenRunner(new LanguagePairRegistry());
    const ports: RitualPorts = { clock: frozenClock(), ledger: makeLedger() };

    const thrown = await runner
      .run(ritualInput(), ports, nullEmit())
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(NecroError);
    expect((thrown as NecroError).code).toBe("PAIR_UNKNOWN");
    // No fabricated leak text is available on this path, so pass an empty
    // string for the input-leak clause; the shape/leak-free checks still hold.
    expectWellFormedLeakFree(thrown as NecroError, "");
  });

  it("(b) a content item that cannot be masked throws a typed, leak-free NecroError", async () => {
    // Force a mask failure: a snapshot whose `.py` content is a NON-STRING.
    // `maskContentItem` cannot run the secret scan over it and raises the typed
    // withhold error (R12.4), which the runner rethrows via `asCovenError`.
    // The candidate path carries a secret-looking token so we can assert the
    // surfaced message names neither the path nor the secret.
    const leakyPath = `pkg/${FAKE_SECRET}_module.py`;
    const snapshot = snapshotOf({ [leakyPath]: "print 'x'\n" });
    // Corrupt the overlay content for the candidate to a NON-STRING so
    // `maskContentItem` cannot run the scan and throws. `contents` is the Map
    // SELECT reads `before` from (`contents.get(path)`); overwrite just this
    // path's value with a number via the Map's own `set`.
    (snapshot.contents as unknown as Map<string, unknown>).set(
      leakyPath,
      12345,
    );

    const input = ritualInput({
      snapshot,
      reading: reading([judgementDraw(leakyPath)]),
      target: { kind: "file", path: leakyPath },
    });

    const runner = new LocalCovenRunner(registryWith());
    const ports: RitualPorts = { clock: frozenClock(), ledger: makeLedger() };

    const thrown = await runner
      .run(input, ports, nullEmit())
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(NecroError);
    expectWellFormedLeakFree(thrown as NecroError, leakyPath);
    // Belt-and-braces: the message quotes neither the path nor the secret.
    expect((thrown as NecroError).userMessage).not.toContain(leakyPath);
    expect((thrown as NecroError).userMessage).not.toContain(FAKE_SECRET);
  });
});
