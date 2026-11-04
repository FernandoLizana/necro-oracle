// apps/web/src/server/handlers/external-skip.ts
//
// The pure External_Sub_Budget skip decision (design.md D15
// "External_Sub_Budget").
//
// The external-enrichment phase (OSV, PyPI, npm lookups) has its own small time
// budget. If it overruns that budget, or the caller explicitly asked to skip
// it, the reading proceeds on the snapshot alone and the oracle says so. This
// module holds only the pure DECISION and its Oracle_Voice note: the route
// (task 26) is responsible for actually omitting `registryData` / `osvData` and
// fabricating nothing (R6.22).
//
// _Requirements: R6.20, R6.21, R6.22_

import { EXTERNAL_SKIP_NOTE } from "@necro/ui-crt";

/** The external-enrichment sub-budget in milliseconds (design.md D15). */
export const EXTERNAL_SUB_BUDGET_MS = 10_000;

/**
 * Decide whether to skip external enrichment. Pure and total: the same input
 * always yields the same `{ skip, note }` and nothing else.
 *   - `skip` is true iff `elapsedMs > EXTERNAL_SUB_BUDGET_MS` (strict: exactly
 *     the budget does not skip) OR the explicit `skipped` flag is set;
 *   - when skipping, `note` is the non-empty two-layer Oracle_Voice skip line
 *     (R6.21); otherwise `note` is the empty string.
 * The returned object carries ONLY `{ skip, note }` — never any fabricated
 * registry or OSV data (R6.22).
 */
export function decideExternalSkip(input: {
  elapsedMs: number;
  skipped: boolean;
}): { skip: boolean; note: string } {
  const skip = input.elapsedMs > EXTERNAL_SUB_BUDGET_MS || input.skipped === true;
  return { skip, note: skip ? EXTERNAL_SKIP_NOTE : "" };
}
