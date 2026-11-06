// @necro/coven — Language_Pair_Registry (design: "Language_Pair_Registry").
//
// A pure, in-memory map from a `LanguagePairId` (e.g. "python2->python3") to the
// `Grimoire` that resurrects that pair. The registry is the single lookup point
// the Coven_Runner consults at SELECT time, BEFORE any sandbox or LLM work is
// touched: an unknown pair fails fast here (R15.2) so no micro-VM is spun up and
// no model is called for a pair we cannot migrate.
//
// The registry is adapter-free and side-effect-free apart from mutating its own
// backing map. It imports no ports and no grimoire package, so the enforced
// dependency direction (oracle <- grimoires <- coven) is preserved: concrete
// grimoires are registered INTO it by the runner at construction (R15.4, R15.5),
// not imported by it.
//
// Guarantees (R15.1-R15.3):
//   - resolve(id) returns the exact grimoire registered for `id`.
//   - resolve(unknown) throws NecroError("PAIR_UNKNOWN", ...) before any work.
//   - register(duplicate) throws NecroError("PAIR_DUPLICATE", ...) and leaves
//     the existing binding untouched.
//   - has(id) reports presence without throwing.

import { covenError, type LanguagePairId } from "./models.js";
import type { Grimoire } from "./ports.js";

/**
 * A guarded, in-memory binding of language-pair ids to grimoires.
 *
 * Construct one per runner. Registration happens once at runner construction
 * (see `createDefaultRegistry` as the documented registration point); the
 * runner then only ever calls `resolve`/`has`.
 */
export class LanguagePairRegistry {
  // Keyed by the raw pair-id string so lookups are a plain Map hit. The map is
  // private: the only way in is `register`, the only ways out are `resolve`/`has`.
  readonly #bindings = new Map<LanguagePairId, Grimoire>();

  /**
   * Bind `grimoire` to `id`. Throws `NecroError("PAIR_DUPLICATE", ...)` if `id`
   * is already bound, leaving the FIRST binding intact (R15.3) — a second
   * registration never silently overwrites the first.
   */
  register(id: LanguagePairId, grimoire: Grimoire): void {
    if (this.#bindings.has(id)) {
      throw covenError(
        "PAIR_DUPLICATE",
        // oracle-voice: one mystical line, then the actionable technical fact.
        "Two rites claim the same crossing; the circle will not hold.\n" +
          `A grimoire is already bound to "${id}"; register each pair once.`,
      );
    }
    this.#bindings.set(id, grimoire);
  }

  /**
   * Return the grimoire bound to `id`. Throws
   * `NecroError("PAIR_UNKNOWN", ...)` for an unregistered id (R15.2). Callers
   * resolve at SELECT time so this fails fast, before any sandbox or LLM work.
   */
  resolve(id: LanguagePairId): Grimoire {
    const grimoire = this.#bindings.get(id);
    if (grimoire === undefined) {
      throw covenError(
        "PAIR_UNKNOWN",
        // oracle-voice: one mystical line, then the actionable technical fact.
        "No rite is written for this crossing; the dead stay dead.\n" +
          `No grimoire is registered for "${id}"; choose a known pair.`,
      );
    }
    return grimoire;
  }

  /** Report whether a grimoire is bound to `id`, without throwing. */
  has(id: LanguagePairId): boolean {
    return this.#bindings.has(id);
  }
}

/** The one language-pair the engine ships today (R15.4, R15.5). */
export const PYTHON2_TO_PYTHON3: LanguagePairId = "python2->python3";

/**
 * Build the registry the local runner uses at construction and register the
 * shipped grimoires into it (R15.4, R15.5).
 *
 * This is the documented registration point. The `python2->python3` grimoire
 * (`@necro/grimoires-py2to3`, task 4.x) does not exist yet, so the runner passes
 * it in here rather than this module importing it — keeping the registry free of
 * any grimoire-package dependency and honouring `oracle <- grimoires <- coven`.
 * Once the grimoire lands, the runner calls:
 *
 *   const registry = createDefaultRegistry({ py2to3: py2to3Grimoire });
 *
 * Omitting a grimoire simply leaves its pair unregistered; `resolve` for that
 * pair then fails with `PAIR_UNKNOWN` as designed.
 */
export function createDefaultRegistry(
  grimoires: { readonly py2to3?: Grimoire } = {},
): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  if (grimoires.py2to3 !== undefined) {
    registry.register(PYTHON2_TO_PYTHON3, grimoires.py2to3);
  }
  return registry;
}
