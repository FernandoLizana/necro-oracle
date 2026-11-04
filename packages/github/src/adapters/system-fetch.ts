// System fetch adapter: the only place allowed to touch globalThis.fetch.
import { FetchTransportError, type FetchPort, type FetchRequest, type FetchResponse } from "../ports.js";

function isAbortLike(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const name = (e as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export function createSystemFetchPort(): FetchPort {
  return async (req: FetchRequest): Promise<FetchResponse> => {
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;

    let res: Response;
    try {
      res = await globalThis.fetch(req.url, {
        method: req.method,
        headers: { ...req.headers },
        ...(req.body === undefined ? {} : { body: req.body }),
        redirect: "manual",
        signal,
      });
    } catch (e) {
      if (isAbortLike(e) || signal.aborted) {
        throw new FetchTransportError("timeout", `request aborted or timed out: ${req.url}`, e);
      }
      throw new FetchTransportError("network", `network failure: ${req.url}`, e);
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: res.body };
  };
}
