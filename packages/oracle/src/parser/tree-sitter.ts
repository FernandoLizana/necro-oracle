// @necro/oracle — tree-sitter Python parser.
//
// PLACEHOLDER (task 10). The full implementation is task 11.2, which will provide:
//   - initParser(): lazy, idempotent WASM singleton that loads the on-disk
//     tree-sitter-python grammar (no network); resets its promise on failure
//     and rejects with NecroError(PARSER_INIT_FAILED).
//   - parsePython / queryPython / hasLegacyPythonNodes.
//
// This stub exists only so the Vitest WASM setup file (vitest.setup.ts) can
// import `initParser` and the package continues to typecheck before task 11.
// It performs NO side effects at import time and makes NO network calls.

let initPromise: Promise<void> | null = null;

/**
 * Initialize the parser. Idempotent: the second and later calls return the
 * same resolved promise immediately.
 *
 * Placeholder behaviour: resolves without loading WASM. Task 11.2 replaces the
 * body with the real on-disk grammar load (file:// URL, no network).
 */
export function initParser(): Promise<void> {
  initPromise ??= Promise.resolve();
  return initPromise;
}
