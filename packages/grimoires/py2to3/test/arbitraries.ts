// @necro/grimoires-py2to3 — reusable fast-check arbitraries for the Pre_Pass.
//
// `arbPy2Program` is a GRAMMAR-BASED generator of small, syntactically shaped
// Python 2 programs (testing steering: "grammar-based generator of small py2
// programs"). It is shared by the fixer property tests (idempotence task 4.3,
// determinism task 4.4): instead of random character soup, it assembles whole
// programs from a vocabulary of line templates, each of which is either a py2
// construct one of the six Pre_Pass fixers targets, a construct deliberately
// left unconverted (a chevron `print >> …`), or a neutral py3 line that no
// fixer should touch. This keeps generated inputs in the interesting part of
// the input space while still exercising ordering, repetition and mixing.
//
// The arbitrary is pure data generation only — it performs NO parse, no fixer
// application, no network, LLM, or sandbox work (testing steering). Consumers
// parse the generated source with the injected `parsePython` inside the test.
//
// Generated programs are intentionally SMALL (a handful of top-level lines) so
// a 1000-run property suite stays fast, and every line is a standalone
// top-level statement (no indentation coupling between lines) so any subset or
// ordering is still valid Python to the degree tree-sitter needs.

import fc from "fast-check";

/**
 * A short, safe identifier (lowercase letters, length 1..4). Kept to letters so
 * generated names never collide with keywords in a way that changes which
 * construct a line represents.
 */
const arbIdent: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
    minLength: 1,
    maxLength: 4,
  })
  .filter((s) => s.length >= 1);

/** A small non-negative integer rendered as a decimal literal string. */
const arbIntText: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9999 })
  .map((n) => String(n));

/**
 * A short double-quoted string literal whose CONTENT is plain letters/spaces.
 * The content deliberately avoids quotes, backslashes and the tokens the
 * fixers look for (e.g. `<>`, `L` suffixes) so that the only occurrences of
 * those tokens in a program come from real code lines, not from inside a
 * literal. This lets the preservation intent of the fixers be exercised
 * without constructing adversarial escape sequences.
 */
const arbStringText: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")), {
    minLength: 0,
    maxLength: 8,
  })
  .map((s) => `"${s}"`);

/**
 * One top-level Python line. Each entry is a self-contained statement so lines
 * compose in any order. The templates cover:
 *   - the six py2 constructs the Pre_Pass fixers rewrite,
 *   - a chevron `print >> …` the print fixer deliberately leaves unconverted,
 *   - neutral py3 lines no fixer should touch (incl. a `u`-free string literal
 *     and an already-py3 `print(...)` / `.items()`), so idempotence and
 *     determinism are tested across both changing and unchanging content.
 */
const arbLine: fc.Arbitrary<string> = fc.oneof(
  // print_statement: `print "x", y`
  fc.tuple(arbStringText, arbIdent).map(([s, name]) => `print ${s}, ${name}`),
  // print_statement single operand: `print x`
  arbIdent.map((name) => `print ${name}`),
  // except_comma: a minimal try/except on one logical construct, rendered as a
  // compound statement using explicit newlines (still a single "line" entry).
  arbIdent.map((name) => `try:\n    pass\nexcept Exception, ${name}:\n    pass`),
  // dict_iter: `d.iteritems()` / iterkeys / itervalues
  fc
    .tuple(arbIdent, fc.constantFrom("iteritems", "iterkeys", "itervalues"))
    .map(([d, method]) => `${d}.${method}()`),
  // unicode_str call: `unicode(x)`
  arbIdent.map((name) => `unicode(${name})`),
  // unicode_str prefix: `u"text"`
  arbStringText.map((s) => `u${s}`),
  // long_literal: `0L`, `42L`
  arbIntText.map((n) => `${n}L`),
  // ne_operator: `a <> b`
  fc.tuple(arbIdent, arbIdent).map(([a, b]) => `${a} <> ${b}`),
  // unconverted chevron print (recorded as a residual, never rewritten)
  fc
    .tuple(arbIdent, arbIdent)
    .map(([stream, name]) => `print >> ${stream}, ${name}`),
  // neutral py3 line: a plain assignment that no fixer targets
  fc.tuple(arbIdent, arbIntText).map(([name, n]) => `${name} = ${n}`),
  // neutral py3 line: already-modern print call
  arbIdent.map((name) => `print(${name})`),
  // neutral py3 line: already-modern dict method
  arbIdent.map((d) => `${d}.items()`),
  // neutral py3 line: a bare quote string literal (no redundant prefix)
  arbStringText,
);

/**
 * `arbPy2Program` — a grammar-based generator of small Python 2 programs.
 *
 * A program is 0..8 top-level lines joined by newlines. Each line is drawn from
 * {@link arbLine}, so a program mixes py2 constructs the Pre_Pass fixers
 * rewrite, unconverted constructs, and neutral py3 lines in any order and with
 * repetition. The empty program (zero lines) is included to cover the trivial
 * input. Programs are returned as plain source strings; the test parses them
 * with the injected `parsePython`.
 */
export const arbPy2Program: fc.Arbitrary<string> = fc
  .array(arbLine, { minLength: 0, maxLength: 8 })
  .map((lines) => lines.join("\n"));
