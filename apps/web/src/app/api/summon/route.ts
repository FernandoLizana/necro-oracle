// apps/web/src/app/api/summon/route.ts
//
// Feature: 03-crt-terminal, task 27.2 — the Summon_Route module (design.md
// §"Route files"; R6.11, R12.2, R12.8).
//
// The App Router entry for `POST /api/summon`. It is a thin binding layer: it
// pins the route config (Node runtime, never cached, a 50 s serverless backstop
// above the 40 s Overall_Budget, R6.11), lazily resolves the memoised
// composition-root deps inside `POST`, and delegates to `handleSummon`. Every
// non-POST method is answered by the shared `methodNotAllowed` guard
// (405 + `Allow: POST` + `no-store` + an Error_Envelope body, HEAD bodyless)
// so the whole method contract lives in one place (R12.2).
//
// `getRouteDeps()` is called only inside `POST` (lazily), so importing this
// module does no env read, builds no adapters, and opens no socket; the
// composition root memoises the one `GitHubSummoner` across warm requests
// (R12.10).
//
// _Requirements: R6.11, R12.2, R12.8_

import { getRouteDeps } from "../../../server/composition.js";
import { methodNotAllowed } from "../../../server/handlers/guard.js";
import { handleSummon } from "../../../server/handlers/summon.js";

/** The reading pipeline runs on the Node.js runtime (not Edge) — R6.11. */
export const runtime = "nodejs";

/** Never statically cached: every summon is resolved fresh. */
export const dynamic = "force-dynamic";

/** Serverless backstop above the 40 s Overall_Budget (R6.11). */
export const maxDuration = 50;

/** `POST /api/summon` — resolve the memoised deps, then run the handler. */
export const POST = (req: Request): Promise<Response> => handleSummon(req, getRouteDeps());

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
