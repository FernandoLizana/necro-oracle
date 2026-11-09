// @vitest-environment jsdom
//
// SEC-02 (BYOK masked input behaviour) — the masked `SoulKeyInput` must keep
// the raw key out of the DOM/log and must let the user CANCEL with Escape.
//
// Covered here:
//   - canary: a secret typed into the field is handed ONLY to `setKey`, is
//     cleared from the DOM node on submit, and never reaches `onConfirm`/the
//     `onKeySet` mirror beyond its last four characters;
//   - Escape cancels: it clears the field value (so the secret does not linger
//     in the DOM) and calls `onClose` WITHOUT storing a key or recording a
//     mirror;
//   - the field is masked (`type="password"`).
//
// Offline, jsdom. No network / LLM / sandbox.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SoulKeyInput } from "./SoulKeyInput.js";

afterEach(() => {
  cleanup();
});

const SECRET = "sk-or-v1-deadbeefcafef00dSECRET1234567890";

function renderInput() {
  const setKey = vi.fn();
  const onKeySet = vi.fn();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <SoulKeyInput
      api={{ setKey }}
      onKeySet={onKeySet}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  const input = container.querySelector(
    "#crt-soul-key",
  ) as HTMLInputElement;
  const form = container.querySelector("form") as HTMLFormElement;
  return { setKey, onKeySet, onConfirm, onClose, input, form, container };
}

describe("SEC-02 (R25.2, R26.4): masked SoulKeyInput keeps the key secret", () => {
  it("hands the secret only to setKey and clears the node on submit (canary)", () => {
    const { setKey, onKeySet, onConfirm, input, form } = renderInput();
    input.value = SECRET;
    fireEvent.submit(form);

    expect(setKey).toHaveBeenCalledWith(SECRET);
    // The node is wiped so the secret cannot linger in the DOM.
    expect(input.value).toBe("");
    // Only the last-4 mirror escapes, never the raw key.
    const mirror = onKeySet.mock.calls[0]?.[0];
    expect(mirror).toEqual({ keySet: true, last4: "7890" });
    for (const line of onConfirm.mock.calls[0]?.[0] ?? []) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("deadbeef");
    }
  });

  it("Escape cancels: clears the field, closes, stores nothing", () => {
    const { setKey, onKeySet, onClose, input } = renderInput();
    input.value = SECRET;
    fireEvent.keyDown(input, { key: "Escape" });

    // The secret is wiped from the DOM and NOT stored.
    expect(input.value).toBe("");
    expect(setKey).not.toHaveBeenCalled();
    expect(onKeySet).not.toHaveBeenCalled();
    // The field is dismissed.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is a masked password field", () => {
    const { input } = renderInput();
    expect(input.getAttribute("type")).toBe("password");
  });
});
