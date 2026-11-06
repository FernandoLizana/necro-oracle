// apps/web/src/app/api/resurrect/route.ts
//
// Feature: resurrection-engine, task 13.2 — the Resurrection_Route module
// (design: "Resurrection_Route"). The App Router entry for
// `POST /api/resurrect` is a thin binding layer mirroring
// `app/api/readings/route.ts`: it pins the route config (Node runtime, never
// cached, a 50 s serverless backstop above the 48 s Overall_Budget, R10.3),
// lazily resolves the memoised composition-root deps inside `POST`, and
// delegates to `handleResurrect`, which returns a streamed NDJSON response.
//
// `getResurrectDeps()` returns a `ResurrectDeps`, which is assignable to the
// handler's `ResurrectHandlerDeps` (its one extra field, `setTimer`, is
// optional) — so production uses the handler's `setTimeout`-backed budget timer
// while tests inject a fake-clock timer. `getResurrectDeps()` is called only
// inside `POST`, so importing this module does no env read, builds no adapters,
// and opens no socket.
//
// Every non-POST method is answered by the shared `methodNotAllowed` guard
// (405 + `Allow: POST` + `no-store` + an Error_Envelope body, HEAD bodyless)
// so the whole method contract lives in one place (R11.1).
//
// _Requirements: R10.3, R11.1, R9.1_

import { getResurrectDeps } from "../../../server/composition.js";
import { methodNotAllowed } from "../../../server/handlers/guard.js";
import { handleResurrect } from "../../../server/handlers/resurrect.js";

/** The Ritual parses Python and loads WASM — Node.js runtime. */
export const runtime = "nodejs";

/** Never statically cached: every Ritual is streamed fresh. */
export const dynamic = "force-dynamic";

/** Serverless backstop above the 48 s Overall_Budget (R10.3). */
export const maxDuration = 50;

/** `POST /api/resurrect` — resolve the memoised deps, then stream the Ritual. */
export const POST = (req: Request): Promise<Response> =>
  handleResurrect(req, getResurrectDeps());

// Every non-POST method shares the single 405 guard (405 + Allow: POST +
// no-store + VALIDATION_FAILED Error_Envelope; HEAD carries no body).
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
