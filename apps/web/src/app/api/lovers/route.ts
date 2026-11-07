// apps/web/src/app/api/lovers/route.ts
//
// Feature: lovers-binding, task 11.6b — the Lovers_Route binding (design C.5
// "Lovers route", C.6 route deadline). The App Router entry for
// `POST /api/lovers` is a thin binding layer mirroring
// `app/api/resurrect/route.ts`: it pins the route config (Node runtime, never
// cached, the serverless `maxDuration` backstop), lazily resolves the memoised
// composition-root deps inside `POST`, and delegates to `handleLovers`, which
// returns a streamed NDJSON response.
//
// `getLoversDeps()` is called only inside `POST`, so importing this module does
// no env read, builds no adapters, and opens no socket.
//
// Every non-POST method is answered by the shared `methodNotAllowed` guard
// (405 + `Allow: POST` + `no-store` + an Error_Envelope body, HEAD bodyless)
// so the whole method contract lives in one place (R19.2).
//
// maxDuration = 120: the authoritative design decision (design C.6, line 982)
// raises `/api/lovers` to 120 s because the lovers rite must summon + resurrect
// the file BEFORE it ever reaches PLAN, then run the two-step PLAN/GENERATE
// pipeline — a sum the old 50 s window could not hold. The Vercel Fluid Compute
// limit permits 120 s. The route-level Overall_Budget fires below this backstop,
// and the LoversRunner's own single-request deadline keeps PLAN/GENERATE inside
// the window. (Design C.5 prose still reads 50; the C.6 route-deadlines section
// supersedes it with the 120 decision, which the handler's budget arithmetic is
// built around.) If a deployment target caps `maxDuration` below 120, lower
// this value — the same deadline algorithm keeps the rite inside whatever window
// applies.
//
// _Requirements: R19.1, R19.2_

// Static import of parseJavascript so @vercel/nft traces tree-sitter-javascript
// WASM into this serverless function. The lovers binding calls parseJavascript
// at runtime (via validateLovers); without a static reference here the tracer
// cannot follow the dynamic require inside the oracle package (lovers-binding
// task 7.2 / 15.3).
import { parseJavascript as _parseJavascriptForTrace } from "@necro/oracle";
import { getLoversDeps } from "../../../server/composition.js";
import { methodNotAllowed } from "../../../server/handlers/guard.js";
import { handleLovers } from "../../../server/handlers/lovers.js";

/** The binding parses Python + JavaScript and loads WASM — Node.js runtime. */
export const runtime = "nodejs";

/** Never statically cached: every binding is streamed fresh. */
export const dynamic = "force-dynamic";

/**
 * Serverless backstop (design C.6 route deadlines): 120 s, above the route's
 * Overall_Budget and the LoversRunner's single-request deadline. The Fluid
 * Compute limit permits it; lower to 50 with the same deadline algorithm if a
 * target caps it.
 */
export const maxDuration = 120;

/** `POST /api/lovers` — resolve the memoised deps, then stream the binding. */
export const POST = (req: Request): Promise<Response> =>
  handleLovers(req, getLoversDeps());

// Every non-POST method shares the single 405 guard (405 + Allow: POST +
// no-store + VALIDATION_FAILED Error_Envelope; HEAD carries no body).
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
