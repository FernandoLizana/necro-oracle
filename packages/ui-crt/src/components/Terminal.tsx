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

import { useCallback, useEffect, useState } from "react";

import type { TerminalPorts } from "../ports.js";
import { useTerminal } from "../hooks/use-terminal.js";
import { BOOT_PHRASE } from "../voice/phrases.js";
import { loadCardArt } from "../render/load-card-art.js";
import type { CardArtTable } from "../render/ascii-card.js";
import { visualCards } from "../session/visual-reading.js";
import { Screen } from "./Screen.js";
import { OutputLog } from "./OutputLog.js";
import { CommandLine } from "./CommandLine.js";
import { ButtonRow } from "./ButtonRow.js";
import { BootOverlay } from "./BootOverlay.js";
import { CardReveal } from "./CardReveal.js";
import { RotOverlay } from "./RotOverlay.js";
import { VitalityCounter } from "./VitalityCounter.js";

/** The accessible name of the terminal and its document title. */
const TERMINAL_LABEL = "Necro-Oracle CRT terminal";
const DOCUMENT_TITLE = "Necro-Oracle terminal";

/** Props for the Terminal. */
export interface TerminalProps {
  /** Every side effect the terminal reaches is injected through these ports. */
  readonly ports: TerminalPorts;
  /**
   * The external Boot_Skip signal, forwarded to the one-time `boot` action.
   * When `true`, the Boot_Sequence starts already settled to `phase: "done"`
   * (no overlay, no frames) while the BOOT_PHRASE still leads the log (R1.5,
   * R12.5). The host app reads the `?boot=skip` query flag into this prop
   * (visual-necromancy task 16.2); omitted / `false` plays the full boot.
   */
  readonly bootSignal?: boolean;
}

/** The live CRT terminal, constructed with a full set of ports. */
export function Terminal({ ports, bootSignal }: TerminalProps): React.JSX.Element {
  // The live rot-then-rebirth playing state, reported up by `RotOverlay` (the
  // single `useRot` owner). It feeds the ambient Resurrection_Animation hum
  // gate inside `useTerminal` so the low drone hums only while the animation is
  // actively playing (visual-necromancy task 21.1, OPTIONAL polish, R13.1).
  const [resurrectionPlaying, setResurrectionPlaying] = useState(false);
  const terminal = useTerminal(ports, { bootSignal, resurrectionPlaying });
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
    bootFrameForRender,
    bootFrameKindForRender,
    visualSeed,
  } = terminal;

  // The DOWNLOAD PATCH affordance is shown only once a resurrection Ritual has
  // resolved with a non-empty patch (R7.3, R7.4): the diff/vitality blocks
  // already render in the log; this control offers the inline patch as a
  // client-side download with no server round-trip.
  const hasPatch =
    state.lastRitual !== null && state.lastRitual.patch.length > 0;

  // The per-CardId illustration table ships in its own lazy chunk, fetched
  // once after mount so it stays outside the first terminal render (R11.4).
  // Until it resolves, `CardReveal` falls back to the generic motif. A loaded
  // table never blocks the first paint and never changes the log text (D1).
  const [cardArt, setCardArt] = useState<CardArtTable>({});
  useEffect(() => {
    let cancelled = false;
    void loadCardArt()
      .then((loaded) => {
        if (!cancelled) setCardArt(loaded.table);
      })
      .catch(() => {
        // The generic motif is a complete fallback; a failed art chunk never
        // breaks the reading — the log already carries the card text (D1).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The drawn cards of the current reading, in the Reading's exact order. The
  // decorative card overlay draws these over the terminal; the authoritative
  // card text stays in the log (design D1, R4.6, R12.2).
  const cards = visualCards(state);

  // A settled resurrection: the decorative rot-then-rebirth overlay plays over
  // the terminal while the diff / Vitality_Delta live in the log (R6.1, R6.10).
  const ritual = state.lastRitual;

  // Stable callback the `RotOverlay` reports its rot-playing state through, so
  // the ambient hum gate follows the overlay's single `useRot` (task 21.1).
  const onRotPlayingChange = useCallback((playing: boolean) => {
    setResurrectionPlaying(playing);
  }, []);

  // The component owns the document shell attributes in environments where the
  // framework layout has not already set them (R15.12). It also flags that the
  // client has mounted (`data-js="ready"`), which lets the CSS hide the static
  // no-JS fallback note (R1.5) now that the live terminal is present — a plain
  // DOM property write, no inline script, so it is CSP-safe (R14.9).
  //
  // The Boot_Sequence NEVER defers this write: `data-js="ready"` is set
  // unconditionally and immediately in this mount effect, exactly as before, so
  // the `#no-js-note` is hidden the moment the client mounts regardless of boot
  // state (visual-necromancy D1, R10.4). The boot plays as an overlay over the
  // already-mounted terminal; it does not gate, delay, or replace this effect.
  useEffect(() => {
    document.documentElement.lang = "en";
    document.documentElement.dataset.js = "ready";
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
        {/* The one-time Boot_Sequence overlay, drawn over the already-mounted
            terminal. It renders nothing once the boot phase settles to "done"
            (reduced motion / bootSignal / skipped / completed), so the ready
            terminal carries no leftover overlay (R1.1, R1.7, R10.4). */}
        <BootOverlay
          frame={bootFrameForRender}
          bootPhase={state.boot.phase}
          frameKind={bootFrameKindForRender}
        />
        <OutputLog
          ref={logRef}
          blocks={state.log}
          ariaBusy={ariaBusy}
          revealedCountFor={revealedCountFor}
          engineFailed={engineFailed}
        />
        {/* Decorative card layer: one framed ASCII card per drawn position, in
            the Reading's order, Card_Back → flip → AsciiCard with the severity
            glitch. aria-hidden — the log owns the announced card text (D1). */}
        <CardReveal
          cards={cards}
          flippedCount={state.cardReveal.flippedCount}
          motionMode={state.motionMode}
          art={cardArt}
        />
        {/* Decorative resurrection layer: the rot-then-rebirth animation plays
            over the terminal while the diff / Vitality_Delta stay in the log. */}
        {ritual !== null ? (
          <>
            <RotOverlay
              files={ritual.files}
              seed={visualSeed}
              motionMode={state.motionMode}
              frames={ports.frames}
              onPlayingChange={onRotPlayingChange}
            />
            {/* OPTIONAL decorative Vitality_Delta count-up (task 21.3). It
                counts before -> after alongside the rebirth. aria-hidden — the
                authoritative delta is announced once from the log (D1). */}
            <VitalityCounter
              beforeVitality={ritual.beforeVitality}
              afterVitality={ritual.afterVitality}
              motionMode={state.motionMode}
              frames={ports.frames}
            />
          </>
        ) : null}
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
