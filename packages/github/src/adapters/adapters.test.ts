// Task 29.1 (R9.1, R9.2, R9.6, R10.6): failing tests for the system adapters. Test-first: red until 29.2.
//
// Assumed API (design.md, adapters):
//   ./system-fetch.js  export function createSystemFetchPort(): FetchPort
//     - calls globalThis.fetch(url, { method, headers, body, redirect: "manual", signal })
//       (looked up at call time, so vi.stubGlobal works)
//     - signal combines AbortSignal.timeout(req.timeoutMs) with the optional caller signal
//     - resolves { status, headers (names lower-cased), body } from the Response
//     - an abort or timeout (error name AbortError / TimeoutError) -> FetchTransportError("timeout")
//     - any other failure -> FetchTransportError("network"), original error as `cause`
//   ./system-clock.js  export const systemClock: ClockPort  (nowMs() === Date.now())
// No real network: globalThis.fetch is stubbed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTransportError, type FetchRequest } from "../ports.js";
import { systemClock } from "./system-clock.js";
import { createSystemFetchPort } from "./system-fetch.js";

type FetchInit = RequestInit & { signal: AbortSignal };

const baseReq: FetchRequest = {
  url: "https://api.github.com/repos/o/r",
  method: "GET",
  headers: { accept: "application/json" },
  timeoutMs: 5_000,
  redirect: "manual",
};

/** Stub fetch that rejects with the signal's reason once aborted, otherwise never settles. */
function hangingFetch() {
  return vi.fn((_url: string, init: FetchInit) =>
    new Promise<Response>((_resolve, reject) => {
      const fail = () => reject(init.signal.reason);
      if (init.signal.aborted) fail();
      else init.signal.addEventListener("abort", fail, { once: true });
    }),
  );
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createSystemFetchPort", () => {
  it("sends redirect: manual with method, headers and body", async () => {
    const fetchStub = vi.fn(async (_u: string, _i: FetchInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    await createSystemFetchPort()({ ...baseReq, method: "POST", body: "{}" });
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe(baseReq.url);
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers).toEqual({ accept: "application/json" });
  });

  it("uses AbortSignal.timeout(timeoutMs)", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    await createSystemFetchPort()({ ...baseReq, timeoutMs: 1234 });
    expect(spy).toHaveBeenCalledWith(1234);
  });

  it("returns status, lower-cased header names and the body stream", async () => {
    const res = new Response("hello", {
      status: 302,
      headers: { "Content-Type": "text/plain", "X-RateLimit-Remaining": "7", Location: "https://x.test/" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => res));
    const out = await createSystemFetchPort()(baseReq);
    expect(out.status).toBe(302);
    expect(out.headers["content-type"]).toBe("text/plain");
    expect(out.headers["x-ratelimit-remaining"]).toBe("7");
    expect(out.headers["location"]).toBe("https://x.test/");
    expect(Object.keys(out.headers).every((k) => k === k.toLowerCase())).toBe(true);
    expect(out.body).not.toBeNull();
    expect(await new Response(out.body).text()).toBe("hello");
  });

  it("returns a null body when the response has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const out = await createSystemFetchPort()(baseReq);
    expect(out.body).toBeNull();
  });

  it("maps a timeout to FetchTransportError('timeout')", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const err = await caught(createSystemFetchPort()({ ...baseReq, timeoutMs: 20 }));
    expect(err).toBeInstanceOf(FetchTransportError);
    expect((err as FetchTransportError).kind).toBe("timeout");
  });

  it("maps a caller abort to FetchTransportError('timeout')", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const ac = new AbortController();
    const p = createSystemFetchPort()({ ...baseReq, signal: ac.signal });
    ac.abort();
    const err = await caught(p);
    expect(err).toBeInstanceOf(FetchTransportError);
    expect((err as FetchTransportError).kind).toBe("timeout");
  });

  it("honours an already-aborted caller signal", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const err = await caught(createSystemFetchPort()({ ...baseReq, signal: AbortSignal.abort() }));
    expect((err as FetchTransportError).kind).toBe("timeout");
  });

  it("passes a signal to fetch that follows the caller signal", async () => {
    const fetchStub = hangingFetch();
    vi.stubGlobal("fetch", fetchStub);
    const ac = new AbortController();
    const p = createSystemFetchPort()({ ...baseReq, signal: ac.signal });
    const signal = fetchStub.mock.calls[0]![1].signal;
    expect(signal.aborted).toBe(false);
    ac.abort();
    expect(signal.aborted).toBe(true);
    await caught(p);
  });

  it("maps other failures to FetchTransportError('network') with the cause", async () => {
    const boom = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn(async () => { throw boom; }));
    const err = await caught(createSystemFetchPort()(baseReq));
    expect(err).toBeInstanceOf(FetchTransportError);
    expect((err as FetchTransportError).kind).toBe("network");
    expect((err as FetchTransportError).cause).toBe(boom);
  });
});

describe("systemClock", () => {
  it("nowMs() returns Date.now()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_123);
    expect(systemClock.nowMs()).toBe(1_700_000_000_123);
    vi.setSystemTime(1_800_000_000_000);
    expect(systemClock.nowMs()).toBe(Date.now());
  });
});
