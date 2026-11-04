// apps/web/src/terminal/api-client.test.ts
//
// Feature: 03-crt-terminal, task 28.1 (TEST-FIRST).
//
// Example tests for the browser API client `createApiPort` (design.md
// §"Browser adapters"): the Summon_Route outcome table for `port.summon`, and
// the streaming NDJSON reader for `port.read`. Both are driven by a FAKE
// `fetch` (a `vi.fn` typed as `typeof fetch`) returning crafted `Response`
// objects — no real network, no DOM, no sandbox.
//
// TEST-FIRST (red). This file is written before `terminal/api-client.ts`
// (task 28.2). The import of `./api-client.js` below therefore fails to
// resolve and the whole suite is red for the expected reason: the module does
// not exist yet. Nothing here is implementation.
//
// ───────────────────────────────────────────────────────────────────────────
// CONTRACT PINNED BY THIS FILE (recorded for task 28.2)
// ───────────────────────────────────────────────────────────────────────────
//
//   api-client.ts  →  createApiPort(fetchImpl: typeof fetch): ApiPort
//
// where `ApiPort` is the `@necro/ui-crt` protocol type:
//
//   summon(repo: string, signal: AbortSignal): Promise<SummonSummary>
//   read(pinned: string, spread: PlayableSpread, signal: AbortSignal,
//        onProgress: ReadProgress): Promise<ReadingResponse>
//
// SUMMON (design.md §"Browser adapters", the outcome table). `summon` POSTs the
// request JSON with `AbortSignal.any([signal, AbortSignal.timeout(55_000)])`
// and maps the outcome:
//   • fetch rejects with TypeError, or the 55 s timeout signal fires
//       → reject with `networkError()` (NETWORK_TIMEOUT)
//   • user abort (the caller's `signal` aborted by Ctrl+C)
//       → rethrow the AbortError (NOT mapped to a NecroError)
//   • ok + body passes SummonSummarySchema       → resolve with the value
//   • ok + body fails the schema, or is not JSON → `invalidResponseError()`
//                                                   (VALIDATION_FAILED)
//   • !ok + body passes ErrorEnvelopeSchema       → NecroError(code,userMessage)
//   • status ≥ 500 + no valid envelope            → `upstreamError()`
//                                                   (UPSTREAM_UNAVAILABLE)
//   • status < 500 + no valid envelope            → `invalidResponseError()`
//                                                   (VALIDATION_FAILED)
//
// READ (design.md §"Browser adapters", the streaming rules). `read` POSTs the
// reading request, then reads `response.body` through a `TextDecoder` and
// `createNdjsonParser`. For each complete StreamLine:
//   • a PhaseLine / SkipNoteLine is decoded to a `ProgressEvent`
//       ({kind:"phase",phase} / {kind:"skip-note",note}) and handed to
//       `onProgress` INCREMENTALLY, as that line arrives;
//   • the final ResultLine's inner value is validated by ReadingResponseSchema
//       and resolves the promise (R6.18);
//   • an ErrorLine rejects with NecroError(code, userMessage);
//   • a malformed line (bad JSON / fails StreamLineSchema) rejects with
//       `invalidResponseError()` (VALIDATION_FAILED, R6.9);
//   • the stream ending with NO result/error line, or the 55 s client timeout,
//       rejects with `networkError()` (NETWORK_TIMEOUT, R6.17, R11.6);
//   • a user abort (Ctrl+C) cancels the reader and rethrows the AbortError.
//
// DETERMINISM OF THE 55 s TIMEOUT (recorded for 28.2). The implementation
// composes `AbortSignal.any([signal, AbortSignal.timeout(55_000)])`.
// `AbortSignal.timeout` is backed by a timer, so these tests drive it with
// Vitest fake timers: `vi.useFakeTimers()`, kick off the call, then
// `await vi.advanceTimersByTimeAsync(55_000)` fires the timeout signal
// deterministically with no wall-clock wait. The user-abort path instead uses
// a real `AbortController` the test aborts, with the fake fetch rejecting with
// a DOMException named "AbortError".
//
// INCREMENTAL onProgress CONTRACT (recorded for 28.2). The reader must call
// `onProgress` for an earlier phase BEFORE it has pulled the chunk carrying a
// later phase. We prove this with a hand-built ReadableStream whose `pull`
// hands out one chunk per read: after the SUMMON chunk is read we await a
// microtask tick and assert `onProgress` already saw SUMMON before the next
// `pull` enqueues DOWNLOAD — i.e. it streams, it does not buffer to the end.
//
// _Requirements: R5.4, R5.10, R6.8, R6.9, R6.17, R6.18, R11.4, R11.5, R11.6, R11.7_

import { NecroError } from "@necro/oracle/client";
import type {
  PlayableSpread,
  ProgressEvent,
  ReadingResponse,
  SummonSummary,
} from "@necro/ui-crt";
import { afterEach, describe, expect, it, vi } from "vitest";

// Not yet implemented — task 28.2 adds this module. The import is what makes
// this suite red until then.
import { createApiPort } from "./api-client.js";

// --- fixtures --------------------------------------------------------------

/** A valid 40-hex lowercase commit sha for the pinned ref. */
const SHA = "a".repeat(40);

/** A commit-pinned ref the readings route accepts: owner/name@<40-hex>. */
const PINNED = `octocat/hello-world@${SHA}`;

/** The repo string the summon route accepts. */
const REPO = "octocat/hello-world";

/** A field-complete, schema-valid SummonSummary (mirrors the wire schema). */
const validSummary: SummonSummary = {
  ref: { owner: "octocat", name: "hello-world", sha: SHA, defaultBranch: "main" },
  stars: 12,
  hasWorkflowsDir: true,
  degradedFields: ["pulls"],
  cache: "hit",
  fileCount: 7,
  truncated: false,
};

/** A minimal, ReadingResponseSchema-valid ReadingResponse. */
const validReading: ReadingResponse = {
  summary: validSummary,
  reading: {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: {
      owner: "octocat",
      name: "hello-world",
      sha: SHA,
      defaultBranch: "main",
    },
    draws: [],
    spread: [
      { position: 1, label: "The Corpse", draw: null, description: "nothing stirs" },
    ],
    vitality: 42,
    createdAt: "2023-11-14T22:13:20.000Z",
    engineVersion: "0.0.0",
    errors: [],
  },
};

// --- helpers ---------------------------------------------------------------

/** A `vi.fn` typed as the global `fetch`. */
function fakeFetch(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

/** Build a 200 `Response` whose JSON body is `value`. */
function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Build a `Response` with a raw (possibly non-JSON) text body. */
function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, { status: 200, ...init });
}

/**
 * Build a `Response` whose body streams the given NDJSON chunks, one chunk per
 * `pull`. Each chunk is encoded with TextEncoder. This lets a test split one
 * line across chunks (to prove reassembly) and interleave assertions between
 * chunks (to prove incremental dispatch).
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

/** A DOMException("...", "AbortError"), as a real abort would surface. */
function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// SUMMON — the Summon_Route outcome table
// ===========================================================================

describe("createApiPort.summon — outcome table (R5.4, R5.10, R11.4, R11.5, R11.7)", () => {
  it("fetch rejects with a TypeError -> NETWORK_TIMEOUT (networkError) (R11.4)", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));
    const port = createApiPort(fetchImpl);

    const signal = new AbortController().signal;
    const err = await port.summon(REPO, signal).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("NETWORK_TIMEOUT");
  });

  it("the 55 s client timeout firing -> NETWORK_TIMEOUT (R11.6)", async () => {
    vi.useFakeTimers();
    const fetchImpl = fakeFetch();
    // fetch never settles on its own; when the timeout signal aborts, a real
    // fetch rejects with an AbortError whose cause is the TimeoutError. The
    // client must map the *timeout* path to NETWORK_TIMEOUT, not rethrow.
    fetchImpl.mockImplementation(
      (_input: RequestInfo | URL, reqInit?: RequestInit) =>
        new Promise((_resolve, reject) => {
          reqInit?.signal?.addEventListener("abort", () => {
            reject(abortError());
          });
        }),
    );
    const port = createApiPort(fetchImpl);

    // The caller's own signal is NOT aborted — only the internal 55 s timeout.
    const signal = new AbortController().signal;
    const promise = port.summon(REPO, signal).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(55_000);
    const err = await promise;

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("NETWORK_TIMEOUT");
  });

  it("user abort (Ctrl+C) -> AbortError rethrown, NOT mapped to a NecroError", async () => {
    const controller = new AbortController();
    const fetchImpl = fakeFetch();
    fetchImpl.mockImplementation(
      (_input: RequestInfo | URL, reqInit?: RequestInit) =>
        new Promise((_resolve, reject) => {
          reqInit?.signal?.addEventListener("abort", () => {
            reject(abortError());
          });
        }),
    );
    const port = createApiPort(fetchImpl);

    const promise = port.summon(REPO, controller.signal).catch((e: unknown) => e);
    controller.abort();
    const err = await promise;

    expect(err).not.toBeInstanceOf(NecroError);
    expect((err as Error).name).toBe("AbortError");
  });

  it("ok + body valid against SummonSummarySchema -> resolves with the value (R5.4)", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(validSummary));
    const port = createApiPort(fetchImpl);

    const result = await port.summon(REPO, new AbortController().signal);
    expect(result).toEqual(validSummary);
  });

  it("ok + body that fails SummonSummarySchema -> VALIDATION_FAILED", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(
      jsonResponse({ ...validSummary, stars: -1, cache: "stale" }),
    );
    const port = createApiPort(fetchImpl);

    const err = await port
      .summon(REPO, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });

  it("ok + body that is not JSON -> VALIDATION_FAILED", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(textResponse("<html>not json</html>"));
    const port = createApiPort(fetchImpl);

    const err = await port
      .summon(REPO, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });

  it("!ok + body a valid ErrorEnvelope -> NecroError carrying that code+userMessage (R5.10, R11.7)", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "REPO_NOT_FOUND",
            userMessage: "No repository answers by this name.",
          },
        },
        { status: 404 },
      ),
    );
    const port = createApiPort(fetchImpl);

    const err = await port
      .summon(REPO, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("REPO_NOT_FOUND");
    expect((err as NecroError).userMessage).toBe(
      "No repository answers by this name.",
    );
  });

  it("status >= 500 + body NOT a valid envelope -> UPSTREAM_UNAVAILABLE (R11.5)", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(textResponse("gateway boom", { status: 502 }));
    const port = createApiPort(fetchImpl);

    const err = await port
      .summon(REPO, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("status < 500 + body NOT a valid envelope -> VALIDATION_FAILED", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(textResponse("plain 400", { status: 400 }));
    const port = createApiPort(fetchImpl);

    const err = await port
      .summon(REPO, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });
});

// ===========================================================================
// READ — the streaming NDJSON reader
// ===========================================================================

const SPREAD: PlayableSpread = "necropsy";

describe("createApiPort.read — streaming reader (R6.8, R6.9, R6.17, R6.18, R11.6)", () => {
  it("dispatches each phase/skip-note to onProgress in order then resolves with the validated result (R6.18)", async () => {
    const chunks = [
      line({ phase: "SUMMON" }),
      line({ phase: "DOWNLOAD" }),
      line({ phase: "EXTERNAL" }),
      line({ skip: true, note: "The external omens did not answer in time." }),
      line({ phase: "READING" }),
      line({ result: validReading }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const result = await port.read(
      PINNED,
      SPREAD,
      new AbortController().signal,
      onProgress,
    );

    expect(result).toEqual(validReading);

    // onProgress received exactly one event per non-final line, in order, each
    // decoded to the ProgressEvent union.
    const events = onProgress.mock.calls.map((c) => c[0]);
    expect(events).toEqual<ProgressEvent[]>([
      { kind: "phase", phase: "SUMMON" },
      { kind: "phase", phase: "DOWNLOAD" },
      { kind: "phase", phase: "EXTERNAL" },
      { kind: "skip-note", note: "The external omens did not answer in time." },
      { kind: "phase", phase: "READING" },
    ]);
  });

  it("reassembles a line split across several chunks (incremental parsing)", async () => {
    const resultLine = line({ result: validReading });
    const chunks = [
      // SUMMON phase line split across three chunks, no newline until the 3rd.
      '{"phase":',
      '"SUM',
      'MON"}\n',
      resultLine,
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const result = await port.read(
      PINNED,
      SPREAD,
      new AbortController().signal,
      onProgress,
    );

    expect(result).toEqual(validReading);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual<ProgressEvent[]>([
      { kind: "phase", phase: "SUMMON" },
    ]);
  });

  it("a skip-note line before READING is decoded to {kind:'skip-note', note}", async () => {
    const note = "The registry slumbered; its omens are skipped.";
    const chunks = [
      line({ phase: "SUMMON" }),
      line({ skip: true, note }),
      line({ phase: "READING" }),
      line({ result: validReading }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    await port.read(PINNED, SPREAD, new AbortController().signal, onProgress);

    expect(onProgress.mock.calls.map((c) => c[0])).toContainEqual<ProgressEvent>({
      kind: "skip-note",
      note,
    });
  });

  it("an error final line rejects with NecroError(code, userMessage)", async () => {
    const chunks = [
      line({ phase: "SUMMON" }),
      line({
        error: {
          code: "DOWNLOAD_TOO_LARGE",
          userMessage: "The corpse is too vast to raise whole.",
        },
      }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const err = await port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("DOWNLOAD_TOO_LARGE");
    expect((err as NecroError).userMessage).toBe(
      "The corpse is too vast to raise whole.",
    );
  });

  it("stream ends with NO result/error line -> NETWORK_TIMEOUT (networkError) (R6.17, R11.6)", async () => {
    const chunks = [line({ phase: "SUMMON" }), line({ phase: "DOWNLOAD" })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const err = await port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("NETWORK_TIMEOUT");
  });

  it("a malformed line (bad JSON) -> VALIDATION_FAILED (invalidResponseError) (R6.9)", async () => {
    const chunks = [line({ phase: "SUMMON" }), "this is not json\n"];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const err = await port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });

  it("a well-formed line that fails StreamLineSchema -> VALIDATION_FAILED (R6.9)", async () => {
    // Valid JSON, but matches none of the four StreamLine shapes.
    const chunks = [line({ phase: "SUMMON" }), line({ phase: "NOT_A_PHASE" })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const err = await port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });

  it("a result line whose inner value fails ReadingResponseSchema -> VALIDATION_FAILED (R6.18)", async () => {
    // StreamLineSchema itself validates the result shape, so a bad inner
    // Reading is caught at parse time and surfaces as VALIDATION_FAILED.
    const badReading = { summary: validSummary, reading: { vitality: 9999 } };
    const chunks = [line({ phase: "READING" }), line({ result: badReading })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const err = await port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("VALIDATION_FAILED");
  });

  it("the 55 s client timeout firing mid-stream -> NETWORK_TIMEOUT (R11.6)", async () => {
    vi.useFakeTimers();
    // A stream that yields SUMMON then stalls forever until its signal aborts.
    const encoder = new TextEncoder();
    const fetchImpl = fakeFetch();
    fetchImpl.mockImplementation(
      (_input: RequestInfo | URL, reqInit?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(line({ phase: "SUMMON" })));
            // Never enqueue a result/error; abort rejects the pending read.
            reqInit?.signal?.addEventListener("abort", () => {
              controller.error(abortError());
            });
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      },
    );
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const promise = port
      .read(PINNED, SPREAD, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(55_000);
    const err = await promise;

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("NETWORK_TIMEOUT");
  });

  it("a user abort during read cancels the reader and rethrows AbortError", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const fetchImpl = fakeFetch();
    fetchImpl.mockImplementation(
      (_input: RequestInfo | URL, reqInit?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(line({ phase: "SUMMON" })));
            reqInit?.signal?.addEventListener("abort", () => {
              ctrl.error(abortError());
            });
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      },
    );
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: ProgressEvent) => void>();
    const promise = port
      .read(PINNED, SPREAD, controller.signal, onProgress)
      .catch((e: unknown) => e);
    controller.abort();
    const err = await promise;

    expect(err).not.toBeInstanceOf(NecroError);
    expect((err as Error).name).toBe("AbortError");
  });
});

// ===========================================================================
// READ — incremental dispatch (streams, does not buffer)
// ===========================================================================

describe("createApiPort.read — incremental dispatch (R6.8)", () => {
  it("calls onProgress for an earlier phase BEFORE the later chunk is enqueued", async () => {
    const encoder = new TextEncoder();

    // A controller we drive by hand: we enqueue SUMMON, let the reader react,
    // assert onProgress already saw SUMMON, THEN enqueue DOWNLOAD + result.
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(new Response(stream, { status: 200 }));
    const port = createApiPort(fetchImpl);

    const seen: ProgressEvent[] = [];
    const onProgress = vi.fn((e: ProgressEvent) => {
      seen.push(e);
    });

    const promise = port.read(
      PINNED,
      SPREAD,
      new AbortController().signal,
      onProgress,
    );

    // Enqueue only SUMMON, then let microtasks flush so the reader processes it.
    streamController.enqueue(encoder.encode(line({ phase: "SUMMON" })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // PROOF OF STREAMING: SUMMON was dispatched before DOWNLOAD was ever sent.
    expect(seen).toEqual<ProgressEvent[]>([{ kind: "phase", phase: "SUMMON" }]);

    // Now finish the stream and let the promise resolve.
    streamController.enqueue(encoder.encode(line({ phase: "DOWNLOAD" })));
    streamController.enqueue(encoder.encode(line({ result: validReading })));
    streamController.close();

    const result = await promise;
    expect(result).toEqual(validReading);
    expect(seen).toEqual<ProgressEvent[]>([
      { kind: "phase", phase: "SUMMON" },
      { kind: "phase", phase: "DOWNLOAD" },
    ]);
  });
});
