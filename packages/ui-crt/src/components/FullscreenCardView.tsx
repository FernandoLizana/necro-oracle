// src/components/FullscreenCardView.tsx
//
// Feature: 06-arcana-visions, task 14.1.
//
// Screen-only modal single-card inspector. It presents ONE drawn card from the
// current reading full-screen and lets the user move between the drawn cards by
// keyboard, close with Escape, and have focus behave like a proper dialog. It
// adds no data and makes no decisions about the reading: it renders whatever
// `cards[index]` resolves to through the same pure `pixelCardModel` +
// `integerScale` + `PixelCard` path the Spread_View uses, so the fullscreen view
// and the spread always agree on what a card looks like (the pixel skin changes
// nothing about the diagnosis).
//
// Focus (R2.7, R2.8, R10.5, R10.6):
//   - The container is `role="dialog" aria-modal="true"`.
//   - On open the component CAPTURES `document.activeElement` (the opener) and
//     moves focus inside — onto the dialog itself — using the SAME deferred-focus
//     technique the terminal uses (`use-terminal.ts` dispatches a `focus` effect
//     that runs `queueMicrotask(() => inputRef.current?.focus())`), so focus is
//     set after the element exists and is not stolen by the opening event.
//   - While open, Tab / Shift+Tab are TRAPPED: focus cycles only through the
//     dialog's own focusable controls (the dialog node and the close button),
//     never escaping to the terminal behind it.
//   - On close (unmount) focus is RESTORED to the captured opener via the same
//     `queueMicrotask` deferral, so the element that opened the view regains
//     focus after React has torn the dialog down.
//   There is no pre-existing focus-trap/dialog utility in `@necro/ui-crt`
//   (searched: no `role="dialog"`, `aria-modal`, or focus-trap helper exists),
//   so this is a minimal, local trap: a ref to the dialog, a keydown handler
//   cycling Tab within the focusable children, and capture/restore on
//   mount/unmount. It reuses only the established `queueMicrotask` focus idiom.
//
// Navigation (R2.5, R2.6, R2.8):
//   - ArrowRight / ArrowDown advance to the next drawn card; ArrowLeft / ArrowUp
//     go to the previous one; both WRAP (last -> first, first -> last) via
//     modular arithmetic on `cards.length`.
//   - With exactly one drawn card any navigation is a NO-OP: the wrap maps every
//     index back onto 0, so `onIndexChange` is never fired to a different index.
//   - Escape closes the view (`onClose`), after which the parent unmounts it and
//     focus is restored to the opener.
//
// Rendering (R2.9, R1.7, R10.3):
//   - The single large `PixelCard` computes its OWN `integerScale` against the
//     measured fullscreen region (falling back to scale 1 before measurement),
//     so the card fills the space at a whole-number factor with native aspect.
//   - Reversed cards rotate the IMAGE 180° with upright text and the
//     Diagnosis_Caption below the image — both are `PixelCard`/`arcana.css`
//     behaviour, inherited unchanged.
//   - Every interactive control shows the visible `--crt-focus` ring via the
//     Spec 05 `.crt :focus-visible` rule (the `CRT_FOCUS` token); the close
//     button and the dialog are reachable and activate by keyboard (R10.3,
//     R10.5).
//
// This component is a screen only: no ports, no data fetching, no clock, no
// network, no audio. The parent controls whether it is mounted (open within
// 500 ms is a mounting decision the parent makes on click / Enter / `explain`);
// this component simply renders when present.
//
// _Requirements: R2.1, R2.2, R2.5, R2.6, R2.7, R2.8, R2.9, R10.3, R10.5, R10.6_

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { ArcanaAsset } from "../arcana/manifest.js";
import { integerScale, type Size } from "../arcana/integer-scale.js";
import { pixelCardModel } from "../arcana/pixel-card-model.js";
import type { MotionMode } from "../motion/motion-mode.js";
import { asciiCard } from "../render/ascii-card.js";
import type { VisualCard } from "../session/visual-reading.js";
import { PixelCard } from "./PixelCard.js";

/** The logical size of a diagnosis card, used as the scaling fallback. */
const DIAGNOSIS_LOGICAL: Size = { w: 120, h: 160 };

/** Props for the modal single-card inspector (design §"Component: FullscreenCardView"). */
export interface FullscreenCardViewProps {
  /** The drawn cards of the current reading, in spread order (authoritative). */
  readonly cards: readonly VisualCard[];
  /** The index of the currently shown card within `cards`. */
  readonly index: number;
  /** The trusted asset map from `loadManifest` (logical size + text bands). */
  readonly manifest: ReadonlyMap<string, ArcanaAsset>;
  /** The effective motion mode; `reduced` suppresses glitch and zone animation. */
  readonly motionMode: MotionMode;
  /** Request to show a different drawn card (parent owns `index`). */
  readonly onIndexChange: (next: number) => void;
  /** Request to close the view; the parent unmounts and focus is restored. */
  readonly onClose: () => void;
}

/** The focusable elements inside the dialog, in tab order. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    '[data-fullscreen-focusable="true"]',
  );
  return Array.from(nodes);
}

/**
 * The modal single-card inspector.
 *
 * Renders nothing when there is no card to show (`cards` empty or `index` out of
 * range) so the parent can mount it unconditionally without guarding every
 * transition. Otherwise it renders a `role="dialog" aria-modal="true"` overlay
 * holding the large `PixelCard`, a close control, and the navigation hint, with
 * a local focus trap and opener-focus restore.
 */
export function FullscreenCardView({
  cards,
  index,
  manifest,
  motionMode,
  onIndexChange,
  onClose,
}: FullscreenCardViewProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // Capture the opener on mount and restore focus to it on unmount, using the
  // same deferred-focus idiom as `use-terminal.ts` (queueMicrotask so focus is
  // applied after the element exists / after React tears the dialog down).
  useEffect(() => {
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    queueMicrotask(() => dialog?.focus());
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) {
        queueMicrotask(() => opener.focus());
      }
    };
  }, []);

  // Measure the fullscreen region and compute this card's own Integer_Scale
  // against it; fall back to scale 1 before measurement (and when the region is
  // smaller than the logical size, `integerScale` already clamps to 1).
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (region === null) return;
    const rect = region.getBoundingClientRect();
    setScale(
      integerScale({ w: rect.width, h: rect.height }, DIAGNOSIS_LOGICAL),
    );
  }, [index, cards.length]);

  const count = cards.length;

  const step = useCallback(
    (delta: number) => {
      // Wrap both ends; with a single card every move maps back to 0 (R2.5,
      // R2.6). `onIndexChange` is still called, but to the same index, so the
      // view holds that card displayed on any navigation.
      if (count === 0) return;
      const next = ((index + delta) % count + count) % count;
      onIndexChange(next);
    },
    [count, index, onIndexChange],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          step(1);
          return;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          step(-1);
          return;
        case "Tab": {
          // Trap Tab / Shift+Tab within the dialog's own focusable controls
          // (R2.7, R10.6). Cycle: forward from the last wraps to the first,
          // backward from the first wraps to the last.
          const dialog = dialogRef.current;
          if (dialog === null) return;
          const focusables = focusableWithin(dialog);
          if (focusables.length === 0) {
            event.preventDefault();
            return;
          }
          const active = document.activeElement as HTMLElement | null;
          const currentIndex = active ? focusables.indexOf(active) : -1;
          const lastIndex = focusables.length - 1;
          let targetIndex: number;
          if (event.shiftKey) {
            targetIndex =
              currentIndex <= 0 ? lastIndex : currentIndex - 1;
          } else {
            targetIndex =
              currentIndex === -1 || currentIndex === lastIndex
                ? 0
                : currentIndex + 1;
          }
          event.preventDefault();
          focusables[targetIndex]?.focus();
          return;
        }
        default:
          return;
      }
    },
    [onClose, step],
  );

  // Nothing to show: render no overlay so the parent can mount unconditionally.
  if (count === 0 || index < 0 || index >= count) {
    return null;
  }

  const card = cards[index];
  if (card === undefined) {
    return null;
  }
  const model = pixelCardModel(card);
  const asset =
    manifest.get(model.card) ??
    ({ id: model.card, logical: DIAGNOSIS_LOGICAL, bands: null } as ArcanaAsset);
  const src = `/arcana/${model.card}.webp`;

  return (
    <div
      ref={dialogRef}
      className="crt-fullscreen-card"
      role="dialog"
      aria-modal="true"
      aria-label={model.altText}
      tabIndex={-1}
      data-fullscreen-focusable="true"
      data-card={model.card}
      onKeyDown={onKeyDown}
    >
      <div className="crt-fullscreen-controls">
        <button
          type="button"
          className="crt-fullscreen-close"
          data-fullscreen-focusable="true"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div ref={regionRef} className="crt-fullscreen-region">
        <PixelCard
          model={model}
          asset={asset}
          scale={scale}
          motionMode={motionMode}
          src={src}
          // The fullscreen view renders only its single, currently-visible card
          // (the parent mounts it only while open), so that one image is eager;
          // every other pixel card stays lazy via PixelCard's default (R11.1).
          loading="eager"
          asciiFallback={asciiCard(
            model.card,
            model.orientation,
            {},
            card.label,
          )}
        />
      </div>

      {/*
       * Navigation hint: DOM text so it reads with motion stopped (R10.2).
       * Shown only when more than one card can be navigated to; with a single
       * card navigation is a no-op so the hint would mislead (R2.6).
       */}
      {count > 1 ? (
        <p className="crt-fullscreen-hint">
          {"\u2190/\u2191 previous \u00b7 \u2192/\u2193 next \u00b7 Esc to close"}
        </p>
      ) : (
        <p className="crt-fullscreen-hint">{"Esc to close"}</p>
      )}
    </div>
  );
}
