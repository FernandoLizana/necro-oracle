"use client";

// apps/web/src/components/SoulKeyInput.tsx
//
// Feature: lovers-binding, task 11.5 — the masked Soul_Key input.
//
// The `key set` command opens this field (the wiring lives in tasks 10.6 /
// 11.9); this task builds the component and its submit behaviour. It is a
// masked, password-style row styled to match the CRT Command_Line
// (`@necro/ui-crt`'s `CommandLine`), but it lives in `apps/web` because it
// talks to the non-persistable Soul_Key container (`terminal/soul-key-context`,
// task 11.4): the raw key value must never leave `apps/web` and never reach
// `@necro/ui-crt`.
//
// BYOK secrecy invariant (R25.2, R26.4): the raw key value goes ONLY to the
// in-memory ref via `SoulKeyApi.setKey(...)`. This component NEVER writes the
// value to the output log, the scrollback, or the command history, and NEVER
// renders the raw value anywhere:
//   - the field is `type="password"` (masked on screen);
//   - the input is uncontrolled, so the value lives only in the DOM node until
//     submit;
//   - on submit the value is read once, handed to `setKey`, then the node's
//     value is cleared immediately — React state never holds it;
//   - the only thing that escapes submit is the HUD mirror `{ keySet, last4 }`
//     (last 4 chars only) plus the Oracle_Voice confirmation lines, neither of
//     which contains the key.
//
// On a valid submit the component emits the Oracle_Voice "set" confirmation
// (two layers, ASCII, ≤ 72 cols, no emoji — see the oracle-voice steering and
// design D.2): a short mystical line then the plain-English fact that the key
// lives only in this tab and a reload forgets it.
//
// _Requirements: R25.2, R26.4_
// _Design: D.2 Commands + masked input, D.3 Non-persistable state container_

import { forwardRef } from "react";

/**
 * The slice of the Soul_Key container this input needs: it only ever WRITES the
 * raw key, never reads it back. This mirrors the `setKey` of the `SoulKeyApi`
 * exposed by `terminal/soul-key-context` (task 11.4) so the shell can hand the
 * context's own `setKey` straight in without this component importing — or
 * being able to read — the raw value.
 */
export interface SoulKeyWriter {
  /** Store the raw key in the in-memory ref. Never logged, never rendered. */
  readonly setKey: (raw: string) => void;
}

/** The HUD mirror recorded on a successful `key set` — never the raw value. */
export interface SoulKeyMirror {
  readonly keySet: true;
  /** The last four characters of the key, for the `SOUL SOURCE` HUD only. */
  readonly last4: string;
}

/** Props for the masked Soul_Key input. */
export interface SoulKeyInputProps {
  /** The write-only Soul_Key container seam (the context's `setKey`). */
  readonly api: SoulKeyWriter;
  /**
   * Record the set flag + last-4 mirror in the reducer (drives the HUD). Called
   * with `{ keySet: true, last4 }` on a successful submit; never the raw value.
   */
  readonly onKeySet: (mirror: SoulKeyMirror) => void;
  /**
   * Emit the Oracle_Voice confirmation into the terminal output log. Receives
   * the ready-made lines (mystical line, then the plain-English fact) so this
   * component owns no line-id/formatting policy.
   */
  readonly onConfirm: (lines: readonly string[]) => void;
  /** Dismiss the masked input (e.g. the shell closes it after a submit). */
  readonly onClose: () => void;
}

/**
 * The Oracle_Voice "set" confirmation (design D.2). Two layers: a short
 * mystical line, then the technical fact. ASCII only, no emoji, ≤ 72 columns.
 */
export const SOUL_KEY_SET_CONFIRMATION: readonly string[] = [
  "Your soul is bound to the circle, for this session only.",
  "Key stored in memory for this tab; cleared on reload.",
];

/** The last four characters of a key, used only for the HUD mirror preview. */
function lastFour(raw: string): string {
  return raw.slice(-4);
}

/**
 * The masked Soul_Key input row.
 *
 * Uncontrolled, like the Command_Line: the Terminal shell can focus it through
 * the forwarded ref, and the value is read from the DOM node only at submit.
 */
export const SoulKeyInput = forwardRef<HTMLInputElement, SoulKeyInputProps>(
  function SoulKeyInput(
    { api, onKeySet, onConfirm, onClose },
    ref,
  ): React.JSX.Element {
    return (
      <form
        className="crt-input"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem(
            "crt-soul-key",
          ) as HTMLInputElement | null;
          const raw = input?.value ?? "";
          // Clear the node's value BEFORE anything else so the raw key never
          // lingers in the DOM, even if a later call throws.
          if (input !== null) input.value = "";

          // An empty submit stores nothing and simply closes the field; we
          // never record a mirror or emit a confirmation for a non-key.
          if (raw.length === 0) {
            onClose();
            return;
          }

          // The ONLY place the raw value goes: the in-memory ref.
          api.setKey(raw);
          // The only things that escape: the last-4 mirror + the confirmation.
          onKeySet({ keySet: true, last4: lastFour(raw) });
          onConfirm(SOUL_KEY_SET_CONFIRMATION);
          onClose();
        }}
      >
        <label htmlFor="crt-soul-key" className="crt-sr-only">
          OpenRouter key
        </label>
        <span aria-hidden="true" className="crt-prompt">
          KEY&gt;
        </span>
        <input
          ref={ref}
          id="crt-soul-key"
          name="crt-soul-key"
          type="password"
          aria-label="OpenRouter key"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
        />
      </form>
    );
  },
);
