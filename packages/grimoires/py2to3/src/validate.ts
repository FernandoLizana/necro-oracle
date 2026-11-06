// @necro/grimoires-py2to3 — Target_Parser validity check (placeholder shell).
//
// `validate(after)` proves the produced content is acceptable Python 3 by
// parsing it with the injected `parsePython` and counting error nodes (zero
// error nodes => valid). It NEVER executes repository code — it only parses.
//
// This is the TASK 4.1 placeholder satisfying the `Grimoire.validate` contract
// shape. The real tree-sitter error-node count lands in task 5.2; until then it
// conservatively reports "not yet validated" (valid: false) so nothing is
// mistaken for confirmed Python 3 before the real check exists.

import type { ValidationResult } from "@necro/coven";

/**
 * Placeholder Target_Parser check. Task 5.2 replaces this with a real
 * `parsePython(after)` error-node count; the signature is fixed now so the
 * grimoire shell typechecks and the runner can call it.
 */
export function validate(_after: string): ValidationResult {
  return { valid: false, errorNodeCount: 0 };
}
