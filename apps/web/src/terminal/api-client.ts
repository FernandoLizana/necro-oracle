// apps/web/src/terminal/api-client.ts
//
// `createApiPort` — the browser `ApiPort` implementation (design.md
// §"Browser adapters"). It is the single seam between the Terminal reducer and
// the summon/readings HTTP routes. It owns the Summon_Route outcome table and
// the streaming NDJSON reader of the Reading_Route; it never touches the DOM,
// localStorage, the clock directly (only `AbortSignal.timeout`), or the
// single-inflight / stale-requestId rules (those live in the reducer).
//
// Both methods compose the caller's `signal` with an internal 55 s client
// timeout via `AbortSignal.any`. The two abort paths both surface a
// DOMException named "AbortError", so they are told apart by inspecting the
// CALLER's `signal.aborted` — a user Ctrl+C aborts the caller's controller and
// is rethrown verbatim; the 55 s timeout does not, and is mapped to
// `networkError()` (NETWORK_TIMEOUT).
//
// _Requirements: R5.4, R5.10, R6.8, R6.9, R6.17, R6.18, R11.4, R11.5, R11.6, R11.7_

import { NecroError } from "@necro/oracle/client";
import type {
  ApiPort,
  PlayableSpread,
  ReadProgress,
  ReadingResponse,
  SummonSummary,
} from "@necro/ui-crt";
import { invalidResponseError, networkError, upstreamError } from "@necro/ui-crt";

import {
  ErrorEnvelopeSchema,
  ReadingResponseSchema,
  SummonSummarySchema,
} from "../protocol/schemas.js";
import { createNdjsonParser } from "./ndjson.js";

/** The internal per-request client timeout composed with the caller's signal. */
const CLIENT_TIMEOUT_MS = 55_000;

/**
 * Compose the caller's abort signal with a fresh 55 s client timeout. Either
 * aborting cancels the fetch; the caller's own `signal` is still inspected
 * later to tell a user abort apart from the timeout.
 *
 * The timeout is driven by a `setTimeout`-backed `AbortController` rather than
 * `AbortSignal.timeout`, so that fake timers (the test's deterministic
 * `advanceTimersByTimeAsync`) fire it without a wall-clock wait. A disposer is
 * returned so the caller clears the timer on every settle, leaking no timers.
 */
function withClientTimeout(signal: AbortSignal): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort();
  }, CLIENT_TIMEOUT_MS);
  return {
    signal: AbortSignal.any([signal, timeoutController.signal]),
    dispose: () => {
      clearTimeout(timer);
    },
  };
}

/** Try to read a JSON body; returns `undefined` if the body is not JSON. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function createApiPort(fetchImpl: typeof fetch): ApiPort {
  async function summon(
    repo: string,
    signal: AbortSignal,
  ): Promise<SummonSummary> {
    const timeout = withClientTimeout(signal);
    let res: Response;
    try {
      res = await fetchImpl("/api/summon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
        signal: timeout.signal,
      });
    } catch (error) {
      // Both the user-abort and the 55 s timeout surface an AbortError. Only a
      // user Ctrl+C aborts the CALLER's signal, so that is the discriminator:
      // rethrow a user abort verbatim, map everything else (TypeError, the
      // timeout) to NETWORK_TIMEOUT.
      if (signal.aborted) {
        throw error;
      }
      throw networkError();
    } finally {
      timeout.dispose();
    }

    if (res.ok) {
      const body = await readJson(res);
      if (body === undefined) {
        throw invalidResponseError();
      }
      const parsed = SummonSummarySchema.safeParse(body);
      if (parsed.success) {
        return parsed.data;
      }
      throw invalidResponseError();
    }

    // Error response: prefer a well-formed Error_Envelope so the server's own
    // Oracle_Voice code+message survive; otherwise map by status class.
    const body = await readJson(res);
    const envelope = ErrorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      throw new NecroError(
        envelope.data.error.code,
        envelope.data.error.userMessage,
      );
    }
    if (res.status >= 500) {
      throw upstreamError();
    }
    throw invalidResponseError();
  }

  async function read(
    pinned: string,
    spread: PlayableSpread,
    signal: AbortSignal,
    onProgress: ReadProgress,
  ): Promise<ReadingResponse> {
    // The 55 s client timeout stays armed across both the POST and the whole
    // stream read, so a mid-stream stall is mapped to NETWORK_TIMEOUT.
    const timeout = withClientTimeout(signal);
    try {
      let res: Response;
      try {
        res = await fetchImpl("/api/readings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson",
          },
          body: JSON.stringify({ ref: pinned, spread }),
          signal: timeout.signal,
        });
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        throw networkError();
      }

      const body = res.body;
      if (body === null) {
        throw networkError();
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      const parser = createNdjsonParser();

      // Dispatch one parsed StreamLine. Returns the final ReadingResponse once a
      // result line is seen; otherwise undefined (so the loop keeps reading).
      const dispatch = (
        lines: ReturnType<typeof parser.push>,
      ): ReadingResponse | undefined => {
        for (const parsedLine of lines) {
          if ("phase" in parsedLine) {
            onProgress({ kind: "phase", phase: parsedLine.phase });
          } else if ("skip" in parsedLine) {
            onProgress({ kind: "skip-note", note: parsedLine.note });
          } else if ("error" in parsedLine) {
            throw new NecroError(
              parsedLine.error.code,
              parsedLine.error.userMessage,
            );
          } else {
            // Result line: its inner shape is already validated by
            // StreamLineSchema; re-validate defensively before resolving (R6.18).
            return ReadingResponseSchema.parse(parsedLine.result);
          }
        }
        return undefined;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          const result = dispatch(parser.push(chunk));
          if (result !== undefined) {
            return result;
          }
        }
        const tail = dispatch(parser.flush());
        if (tail !== undefined) {
          return tail;
        }
      } catch (error) {
        // A NecroError from an error line is the reader's deliberate rejection.
        if (error instanceof NecroError) {
          throw error;
        }
        // A user Ctrl+C aborted the caller's signal and surfaced as AbortError:
        // rethrow it verbatim for the reducer to ignore.
        if (signal.aborted) {
          throw error;
        }
        // Any other abort is the 55 s client timeout or a dropped connection.
        if (error instanceof DOMException && error.name === "AbortError") {
          throw networkError();
        }
        // A parser throw (bad JSON or a line failing StreamLineSchema), or a
        // ReadingResponseSchema failure on the result line, is an invalid
        // response (R6.9, R6.18).
        throw invalidResponseError();
      }

      // The stream ended cleanly with no result or error line (R6.17, R11.6).
      throw networkError();
    } finally {
      timeout.dispose();
    }
  }

  return { summon, read };
}
