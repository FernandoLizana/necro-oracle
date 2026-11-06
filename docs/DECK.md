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

## ASCII card faces

The Visual_Layer draws each card as a framed ASCII tarot face rendered as
selectable DOM text (never canvas). The faces are produced by two pure modules
in `@necro/ui-crt`:

- `render/ascii-card.ts` — the ASCII_Card_Renderer. `asciiCard(cardId,
  orientation, art)` returns a card of exactly `CARD_ROWS` (13) × `CARD_COLS`
  (24) box-drawing glyphs for every card in both orientations, so all twelve
  share one frame size. Top to bottom the frame is: top border, the roman
  numeral row, the uppercase card-name row, a thin divider, `ART_ROWS` (6)
  illustration rows, a thin divider, a footer spacer, and the bottom border.
  Numerals, names and verdict words are uppercase; no emoji is ever emitted. The
  numeral and name come from `getCard(cardId)` in `@necro/oracle/client`; an id
  outside the Deck_Card_Set raises a typed `NecroError` (`code: "CARD_UNKNOWN"`,
  Oracle_Voice message) rather than a partial or blank card. Each card carries an
  `accessibleText` equivalent (e.g. `XVI THE TOWER, upright`). The renderer emits
  the frame in normal reading order; the visual 180° flip for `reversed` cards is
  applied in CSS by `AsciiCardView`, with the numeral/name text kept upright, so
  orientation stays semantic (upright = active, reversed = latent/partial).
- `render/ascii-art.ts` — the bespoke per-CardId illustration table (`CARD_ART`,
  a total `Record<CardId, CardArt>` so a newly registered card without art is a
  compile error). Each of the twelve registered cards (`tower`, `death`,
  `devil`, `hermit`, `wheel`, `judgement`, `hanged_man`, `temperance`,
  `justice`, `moon`, `star`, `world`) has a hand-authored phosphor motif sized to
  the 6×22 inner block — e.g. The Tower is a lightning-struck tower, The Death a
  reaper, The Devil a horned sigil. Cards whose reversal reads differently (the
  Hanged Man, the Tower, the Wheel, the Star, the Moon) carry a distinct
  `reversed` motif; the rest reuse the CSS 180° flip. Any CardId without a
  bespoke entry falls back to `GENERIC_ART`. This table ships in its own lazy
  chunk fetched by `loadCardArt()` (in `render/load-card-art.ts`) after mount, so
  it stays outside the first terminal render and inside the bundle budget — the
  loader owns the only dynamic `import("./ascii-art.js")`, which is what makes
  the bundler split the table into a separate chunk.

The faces are decorative overlays only. The authoritative card text — numeral,
name, orientation, severity, evidence and diagnosis — stays in the terminal's
single `role="log"` region exactly as `renderReading` produces it, so a screen
reader hears each card once and the ASCII face adds nothing it must announce.

### The card-back

`asciiCardBack()` builds the single shared Card_Back frame: the same
`CARD_COLS × CARD_ROWS` box with its inner block filled by one repeating sigil
glyph, identical at every face-down position. Every spread position starts as
this shared back and flips to its `AsciiCard` when its reveal step fires.

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
