// apps/web/src/app/api/readings/route.ts
//
// Feature: 03-crt-terminal, task 27.2 — the Reading_Route module (design.md
// §"Route files", §"Streamed progress and time budgets"; R6.11, R12.2, R12.8).
//
// This REPLACES the task-1.2 WASM-resolution spike (a throwaway `GET`) with the
// real streamed Reading_Route. The App Router entry for `POST /api/readings` is
// a thin binding layer: it pins the route config (Node runtime, never cached, a
// 50 s serverless backstop above the 40 s Overall_Budget, R6.11), lazily
// resolves the memoised composition-root deps inside `POST`, and delegates to
// `handleReading`, which returns a streamed NDJSON response (D13).
//
// `getRouteDeps()` returns a `RouteDeps`, which is assignable to the handler's
// `ReadingDeps` (its one extra field, `setTimer`, is optional) — so production
// uses the handler's `setTimeout`-backed budget timers while tests inject a
// fake-clock timer. `getRouteDeps()` is called only inside `POST`, so importing
// this module does no env read, builds no adapters, and opens no socket.
//
// Every non-POST method is answered by the shared `methodNotAllowed` guard
// (405 + `Allow: POST` + `no-store` + an Error_Envelope body, HEAD bodyless)
// so the whole method contract lives in one place (R12.2).
//
// _Requirements: R6.11, R12.2, R12.8_

import { getRouteDeps } from "../../../server/composition.js";
import { methodNotAllowed } from "../../../server/handlers/guard.js";
import { handleReading } from "../../../server/handlers/readings.js";

/** The reading pipeline parses Python and loads WASM — Node.js runtime (R6.11). */
export const runtime = "nodejs";

/** Never statically cached: every reading is streamed fresh. */
export const dynamic = "force-dynamic";

/** Serverless backstop above the 40 s Overall_Budget (R6.11). */
export const maxDuration = 50;

/** `POST /api/readings` — resolve the memoised deps, then stream the reading. */
export const POST = (req: Request): Promise<Response> => handleReading(req, getRouteDeps());

// Every non-POST method shares the single 405 guard (405 + Allow: POST +
// no-store + VALIDATION_FAILED Error_Envelope; HEAD carries no body). The guard
// takes the Request, so Next's per-method handler signature `(req) => Response`
// is satisfied directly.
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
