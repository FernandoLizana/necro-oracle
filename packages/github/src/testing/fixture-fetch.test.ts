import { describe, expect, it } from "vitest";
import { FetchTransportError, type FetchRequest } from "../ports.js";
import { createFixtureFetch } from "./fixture-fetch.js";

const URL_A = "https://api.github.com/repos/o/r";
const URL_B = "https://api.github.com/repos/o/r/commits/main";

function req(url: string, extra: Partial<FetchRequest> = {}): FetchRequest {
  return { url, method: "GET", headers: {}, timeoutMs: 1000, redirect: "manual", ...extra };
}

async function text(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (body === null) return "";
  return new Response(body).text();
}

describe("fixture fetch (R9.4, R9.5, R9.6)", () => {
  it("answers from registered fixtures by method and URL", async () => {
    const ff = createFixtureFetch();
    ff.register({ method: "GET", url: URL_A, json: { id: 1 } });
    ff.register({ method: "POST", url: URL_A, body: "posted" });

    const get = await ff.fetch(req(URL_A));
    expect(get.status).toBe(200);
    expect(JSON.parse(await text(get.body))).toEqual({ id: 1 });

    const post = await ff.fetch(req(URL_A, { method: "POST", body: "{}" }));
    expect(await text(post.body)).toBe("posted");
  });

  it("defaults the method to GET", async () => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, body: "x" });
    expect(await text((await ff.fetch(req(URL_A))).body)).toBe("x");
  });

  it("records every request with url, method, headers, timeoutMs and redirect", async () => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, json: {} });
    ff.register({ url: URL_B, json: {} });
    await ff.fetch(req(URL_A, { headers: { authorization: "Bearer t" }, timeoutMs: 1234 }));
    await ff.fetch(req(URL_B));
    expect(ff.requests).toHaveLength(2);
    expect(ff.requests[0]).toMatchObject({
      url: URL_A,
      method: "GET",
      headers: { authorization: "Bearer t" },
      timeoutMs: 1234,
      redirect: "manual",
    });
    expect(ff.requests[1]?.url).toBe(URL_B);
  });

  it("supports scripted status, headers and body", async () => {
    const ff = createFixtureFetch();
    ff.register({
      url: URL_A,
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      body: new Uint8Array([1, 2, 3]),
    });
    const res = await ff.fetch(req(URL_A));
    expect(res.status).toBe(403);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    expect(new Uint8Array(await new Response(res.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns a null body when none is scripted", async () => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, status: 204 });
    expect((await ff.fetch(req(URL_A))).body).toBeNull();
  });

  it("serves a Location redirect with a lower-cased header", async () => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, redirectTo: "https://api.github.com/repositories/42", status: 301 });
    const res = await ff.fetch(req(URL_A));
    expect(res.status).toBe(301);
    expect(res.headers["location"]).toBe("https://api.github.com/repositories/42");
  });

  it.each(["timeout", "network"] as const)("throws FetchTransportError(%s) when scripted", async (kind) => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, transportError: kind });
    const err = await ff.fetch(req(URL_A)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchTransportError);
    expect((err as FetchTransportError).kind).toBe(kind);
    expect(ff.requests).toHaveLength(1);
  });

  it("streams chunks lazily and records cancel()", async () => {
    const ff = createFixtureFetch();
    const handle = ff.register({
      url: URL_A,
      stream: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    });
    const res = await ff.fetch(req(URL_A));
    const reader = res.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    expect(handle.cancelCalls).toBe(0);
    expect(handle.chunksPulled).toBeLessThan(3);
    await reader.cancel("enough");
    expect(handle.cancelCalls).toBe(1);
  });

  it("does not count a fully consumed stream as cancelled", async () => {
    const ff = createFixtureFetch();
    const handle = ff.register({ url: URL_A, stream: [new Uint8Array([9])] });
    const res = await ff.fetch(req(URL_A));
    expect(new Uint8Array(await new Response(res.body).arrayBuffer())).toEqual(new Uint8Array([9]));
    expect(handle.cancelCalls).toBe(0);
  });

  it("fails loudly on an unregistered URL and still records the request", async () => {
    const ff = createFixtureFetch();
    ff.register({ url: URL_A, json: {} });
    await expect(ff.fetch(req("https://example.com/nope"))).rejects.toThrow(/unregistered/i);
    await expect(ff.fetch(req(URL_A, { method: "POST" }))).rejects.toThrow(/unregistered/i);
    expect(ff.requests.map((r) => r.url)).toEqual(["https://example.com/nope", URL_A]);
  });

  it("does not throw a FetchTransportError for an unregistered URL", async () => {
    const ff = createFixtureFetch();
    const err = await ff.fetch(req(URL_B)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FetchTransportError);
  });
});
