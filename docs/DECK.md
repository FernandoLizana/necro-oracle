# The Deck

> *"Shuffle the deck. Name the repository. The dead will speak."*

Every card is a real, evidence-backed diagnosis. A draw comes from a deterministic
detector with evidence — the LLM only interprets and narrates, it never decides
whether a card is drawn (product principle: *the cards cannot lie*). Orientation
is semantic: **upright = active/confirmed**, **reversed = latent/partial/mitigated**.

This file is the single source of truth for which card each detector draws and,
where a resurrection exists, which **grimoire** that card unlocks (the card ↔
grimoire link). The full deck narrative — card art, spreads, orientation table —
lives in `docs/DESIGN.md` §3; this file tracks the implemented detectors and
their grimoire links. Update it whenever a card, detector, or grimoire changes.

## Cards and detectors

Each detector is a pure module in `packages/oracle/src/detectors/<card>.ts`.

| Card | Id | Diagnosis | Grimoire (resurrection) |
| --- | --- | --- | --- |
| XX Judgement | `judgement` | A dead runtime calls for resurrection (Python 2 syntax: `print` statements, `except X, e:`, `<>`, long literals, legacy packaging) | **py2to3** — see below |
| XVI The Tower | `tower` | Rotting or broken dependencies (majors behind, yanked, unpinned, Py2-only classifiers) | — |
| XV The Devil | `devil` | Security sins (masked secret patterns, dangerous calls, known OSV vulns) — report only, never auto-fixed | — |
| XIII Death | `death` | Dead code (unreachable, unreferenced, commented-out corpses) | — |
| X Wheel of Fortune | `wheel` | Missing or rusted tests — fate alone decides | — |
| IX The Hermit | `hermit` | Missing or stale documentation; no guiding lantern | — |
| XII The Hanged Man | `hanged_man` | Abandonment — suspended, waiting, barely breathing | — |
| XIV Temperance | `temperance` | No vessel tempers the code (missing or broken CI/linting/formatting) | — |
| XI Justice | `justice` | No law governs the code (licence / governance gaps) | — |
| XVIII The Moon | `moon` | A labyrinth under a pale moon — tangled complexity | — |
| XVII The Star | `star` | A star still shines — the strengths that remain (always present) | — |
| XXI The World | `world` | The circle closes — overall completeness/health | — |

The Star is always drawn so a reading is never purely bleak; The World and the
vitality score summarise the whole. Orientation per card is defined in
`docs/DESIGN.md` §3A.

## Card ↔ grimoire links

A grimoire is a migration plugin unlocked by the card whose diagnosis it heals. A
grimoire is registered into the `LanguagePairRegistry` in `@necro/coven`; adding a
new pair never requires an engine-core source change (see
`docs/ARCHITECTURE.md` → "The Resurrection Engine").

### JUDGEMENT → `py2to3`

> JUDGEMENT: *"A dead runtime hears the trumpet."*

The **Judgement** card (detector `packages/oracle/src/detectors/judgement.ts`)
draws when a repository carries Python 2 syntax that fails under Python 3. It
unlocks the **py2to3** grimoire (`@necro/grimoires-py2to3`, pair
`python2->python3`), the first resurrection in the deck.

- **Evidence → candidates.** The Judgement draw's static evidence names the `.py`
  files and lines carrying Python 2 constructs; the Resurrection Engine's SELECT
  phase derives its candidate files directly from that evidence.
- **Deterministic Pre_Pass fixers:** `print_statement` (`print x` → `print(x)`),
  `except_comma` (`except E, e:` → `except E as e:`), `dict_iter`
  (`.iteritems()/.iterkeys()/.itervalues()` → `.items()/.keys()/.values()`),
  `unicode_str` (`unicode(x)` → `str(x)`, `u"…"` normalized), `long_literal`
  (`10L` → `10`), `ne_operator` (`a <> b` → `a != b`). Each fixer preserves
  string-literal and comment contents and is idempotent.
- **LLM_Pass:** residual constructs the mechanical pass cannot convert are sent,
  masked and wrapped in untrusted-data delimiters, through the injected `LlmPort`;
  skipped entirely in Degraded_Mode (no key).
- **Validation:** the tree-sitter `Target_Parser` (and an optional E2B parse-only
  check) must accept the produced file with zero error nodes; unparseable output
  is reported as a residual, never presented as converted.
- **Re-diagnosis:** the validated conversion is re-read with the same spread, and
  a healed Judgement draw lifts the vitality score. Reversed Judgement (code that
  already straddles 2/3 via `six`/`__future__`) is a lighter resurrection.

No pull request is opened in this feature; the grimoire delivers a per-file diff
and a downloadable unified-diff patch.

## Divergence allowlist

Every intended behaviour change a grimoire makes must be declared in its
`divergenceAllowlist` (id, description, minimal example). The shipped `py2to3`
Pre_Pass fixers are behaviour-preserving, so its allowlist is empty; any future
behaviour-changing transform must be listed there or it fails gate G4.
