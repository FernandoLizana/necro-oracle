// @vitest-environment jsdom
//
// ButtonRow — axe zero-violation accessibility test for the lovers-binding
// command chips (lovers-binding task 14.5).
//
// Validates: Requirements 30.2, 30.3
//
// R30.2: WHILE the new BYOK / lovers chips are rendered, the surface reports
//        ZERO axe violations.
// R30.3: every new command is offered as a clickable chip with an accessible
//        name — KEY, MODEL, and LOVERS — inside a named command-shortcuts
//        group.
//
// The three additive chips (KEY, MODEL, LOVERS) are the clickable equivalents
// of the typed `key` / `model` / `lovers` commands. This renders the row with
// all three present and asserts axe is clean and that each chip exposes its
// exact accessible name. The behavioural wiring of the chips is covered by
// `ButtonRow.test.tsx`; this suite is the accessibility gate for task 14.5.
//
// HONEST LIMITATION: jest-axe is a PROGRAMMATIC check and axe-core disables its
// color-contrast rule under jsdom, so the >= 4.5:1 contrast floor (R30.3) is a
// MANUAL / browser-e2e concern. Full WCAG conformance still needs manual
// assistive-technology testing.

import { cleanup, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { ButtonRow, type ButtonRowProps } from "./ButtonRow.js";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});

/** Render the row with all three lovers-binding chips present (no-op spies). */
function renderRow(): { container: HTMLElement } {
  const props: ButtonRowProps = {
    submit: () => {},
    prefillSummon: () => {},
    toggleSound: () => {},
    soundOn: false,
    prefillModel: () => {},
    loversPrefill: () => {},
  };
  return render(<ButtonRow {...props} />);
}

describe("30.2 / 30.3 (R30.2, R30.3): ButtonRow chips report zero axe violations", () => {
  it("has no axe violations with the KEY / MODEL / LOVERS chips present", async () => {
    const { container } = renderRow();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("offers every new command as a clickable chip with an accessible name (R30.3)", () => {
    renderRow();
    // The chips live in a named command-shortcuts group…
    expect(
      screen.getByRole("group", { name: "Command shortcuts" }),
    ).toBeInTheDocument();
    // …and each new command is a button with its exact accessible name.
    for (const name of ["KEY", "MODEL", "LOVERS"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
