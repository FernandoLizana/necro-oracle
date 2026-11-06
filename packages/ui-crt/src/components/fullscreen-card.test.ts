// @vitest-environment jsdom
//
// FullscreenCardView — unit tests (06-arcana-visions, task 14.2).
//
// FullscreenCardView is the screen-only modal single-card inspector built in
// task 14.1. The parent owns `index` and owns the mounting decision (open
// within 500 ms from click / Enter / `explain`); this component only renders
// whichever `cards[index]` resolves to and runs its own keyboard + focus
// contract. These tests exercise exactly that contract through Testing Library
// and `@testing-library/user-event` on jsdom:
//
//   - open on click/Enter (R2.1, R2.2): with the dialog mounted at a given
//     index the matching card face is shown, and focus is moved INTO the dialog
//     on mount (R10.6) via the component's queueMicrotask deferral.
//   - arrow wrap both ends (R2.5): ArrowRight from the last index wraps to the
//     first; ArrowLeft from the first wraps to the last — asserted through the
//     `onIndexChange` the component calls with the wrapped index.
//   - single-card no-op (R2.6): with one card every arrow maps back to index 0,
//     so the shown card never changes.
//   - focus trap (R2.7): Tab / Shift+Tab cycle only within the dialog's
//     `data-fullscreen-focusable` controls, never escaping to an element behind
//     the dialog.
//   - Escape close + focus restore (R2.8, R10.6): Escape calls `onClose`; and on
//     unmount focus returns to the opener element that had focus when the dialog
//     mounted (awaiting a microtask for the queueMicrotask deferral).
//   - visible focus ring present (R10.5): the focusable controls carry the
//     `data-fullscreen-focusable` hook and are reachable/focusable; the CSS ring
//     itself lives in the Spec 05 `.crt :focus-visible` tokens, so here we assert
//     the hook attributes/classes the ring contract keys off.
//
// Screen only: no ports, clock, network or audio. All navigation and focus is
// observed through `onIndexChange`/`onClose` spies and `document.activeElement`.
//
// Validates: Requirements 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 10.5, 10.6

import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardDrawSchema, type CardId } from "@necro/oracle/client";

import { loadManifest, type ArcanaAsset } from "../arcana/manifest.js";
import type { VisualCard } from "../session/visual-reading.js";
import { FullscreenCardView } from "./FullscreenCardView.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real app manifest — distilled to the trusted id -> ArcanaAsset map. */
const MANIFEST: ReadonlyMap<string, ArcanaAsset> = (() => {
  // A minimal, schema-valid manifest covering the ids the tests draw. loadManifest
  // keeps only id/logical/bands, matching exactly what the real manifest yields.
  const ids: readonly CardId[] = ["judgement", "tower", "death", "devil"];
  return loadManifest({
    images: ids.map((id) => ({
      id,
      logical: [120, 160] as const,
      bands: { header_rows: [0, 19], footer_rows: [147, 160] },
    })),
  });
})();

/** Build a schema-valid `VisualCard` for a card id at a 1-based position. */
function visualCard(card: CardId, position: number): VisualCard {
  return {
    position,
    label: `POSITION ${position}`,
    draw: CardDrawSchema.parse({
      card,
      severity: 2,
      orientation: "upright",
      evidence: [],
      summary: `summary-${position}`,
      grimoires: [],
    }),
  };
}

/** A three-card array, in spread order, for the navigation/trap tests. */
const THREE_CARDS: readonly VisualCard[] = [
  visualCard("judgement", 1),
  visualCard("tower", 2),
  visualCard("death", 3),
];

/** A single-card array, for the no-op test. */
const ONE_CARD: readonly VisualCard[] = [visualCard("devil", 1)];

/** Render the dialog with sensible defaults; overrides win. */
function renderDialog(
  overrides: Partial<React.ComponentProps<typeof FullscreenCardView>> = {},
) {
  const onIndexChange = overrides.onIndexChange ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    createElement(FullscreenCardView, {
      cards: THREE_CARDS,
      index: 0,
      manifest: MANIFEST,
      motionMode: "reduced",
      onIndexChange,
      onClose,
      ...overrides,
    }),
  );
  return { ...result, onIndexChange, onClose };
}

/** The modal dialog node (role + modal contract). */
function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

/** Flush the component's queueMicrotask focus capture/restore deferral. */
async function microtask(): Promise<void> {
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Open on click/Enter + focus moved into the dialog (R2.1, R2.2, R10.6)
// ---------------------------------------------------------------------------

describe("R2.1 / R2.2 / R10.6 (open): the mounted index is shown and focus moves into the dialog", () => {
  it("renders the card at the mounted index as a modal dialog", () => {
    renderDialog({ index: 1 });
    const node = dialog();
    expect(node).not.toBeNull();
    expect(node.getAttribute("aria-modal")).toBe("true");
    // cards[1] is the tower — the dialog carries the drawn card id as data.
    expect(node.getAttribute("data-card")).toBe("tower");
  });

  it("shows a different card when the parent mounts a different index", () => {
    renderDialog({ index: 2 });
    expect(dialog().getAttribute("data-card")).toBe("death");
  });

  it("moves focus onto the dialog on mount (deferred-focus idiom)", async () => {
    renderDialog({ index: 0 });
    // queueMicrotask(() => dialog.focus()) runs after mount.
    await microtask();
    expect(document.activeElement).toBe(dialog());
  });
});

// ---------------------------------------------------------------------------
// Arrow wrap both ends (R2.5)
// ---------------------------------------------------------------------------

describe("R2.5 (arrow wrap): arrows move between drawn cards and wrap at both ends", () => {
  it("ArrowRight from the last index wraps to the first (0)", async () => {
    const { onIndexChange } = renderDialog({ index: THREE_CARDS.length - 1 });
    await microtask();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("ArrowLeft from the first index wraps to the last", async () => {
    const { onIndexChange } = renderDialog({ index: 0 });
    await microtask();
    const user = userEvent.setup();
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenCalledWith(THREE_CARDS.length - 1);
  });

  it("ArrowRight advances to the next index in the middle of the range", async () => {
    const { onIndexChange } = renderDialog({ index: 0 });
    await microtask();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Single-card no-op (R2.6)
// ---------------------------------------------------------------------------

describe("R2.6 (single-card no-op): with one card arrows never change the shown card", () => {
  it("ArrowRight / ArrowLeft map back to index 0 with a single card", async () => {
    const onIndexChange = vi.fn<(next: number) => void>();
    renderDialog({ cards: ONE_CARD, index: 0, onIndexChange });
    await microtask();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");
    // The component always calls onIndexChange, but every move wraps to 0, so
    // the shown card never changes.
    for (const call of onIndexChange.mock.calls) {
      expect(call[0]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Focus trap (R2.7, R10.6)
// ---------------------------------------------------------------------------

describe("R2.7 (focus trap): Tab / Shift+Tab cycle only within the dialog's focusable controls", () => {
  it("every focus-hook member is the dialog or a control inside the dialog", () => {
    renderDialog({ index: 0 });
    const node = dialog();
    // The dialog itself carries the hook, plus every descendant control (the
    // close button). Matching from the document, every member must be the
    // dialog or live inside it — nothing behind the dialog is a trap member.
    const members = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-fullscreen-focusable="true"]',
      ),
    );
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const el of members) {
      expect(el === node || node.contains(el)).toBe(true);
    }
    // At least one descendant control (the close button) lives inside.
    const descendants = Array.from(
      node.querySelectorAll<HTMLElement>('[data-fullscreen-focusable="true"]'),
    );
    expect(descendants.length).toBeGreaterThanOrEqual(1);
  });

  it("Tab from the dialog cycles forward within the trap and never escapes", async () => {
    renderDialog({ index: 0 });
    await microtask();
    const node = dialog();
    const focusables = Array.from(
      node.querySelectorAll<HTMLElement>('[data-fullscreen-focusable="true"]'),
    );
    const user = userEvent.setup();

    // Start on the dialog (index 0 in the trap). Each Tab lands on the next
    // focusable, and from the last member it wraps back to the first.
    expect(document.activeElement).toBe(node);
    for (let i = 0; i < focusables.length + 1; i += 1) {
      await user.keyboard("{Tab}");
      // Focus must always remain on one of the trap's members.
      expect(focusables).toContain(document.activeElement);
    }
  });

  it("Shift+Tab from the first member wraps to the last member", async () => {
    renderDialog({ index: 0 });
    await microtask();
    const node = dialog();
    const focusables = Array.from(
      node.querySelectorAll<HTMLElement>('[data-fullscreen-focusable="true"]'),
    );
    const last = focusables[focusables.length - 1]!;
    const user = userEvent.setup();

    // On the dialog (first member) Shift+Tab wraps to the last member.
    expect(document.activeElement).toBe(node);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(last);
  });
});

// ---------------------------------------------------------------------------
// Escape close + focus restore (R2.8, R10.6)
// ---------------------------------------------------------------------------

describe("R2.8 / R10.6 (escape + restore): Escape closes and unmount restores focus to the opener", () => {
  it("Escape calls onClose", async () => {
    const { onClose } = renderDialog({ index: 0 });
    await microtask();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener element on unmount", async () => {
    // Render an opener button first and focus it — it is the element the dialog
    // captures as document.activeElement on mount.
    const opener = document.createElement("button");
    opener.textContent = "Inspect";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = renderDialog({ index: 0 });
    // Mount capture + deferred dialog focus runs first.
    await microtask();
    expect(document.activeElement).toBe(dialog());

    unmount();
    // The unmount cleanup restores focus via queueMicrotask(() => opener.focus()).
    await microtask();
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });
});

// ---------------------------------------------------------------------------
// Visible focus ring present (R10.5)
// ---------------------------------------------------------------------------

describe("R10.5 (focus ring): focusable controls carry the ring hook and are reachable", () => {
  it("the close control is a focusable button carrying the focus hook", () => {
    renderDialog({ index: 0 });
    const close = dialog().querySelector<HTMLButtonElement>(
      'button[data-fullscreen-focusable="true"]',
    );
    expect(close).not.toBeNull();
    expect(close!.tagName).toBe("BUTTON");
    // Focusable and keyboard-reachable: focusing it makes it the active element.
    close!.focus();
    expect(document.activeElement).toBe(close);
  });

  it("the dialog itself is a focus-hook member so the :focus-visible ring applies", () => {
    renderDialog({ index: 0 });
    const node = dialog();
    expect(node.getAttribute("data-fullscreen-focusable")).toBe("true");
    // tabIndex=-1 makes the dialog programmatically focusable for the trap.
    expect(node.tabIndex).toBe(-1);
  });
});
