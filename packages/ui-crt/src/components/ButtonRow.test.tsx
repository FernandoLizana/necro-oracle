// @vitest-environment jsdom
//
// ButtonRow — lovers-binding command chips (KEY, MODEL, LOVERS).
//
// Validates: Requirements R14.3, R25.1, R25.2, R25.5
//
// `ButtonRow` renders the clickable equivalents of the typed commands. These
// tests cover the three additive lovers-binding chips and their security
// invariant:
//
//   - KEY   — dispatches the FIXED string `key set` through `submit` (which the
//             reducer turns into the masked-input effect). The chip label is
//             `KEY` and it NEVER carries or renders a key value verbatim
//             (R25.1, R25.2).
//   - MODEL — a PREFILL affordance (needs a required `<id>` arg); it calls
//             `prefillModel` and renders only when that prop is supplied (R25.5).
//   - LOVERS — CONDITIONAL (R14.3): rendered only while `loversPrefill` is
//             supplied (THE LOVERS drawn AND a resurrectable file in scope);
//             omitted otherwise. It calls `loversPrefill`, never one-shot
//             submits.
//
// The component is pure presentation: these tests pass in spies for every
// callback and assert on the rendered DOM and the arguments the chips pass —
// no network, LLM, sandbox or clock.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ButtonRow, type ButtonRowProps } from "./ButtonRow.js";

afterEach(() => {
  cleanup();
});

interface Spies {
  readonly submit: ReturnType<typeof vi.fn>;
  readonly prefillSummon: ReturnType<typeof vi.fn>;
  readonly toggleSound: ReturnType<typeof vi.fn>;
  readonly prefillModel: ReturnType<typeof vi.fn>;
  readonly loversPrefill: ReturnType<typeof vi.fn>;
}

/**
 * Render the row with spy callbacks. The two CONDITIONAL chips (MODEL, LOVERS)
 * render only when their prefill prop is supplied; `withModel`/`withLovers`
 * toggle whether those props are passed at all (so the test can assert the
 * chip is omitted) without passing an explicit `undefined`
 * (`exactOptionalPropertyTypes`).
 */
function renderRow(
  opts: { readonly withModel?: boolean; readonly withLovers?: boolean } = {},
): Spies {
  const { withModel = true, withLovers = true } = opts;
  const submit = vi.fn();
  const prefillSummon = vi.fn();
  const toggleSound = vi.fn();
  const prefillModel = vi.fn();
  const loversPrefill = vi.fn();

  const props: ButtonRowProps = {
    submit,
    prefillSummon,
    toggleSound,
    soundOn: false,
    ...(withModel ? { prefillModel } : {}),
    ...(withLovers ? { loversPrefill } : {}),
  };

  render(<ButtonRow {...props} />);

  return { submit, prefillSummon, toggleSound, prefillModel, loversPrefill };
}

// ---------------------------------------------------------------------------
// KEY chip (R25.1, R25.2)
// ---------------------------------------------------------------------------

describe("ButtonRow — KEY chip (R25.1, R25.2)", () => {
  it("renders a KEY chip that dispatches the fixed `key set` line", () => {
    const { submit } = renderRow();
    const key = screen.getByRole("button", { name: "KEY" });
    expect(key).toBeInTheDocument();

    fireEvent.click(key);

    // The chip submits the FIXED op string `key set` (which opens the masked
    // input via the reducer) — it NEVER one-shot submits a key value.
    expect(submit).toHaveBeenCalledExactlyOnceWith("key set", "button");
  });

  it("never carries or renders a key value verbatim (R25.2)", () => {
    const { submit } = renderRow();
    const key = screen.getByRole("button", { name: "KEY" });

    // The chip label is exactly `KEY`, not a key value.
    expect(key.textContent).toBe("KEY");

    fireEvent.click(key);
    fireEvent.click(key);

    // Every argument the chip ever passes to `submit` is the fixed command
    // line; no call carries anything that looks like a secret key token.
    for (const call of submit.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toMatch(/sk-|secret|bearer/i);
      }
      expect(call[0]).toBe("key set");
      expect(call[1]).toBe("button");
    }
  });
});

// ---------------------------------------------------------------------------
// MODEL chip (R25.5)
// ---------------------------------------------------------------------------

describe("ButtonRow — MODEL chip (R25.5)", () => {
  it("renders a MODEL chip that prefills rather than one-shot submitting", () => {
    const { prefillModel, submit } = renderRow();
    const model = screen.getByRole("button", { name: "MODEL" });
    expect(model).toBeInTheDocument();
    expect(model.textContent).toBe("MODEL");

    fireEvent.click(model);

    // MODEL needs a required `<id>` arg, so the chip PREFILLS and focuses the
    // input (via `prefillModel`); it never submits an argument-less line.
    expect(prefillModel).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("omits the MODEL chip entirely when prefillModel is not supplied", () => {
    renderRow({ withModel: false });
    expect(screen.queryByRole("button", { name: "MODEL" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LOVERS chip (R14.3)
// ---------------------------------------------------------------------------

describe("ButtonRow — LOVERS chip (R14.3)", () => {
  it("renders a LOVERS chip that prefills when loversPrefill is supplied", () => {
    const { loversPrefill, submit } = renderRow();
    const lovers = screen.getByRole("button", { name: "LOVERS" });
    expect(lovers).toBeInTheDocument();
    expect(lovers.textContent).toBe("LOVERS");

    fireEvent.click(lovers);

    // Like SUMMON, the chip prefills `lovers <file> ` and focuses the input;
    // it never one-shot submits a binding.
    expect(loversPrefill).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("omits the LOVERS chip when not lovers-eligible (R14.3)", () => {
    renderRow({ withLovers: false });
    expect(screen.queryByRole("button", { name: "LOVERS" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Chip group — labels and conventions
// ---------------------------------------------------------------------------

describe("ButtonRow — chip labels and group", () => {
  it("exposes the chips in a labelled command-shortcuts group", () => {
    renderRow();
    const group = screen.getByRole("group", { name: "Command shortcuts" });
    expect(group).toBeInTheDocument();
  });

  it("renders the lovers-binding chips with their exact labels", () => {
    renderRow();
    for (const label of ["KEY", "MODEL", "LOVERS"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
