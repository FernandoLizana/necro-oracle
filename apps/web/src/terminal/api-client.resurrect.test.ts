// apps/web/src/terminal/api-client.resurrect.test.ts
//
// Feature: resurrection-engine, task 14.4.
//
// Example tests for `createApiPort().resurrect` (apps/web/src/terminal/
// api-client.ts, added in task 14.3): the browser consumer of the
// Resurrection_Route NDJSON stream. Mirrors the `read`-method harness in
// `api-client.test.ts` exactly — a FAKE `fetch` (a `vi.fn` typed as
// `typeof fetch`) returning a `Response` whose `body` is a hand-built
// `ReadableStream<Uint8Array>` of NDJSON bytes. No real network, no DOM, no
// sandbox, no LLM.
//
// WHAT THIS FILE PINS (design "Resurrection NDJSON additions", R9.1-R9.4,
// R14.3):
//   • A recorded happy-path sequence — the six resurrection phases in order
//     (SELECT..DIFF) → a skip-note → a terminal Result_Line — drives one
//     `onProgress` call per non-final line (each decoded to the
//     `ResurrectProgressEvent` union) and resolves to the validated
//     `RitualResult` (R9.2, R9.3).
//   • An error-terminal case — a stream ending in an Error_Line — rejects with
//     a `NecroError` exposing only `{ code, userMessage }` (R9.3, R12.1).
//   • A demo sequence — the server has already applied the `[DEMO]` prefix to
//     every line's text — is surfaced verbatim: the client passes the prefixed
//     note/phase text through untouched and NEVER double-prefixes it (R14.3,
//     demo mode).
//
// The schema-parameterized `createNdjsonParser(ResurrectStreamLineSchema)` and
// the user-abort vs 55 s-timeout discrimination are already exercised by
// `api-client.test.ts` for the `read` method and by the Resurrection_Route
// tests; this file concentrates on the recorded-sequence contract unique to
// `resurrect`.
//
// _Requirements: R9.1, R9.2, R9.3, R9.4, R14.3_

import { NecroError } from "@necro/oracle/client";
import type {
  PlayableSpread,
  ResurrectProgressEvent,
  ResurrectTarget,
  RitualResponse,
} from "@necro/ui-crt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiPort } from "./api-client.js";

// --- fixtures --------------------------------------------------------------

/** A valid 40-hex lowercase commit sha for the pinned ref. */
const SHA = "a".repeat(40);

/** A commit-pinned ref the resurrect route accepts: owner/name@<40-hex>. */
const PINNED = `octocat/hello-world@${SHA}`;

/** The in-scope spread the resurrect command POSTs. */
const SPREAD: PlayableSpread = "necropsy";

/** A bare resurrect target (no card/file argument). */
const BARE_TARGET: ResurrectTarget = { kind: "bare" };

/**
 * A field-complete, RitualResultWireSchema-valid `RitualResult` (mirrors the
 * pure-zod wire shape in `protocol/resurrect-wire.ts`). One changed, validated,
 * fully-converted file; a positive vitality delta with one improved card.
 */
const validRitual: RitualResponse = {
  ritualId: "123e4567-e89b-42d3-a456-426614174000",
  selectedCount: 1,
  files: [
    {
      path: "src/legacy.py",
      diff: [
        { kind: "remove", text: 'print "hello"' },
        { kind: "add", text: 'print("hello")' },
        { kind: "context", text: "" },
      ],
      residuals: [],
      fullyConverted: true,
    },
  ],
  patch:
    "--- a/src/legacy.py\n+++ b/src/legacy.py\n@@ -1 +1 @@\n-print \"hello\"\n+print(\"hello\")\n",
  beforeVitality: 40,
  afterVitality: 55,
  vitalityDelta: 15,
  changedCards: [{ card: "judgement", change: "severity", improved: true }],
  degraded: false,
  demo: false,
};

/** The wire form adds the fields the terminal does not render (before/after,
 * validated). The client re-validates the result line against the full wire
 * schema, so the recorded result line must carry them. */
const validRitualWire = {
  ritualId: validRitual.ritualId,
  selectedCount: validRitual.selectedCount,
  files: [
    {
      path: "src/legacy.py",
      before: 'print "hello"\n',
      after: 'print("hello")\n',
      diff: [
        { kind: "remove", text: 'print "hello"' },
        { kind: "add", text: 'print("hello")' },
        { kind: "context", text: "" },
      ],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch: validRitual.patch,
  beforeVitality: validRitual.beforeVitality,
  afterVitality: validRitual.afterVitality,
  vitalityDelta: validRitual.vitalityDelta,
  changedCards: validRitual.changedCards,
  degraded: validRitual.degraded,
  demo: validRitual.demo,
} as const;

// --- helpers ---------------------------------------------------------------

/** A `vi.fn` typed as the global `fetch`. */
function fakeFetch(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

/**
 * Build a `Response` whose body streams the given NDJSON chunks, one chunk per
 * `pull`. Mirrors the `streamingResponse` helper in `api-client.test.ts`.
 */
function streamingResponse(chunks: readonly string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/** One NDJSON line (object + trailing newline). */
function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// resurrect — the recorded NDJSON sequence
// ===========================================================================

describe("createApiPort.resurrect — recorded stream (R9.1, R9.2, R9.3, R9.4, R14.3)", () => {
  it("drives onProgress with the six phases in order then a skip-note, and resolves with the validated RitualResult (R9.2, R9.3)", async () => {
    const note = "The alchemist's omens did not answer in time; the step is skipped.";
    const chunks = [
      line({ phase: "SELECT" }),
      line({ phase: "PRE_PASS" }),
      line({ phase: "LLM_PASS" }),
      line({ phase: "VALIDATE" }),
      line({ phase: "REDIAGNOSE" }),
      line({ phase: "DIFF" }),
      line({ skip: true, note }),
      line({ result: validRitualWire }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ResurrectProgressEvent) => void>();
    const result = await port.resurrect(
      PINNED,
      BARE_TARGET,
      SPREAD,
      new AbortController().signal,
      onProgress,
    );

    // Resolves with the parsed RitualResult (the terminal's render contract).
    expect(result).toEqual(validRitualWire);

    // One event per non-final line, in recorded order, each decoded to the
    // ResurrectProgressEvent union.
    const events = onProgress.mock.calls.map((c) => c[0]);
    expect(events).toEqual<ResurrectProgressEvent[]>([
      { kind: "phase", phase: "SELECT" },
      { kind: "phase", phase: "PRE_PASS" },
      { kind: "phase", phase: "LLM_PASS" },
      { kind: "phase", phase: "VALIDATE" },
      { kind: "phase", phase: "REDIAGNOSE" },
      { kind: "phase", phase: "DIFF" },
      { kind: "skip-note", note },
    ]);
  });

  it("POSTs to /api/resurrect as x-ndjson with the pinned ref and spread, omitting target for a bare run", async () => {
    const chunks = [line({ phase: "SELECT" }), line({ result: validRitualWire })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    await port.resurrect(
      PINNED,
      BARE_TARGET,
      SPREAD,
      new AbortController().signal,
      vi.fn(),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, reqInit] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/resurrect");
    expect(reqInit?.method).toBe("POST");
    expect((reqInit?.headers as Record<string, string>).accept).toBe(
      "application/x-ndjson",
    );
    const body = JSON.parse(reqInit?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ ref: PINNED, spread: SPREAD });
    expect(body).not.toHaveProperty("target");
  });

  it("sends a card-id target and a file-path target through the request body", async () => {
    const chunks = [line({ result: validRitualWire })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    await port.resurrect(
      PINNED,
      { kind: "card", card: "hanged_man" },
      SPREAD,
      new AbortController().signal,
      vi.fn(),
    );
    const cardBody = JSON.parse(
      fetchImpl.mock.calls[0]![1]?.body as string,
    ) as Record<string, unknown>;
    expect(cardBody.target).toBe("hanged_man");

    fetchImpl.mockResolvedValue(streamingResponse([line({ result: validRitualWire })]));
    await port.resurrect(
      PINNED,
      { kind: "file", path: "src/legacy.py" },
      SPREAD,
      new AbortController().signal,
      vi.fn(),
    );
    const fileBody = JSON.parse(
      fetchImpl.mock.calls[1]![1]?.body as string,
    ) as Record<string, unknown>;
    expect(fileBody.target).toBe("src/legacy.py");
  });

  it("an error final line rejects with NecroError exposing only { code, userMessage } (R9.3, R12.1)", async () => {
    // The wire error line reuses the reading route's `ErrorEnvelopeSchema`, so
    // `code` is validated against the browser-safe `NecroErrorCode` enum; the
    // resurrection runner maps its own codes to these before the server writes
    // the line, so the client sees one of the enum's codes.
    const chunks = [
      line({ phase: "SELECT" }),
      line({ phase: "PRE_PASS" }),
      line({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          userMessage: "The ritual's hour elapsed before the body could rise.",
        },
      }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ResurrectProgressEvent) => void>();
    const err = await port
      .resurrect(PINNED, BARE_TARGET, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
    expect((err as NecroError).userMessage).toBe(
      "The ritual's hour elapsed before the body could rise.",
    );

    // The raised value carries only the two envelope fields — the error line is
    // the two-field `{ code, userMessage }` envelope, so no `cause` chain or
    // other free-form field reaches the terminal.
    expect((err as NecroError).cause).toBeUndefined();

    // The phases seen before the terminal error were still dispatched in order.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual<ResurrectProgressEvent[]>([
      { kind: "phase", phase: "SELECT" },
      { kind: "phase", phase: "PRE_PASS" },
    ]);
  });
});

// ===========================================================================
// resurrect — demo mode: server-applied [DEMO] prefix surfaced verbatim
// ===========================================================================

describe("createApiPort.resurrect — demo prefix is surfaced verbatim (R14.3)", () => {
  it("passes the server's [DEMO]-prefixed phase/skip text through untouched and never double-prefixes it", async () => {
    // In demo mode the SERVER applies `[DEMO] ` to every line's text. The
    // client must render it verbatim: the skip-note note is surfaced with its
    // single prefix and no second `[DEMO]` is added. (Phase lines carry an enum
    // phase, not free text, so the prefix rides on the skip-note/result text.)
    const demoNote = "[DEMO] The alchemist slumbered; its omens are skipped.";
    const demoRitualWire = { ...validRitualWire, demo: true } as const;
    const chunks = [
      line({ phase: "SELECT" }),
      line({ phase: "PRE_PASS" }),
      line({ skip: true, note: demoNote }),
      line({ phase: "DIFF" }),
      line({ result: demoRitualWire }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ResurrectProgressEvent) => void>();
    const result = await port.resurrect(
      PINNED,
      BARE_TARGET,
      SPREAD,
      new AbortController().signal,
      onProgress,
    );

    // The demo flag rides through on the resolved result.
    expect(result.demo).toBe(true);

    // The skip-note is surfaced with EXACTLY the server's single `[DEMO]`
    // prefix — the client adds none of its own.
    const skip = onProgress.mock.calls
      .map((c) => c[0])
      .find((e): e is Extract<ResurrectProgressEvent, { kind: "skip-note" }> =>
        e.kind === "skip-note",
      );
    expect(skip?.note).toBe(demoNote);
    // Exactly one `[DEMO]` occurrence — never double-prefixed.
    expect(skip?.note.match(/\[DEMO\]/g)).toHaveLength(1);
  });

  it("an error line's [DEMO]-prefixed userMessage is surfaced verbatim, not double-prefixed", async () => {
    const demoMsg = "[DEMO] The demanded fixture could not be found in the crypt.";
    const chunks = [
      line({ phase: "SELECT" }),
      line({ error: { code: "UPSTREAM_UNAVAILABLE", userMessage: demoMsg } }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const err = await port
      .resurrect(PINNED, BARE_TARGET, SPREAD, new AbortController().signal, vi.fn())
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).userMessage).toBe(demoMsg);
    expect((err as NecroError).userMessage.match(/\[DEMO\]/g)).toHaveLength(1);
  });
});
