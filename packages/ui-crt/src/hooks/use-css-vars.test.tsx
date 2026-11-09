// @vitest-environment jsdom
//
// SEC-08 refactor: `useCssVars` applies dynamic CSS custom properties to a
// ref'd element through the CSSOM (`element.style.setProperty`) in a layout
// effect, INSTEAD of a CSP-blocked inline `style=` attribute. Programmatic
// style mutation is governed by `script-src` (our nonce'd/strict-dynamic
// bundle), not `style-src`, so the strict nonce-only `style-src` holds with no
// 'unsafe-inline'. Values are applied verbatim and stale keys are removed when
// the record changes.
//
// Validates: SEC-08 (CSP style-src nonce-only).
import { useRef } from "react";
import { act, render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useCssVars } from "./use-css-vars.js";

afterEach(() => {
  cleanup();
});

function Probe({ vars }: { vars: Record<string, string> }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useCssVars(ref, vars);
  return <div ref={ref} data-testid="probe" />;
}

describe("SEC-08: useCssVars sets custom properties via the CSSOM, not a style attribute", () => {
  it("applies each custom property as an inline custom-property value", () => {
    const { getByTestId } = render(
      <Probe vars={{ "--arcana-scale": "4", "--arcana-logical-w": "256" }} />,
    );
    const el = getByTestId("probe") as HTMLElement;
    expect(el.style.getPropertyValue("--arcana-scale")).toBe("4");
    expect(el.style.getPropertyValue("--arcana-logical-w")).toBe("256");
  });

  it("removes a custom property that is no longer in the record on rerender", () => {
    const { getByTestId, rerender } = render(
      <Probe vars={{ "--glitch-offset": "3px", "--glitch-tears": "2" }} />,
    );
    const el = getByTestId("probe") as HTMLElement;
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("3px");

    act(() => {
      rerender(<Probe vars={{ "--glitch-offset": "5px" }} />);
    });
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("5px");
    // --glitch-tears is gone from the new record, so it must be cleared.
    expect(el.style.getPropertyValue("--glitch-tears")).toBe("");
  });

  it("sets NO non-custom (static) style properties", () => {
    const { getByTestId } = render(<Probe vars={{ "--x": "1" }} />);
    const el = getByTestId("probe") as HTMLElement;
    // Only the one custom property is present; no imageRendering / filter / etc.
    expect(el.style.imageRendering).toBe("");
    expect(el.getAttribute("style") ?? "").toContain("--x");
  });
});
