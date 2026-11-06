// @necro/grimoires-py2to3 — deterministic Pre_Pass fixers (barrel).
//
// The six pure fixers (`print_statement`, `except_comma`, `dict_iter`,
// `unicode_str`, `long_literal`, `ne_operator`) land in task 4.2. Each is a pure
// `(source: string, ctx: FixerContext) => FixResult` that parses once via the
// injected `parsePython`, applies non-overlapping edits right-to-left, never
// alters string-literal or comment contents, and records unconverted constructs
// as `ResidualEntry`s. They import NO adapters (dependency direction:
// oracle <- grimoires <- coven; adapters are injected through ports).
//
// Until then the Pre_Pass is empty: the grimoire ships `fixers: []` (task 4.1).

import type { Fixer } from "@necro/coven";

/**
 * The Pre_Pass fixers in fixed application order (task 4.2 wires the six
 * deterministic transforms here). Order is significant: the runner applies
 * them left-to-right, each operating on the previous fixer's output.
 */
export const FIXERS: readonly Fixer[] = [];
