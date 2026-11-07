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
// lovers-binding (task 10.6): three additive chips for the new commands. They
// follow the EXISTING chip conventions exactly and leave every prior chip
// byte-identical:
//
//   - KEY   — dispatches `key set` through `submit`, NOT a raw argument-bearing
//             line. The reducer's `key set` path emits the `byok.open-key-input`
//             effect so the shell opens the MASKED input (lovers-binding task
//             10.1 note + D.2); the chip therefore never submits a key value.
//   - MODEL — a PREFILL affordance mirroring SUMMON: `model` needs a required
//             `<id>` argument, so the chip prefills `model ` and focuses the
//             input (via `prefillModel`) rather than one-shot submitting an
//             argument-less line. The user then types the tier + id.
//   - LOVERS — CONDITIONAL (R14.3): rendered ONLY while THE LOVERS (VI) was
//             drawn AND a resurrectable file is in scope (the host passes the
//             eligible file through `loversPrefill`). `lovers <file> js` needs a
//             `<file>` argument, so — like SUMMON — the chip PREFILLS
//             `lovers <file> ` and focuses the input, letting the user confirm /
//             edit before submitting. When not eligible the host omits
//             `loversPrefill` and the chip does not render at all.
//
// _Requirements: R3.8, R3.9, R3.10, R3.12, R15.2, R14.3_

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
  /**
   * Prefill `model ` and focus the input (MODEL), mirroring `prefillSummon`.
   * The chip renders whenever this is supplied; omitted leaves no MODEL chip.
   */
  readonly prefillModel?: () => void;
  /**
   * Prefill `lovers <file> ` and focus the input (LOVERS), mirroring
   * `prefillSummon`. Supplied by the host ONLY while THE LOVERS (VI) was drawn
   * AND a resurrectable file is in scope (R14.3) — so the LOVERS chip renders
   * exactly in the lovers-eligible state and is omitted otherwise.
   */
  readonly loversPrefill?: () => void;
}

/** The clickable command shortcuts. */
export function ButtonRow({
  submit,
  prefillSummon,
  toggleSound,
  soundOn,
  prefillModel,
  loversPrefill,
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
      {/* KEY: dispatches `key set`, which opens the MASKED input via the
          reducer's `byok.open-key-input` effect — never a raw key line. */}
      <button type="button" onClick={() => submit("key set", "button")}>
        KEY
      </button>
      {/* MODEL: prefill affordance (needs a required <id> arg), mirrors SUMMON. */}
      {prefillModel !== undefined ? (
        <button type="button" onClick={prefillModel}>
          MODEL
        </button>
      ) : null}
      {/* LOVERS: conditional (R14.3) prefill affordance; rendered only while
          THE LOVERS was drawn AND a resurrectable file is in scope. */}
      {loversPrefill !== undefined ? (
        <button type="button" onClick={loversPrefill}>
          LOVERS
        </button>
      ) : null}
    </div>
  );
}
