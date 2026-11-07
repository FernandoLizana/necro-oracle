// src/components/LegacyRepoList.tsx
//
// Feature: oracle-landing-polish, task 8.2.
//
// The screen-only DMG LEGACY REPOS list for the Landing_State (design
// §"Component: LegacyRepoList"). It renders a `role="listbox"` of
// `role="option"` rows — one per `LandingRow` — reflecting the current
// `selectedIndex` the parent `Landing` owns. The selected option carries
// `aria-selected="true"` and the inverted `.crt-landing-row` class (the
// `[aria-selected="true"]` rule in `landing.css` does the palette swap);
// non-selected options carry `aria-selected="false"`.
//
// The ▶ cursor on the selected row is purely decorative: it is marked
// `aria-hidden` and lives in the `.crt-landing-row-cursor` gutter, so a screen
// reader hears only the row's label, tag, and file count as plain text — the
// ▶ glyph never enters the accessible name (R20.3).
//
// Mouse: hovering or clicking a row selects it (`onSelect`); clicking also
// activates it (`onActivate`). Keyboard navigation itself is driven by the
// parent `Landing` keydown handler (task 9.1); this component only reflects
// `selectedIndex` and exposes the listbox/option semantics.
//
// This is a screen only: no ports, no data fetching, no clock.
//
// _Requirements: R4.5, R4.7, R4.8, R20.3_

import type { LandingRow } from "../landing/repos.js";
import { emptyListCopy, type EmptyReason } from "../landing/oracle-copy.js";

/** Props for the LEGACY REPOS list (design §"Component: LegacyRepoList"). */
export interface LegacyRepoListProps {
  /** The full selectable list: concrete repos followed by the ENTER row. */
  readonly rows: readonly LandingRow[];
  /** The 0-based index of the currently selected row. */
  readonly selectedIndex: number;
  /** Select a row (mouse hover / click). */
  readonly onSelect: (index: number) => void;
  /** Activate a row (click / Enter). */
  readonly onActivate: (index: number) => void;
  /**
   * Why the list is empty, used ONLY when `rows` is empty (R19.5, R19.7). A
   * legitimate zero-repo result (`"none"`, the default) shows the empty-state
   * message; a fetch-failure reason shows the matching in-world error state
   * instead. Ignored while `rows` has entries. Today `LANDING_ROWS` is a static
   * authored table, so this is a defensive/edge path.
   */
  readonly emptyReason?: EmptyReason;
}

/** The ▶ cursor marker glyph (decorative; aria-hidden). */
const CURSOR_GLYPH = "\u25B6"; // ▶

/** The middle-dot separator joining a repo's tag and file count (R27). */
const CAPTION_SEPARATOR = "\u00B7"; // ·

/**
 * Render one option's visible content. A repo row shows the label, tag, and
 * file count as plain text; the ENTER row shows its single label. The ▶ cursor
 * gutter is always present (fixed-width per `landing.css`) and carries the
 * glyph only on the selected row, kept out of the accessible name via
 * `aria-hidden`.
 */
function rowContent(row: LandingRow, selected: boolean): React.JSX.Element {
  const cursor = (
    <span className="crt-landing-row-cursor" aria-hidden="true">
      {selected ? CURSOR_GLYPH : ""}
    </span>
  );

  if (row.kind === "repo") {
    const { label, tag, files } = row.repo;
    // The tag and file count read as ONE caption joined by a middle-dot (U+00B7)
    // with a SINGLE SPACE ON BOTH SIDES, e.g. `DUNGEON · 4 FILES` (R27, R31).
    //
    // The whole `TAG · FILES` caption is rendered as ONE text run inside a
    // single (non-flex) span, so the surrounding spaces are never collapsed or
    // stripped: when the tag / separator / files sat in separate `inline-flex`
    // children, the flex layout trimmed the separator item's leading/trailing
    // whitespace, so the rendered text became `DUNGEON·4 FILES` instead of
    // `DUNGEON · 4 FILES`. Keeping the caption as a single inline text run
    // preserves both spaces (R31). The caption still carries the tag and file
    // count as plain text so the option's accessible name contains the label,
    // tag and file count (R20.3); it is NOT aria-hidden.
    return (
      <>
        {cursor}
        <span className="crt-landing-row-label">{label}</span>
        <span className="crt-landing-row-caption">
          {`${tag} ${CAPTION_SEPARATOR} ${files}`}
        </span>
      </>
    );
  }

  return (
    <>
      {cursor}
      <span className="crt-landing-row-label">{row.label}</span>
    </>
  );
}

/** The screen-only DMG LEGACY REPOS selectable list. */
export function LegacyRepoList({
  rows,
  selectedIndex,
  onSelect,
  onActivate,
  emptyReason = "none",
}: LegacyRepoListProps): React.JSX.Element {
  // Zero entries: render the in-world empty/error state instead of options
  // (R19.5, R19.7). The accessible list label stays on the listbox container
  // so assistive tech still announces the list; the two oracle-voice lines are
  // plain DOM text, and the technical line is the authoritative live-region
  // fact (R19.6). A legitimate zero-repo result shows the empty-state message;
  // a fetch-failure routes to the matching error copy.
  if (rows.length === 0) {
    const copy = emptyListCopy(emptyReason);
    const isError = emptyReason !== "none";
    // Zero entries carry no `option` children, so the container is a labelled
    // `group` rather than a `listbox` (an empty `listbox` with a non-option
    // child is an ARIA violation and would fail axe, R20.2). The accessible
    // list label stays on the container (R19.5, R19.7). The two oracle-voice
    // lines are plain DOM text; the whole message sits in ONE live region whose
    // text is dominated by the plain technical fact so screen readers get clear
    // text (R19.6). An error state is assertive (`alert`); a legitimate empty
    // list is polite (`status`).
    return (
      <div
        className="crt-landing-panel crt-landing-list crt-landing-list-empty"
        role="group"
        aria-label="Legacy repositories"
      >
        <p
          className={
            isError
              ? "crt-landing-empty crt-landing-empty-error"
              : "crt-landing-empty"
          }
          role={isError ? "alert" : "status"}
          aria-live={isError ? "assertive" : "polite"}
        >
          <span className="crt-landing-empty-mystical">{copy.mystical}</span>{" "}
          <span className="crt-landing-empty-technical">{copy.technical}</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="crt-landing-panel crt-landing-list"
      role="listbox"
      aria-label="Legacy repositories"
    >
      {rows.map((row, index) => {
        const selected = index === selectedIndex;
        return (
          <div
            key={index}
            role="option"
            aria-selected={selected ? "true" : "false"}
            className="crt-landing-row"
            // Clicking a row selects and activates it (R4.7, R4.8); hovering
            // selects it. Selection always precedes activation so the parent
            // sees the correct index for the summon/focus effect.
            onMouseEnter={() => onSelect(index)}
            onClick={() => {
              onSelect(index);
              onActivate(index);
            }}
          >
            {rowContent(row, selected)}
          </div>
        );
      })}
    </div>
  );
}
