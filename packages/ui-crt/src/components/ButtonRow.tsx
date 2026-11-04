"use client";

// src/components/ButtonRow.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The clickable equivalents of the typed commands (R3.8): a labelled
// `role="group"` of native `<button>`s. Every button runs a command through
// `submit(..., "button")`, except SUMMON (which prefills `summon ` and focuses
// the input) and SOUND (a toggle that reports its pressed state through
// `aria-pressed` and counts as a user gesture). No button except SUMMON
// refocuses the input (R15.5).
//
// _Requirements: R3.8, R3.9, R3.10, R3.12, R15.2_

/** Props for the button row. */
export interface ButtonRowProps {
  /** Run a command from a button press. */
  readonly submit: (raw: string, source: "button") => void;
  /** Prefill `summon ` and focus the input (SUMMON). */
  readonly prefillSummon: () => void;
  /** Toggle sound (SOUND). */
  readonly toggleSound: () => void;
  /** Whether sound is currently on (drives SOUND's `aria-pressed`). */
  readonly soundOn: boolean;
}

/** The clickable command shortcuts. */
export function ButtonRow({
  submit,
  prefillSummon,
  toggleSound,
  soundOn,
}: ButtonRowProps): React.JSX.Element {
  return (
    <div role="group" aria-label="Command shortcuts" className="crt-buttons">
      <button type="button" onClick={() => submit("help", "button")}>
        HELP
      </button>
      <button type="button" onClick={prefillSummon}>
        SUMMON
      </button>
      <button type="button" onClick={() => submit("read", "button")}>
        READ
      </button>
      <button type="button" onClick={() => submit("demo", "button")}>
        DEMO
      </button>
      <button type="button" onClick={() => submit("clear", "button")}>
        CLEAR
      </button>
      <button type="button" onClick={() => submit("motion", "button")}>
        MOTION
      </button>
      <button
        type="button"
        aria-pressed={soundOn ? "true" : "false"}
        onClick={toggleSound}
      >
        SOUND
      </button>
    </div>
  );
}
