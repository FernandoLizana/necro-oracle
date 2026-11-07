// @necro/llm — pure Model_Router signal extraction (R3.1, R3.6, R35.4).
//
// `signals.ts` derives the measurable inputs the pure `routeModel` decision
// rule (see `model-router.ts`) consumes: a token estimate, a count of
// unresolved diagnostics, and the four `DifficultyFlags`. Every derivation here
// is pure substring/shape inspection of a minimal context string — the enclosing
// unit plus its referenced signatures/imports, never the whole repository and
// never executed. There is NO model call, NO network, NO clock, and NO I/O, so
// the router stays a pure, testable function of its signals (R3.6, R35.4).
//
// The heuristics are intentionally simple and conservative: each difficulty
// flag is a cheap, documented substring/marker test over Python-2/3 source.
// They inform tier selection only — they never decide whether a card is drawn
// or whether an edit is accepted (that stays with the deterministic gates). A
// false positive costs at most an escalation to the STRONG tier; it can never
// weaken a gate.
//
// `RouterSignals`, `DifficultyFlags`, and `ModelTier` are OWNED by `@necro/llm`
// and re-exported through the barrel; `@necro/coven` references them
// structurally through its injected `ModelRouterPort`, so this package never
// imports `@necro/coven` (preserves `oracle <- grimoires <- coven <- web`).

/**
 * Measurable construct-difficulty signals derived by pure inspection of the
 * minimal context. Each flag, when set, pushes the router toward the STRONG
 * tier (see `routeModel`). Structurally matches the coven-owned shape from
 * task 1.1.
 */
export interface DifficultyFlags {
  /** A metaclass is involved (`metaclass=` kwarg, or a `class X(type)` base). */
  readonly metaclass: boolean;
  /** Unicode/bytes handling is involved (`b''`/`u''` literals, bytes/encode/decode). */
  readonly unicodeBytes: boolean;
  /** A dynamic import is involved (`__import__(` or `importlib`). */
  readonly dynamicImport: boolean;
  /**
   * Part C only: a cross-language (Python->JS) type mapping is in play. This is
   * a CALLER-supplied flag, not derived from source text — the Lovers PLAN path
   * sets it so it informs PLAN difficulty, while GENERATE is routed by function
   * count/token estimate instead (see `routeGenerate`).
   */
  readonly crossLangTypeMapping: boolean;
}

/**
 * The pure input to the Model_Router: an estimated token count of the minimal
 * context, the count of unresolved diagnostics/residuals in the unit, and the
 * derived difficulty flags. Structurally matches the coven-owned shape from
 * task 1.1.
 */
export interface RouterSignals {
  /** Estimated tokens of the minimal context. */
  readonly tokenEstimate: number;
  /** Count of residuals/diagnostics still unresolved in the unit. */
  readonly unresolvedDiagnostics: number;
  /** Measurable construct-difficulty signals. */
  readonly difficulty: DifficultyFlags;
}

/**
 * Detect a Python metaclass. Two cheap, well-known markers:
 *   - the Python 3 `metaclass=` class keyword argument, and
 *   - a Python 2 metaclass base `class Foo(type):` (a class whose base is the
 *     built-in `type`, i.e. the class is itself a metaclass).
 * Conservative: matches the literal markers only, never executes the source.
 */
function hasMetaclass(src: string): boolean {
  if (src.includes("metaclass=")) return true;
  // `class <Name>(... type ...)`: a `type` base in the base-class list.
  return /\bclass\s+\w+\s*\([^)]*\btype\b[^)]*\)/.test(src);
}

/**
 * Detect Unicode/bytes handling. Markers:
 *   - `b'...'` / `b"..."` bytes literals and `u'...'` / `u"..."` unicode literals
 *     (including raw/byte combos like `rb'...'`), and
 *   - the `bytes(`, `.encode(`, `.decode(`, and `unicode(` calls that mark the
 *     Python 2/3 str/bytes boundary the migration cares about.
 */
function hasUnicodeBytes(src: string): boolean {
  // Prefixed string literals: an optional r/R combined with b/B or u/U before a quote.
  if (/\b(?:[rR][bB]|[bB][rR]|[bBuU])["']/.test(src)) return true;
  if (/\bbytes\s*\(/.test(src)) return true;
  if (/\bunicode\s*\(/.test(src)) return true;
  if (/\.encode\s*\(/.test(src)) return true;
  if (/\.decode\s*\(/.test(src)) return true;
  return false;
}

/**
 * Detect a dynamic import. Markers: the `__import__(` builtin and any reference
 * to the `importlib` module (`import importlib`, `importlib.import_module(`).
 */
function hasDynamicImport(src: string): boolean {
  if (src.includes("__import__(")) return true;
  if (/\bimportlib\b/.test(src)) return true;
  return false;
}

/**
 * Derive the three source-detectable {@link DifficultyFlags} from a minimal
 * context string by pure substring/shape inspection. The fourth flag,
 * `crossLangTypeMapping`, is caller-supplied (the Lovers PLAN path), so it is
 * passed in rather than inferred from text; it defaults to `false`.
 *
 * Pure: no model call, no network, no clock, no I/O.
 */
export function extractDifficultyFlags(
  context: string,
  crossLangTypeMapping = false,
): DifficultyFlags {
  return {
    metaclass: hasMetaclass(context),
    unicodeBytes: hasUnicodeBytes(context),
    dynamicImport: hasDynamicImport(context),
    crossLangTypeMapping,
  };
}
