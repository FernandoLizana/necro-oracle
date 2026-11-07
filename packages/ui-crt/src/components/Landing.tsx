// src/components/Landing.tsx
//
// Feature: oracle-landing-polish, task 9.1.
//
// The screen-only DMG Landing_State region (design §"Component: Landing"). It
// mounts inside the existing `<Terminal>` `Screen` as a sibling above the
// `OutputLog`, gated by the single pure predicate `landingVisible(state)`:
// `Landing` returns `null` whenever the landing is not visible, so it never
// coexists with a reading spread, the ritual, or a populated log.
//
// It owns a small local `SelectionState` (the cursor index into `LANDING_ROWS`)
// and composes the four screen-only pieces the design calls for — `HudBar`,
// `LegacyRepoList`, `PreviewWindow`, `HintBar` — in the strict 4-shade DMG
// palette (`landing.css`, imported here as a side effect).
//
// Keyboard: the landing attaches an `onKeyDown` handler on its OWN root
// container (NOT a window/document listener), so it only sees key presses while
// focus is inside the landing region. Every press is mapped by the pure
// `landingKeyAction` handler, which already returns `none` for any
// Alt/Ctrl/Meta-modified or unmapped key. On `none` the handler does nothing
// and does NOT call `preventDefault`/`stopPropagation`, so the key falls through
// untouched — crucially, because the handler lives on the landing root and not
// on `window`, a key typed into the `NECRO>` input (which is a sibling, outside
// this subtree) never reaches this handler at all. The command line, the
// command chips, and the `NECRO>` input therefore stay fully operable; focus is
// never trapped (R7.8, R7.9). The parent `<Terminal>` keeps all of them mounted
// (task 9.2).
//
// This is a screen only: no ports, no data fetching, no clock, no network.
//
// _Requirements: R1.1, R5.1, R5.2, R5.3, R7.8, R7.9_

"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

import "../landing/landing.css";

import type { SessionState } from "../session/state.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import type { Size } from "../arcana/integer-scale.js";
import type { MotionMode } from "../motion/motion-mode.js";
import { LANDING_ROWS } from "../landing/repos.js";
import type { EmptyReason } from "../landing/oracle-copy.js";
import {
  activate,
  move,
  selectedRow,
  type SelectionState,
} from "../landing/selection.js";
import { landingKeyAction } from "../landing/key-binding.js";
import {
  hudModel,
  landingVisible,
  previewModel,
} from "../landing/landing-model.js";
import { HudBar } from "./HudBar.js";
import { LegacyRepoList } from "./LegacyRepoList.js";
import { PreviewWindow } from "./PreviewWindow.js";
import { HintBar } from "./HintBar.js";

/** Props for the DMG Landing region (design §"Component: Landing"). */
export interface LandingProps {
  /** The full session state; `landingVisible` gates the whole region. */
  readonly state: SessionState;
  /** The trusted `id -> ArcanaAsset` map (preview Seer + card backs). */
  readonly manifest: ReadonlyMap<string, ArcanaAsset>;
  /** The effective motion mode, surfaced as the `data-motion` zone marker. */
  readonly motionMode: MotionMode;
  /** The Seer image URL, threaded down to the PREVIEW window's `SeerPortrait`. */
  readonly seerSrc?: string;
  /** The available preview area the Seer / card backs are scaled to fit. */
  readonly available?: Size;
  /** Run a command exactly as a typed submit would (reuses Terminal.submit). */
  readonly submit: (raw: string, source: "button") => void;
  /**
   * Summon a concrete repo and THEN read fates against it (R5.1). This is the
   * landing-only activation path: the host (`Terminal`) dispatches
   * `summon <ref>` and chains `read fates` only once that summon has RESOLVED,
   * working around the reducer's single-in-flight guard (a synchronous second
   * `submit("read fates")` would hit `inflight !== null` and be rejected). The
   * typed-command path is untouched — typing `summon x` then `read fates`
   * yourself still behaves exactly as before.
   */
  readonly onSummonAndRead: (ref: string) => void;
  /** Prefill `summon ` / focus the NECRO> input (reuses Terminal.prefillSummon). */
  readonly focusInput: () => void;
  /**
   * The source of the LEGACY REPOS rows. Defaults to the static authored
   * `LANDING_ROWS` (always non-empty). A host that fetched the list can pass
   * its own rows; when that list is empty, `listEmptyReason` distinguishes a
   * legitimate zero-repo result from a fetch failure (R19.5, R19.7).
   */
  readonly rows?: readonly (typeof LANDING_ROWS)[number][];
  /**
   * Why the row list is empty, surfaced to `LegacyRepoList` only when the list
   * has zero entries: `"none"` (default) shows the empty-state message, a
   * fetch-failure reason shows the matching in-world error state (R19.7).
   */
  readonly listEmptyReason?: EmptyReason;
}

/**
 * A sensible default preview area before `PreviewWindow` measures its own panel
 * box (oracle-landing-polish R26). Sized so the Seer (256×144) and the three
 * card backs (120×160) already scale up to substantially fill the preview even
 * before the ResizeObserver reports the real panel rect — large enough for an
 * integer scale > 1 on both the Seer and the 3-across card-back row.
 */
const DEFAULT_PREVIEW_AREA: Size = { w: 768, h: 432 };

/** The seer asset id in the manifest. */
const SEER_ID = "seer";

/**
 * The screen-only DMG Landing region. Returns `null` when the landing is not
 * visible; otherwise composes the HUD, the selectable LEGACY REPOS list, the
 * PREVIEW window, and the hint bar, and owns the keyboard/mouse selection.
 */
export function Landing({
  state,
  manifest,
  motionMode,
  seerSrc,
  available,
  submit,
  onSummonAndRead,
  focusInput,
  rows = LANDING_ROWS,
  listEmptyReason = "none",
}: LandingProps): React.JSX.Element | null {
  // The local cursor into the row list. The parent never owns this — the
  // landing is a self-contained menu — so it starts at the first row (index 0)
  // and moves only through `move()` (clamped, no wrap) or a mouse select.
  const [selection, setSelection] = useState<SelectionState>({ index: 0 });

  // Run the activation effect for a given row index: a concrete repo summons
  // then reads fates (the host chains the read after the summon RESOLVES —
  // R5.1); the ENTER row focuses the input (R5.2, R5.3). Pure
  // `activate(selectedRow(...))` decides which. The summon+read is NOT two raw
  // synchronous submits here: a second `submit("read fates")` fired in the same
  // tick would hit the reducer's single-in-flight guard (the summon just set
  // `inflight`) and be rejected, so the read would never run. Instead the
  // concrete-repo case delegates to `onSummonAndRead`, which the host dispatches
  // the summon for and then chains the read once the summon settles.
  const runActivation = useCallback(
    (index: number) => {
      // An empty list has no activatable row (defensive: the static table is
      // never empty, but a fetched list can be).
      if (rows.length === 0) return;
      const row = selectedRow({ index }, rows);
      const result = activate(row);
      if (result.kind === "summon-read") {
        onSummonAndRead(result.ref);
      } else {
        focusInput();
      }
    },
    [rows, onSummonAndRead, focusInput],
  );

  // A mouse click on a row selects it and then activates it (R5.3). Selecting
  // first keeps the local cursor in sync with the activated row.
  const onActivate = useCallback(
    (index: number) => {
      setSelection({ index });
      runActivation(index);
    },
    [runActivation],
  );

  // The landing-root keydown handler. It lives on the landing container (NOT a
  // window/document listener) so it only fires while focus is inside the
  // landing; a key typed into the sibling `NECRO>` input never reaches it. The
  // pure `landingKeyAction` already returns `none` for any Alt/Ctrl/Meta key
  // and any unmapped key; on `none` we do nothing and let the key fall through
  // (no preventDefault, no stopPropagation) so nothing is ever stolen (R7.8,
  // R7.9).
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const action = landingKeyAction({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });

      switch (action.kind) {
        case "move":
          event.preventDefault();
          setSelection((prev) => move(prev, action.dir, rows.length));
          return;
        case "activate":
          event.preventDefault();
          setSelection((prev) => {
            runActivation(prev.index);
            return prev;
          });
          return;
        case "demo":
          event.preventDefault();
          submit("demo", "button");
          return;
        case "help":
          event.preventDefault();
          submit("help", "button");
          return;
        case "none":
          // Not a landing binding: fall through to the NECRO> input untouched.
          return;
      }
    },
    [rows.length, runActivation, submit],
  );

  // The one predicate that gates the whole region. Evaluated AFTER the hooks so
  // the hook order stays stable across renders (R1.1).
  if (!landingVisible(state)) {
    return null;
  }

  // With an empty list there is no selected row; the PREVIEW falls back to the
  // first authored row's shape only to keep the model total. `LegacyRepoList`
  // renders the empty/error state instead of options in that case.
  const selected =
    rows.length === 0
      ? selectedRow(selection, LANDING_ROWS)
      : selectedRow(selection, rows);
  const preview = previewModel(state, selected, manifest);
  const seerAsset = manifest.get(SEER_ID);
  const previewArea = available ?? DEFAULT_PREVIEW_AREA;

  return (
    <div
      className="crt-landing"
      data-motion={motionMode}
      role="region"
      aria-label="Legacy repository landing"
      // The landing root is keyboard-focusable so a keyboard user can Tab into
      // the region and drive the selectable LEGACY REPOS list with the arrow
      // keys / A / B / H bindings. The root-level `onKeyDown` only fires while
      // focus is inside this subtree, so a key typed into the sibling `NECRO>`
      // input never reaches it; the region is NOT a modal and traps no focus —
      // a subsequent Tab leaves it for the command line and chips (R7.8, R7.9).
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <HudBar model={hudModel(state)} />
      <LegacyRepoList
        rows={rows}
        selectedIndex={selection.index}
        onSelect={(index) => setSelection({ index })}
        onActivate={onActivate}
        emptyReason={listEmptyReason}
      />
      <PreviewWindow
        model={preview}
        seerAsset={seerAsset}
        // `exactOptionalPropertyTypes` forbids forwarding an explicit
        // `undefined` to the optional `seerSrc`; spread it only when present so
        // `PreviewWindow` keeps its own committed-URL default otherwise.
        {...(seerSrc !== undefined ? { seerSrc } : {})}
        available={previewArea}
        motionMode={motionMode}
      />
      <HintBar />
    </div>
  );
}
