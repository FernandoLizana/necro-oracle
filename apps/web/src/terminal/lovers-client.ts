// apps/web/src/terminal/lovers-client.ts
//
// Feature: lovers-binding, task 11.9 — the browser fetch client for the
// Lovers_Route NDJSON stream (`POST /api/lovers`), mirroring the resurrect
// client in `api-client.ts` (design §C.5 "Lovers route + wire schemas", §D.4
// "Transport", and the "Where code lives" map: `terminal/lovers-client.ts`).
//
// It POSTs a `LoversRequest` and consumes the `application/x-ndjson` stream:
// one JSON object per line — a phase line, a skip-note line, then a terminal
// result or error line. Each decoded line is validated against the BROWSER-SAFE
// pure-zod mirror `LoversStreamLineSchema` from `protocol/lovers-wire.ts` (never
// the server `lovers-stream.ts`, which imports `@necro/coven`) so the client
// bundle keeps the client boundary (R16.4) and the terminal JS budget.
//
// BYOK (R27.1, R41.1): the client attaches the user key in the dedicated
// `X-Necro-User-Key` header IFF a key is set for this tab — read through the
// injected `UserKeyReader` (`SoulKeyApi.getKeyForRequest`) — and attaches NO
// header otherwise. The raw key flows only into the header object and is NEVER
// logged. The header spelling + attach-only-when-set rule are identical to the
// resurrect client in `api-client.ts`.
//
// It reuses the exact abort/timeout discrimination of `api-client.ts`: the
// caller's `signal` is composed with a 55 s client timeout; a user Ctrl+C
// (which aborts the CALLER's signal) is rethrown verbatim, while the timeout or
// a dropped connection maps to `networkError()` (NETWORK_TIMEOUT). A terminal
// error line rejects with a `NecroError` exposing only `{ code, userMessage }`.
//
// This task owns the browser transport (the header + the stream reader). Wiring
// the `lovers` command through this client into the terminal shell, and the
// route/handler itself, are later tasks (11.6b); this module is the standalone
// client those will consume.
//
// _Requirements: R19.1, R19.3, R27.1, R40.1, R41.1_
// _Design: C.5 Lovers route + wire schemas, D.4 Transport_

import { NecroError } from "@necro/oracle/client";
import type {
  LoversModelOverrides,
  LoversPhase,
  LoversProgress,
  LoversProgressEvent,
  LoversRequestArgs as UiCrtLoversRequestArgs,
} from "@necro/ui-crt";
import { invalidResponseError, networkError } from "@necro/ui-crt";

import {
  type LoversResponse,
  LoversResultWireSchema,
  LoversStreamLineSchema,
} from "../protocol/lovers-wire.js";
import { createNdjsonParser } from "./ndjson.js";
import type { UserKeyReader } from "./api-client.js";

/**
 * Item 19: the per-request client timeout composed with the caller's signal.
 *
 * The lovers rite summons + resurrects the file BEFORE PLAN/GENERATE, so the
 * server runs up to a 115 s Overall_Budget under `maxDuration = 120` (design
 * C.6). This timeout must sit ABOVE the server's own deadline so the client
 * only gives up AFTER the server would have; otherwise a legitimate long
 * binding is aborted client-side as a spurious NETWORK_TIMEOUT. (The generic
 * 55 s value is correct for the readings/resurrect clients, whose server
 * budgets are 40/48 s, but is far too short for the 120 s lovers route.)
 * Exported so a test pins the "client waits longer than the server" invariant.
 */
export const LOVERS_CLIENT_TIMEOUT_MS = 125_000;

/**
 * The dedicated BYOK transport header (lovers-binding R27.1, R41.1), declared
 * with the wire/display spelling `X-Necro-User-Key`. Header names match
 * case-insensitively, so the server's lowercase `USER_KEY_HEADER` lookup reads
 * this value unchanged. Declared here (not imported from `server/user-key.ts`)
 * so the browser bundle keeps the client boundary (R16.4).
 */
const USER_KEY_HEADER = "X-Necro-User-Key" as const;

// The BYOK model overrides, the four ordered Lovers phases, the progress-event
// union and the progress callback are the SINGLE source of truth in
// `@necro/ui-crt` (the lovers-binding task 14.4 wiring). They are re-exported
// here so existing importers of this module keep the same names, while the
// api-client can thread ui-crt's `LoversRequestArgs` straight through without a
// structural mismatch under `exactOptionalPropertyTypes`.
export type { LoversModelOverrides, LoversPhase, LoversProgress, LoversProgressEvent };

/**
 * The arguments the terminal supplies to run a Lovers binding: the ui-crt
 * `LoversRequestArgs` (ref / file / spread / optional model overrides) widened
 * with the optional `demo` replay marker this transport may set. Using the
 * ui-crt type as the base keeps the api-client's pass-through assignable.
 */
export interface LoversRequestArgs extends UiCrtLoversRequestArgs {
  /** The optional demo marker; present only for a demo replay. */
  readonly demo?: true | undefined;
}

/**
 * Compose the caller's abort signal with a fresh client timeout (LOVERS_CLIENT_TIMEOUT_MS). Either
 * aborting cancels the fetch; the caller's own `signal` is still inspected
 * later to tell a user abort apart from the timeout. Like the helper in
 * `api-client.ts`; a `setTimeout`-backed controller so fake timers can drive it
 * deterministically, with a disposer so no timer leaks.
 */
function withClientTimeout(signal: AbortSignal): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort();
  }, LOVERS_CLIENT_TIMEOUT_MS);
  return {
    signal: AbortSignal.any([signal, timeoutController.signal]),
    dispose: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Build the request headers, attaching the `X-Necro-User-Key` header IFF
 * `getUserKey` returns a non-empty key (R41.1); otherwise no key header is
 * added. The raw key lives only in the returned header object and is never
 * logged or echoed.
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

/** Serialize the request args into the strict `LoversRequest` wire body. */
function buildBody(args: LoversRequestArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ref: args.ref,
    file: args.file,
    targetLang: "javascript",
    spread: args.spread,
  };
  if (args.models !== undefined) {
    const models: Record<string, string> = {};
    if (args.models.fast !== undefined) models.fast = args.models.fast;
    if (args.models.strong !== undefined) models.strong = args.models.strong;
    body.models = models;
  }
  if (args.demo === true) {
    body.demo = true;
  }
  return body;
}

/**
 * The browser Lovers client. POSTs to `/api/lovers`, streams the NDJSON
 * response, calls `onProgress` for every phase/skip-note line, and resolves
 * with the validated final `LoversResult`. Rejects with a `NecroError`.
 *
 * @param fetchImpl  the `fetch` implementation (the real global in the browser,
 *                   a fake in tests).
 * @param getUserKey OPTIONAL reader of the current BYOK user key
 *                   (`SoulKeyApi.getKeyForRequest`). When it returns a key the
 *                   `X-Necro-User-Key` header is attached; otherwise none is.
 */
export function createLoversClient(
  fetchImpl: typeof fetch,
  getUserKey?: UserKeyReader,
): (
  args: LoversRequestArgs,
  signal: AbortSignal,
  onProgress: LoversProgress,
) => Promise<LoversResponse> {
  return async function lovers(
    args: LoversRequestArgs,
    signal: AbortSignal,
    onProgress: LoversProgress,
  ): Promise<LoversResponse> {
    // The client timeout stays armed across both the POST and the whole
    // stream read, so a mid-stream stall is mapped to NETWORK_TIMEOUT. The
    // user-abort vs timeout discrimination is identical to `api-client.ts`.
    const timeout = withClientTimeout(signal);
    try {
      let res: Response;
      try {
        res = await fetchImpl("/api/lovers", {
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
          body: JSON.stringify(buildBody(args)),
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
      // Validate every line against the browser-safe Lovers_Route line union.
      // The server already applies the `[DEMO]` prefix in demo mode, so the
      // phase/skip/error text is surfaced verbatim — no client double-prefix.
      const parser = createNdjsonParser(LoversStreamLineSchema);

      // Dispatch one parsed line. Returns the final LoversResult once a result
      // line is seen; otherwise undefined (so the loop keeps reading).
      const dispatch = (
        lines: ReturnType<typeof parser.push>,
      ): LoversResponse | undefined => {
        for (const line of lines) {
          if ("phase" in line) {
            onProgress({ kind: "phase", phase: line.phase });
          } else if ("skip" in line) {
            onProgress({ kind: "skip-note", note: line.note });
          } else if ("error" in line) {
            throw new NecroError(line.error.code, line.error.userMessage);
          } else {
            // Result line: re-validate against the LoversResult wire schema
            // before resolving, exactly as the resurrect client re-validates
            // its result line (R9.3-style defensive re-parse, R6.18).
            return LoversResultWireSchema.parse(line.result);
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
        // Any other abort is the LOVERS_CLIENT_TIMEOUT_MS client timeout or a dropped connection.
        if (error instanceof DOMException && error.name === "AbortError") {
          throw networkError();
        }
        // A parser throw (bad JSON or a line failing LoversStreamLineSchema), or
        // a LoversResultWireSchema failure on the result line, is an invalid
        // response.
        throw invalidResponseError();
      }

      // The stream ended cleanly with no result or error line.
      throw networkError();
    } finally {
      timeout.dispose();
    }
  };
}
