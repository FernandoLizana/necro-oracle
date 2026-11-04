"use client";

// src/components/CommandLine.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The Command_Line: a form carrying a visually-hidden label, the aria-hidden
// `NECRO>` prompt and the single text input. Enter submits through the form's
// `onSubmit`; the per-key behaviour (history, Ctrl+L, Ctrl+C, Escape, Tab) is
// owned by the injected `onKeyDown`. The input is uncontrolled — the Terminal
// sets its value through the forwarded ref — so typing, history restore and the
// SUMMON prefill all go through the DOM node directly.
//
// _Requirements: R3.1, R3.7, R15.2, R15.4_

import { forwardRef } from "react";

/** Props for the Command_Line. */
export interface CommandLineProps {
  /** Submit the current input value (Enter). */
  readonly onSubmit: (raw: string) => void;
  /** Per-key handler (history, Ctrl+L, Ctrl+C, Escape). */
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** The Command_Line input row. */
export const CommandLine = forwardRef<HTMLInputElement, CommandLineProps>(
  function CommandLine({ onSubmit, onKeyDown }, ref): React.JSX.Element {
    return (
      <form
        className="crt-input"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem(
            "crt-cmd",
          ) as HTMLInputElement | null;
          const raw = input?.value ?? "";
          if (input !== null) input.value = "";
          onSubmit(raw);
        }}
      >
        <label htmlFor="crt-cmd" className="crt-sr-only">
          Command
        </label>
        <span aria-hidden="true" className="crt-prompt">
          NECRO&gt;
        </span>
        <input
          ref={ref}
          id="crt-cmd"
          name="crt-cmd"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          onKeyDown={onKeyDown}
        />
      </form>
    );
  },
);
