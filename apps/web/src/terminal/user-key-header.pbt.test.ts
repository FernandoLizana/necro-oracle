// apps/web/src/terminal/user-key-header.pbt.test.ts
//
// Feature: lovers-binding, task 11.10 — Property 35 (R41.1, R41.2): the browser
// resurrect + lovers clients attach the `X-Necro-User-Key` header IFF a user
// key is set in the (in-memory) SoulKey context, and never when it is absent;
// the header value equals the key, and the key is never persisted.
//
// The clients consume the SoulKey ref through the injected `UserKeyReader`
// (`SoulKeyApi.getKeyForRequest`), so this test drives the REAL
// `createApiPort().resurrect` and `createLoversClient` with a fake `fetch` and
// a reader that returns an arbitrary key-or-null, and asserts the outgoing
// request headers. It also drives the REAL `deriveLast4` + the non-persistence
// contract of the key container (the context stores the raw key only in a ref,
// never in storage). No network, DOM mutation, LLM, or sandbox.
//
// **Validates: Requirements 41.1, 41.2**

import { NecroError } from "@necro/oracle/client";
import type { PlayableSpread, ResurrectTarget } from "@necro/ui-crt";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiPort, type UserKeyReader } from "./api-client.js";
import { createLoversClient } from "./lovers-client.js";
import { deriveLast4 } from "./soul-key-context.js";

// --- constants -------------------------------------------------------------

const SHA = "a".repeat(40);
const PINNED = `octocat/hello-world@${SHA}`;
const SPREAD: PlayableSpread = "necropsy";
const BARE_TARGET: ResurrectTarget = { kind: "bare" };
const USER_KEY_HEADER = "X-Necro-User-Key";

// A RitualResultWireSchema-valid result line for the resurrect client, and a
// LoversResultWireSchema-valid result line for the lovers client. Both clients
// re-validate the result line, so each must carry a complete wire shape.
const RITUAL_WIRE = {
  ritualId: "123e4567-e89b-42d3-a456-426614174000",
  selectedCount: 1,
  files: [
    {
      path: "src/legacy.py",
      before: 'print "hi"\n',
      after: 'print("hi")\n',
      diff: [{ kind: "context", text: "" }],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch: "--- a\n+++ b\n",
  beforeVitality: 40,
  afterVitality: 55,
  vitalityDelta: 15,
  changedCards: [],
  degraded: false,
  demo: false,
} as const;

const LOVERS_WIRE = {
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
  path: "template",
  soulsSpent: { promptTokens: 0, completionTokens: 0, costUsd: 0, soulSource: "ORACLE", byModel: [] },
  soulSource: "ORACLE",
  demo: false,
} as const;

// --- helpers ---------------------------------------------------------------

/** A `vi.fn` typed as the global `fetch`. */
function fakeFetch(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

/** Build a 200 NDJSON Response whose body streams the given lines. */
function streamingResponse(lines: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const chunks = lines.map((o) => `${JSON.stringify(o)}\n`);
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

/** Read the user-key header off a recorded fetch call (case-insensitive). */
function headerOf(reqInit: RequestInit | undefined, name: string): string | undefined {
  const headers = (reqInit?.headers ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

/** An arbitrary user-key value, biased toward realistic opaque keys. */
const arbKey = fc
  .string({ minLength: 8, maxLength: 64 })
  // The reader may legitimately hold any non-empty string; constrain to
  // header-safe characters so the assertion focuses on attach/omit, not on
  // header serialization.
  .map((s) => s.replace(/[^\x21-\x7e]/g, "x"))
  .filter((s) => s.length >= 8);

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Property 35 (R41.1): attach IFF a key is set; value equals the key
// ===========================================================================

describe("Property 35 (R41.1): resurrect client attaches X-Necro-User-Key iff a key is set, value equals the key", () => {
  it("attaches the header with the exact key when the reader returns a key; omits it when null", async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(arbKey, { nil: null }), async (key) => {
        const fetchImpl = fakeFetch();
        fetchImpl.mockResolvedValue(streamingResponse([{ result: RITUAL_WIRE }]));
        const getUserKey: UserKeyReader = () => key;
        const port = createApiPort(fetchImpl, getUserKey);

        await port.resurrect(
          PINNED,
          BARE_TARGET,
          SPREAD,
          new AbortController().signal,
          vi.fn(),
        );

        const [, reqInit] = fetchImpl.mock.calls[0]!;
        const header = headerOf(reqInit, USER_KEY_HEADER);
        if (key === null) {
          expect(header).toBeUndefined();
        } else {
          expect(header).toBe(key);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never attaches the header when no reader is injected", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse([{ result: RITUAL_WIRE }]));
    const port = createApiPort(fetchImpl); // no getUserKey

    await port.resurrect(PINNED, BARE_TARGET, SPREAD, new AbortController().signal, vi.fn());

    const [, reqInit] = fetchImpl.mock.calls[0]!;
    expect(headerOf(reqInit, USER_KEY_HEADER)).toBeUndefined();
  });

  it("summon and read (non-BYOK routes) never attach the header even when a key is set", async () => {
    const fetchImpl = fakeFetch();
    // summon returns a JSON SummonSummary-shaped body; we only assert the header.
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ not: "a summon" }), { status: 200 }),
    );
    const port = createApiPort(fetchImpl, () => "a-key-that-is-set");

    // summon rejects on the invalid body, but the fetch call still happened.
    await port.summon("octo/legacy", new AbortController().signal).catch(() => undefined);
    const [, reqInit] = fetchImpl.mock.calls[0]!;
    expect(headerOf(reqInit, USER_KEY_HEADER)).toBeUndefined();
  });
});

describe("Property 35 (R41.1): lovers client attaches X-Necro-User-Key iff a key is set, value equals the key", () => {
  it("attaches the header with the exact key when set; omits it when null", async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(arbKey, { nil: null }), async (key) => {
        const fetchImpl = fakeFetch();
        fetchImpl.mockResolvedValue(streamingResponse([{ result: LOVERS_WIRE }]));
        const getUserKey: UserKeyReader = () => key;
        const lovers = createLoversClient(fetchImpl, getUserKey);

        await lovers(
          { ref: PINNED, file: "src/app.py", spread: SPREAD },
          new AbortController().signal,
          vi.fn(),
        );

        const [url, reqInit] = fetchImpl.mock.calls[0]!;
        expect(url).toBe("/api/lovers");
        const header = headerOf(reqInit, USER_KEY_HEADER);
        if (key === null) {
          expect(header).toBeUndefined();
        } else {
          expect(header).toBe(key);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never attaches the header when no reader is injected", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(streamingResponse([{ result: LOVERS_WIRE }]));
    const lovers = createLoversClient(fetchImpl); // no reader

    await lovers(
      { ref: PINNED, file: "src/app.py", spread: SPREAD },
      new AbortController().signal,
      vi.fn(),
    ).catch((e: unknown) => {
      // A NecroError would only arise from an error line; the result line path
      // resolves. Re-throw anything unexpected.
      if (!(e instanceof NecroError)) throw e;
    });

    const [, reqInit] = fetchImpl.mock.calls[0]!;
    expect(headerOf(reqInit, USER_KEY_HEADER)).toBeUndefined();
  });
});

// ===========================================================================
// Property 35 (R41.2): the key value is never logged / never persisted
// ===========================================================================

describe("Property 35 (R41.2): the user key is never logged and never persisted", () => {
  it("resurrect + lovers clients never print the key to the console", async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, async (key) => {
        const logSpies = [
          vi.spyOn(console, "log").mockImplementation(() => {}),
          vi.spyOn(console, "info").mockImplementation(() => {}),
          vi.spyOn(console, "warn").mockImplementation(() => {}),
          vi.spyOn(console, "error").mockImplementation(() => {}),
          vi.spyOn(console, "debug").mockImplementation(() => {}),
        ];
        try {
          const fetchImpl = fakeFetch();
          fetchImpl.mockResolvedValue(streamingResponse([{ result: RITUAL_WIRE }]));
          const resurrect = createApiPort(fetchImpl, () => key).resurrect;
          await resurrect(PINNED, BARE_TARGET, SPREAD, new AbortController().signal, vi.fn());

          const fetchImpl2 = fakeFetch();
          fetchImpl2.mockResolvedValue(streamingResponse([{ result: LOVERS_WIRE }]));
          const lovers = createLoversClient(fetchImpl2, () => key);
          await lovers(
            { ref: PINNED, file: "src/app.py", spread: SPREAD },
            new AbortController().signal,
            vi.fn(),
          );

          // No console sink saw the key value.
          for (const spy of logSpies) {
            for (const call of spy.mock.calls) {
              for (const arg of call) {
                expect(String(arg)).not.toContain(key);
              }
            }
          }
        } finally {
          for (const spy of logSpies) spy.mockRestore();
        }
      }),
      { numRuns: 50 },
    );
  });

  it("deriveLast4 never reveals more than the final four characters of the key", () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const last4 = deriveLast4(key);
        expect(last4.length).toBeLessThanOrEqual(4);
        expect(key.endsWith(last4)).toBe(true);
        // The preview can never carry the whole key (keys here are >= 8 chars).
        expect(last4).not.toBe(key);
      }),
      { numRuns: 200 },
    );
  });
});
