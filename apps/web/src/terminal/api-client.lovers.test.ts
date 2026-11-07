// apps/web/src/terminal/api-client.lovers.test.ts
//
// Feature: lovers-binding, task 14.4 — example tests for `createApiPort().lovers`
// (the browser consumer of the Lovers_Route NDJSON stream, exposed on the
// `ApiPort` so the ui-crt reducer's `api.lovers` effect can drive it). Mirrors
// `api-client.resurrect.test.ts` exactly: a FAKE `fetch` returning a `Response`
// whose `body` is a hand-built `ReadableStream<Uint8Array>` of NDJSON bytes. No
// real network, no DOM, no sandbox, no LLM.
//
// WHAT THIS FILE PINS (design §C.5, R19.1-R19.4):
//   • A recorded happy-path sequence — the four lovers phases in order
//     (PLAN..BIND) -> a skip-note -> a terminal Result_Line — drives one
//     `onProgress` call per non-final line (each decoded to the
//     `LoversProgressEvent` union) and resolves to the validated
//     `LoversResponse`.
//   • POSTs to `/api/lovers` as `application/x-ndjson` with the pinned ref, the
//     file to bind and the spread; the model overrides ride through only when
//     supplied.
//   • An error-terminal line rejects with a `NecroError` exposing only
//     `{ code, userMessage }`.
//   • A demo sequence (server already applied the `[DEMO]` prefix) is surfaced
//     verbatim and never double-prefixed.
//
// The X-Necro-User-Key attach/omit rule and the user-abort vs 55 s-timeout
// discrimination are exercised by `user-key-header.pbt.test.ts` and the shared
// `createLoversClient`; this file concentrates on the recorded-sequence
// round-trip the effect->client->action path depends on.
//
// _Requirements: R19.1, R19.2, R19.3, R19.4_

import { NecroError } from "@necro/oracle/client";
import type {
  LoversProgressEvent,
  LoversRequestArgs,
  LoversResponse,
  PlayableSpread,
} from "@necro/ui-crt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiPort } from "./api-client.js";

// --- fixtures --------------------------------------------------------------

const SHA = "a".repeat(40);
const PINNED = `octocat/hello-world@${SHA}`;
const SPREAD: PlayableSpread = "necropsy";

const ARGS: LoversRequestArgs = {
  ref: PINNED,
  file: "src/app.py",
  spread: SPREAD,
};

/** A LoversResultWireSchema-valid result line (mirrors the pure-zod wire shape). */
const validLoversWire = {
  file: "src/app.py",
  targetLang: "javascript",
  pair: {
    jsBeloved: "// beloved",
    contractSchema: "{}",
    pythonTests: "# py",
    jsTests: "// js",
    pythonHeart: "# heart",
  },
  plan: {
    functions: [
      {
        name: "add",
        params: [],
        returns: { pyType: "int", jsonType: "number", jsType: "number" },
        bindable: true,
        edgeCases: [],
      },
    ],
    typeMap: [],
  },
  path: "llm",
  soulsSpent: {
    promptTokens: 120,
    completionTokens: 80,
    costUsd: 0.0123,
    soulSource: "ORACLE",
    byModel: [],
  },
  soulSource: "ORACLE",
  demo: false,
} as const;

// --- helpers ---------------------------------------------------------------

function fakeFetch(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function streamingResponse(chunks: readonly string[]): Response {
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
  return new Response(stream, { status: 200 });
}

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// lovers — the recorded NDJSON sequence
// ===========================================================================

describe("createApiPort.lovers — recorded stream (R19.1-R19.4)", () => {
  it("drives onProgress with the four phases in order then a skip-note, and resolves with the validated LoversResult", async () => {
    const note = "The living tongue slumbered; the old rite binds instead.";
    const chunks = [
      line({ phase: "PLAN" }),
      line({ phase: "GENERATE" }),
      line({ phase: "VALIDATE" }),
      line({ phase: "BIND" }),
      line({ skip: true, note }),
      line({ result: validLoversWire }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: LoversProgressEvent) => void>();
    const result: LoversResponse = await port.lovers(
      ARGS,
      new AbortController().signal,
      onProgress,
    );

    // Resolves with the parsed LoversResult (the terminal's render contract).
    expect(result).toEqual(validLoversWire);

    // One event per non-final line, in recorded order.
    const events = onProgress.mock.calls.map((c) => c[0]);
    expect(events).toEqual<LoversProgressEvent[]>([
      { kind: "phase", phase: "PLAN" },
      { kind: "phase", phase: "GENERATE" },
      { kind: "phase", phase: "VALIDATE" },
      { kind: "phase", phase: "BIND" },
      { kind: "skip-note", note },
    ]);
  });

  it("POSTs to /api/lovers as x-ndjson with the pinned ref, file and spread", async () => {
    const chunks = [line({ phase: "PLAN" }), line({ result: validLoversWire })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    await port.lovers(ARGS, new AbortController().signal, vi.fn());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, reqInit] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/lovers");
    expect(reqInit?.method).toBe("POST");
    expect((reqInit?.headers as Record<string, string>).accept).toBe(
      "application/x-ndjson",
    );
    const body = JSON.parse(reqInit?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      ref: PINNED,
      file: "src/app.py",
      targetLang: "javascript",
      spread: SPREAD,
    });
    // No overrides supplied -> no `models` field in the body.
    expect(body).not.toHaveProperty("models");
  });

  it("sends the model overrides when supplied", async () => {
    const chunks = [line({ result: validLoversWire })];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    await port.lovers(
      { ...ARGS, models: { fast: "openai/gpt-4o-mini" } },
      new AbortController().signal,
      vi.fn(),
    );
    const body = JSON.parse(
      fetchImpl.mock.calls[0]![1]?.body as string,
    ) as Record<string, unknown>;
    expect(body.models).toEqual({ fast: "openai/gpt-4o-mini" });
  });

  it("an error final line rejects with NecroError exposing only { code, userMessage }", async () => {
    const chunks = [
      line({ phase: "PLAN" }),
      line({ phase: "GENERATE" }),
      line({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          userMessage: "The binding slipped from the circle before it sealed.",
        },
      }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: LoversProgressEvent) => void>();
    const err = await port
      .lovers(ARGS, new AbortController().signal, onProgress)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
    expect((err as NecroError).userMessage).toBe(
      "The binding slipped from the circle before it sealed.",
    );
    expect((err as NecroError).cause).toBeUndefined();

    // The phases seen before the terminal error were still dispatched in order.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual<LoversProgressEvent[]>([
      { kind: "phase", phase: "PLAN" },
      { kind: "phase", phase: "GENERATE" },
    ]);
  });
});

// ===========================================================================
// lovers — demo mode: server-applied [DEMO] prefix surfaced verbatim
// ===========================================================================

describe("createApiPort.lovers — demo prefix is surfaced verbatim", () => {
  it("passes the server's [DEMO]-prefixed skip text through untouched and never double-prefixes it", async () => {
    const demoNote = "[DEMO] The living tongue slumbered; the old rite binds.";
    const demoWire = { ...validLoversWire, demo: true } as const;
    const chunks = [
      line({ phase: "PLAN" }),
      line({ skip: true, note: demoNote }),
      line({ phase: "BIND" }),
      line({ result: demoWire }),
    ];
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse(chunks));
    const port = createApiPort(fetchImpl);

    const onProgress = vi.fn<(e: LoversProgressEvent) => void>();
    const result = await port.lovers(ARGS, new AbortController().signal, onProgress);

    expect(result.demo).toBe(true);
    const skip = onProgress.mock.calls
      .map((c) => c[0])
      .find((e): e is Extract<LoversProgressEvent, { kind: "skip-note" }> =>
        e.kind === "skip-note",
      );
    expect(skip?.note).toBe(demoNote);
    expect(skip?.note.match(/\[DEMO\]/g)).toHaveLength(1);
  });
});
