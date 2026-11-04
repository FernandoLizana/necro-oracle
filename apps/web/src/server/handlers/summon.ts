// apps/web/src/server/handlers/summon.ts
//
// Feature: 03-crt-terminal, task 25.2.
//
// The Summon_Route handler `handleSummon` (design.md §"Handler pipeline" steps
// 1-7; R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8, R12.11,
// R13.1, R14.7). It drives one summon through the shared guard pipeline, maps
// a validated `SummonResult` to the public `SummonSummary`, redacts the
// GitHub token out of the outgoing body, validates it against the wire schema,
// and returns a `200 application/json` response.
//
// The handler NEVER touches `deps.fetch` or `deps.runReading`, and NEVER reads
// the snapshot's runtime file `contents` — only public metadata reaches the
// response (R12.11). The token (and any request `Authorization` value) appears
// nowhere in the output: the body is run through `redactDeep` and request
// headers are never echoed (R12.6, R14.7).
//
// Pipeline order (both handlers share steps 1-3):
//   1. method guard: non-POST -> 405 + Allow: POST
//   2. checkLimit BEFORE any GitHub work -> 429 on denial (R13.1)
//   3. readJsonBody -> 400/413 on a body-guard failure
//   4. SummonRequestSchema.parse (strict) -> 400 VALIDATION_FAILED
//   5. parseRepoRef(body.repo) -> github.summon(parsed) -> toSummonSummary
//   6. redactDeep(summary, token) -> SummonSummarySchema.parse -> 200 JSON
//   7. any throw in steps 5-6 -> mapError(err, token) -> Error_Envelope
//
// _Requirements: R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8, R12.11, R13.1, R14.7_

import { parseRepoRef, type SummonResult } from "@necro/github";
import type { SummonSummary } from "@necro/ui-crt";

import { SummonRequestSchema, SummonSummarySchema } from "../../protocol/schemas.js";
import type { RouteDeps } from "../deps.js";
import { mapError } from "../error-map.js";
import { redactDeep } from "../redact.js";
import {
  checkLimit,
  envelopeResponse,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "./guard.js";

/** The fixed Oracle-voice message for a request body that fails the schema. */
const INVALID_REQUEST_MESSAGE =
  "The offering is malformed.\nName a single public repository to summon.";

/**
 * Map a validated `SummonResult` to the public `SummonSummary`. Only public
 * metadata crosses the boundary: the repo `ref`, the `extras` scalars, the
 * cache verdict, the FILE COUNT (never the file list) and the truncation flag.
 * The snapshot's runtime `contents` Map and the `files` array themselves are
 * never copied (R12.11). `demo` is a client-only marker and is never set here.
 *
 * `ref.defaultBranch` is taken from `extras.defaultBranch` (the summon's
 * authoritative view of the branch), not the snapshot's pinned ref, so a
 * freshly resolved default branch is reflected in the summary.
 */
export function toSummonSummary(result: SummonResult): SummonSummary {
  const { snapshot, extras, cache } = result;
  return {
    ref: {
      owner: snapshot.ref.owner,
      name: snapshot.ref.name,
      sha: snapshot.ref.sha,
      defaultBranch: extras.defaultBranch,
    },
    stars: extras.stars,
    hasWorkflowsDir: extras.hasWorkflowsDir,
    degradedFields: [...extras.degradedFields],
    cache,
    fileCount: snapshot.files.length,
    truncated: snapshot.truncated,
  };
}

/**
 * Handle one `POST /api/summon`. Returns a `200` with a schema-valid,
 * token-redacted `SummonSummary` on success, or a mapped Error_Envelope with
 * the appropriate status on any failure. Every response carries `no-store` and
 * `nosniff`; `405` also carries `Allow: POST`, `429` carries `Retry-After`.
 */
export async function handleSummon(req: Request, deps: RouteDeps): Promise<Response> {
  // 1. Method guard (R12.2) — before any limiter spend or GitHub work.
  if (req.method !== "POST") {
    return methodNotAllowed(req);
  }

  // 2. Rate limit BEFORE any GitHub request (R13.1).
  const limited = await checkLimit(req, deps, "summon");
  if (limited !== null) return limited;

  // 3. Body guards: content-type, size, JSON (R12.1, R12.3).
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  // 4. Strict wire-schema validation (R12.3).
  const parsedBody = SummonRequestSchema.safeParse(body.value);
  if (!parsedBody.success) {
    return errorResponse(400, "VALIDATION_FAILED", INVALID_REQUEST_MESSAGE);
  }

  const token = deps.env.get("GITHUB_TOKEN");
  try {
    // 5. Summon: parse the ref, fetch the snapshot, map to the public summary.
    const parsedRef = parseRepoRef(parsedBody.data.repo);
    const result = await deps.github.summon(parsedRef);
    const summary = toSummonSummary(result);

    // 6. Redact the token out of every string leaf, then re-validate the
    //    redacted body against the SAME wire schema before it leaves (R12.6,
    //    R14.7). A redaction that broke the shape would surface here.
    const redacted = redactDeep(summary, token);
    const safe = SummonSummarySchema.parse(redacted);
    return jsonResponse(safe);
  } catch (err) {
    // 7. Any throw (parseRepoRef SummonerError, gateway NecroError, validation,
    //    or an unexpected fault) -> safe Error_Envelope (R5.10).
    const mapped = mapError(err, token);
    return envelopeResponse(mapped.status, mapped.body, mapped.headers);
  }
}
