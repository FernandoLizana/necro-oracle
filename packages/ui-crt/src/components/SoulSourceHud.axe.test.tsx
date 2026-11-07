// @vitest-environment jsdom
//
// SoulSourceHud — axe zero-violation accessibility test (lovers-binding 14.5).
//
// Validates: Requirements 30.2, 30.3
//
// R30.2: WHILE the Soul_Source_HUD is rendered, the new BYOK surface reports
//        ZERO axe violations.
// R30.3: the HUD exposes an accessible name and is an `aria-live` status region
//        (the MODE indicator is announced once on change).
//
// Renders the REAL `SoulSourceHud` for BOTH Soul_Source modes (ORACLE / YOURS)
// and for the documented souls-spent attribution seam (null vs a live figure),
// asserting axe finds no violations and that the `role="status"` /
// `aria-live="polite"` live-region contract the tarot-ux rule requires holds.
//
// HONEST LIMITATION: jest-axe is a PROGRAMMATIC check and axe-core disables its
// color-contrast rule under jsdom, so the >= 4.5:1 DMG contrast floor (R30.3)
// is NOT verified here — it is enforced by the palette guard and the browser
// axe e2e. Full WCAG conformance still needs manual assistive-tech testing.

import { cleanup, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import type { SoulSourceHudModel } from "../landing/landing-model.js";
import { SoulSourceHud } from "./SoulSourceHud.js";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});

/** The MODE-only models (souls-spent seam not yet wired → `null`). */
const MODE_ONLY: ReadonlyArray<SoulSourceHudModel> = [
  { mode: "ORACLE", label: "SOUL SOURCE: ORACLE", soulsSpent: null },
  { mode: "YOURS", label: "SOUL SOURCE: YOURS", soulsSpent: null },
];

/** A model with the documented souls-spent attribution figure present. */
const WITH_SPENT: SoulSourceHudModel = {
  mode: "YOURS",
  label: "SOUL SOURCE: YOURS",
  soulsSpent: { costUsd: 0.0123, tokens: 1420 },
};

describe("30.2 / 30.3 (R30.2, R30.3): SoulSourceHud reports zero axe violations", () => {
  for (const model of MODE_ONLY) {
    it(`has no axe violations (mode=${model.mode})`, async () => {
      const { container } = render(<SoulSourceHud model={model} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  }

  it("has no axe violations with the souls-spent figure present", async () => {
    const { container } = render(<SoulSourceHud model={WITH_SPENT} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("is an aria-live status region with an accessible name (R30.3)", () => {
    const { getByRole } = render(<SoulSourceHud model={MODE_ONLY[0]!} />);
    // The HUD is announced as a polite status with the MODE line as its name.
    const hud = getByRole("status", { name: "SOUL SOURCE: ORACLE" });
    expect(hud).toBeInTheDocument();
    expect(hud).toHaveAttribute("aria-live", "polite");
  });

  it("includes the souls-spent attribution in the accessible name when present", () => {
    const { getByRole } = render(<SoulSourceHud model={WITH_SPENT} />);
    // The name composes the MODE line + the spent attribution (R24.4 / R30.3).
    const hud = getByRole("status", {
      name: /SOUL SOURCE: YOURS\. SOULS SPENT \(YOURS\):/,
    });
    expect(hud).toHaveAttribute("aria-live", "polite");
  });
});
