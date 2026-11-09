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
// BYOK (lovers-binding task 11.9): `createApiPort` takes an OPTIONAL
// `getUserKey` reader — the `SoulKeyApi.getKeyForRequest` of the `apps/web`
// `SoulKeyContext` ref (design §D.3/D.4). When a key is set, `resurrect`
// attaches it in the dedicated `X-Necro-User-Key` header; when no key is set
// (`getUserKey` returns `null`, or no reader was injected) NO header is
// attached. The raw key value flows ONLY into the header and is NEVER logged
// (R41.1). The `summon`/`read` paths target `/api/summon` and `/api/readings`,
// which are not BYOK routes, so they never attach the header (R27.1: the key
// goes to the resurrect and lovers routes only).
//
// _Requirements: R5.4, R5.10, R6.8, R6.9, R6.17, R6.18, R11.4, R11.5, R11.6, R11.7, R41.1_

import { NecroError } from "@necro/oracle/client";
import type {
  ApiPort,
  LoversProgress,
  LoversRequestArgs,
  LoversResponse,
  PlayableSpread,
  ReadProgress,
  ReadingResponse,
  ResurrectProgress,
  ResurrectTarget,
  RitualResponse,
  SummonSummary,
} from "@necro/ui-crt";
import { invalidResponseError, networkError, upstreamError } from "@necro/ui-crt";

import {
  ErrorEnvelopeSchema,
  ReadingResponseSchema,
  SummonSummarySchema,
} from "../protocol/schemas.js";
import {
  ResurrectStreamLineSchema,
  RitualResultWireSchema,
} from "../protocol/resurrect-wire.js";
import { createNdjsonParser } from "./ndjson.js";
import { createLoversClient } from "./lovers-client.js";

/** The internal per-request client timeout composed with the caller's signal. */
const CLIENT_TIMEOUT_MS = 55_000;

/**
 * The dedicated BYOK transport header (lovers-binding R27.1, R41.1). Declared
 * with the wire/display spelling `X-Necro-User-Key` here rather than imported
 * from `server/user-key.ts`, so the browser bundle keeps the client boundary
 * (R16.4): the client imports only `@necro/ui-crt` + sibling browser modules,
 * never a server module. Header names are matched case-insensitively, so the
 * server's lowercase `USER_KEY_HEADER` lookup reads this value unchanged.
 */
const USER_KEY_HEADER = "X-Necro-User-Key" as const;

/**
 * A reader of the current BYOK user key — the `SoulKeyApi.getKeyForRequest` of
 * the `apps/web` `SoulKeyContext` ref (design §D.3). Returns the raw key when
 * one is set for this tab, or `null` when none is set. The value flows only
 * into the `X-Necro-User-Key` header and is NEVER logged (R41.1).
 */
export type UserKeyReader = () => string | null;

/**
 * Build the request headers for a BYOK route, starting from `base` and adding
 * the `X-Necro-User-Key` header IFF `getUserKey` returns a non-empty key
 * (R41.1). When no reader is injected, or it returns `null`/`""`, no header is
 * added — the request carries no key at all. The key is placed only in the
 * header object and is never logged or echoed.
 */
function withUserKeyHeader(
  base: Record<string, string>,
  getUserKey: UserKeyReader | undefined,
): Record<string, string> {
  const key = getUserKey?.() ?? null;
  if (key === null || key.length === 0) {
    return base;
  }
  return { ...base, [USER_KEY_HEADER]: key };
}

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

export function createApiPort(
  fetchImpl: typeof fetch,
  getUserKey?: UserKeyReader,
): ApiPort {
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

  async function resurrect(
    pinned: string,
    target: ResurrectTarget,
    spread: PlayableSpread,
    signal: AbortSignal,
    onProgress: ResurrectProgress,
    demo?: true,
  ): Promise<RitualResponse> {
    // Serialize the parsed target to the optional `target` string field of
    // ResurrectRequestSchema: a bare run OMITS the field, a card target sends
    // its id, a file target sends its path (R1.4). The server owns all semantic
    // validation (card/file existence, py2 classification).
    const body: {
      ref: string;
      spread: PlayableSpread;
      target?: string;
      demo?: true;
    } = {
      ref: pinned,
      spread,
    };
    if (target.kind === "card") {
      body.target = target.card;
    } else if (target.kind === "file") {
      body.target = target.path;
    }
    // Item 2 (judge-ready-pass): a demo replay forwards demo:true so the route
    // resurrects the bundled fixture OFFLINE (never GitHub/OpenRouter).
    if (demo === true) {
      body.demo = true;
    }

    // The 55 s client timeout stays armed across both the POST and the whole
    // stream read, so a mid-stream stall is mapped to NETWORK_TIMEOUT. The
    // user-abort vs timeout discrimination is identical to `read`.
    const timeout = withClientTimeout(signal);
    try {
      let res: Response;
      try {
        res = await fetchImpl("/api/resurrect", {
          method: "POST",
          // Attach the BYOK user key in the dedicated header IFF one is set for
          // this tab (R27.1, R41.1); omit it entirely otherwise. The raw key
          // lives only in the header object here — never logged.
          headers: withUserKeyHeader(
            {
              "content-type": "application/json",
              accept: "application/x-ndjson",
            },
            getUserKey,
          ),
          body: JSON.stringify(body),
          signal: timeout.signal,
        });
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        throw networkError();
      }

      const stream = res.body;
      if (stream === null) {
        throw networkError();
      }

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      // Reuse the same incremental splitter as `read`, validating every line
      // against the Resurrection_Route line union (R9.5, R9.6). The server
      // already applies the `[DEMO]` prefix to every line in demo mode, so the
      // phase/skip/error text is surfaced verbatim — no client double-prefix.
      const parser = createNdjsonParser(ResurrectStreamLineSchema);

      // Dispatch one parsed line. Returns the final RitualResult once a result
      // line is seen; otherwise undefined (so the loop keeps reading).
      const dispatch = (
        lines: ReturnType<typeof parser.push>,
      ): RitualResponse | undefined => {
        for (const line of lines) {
          if ("phase" in line) {
            onProgress({ kind: "phase", phase: line.phase });
          } else if ("skip" in line) {
            onProgress({ kind: "skip-note", note: line.note });
          } else if ("error" in line) {
            throw new NecroError(line.error.code, line.error.userMessage);
          } else {
            // Result line: re-validate against the RitualResult wire schema
            // before resolving, exactly as `read` re-validates the reading
            // result line (R9.3, R6.18).
            return RitualResultWireSchema.parse(line.result);
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
        // A user Ctrl+C aborted the caller's signal: rethrow verbatim.
        if (signal.aborted) {
          throw error;
        }
        // Any other abort is the 55 s client timeout or a dropped connection.
        if (error instanceof DOMException && error.name === "AbortError") {
          throw networkError();
        }
        // A parser throw (bad JSON or a line failing ResurrectStreamLineSchema),
        // or a RitualResultWireSchema failure on the result line, is an invalid
        // response (R9.6, R6.18).
        throw invalidResponseError();
      }

      // The stream ended cleanly with no result or error line (R6.17, R11.6).
      throw networkError();
    } finally {
      timeout.dispose();
    }
  }

  // The Lovers binding client (lovers-binding task 14.4). Built from the shared
  // `createLoversClient`, threaded with the SAME `getUserKey` reader used for
  // `resurrect`, so `lovers` attaches `X-Necro-User-Key` IFF a key is set for
  // this tab and never otherwise (R27.1, R41.1). The returned function's
  // signature is `(args, signal, onProgress) => Promise<LoversResponse>`, which
  // is exactly the `ApiPort.lovers` shape, so it is exposed directly.
  const loversClient = createLoversClient(fetchImpl, getUserKey);

  function lovers(
    args: LoversRequestArgs,
    signal: AbortSignal,
    onProgress: LoversProgress,
  ): Promise<LoversResponse> {
    return loversClient(args, signal, onProgress);
  }

  return { summon, read, resurrect, lovers };
}
