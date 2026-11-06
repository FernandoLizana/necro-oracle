// @necro/grimoires-py2to3 — deterministic Pre_Pass fixers (barrel).
//
// The six pure fixers (`print_statement`, `except_comma`, `dict_iter`,
// `unicode_str`, `long_literal`, `ne_operator`) each is a pure
// `(source: string, ctx: FixerContext) => FixResult` that parses once via the
// injected `parsePython`, collects spans in document order, applies
// non-overlapping edits right-to-left, never alters string-literal or comment
// contents, and records unconverted constructs as `ResidualEntry`s. On a
// tree-sitter parse failure a fixer leaves content unchanged and records a
// single `parse_failed` residual (R3.7). They import NO adapters (dependency
// direction: oracle <- grimoires <- coven; adapters are injected through
// ports).

import type { Fixer } from "@necro/coven";

import { printStatementFixer } from "./print-statement.js";
import { exceptCommaFixer } from "./except-comma.js";
import { dictIterFixer } from "./dict-iter.js";
import { unicodeStrFixer } from "./unicode-str.js";
import { longLiteralFixer } from "./long-literal.js";
import { neOperatorFixer } from "./ne-operator.js";

export { printStatementFixer } from "./print-statement.js";
export { exceptCommaFixer } from "./except-comma.js";
export { dictIterFixer } from "./dict-iter.js";
export { unicodeStrFixer } from "./unicode-str.js";
export { longLiteralFixer } from "./long-literal.js";
export { neOperatorFixer } from "./ne-operator.js";

/**
 * The Pre_Pass fixers in fixed application order (matching the design's
 * "Pre_Pass transforms" table). Order is significant: the runner applies them
 * left-to-right, each operating on the previous fixer's output. Each fixer
 * targets a disjoint node kind, so the ordering is stable and the composition
 * stays idempotent and deterministic (R3.4, R3.6).
 */
export const FIXERS: readonly Fixer[] = [
  printStatementFixer,
  exceptCommaFixer,
  dictIterFixer,
  unicodeStrFixer,
  longLiteralFixer,
  neOperatorFixer,
];
