"use client";

// src/components/Terminal.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The live CRT terminal. It wires `useTerminal` to the injected ports and
// renders the exact DOM the design calls for: the `main.crt[data-motion]`
// landmark with its accessible name, the visually-hidden `<h1>`, the
// `.crt-screen` with the `role="log"` Live_Region, the Command_Line form, the
// clickable button row, the scanline/flicker layers, and the `<noscript>`
// fallback. Repository-derived text is rendered only as text nodes; the sole
// anchor is a built Evidence_Link (R14.1, R14.5).
//
// _Requirements: R1.1-R1.5, R3.1-R3.12, R9.*, R10.*, R14.1, R14.5, R15.*,
// R16.9, R17.4, R17.5, R19.*_

import { useEffect } from "react";

import type { TerminalPorts } from "../ports.js";
import { useTerminal } from "../hooks/use-terminal.js";
import { BOOT_PHRASE } from "../voice/phrases.js";
import { Screen } from "./Screen.js";
import { OutputLog } from "./OutputLog.js";
import { CommandLine } from "./CommandLine.js";
import { ButtonRow } from "./ButtonRow.js";

/** The accessible name of the terminal and its document title. */
const TERMINAL_LABEL = "Necro-Oracle CRT terminal";
const DOCUMENT_TITLE = "Necro-Oracle terminal";

/** Props for the Terminal. */
export interface TerminalProps {
  /** Every side effect the terminal reaches is injected through these ports. */
  readonly ports: TerminalPorts;
}

/** The live CRT terminal, constructed with a full set of ports. */
export function Terminal({ ports }: TerminalProps): React.JSX.Element {
  const terminal = useTerminal(ports);
  const {
    state,
    ariaBusy,
    rootRef,
    logRef,
    inputRef,
    submit,
    onInputKeyDown,
    prefillSummon,
    toggleSound,
    downloadPatch,
    revealedCountFor,
    engineFailed,
  } = terminal;

  // The DOWNLOAD PATCH affordance is shown only once a resurrection Ritual has
  // resolved with a non-empty patch (R7.3, R7.4): the diff/vitality blocks
  // already render in the log; this control offers the inline patch as a
  // client-side download with no server round-trip.
  const hasPatch =
    state.lastRitual !== null && state.lastRitual.patch.length > 0;

  // The component owns the document shell attributes in environments where the
  // framework layout has not already set them (R15.12).
  useEffect(() => {
    document.documentElement.lang = "en";
    document.title = DOCUMENT_TITLE;
  }, []);

  return (
    <main
      ref={rootRef as React.Ref<HTMLElement>}
      className="crt"
      data-motion={state.motionMode}
      aria-label={TERMINAL_LABEL}
    >
      <h1 className="crt-sr-only">Necro-Oracle terminal</h1>
      <Screen>
        <OutputLog
          ref={logRef}
          blocks={state.log}
          ariaBusy={ariaBusy}
          revealedCountFor={revealedCountFor}
          engineFailed={engineFailed}
        />
        <CommandLine
          ref={inputRef}
          onSubmit={(raw) => submit(raw, "enter")}
          onKeyDown={onInputKeyDown}
        />
        <ButtonRow
          submit={submit}
          prefillSummon={prefillSummon}
          toggleSound={toggleSound}
          soundOn={state.sound.preference === "on"}
        />
        {hasPatch ? (
          <button
            type="button"
            className="crt-patch-download"
            onClick={downloadPatch}
          >
            DOWNLOAD PATCH
          </button>
        ) : null}
      </Screen>
      <noscript>{`${BOOT_PHRASE} — The terminal requires JavaScript.`}</noscript>
    </main>
  );
}
