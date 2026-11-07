// @vitest-environment jsdom
//
// SoulKeyInput — axe zero-violation accessibility test (lovers-binding 14.5).
//
// Validates: Requirements 30.2, 30.3
//
// R30.2: WHILE the masked input is rendered, the new BYOK surface reports ZERO
//        axe violations.
// R30.3: the input exposes an accessible name (a real `<label>` + `aria-label`)
//        and is a proper masked (`type="password"`) field.
//
// The masked input is rendered INSIDE the real `SoulKeyProvider` (the
// non-persistable key container) through a tiny harness that hands the input
// the context's own write-only `setKey`, exactly as the shell wires it (tasks
// 11.4 / 11.9). This exercises the component with its required provider context
// rather than a bare mock.
//
// HONEST LIMITATION: jest-axe is a PROGRAMMATIC check and axe-core disables its
// color-contrast rule under jsdom, so the >= 4.5:1 contrast floor (R30.3) is a
// MANUAL / browser-e2e concern. Full WCAG conformance still needs testing with
// real assistive technologies.

import { cleanup, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { SoulKeyProvider, useSoulKey } from "../terminal/soul-key-context.js";
import { SoulKeyInput } from "./SoulKeyInput.js";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});

/**
 * Render `SoulKeyInput` wrapped in its required `SoulKeyProvider`, handing it
 * the context's own write-only `setKey` (the real wiring seam). The callbacks
 * are no-ops: this suite only asserts the rendered accessibility contract, not
 * the submit behaviour (covered by the component's behaviour test).
 */
function Harness(): React.JSX.Element {
  const api = useSoulKey();
  return (
    <SoulKeyInput
      api={{ setKey: api.setKey }}
      onKeySet={() => {}}
      onConfirm={() => {}}
      onClose={() => {}}
    />
  );
}

function renderMasked(): { container: HTMLElement } {
  return render(
    <SoulKeyProvider>
      <Harness />
    </SoulKeyProvider>,
  );
}

describe("30.2 / 30.3 (R30.2, R30.3): SoulKeyInput reports zero axe violations", () => {
  it("has no axe violations when rendered inside SoulKeyProvider", async () => {
    const { container } = renderMasked();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("is a masked, labelled field with an accessible name (R30.3)", () => {
    const { container } = renderMasked();

    const input = container.querySelector("#crt-soul-key");
    expect(input).not.toBeNull();

    // Masked: a password field so the key is never shown on screen.
    expect(input).toHaveAttribute("type", "password");

    // Accessible name via BOTH a real <label for> association and aria-label,
    // so assistive tech announces the field as "OpenRouter key".
    expect(input).toHaveAttribute("aria-label", "OpenRouter key");
    const label = container.querySelector("label[for='crt-soul-key']");
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent("OpenRouter key");

    // No autofill / autocapitalize surprises on a secret field.
    expect(input).toHaveAttribute("autocomplete", "off");
  });
});
