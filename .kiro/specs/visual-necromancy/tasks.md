# Implementation Plan: Visual Necromancy

## Overview

This plan builds the Visual_Layer as an additive, reversible presentation layer over
the existing CRT terminal (`@necro/ui-crt`). It follows the design's hard split:
pure renderers and pure motion math land first with their property + example tests,
then the client hooks and presentational components that consume them, then the
session-reducer slices, then the Terminal wiring and `apps/web` composition, and
finally end-to-end, accessibility, bundle, and documentation checks.

All unit and property tests use the existing fake ports (`FakeFramePort`,
`FakeMediaPort`, fake sound loader) and a manual clock â€” no network, clock, DOM, or
real randomness in unit/property tests. Property tests run fast-check at â‰¥ 100
iterations and are named with their requirement IDs (e.g.
`describe("P8 (R6.5): rot preserves length and line count", â€¦)`). New pure modules
are barrelled through `packages/ui-crt/src/index.ts`; hooks stay `"use client"`.
`apps/web/src/app/layout.tsx` is never modified â€” the `#no-js-note` contract is only
verified, not changed.

## Tasks

- [x] 1. Boot frame renderer and schedule (pure)
  - [x] 1.1 Implement `render/boot.ts` Boot_Frame_Renderer
    - Add `packages/ui-crt/src/render/boot.ts`: `BOOT_STEP_COUNT`, `BootFrame`
      (`readonly lines: readonly OutputLine[]`), `bootFrame(stepIndex)`, and
      `BOOT_LOGO_TEXT_EQUIVALENT = "NECROMANTIC SYSTEMS 1986"`.
    - Frames progress: memory-check readout (`MEMORY 0640K â€¦ OK`, dry Oracle_Voice,
      one line per step), the ASCII logo, a phosphor warm-up line, ending at a ready
      frame. Every line â‰¤ 72 columns (matches `wrapText` `LINE_WIDTH`).
    - Any index â‰¥ the last step returns the ready frame; no clock/network/DOM/unseeded
      randomness.
    - Add `motion/boot-schedule.ts`: `BOOT_TOTAL_MS = 3400` and
      `bootStepAt(elapsedMs)` clamped to `0..BOOT_STEP_COUNT-1`, with
      `BOOT_STEP_COUNT * BOOT_STEP_MS â‰¤ 3500`.
    - Barrel both through `src/index.ts`.
    - _Requirements: 1.1, 2.1, 2.3_

  - [x] 1.2 Write property tests for boot frames
    - `render/boot.pbt.test.ts`.
    - **Property 1: Boot frame determinism** â€” `describe("P1 (R2.2, R2.3): boot frame determinism", â€¦)`: same index returns equal BootFrame; every line â‰¤ 72 columns.
    - **Property 2: Boot index total and saturating** â€” `describe("P2 (R2.4): boot index total and saturating", â€¦)`: any integer index (incl. negative and beyond last) returns a frame without throwing; index â‰¥ last returns the ready frame.
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [x] 1.3 Write unit tests for boot frames and schedule
    - Specific ready-frame contents; the real logo stays â‰¤ 72 columns;
      `bootStepAt(0) === 0`, `bootStepAt(BOOT_TOTAL_MS) === BOOT_STEP_COUNT-1`,
      total duration â‰¤ 3500 ms.
    - _Requirements: 1.1, 2.3, 2.4_

- [x] 2. ASCII card renderer and art table (pure)
  - [x] 2.1 Implement `render/ascii-card.ts` ASCII_Card_Renderer and Card_Back
    - Add `CARD_COLS = 24`, `CARD_ROWS = 13`, `AsciiCard` interface, and
      `asciiCard(cardId, orientation)` returning exactly `CARD_ROWS Ã— CARD_COLS`
      glyphs for both orientations.
    - Box-drawing border enclosing roman numeral row, uppercase name row(s),
      illustration block, thin divider; numerals/names/verdict words uppercase; no
      emoji. `accessibleText` naming card + numeral + orientation.
    - Pull numeral/name from `getCard(cardId)` (`@necro/oracle/client`). Unknown id
      raises a typed `NecroError` with `code: "CARD_UNKNOWN"` and an Oracle_Voice
      `userMessage` (`The deck holds no such card. (Unknown card id.)`).
    - Add `asciiCardBack()`: the same `CARD_COLS Ã— CARD_ROWS` box filled with a
      repeating sigil glyph, identical for every position.
    - Accept the loaded art table as an argument (stays pure/synchronous). No
      clock/network/DOM/unseeded randomness. Barrel through `src/index.ts`.
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.8, 3.10, 3.12, 4.3_

  - [x] 2.2 Implement `render/ascii-art.ts` per-CardId illustration table (lazy chunk)
    - Add `CardArt` (`upright`, optional `reversed`), `GENERIC_ART`, and `CARD_ART:
      Readonly<Record<CardId, CardArt>>` with bespoke motifs for the 12 registered
      CardIds (tower, death, devil, hermit, wheel, judgement, hanged_man, temperance,
      justice, moon, star, world), each sized to the frame's inner block.
    - Add a small loader that dynamically `import("./ascii-art.js")` so the table
      ships in its own chunk, outside the first terminal render; CardIds lacking a
      bespoke entry use `GENERIC_ART`.
    - _Requirements: 3.11, 3.12, 11.4_

  - [x] 2.3 Write property tests for ASCII cards
    - `render/ascii-card.pbt.test.ts` (generators draw from `CardIdSchema` members and from arbitrary non-member strings).
    - **Property 3: ASCII card determinism** â€” `describe("P3 (R3.9): ascii card determinism", â€¦)`: same id + orientation returns equal card.
    - **Property 4: ASCII card frame-size invariance** â€” `describe("P4 (R3.3, R3.12): ascii card frame-size invariance", â€¦)`: every card in both orientations is exactly `CARD_ROWS` rows Ã— `CARD_COLS` columns.
    - **Property 5: ASCII card set is complete and closed** â€” `describe("P5 (R3.2, R3.10): ascii card set complete and closed", â€¦)`: every Deck_Card_Set member renders; any non-member throws a typed `NecroError`.
    - **Validates: Requirements 3.2, 3.3, 3.9, 3.10, 3.12**

  - [x] 2.4 Write unit tests for art motifs and error
    - Each of the 12 bespoke motifs renders a non-generic illustration; reversed art
      differs from upright; `asciiCard` on an unknown id throws with
      `code: "CARD_UNKNOWN"`; Card_Back is identical across positions.
    - _Requirements: 3.11, 3.10, 4.3_

- [x] 3. Severity glitch profile (pure)
  - [x] 3.1 Implement `motion/glitch.ts` Glitch_Profile
    - Add `GlitchParams` (`intensity: 0|1|2|3`, `offsetPx`, `tearCount`,
      `corruptChars`, `durationMs`) and `glitchProfile(severity)`.
    - Clamp severity to `0..3`; map to bounded values (`offsetPx = severity*2`,
      `tearCount = severity`, `corruptChars = severity*3`,
      `durationMs = min(300, severity*90)`). Severity 0 â‡’ all-zero params; each field
      non-decreasing in severity; `intensity === severity`. No
      clock/network/DOM/unseeded randomness. `durationMs â‰¤ 300` enforces Flash_Limit.
    - Barrel through `src/index.ts`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.2 Write property tests for glitch profile
    - `motion/glitch.pbt.test.ts`.
    - **Property 6: Glitch profile determinism and severity mapping** â€” `describe("P6 (R5.2, R5.6): glitch profile determinism and severity mapping", â€¦)`: equal, finite, bounded params across two calls; `intensity === severity`.
    - **Property 7: Glitch monotonicity and severity-0 emptiness** â€” `describe("P7 (R5.3, R5.4): glitch monotonicity and severity-0 emptiness", â€¦)`: every param non-decreasing with severity; severity 0 â‡’ all zero.
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.6**

  - [x] 3.3 Write unit tests for glitch profile bounds
    - `glitchProfile(0)` all zeros; `glitchProfile(3).durationMs â‰¤ 300`; out-of-range
      severity clamps.
    - _Requirements: 5.3, 5.5_

- [~] 4. Checkpoint - Ensure all tests pass
  - Ensure all pure-renderer and glitch tests pass, ask the user if questions arise.

- [x] 5. Rot transform and decay sequence (pure)
  - [x] 5.1 Implement `render/rot.ts` Rot_Transform
    - Add `rot(source, decay, seed)`: clamp decay to `[0,1]`; `decay === 0` returns
      source unchanged; replace glyphs only at existing non-newline positions so line
      count and total length are preserved for every decay (incl. 1); corrupted-count
      non-decreasing in decay via a seeded deterministic permutation of non-newline
      positions (lower-decay set âŠ† higher-decay set); deterministic given
      `(source, decay, seed)`; seed is the only randomness source. No
      clock/network/DOM/unseeded randomness. Barrel through `src/index.ts`.
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.12_

  - [x] 5.2 Implement `motion/decay.ts` Decay_Sequence
    - Add `decaySequence(frameCount)` returning non-decreasing amounts, first 0, last
      1 (e.g. `[0, .25, .5, .75, 1]`). Barrel through `src/index.ts`.
    - _Requirements: 6.3_

  - [x] 5.3 Write property tests for rot
    - `render/rot.pbt.test.ts`.
    - **Property 8: Rot preserves length and line count** â€” `describe("P8 (R6.5): rot preserves length and line count", â€¦)`.
    - **Property 9: Rot determinism and decay-0 identity** â€” `describe("P9 (R6.4, R6.8): rot determinism and decay-0 identity", â€¦)`.
    - **Property 10: Rot corruption count is monotonic in decay** â€” `describe("P10 (R6.6): rot corruption count monotonic in decay", â€¦)`.
    - **Property 11: Rot clamps out-of-range decay** â€” `describe("P11 (R6.12): rot clamps out-of-range decay", â€¦)`.
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.8, 6.12**

  - [x] 5.4 Write unit tests for decay sequence
    - `decaySequence` first 0, last 1, non-decreasing for several frame counts.
    - _Requirements: 6.3_

- [x] 6. Card-reveal schedule (pure)
  - [x] 6.1 Implement `motion/card-reveal.ts` reveal schedule
    - Add `CardRevealStep` (`positionIndex`, `flipStartMs`, `flipDoneMs`) and
      `cardRevealSchedule(positions)`: one step per position in input order
      (`positionIndex` increasing by 1 from 0), card *n* flips only after card *nâˆ’1*'s
      flip plus its full typewriter reveal (`revealDurationMs(diagnosisLength,
      "full")`); non-decreasing flip offsets; `[]` for empty spread. Barrel through
      `src/index.ts`.
    - _Requirements: 4.1, 4.6, 4.8_

  - [x] 6.2 Write property test for reveal schedule
    - `motion/card-reveal.pbt.test.ts`.
    - **Property 13: Reveal schedule preserves spread order and shape** â€” `describe("P13 (R4.1, R4.6, R4.8): reveal schedule preserves order and shape", â€¦)`: one step per position in order, `positionIndex` strictly increasing by 1 from 0, non-decreasing flip offsets, `[]` for empty spread.
    - **Validates: Requirements 4.1, 4.6, 4.8**

- [x] 7. Session reducer and state extensions (pure)
  - [x] 7.1 Add BootState and CardRevealState slices to session state
    - Extend `SessionState` with `readonly boot: BootState` (`phase`, `startedAtMs`,
      `stepIndex`, `seen`) and `readonly cardReveal: CardRevealState` (`schedule`,
      `flippedCount`). `initialState()` seeds `boot: { phase:"playing",
      startedAtMs:null, stepIndex:0, seen:false }` and `cardReveal: { schedule:[],
      flippedCount:0 }`. No change to `StoragePort`'s two-key restriction (boot-seen
      is session memory, not persisted).
    - _Requirements: 1.5, 4.1_

  - [x] 7.2 Add boot and reveal actions to the reducer
    - Extend the `boot` action with a `bootSignal: boolean` field; add `boot.tick
      {nowMs}` (advance step via `bootStepAt`, transition `phase` to `"done"` at the
      last step) and `boot.skip` (set `phase:"done"`). On the `boot` action, downgrade
      to `phase:"done"` when `bootSignal` is true or motion is reduced, and always
      append `BOOT_PHRASE` as the first Output_Block regardless of `bootPhase`.
    - On `api.read`, seed the card-reveal schedule (`cardRevealSchedule`) in full
      motion; in reduced motion seed no queue (all cards face-up, full text, one
      render). Extend the existing `skip-reveal` action to also mark every card
      flipped and every diagnosis fully revealed. Keep `renderReading`'s one-block-
      per-position ordering; the reveal slice controls only visibility timing.
    - _Requirements: 1.2, 1.5, 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 12.5_

  - [x] 7.3 Write unit tests for reducer slices
    - `boot` with `bootSignal`/reduced â‡’ `phase:"done"` and boot phrase first block;
      `boot.tick` advances to `done` at last step; `boot.skip` â‡’ `done`; `seen` set
      once and not replayed; `api.read` seeds schedule in full motion, none in
      reduced; extended `skip-reveal` reaches final state; empty spread â‡’ empty
      schedule, no error.
    - _Requirements: 1.5, 4.4, 4.5, 4.8, 12.5_

- [~] 8. Checkpoint - Ensure all tests pass
  - Ensure all pure-module and reducer tests pass, ask the user if questions arise.

- [x] 9. Boot hook and overlay (client)
  - [x] 9.1 Implement `hooks/use-boot.ts`
    - `"use client"`. Mirror `use-reveal`: request `FramePort` frames only while
      `motionMode === "full"` && `bootPhase === "playing"`; each tick dispatches
      `{ type: "boot.tick", nowMs }`; request no frame in reduced motion, under
      `bootSignal`, or once done. A non-modifier key or control activation dispatches
      `{ type: "boot.skip" }` and focuses the Command_Line; filter lone
      Shift/Control/Alt/Meta. If `FramePort` is unavailable, force `bootPhase:"done"`.
    - _Requirements: 1.3, 1.5, 1.6, 1.9_

  - [x] 9.2 Implement `components/BootOverlay.tsx`
    - `"use client"`, presentational. Render the current `BootFrame` as selectable
      DOM text (never canvas) positioned over the screen; render nothing when
      `bootPhase !== "playing"`. Show the persistent skip hint `Press any key to skip
      the awakening.` while playing. ASCII logo region `aria-hidden="true"` with a
      sibling `crt-sr-only` span carrying `BOOT_LOGO_TEXT_EQUIVALENT`. The overlay
      never touches, moves, re-parents, or hides `#no-js-note`.
    - _Requirements: 1.1, 1.4, 1.7, 1.8, 10.2, 10.4_

  - [x] 9.3 Write component tests for boot (fake ports, manual clock)
    - Boot plays only in full motion and requests no frames in reduced or under
      `bootSignal`; the boot phrase is the first Output_Block in all cases; any
      non-modifier key dispatches `boot.skip` and focuses the Command_Line; lone
      modifier keys do not skip; overlay renders nothing when done.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.9_

- [x] 10. ASCII card view (client)
  - [x] 10.1 Implement `components/AsciiCardView.tsx`
    - `"use client"`, presentational. Render `AsciiCard.rows` inside a
      `<pre aria-hidden="true">` with a sibling `<span class="crt-sr-only">
      {card.accessibleText}</span>` (card name + numeral + orientation). Apply
      `data-orientation` so CSS rotates reversed cards 180Â° and counter-rotates the
      upright text overlay (numeral/name/subtitle stay upright). Selectable DOM text,
      never canvas. Read `GlitchParams` and apply the glitch class/attributes only in
      full motion; set `data-burning` only for `tower`/`devil`; add the tower shake
      class only at severity â‰¥ 2 in full motion; apply no glitch in reduced motion.
    - _Requirements: 3.4, 3.6, 3.7, 5.1, 5.7, 5.8, 5.9, 5.10, 5.12, 10.2_

  - [x] 10.2 Write component tests for ASCII card view
    - Reversed sets `data-orientation` and keeps text upright; aria-hidden glyphs +
      sr-only equivalent present; glitch class/attributes reflect `glitchProfile`;
      amber only on tower/devil; tower shake only at severity â‰¥ 2 in full motion; no
      glitch in reduced motion; severity integer still shown in the header.
    - _Requirements: 3.4, 3.7, 5.7, 5.8, 5.9, 5.10, 5.12_

- [x] 11. Rot reveal playback (client)
  - [x] 11.1 Implement `components/RotReveal.tsx` and rot playback hook
    - `"use client"`. Reuse the `FramePort` tick pattern from `use-reveal` to step the
      Decay_Sequence in full motion: render `rot(preRitualCode, decaySequence[i],
      seed)` per frame up to decay 1, then reveal the revived code, then render the
      unchanged diff (`renderFileResult` / `ResurrectDiffLine`) and the
      Vitality_Delta (`renderResurrectVitality`) â€” never altering diff content or
      vitality delta. In reduced motion render revived code + diff + vitality delta in
      one synchronous render with zero rot/rebirth frames. Revived code, diff, and
      vitality delta are selectable DOM text appended to the existing `role="log"`
      region. Cap rot frame cadence so luminance changes stay â‰¤ 2/sec (Flash_Limit).
    - _Requirements: 6.1, 6.2, 6.3, 6.9, 6.10, 6.11_

  - [x] 11.2 Write component tests for rot reveal
    - Full motion plays rot frames then renders unchanged diff + vitality delta;
      reduced motion renders once with no rot frames; revived code/diff/vitality are
      selectable and appended to the log once.
    - _Requirements: 6.1, 6.2, 6.9, 6.10_

- [~] 12. Checkpoint - Ensure all tests pass
  - Ensure all hook and component tests pass, ask the user if questions arise.

- [x] 13. Demo determinism seeding
  - [x] 13.1 Add DEMO_SEED and seed glitch + rot in demo mode
    - Export `DEMO_SEED = 0x6e6563` from `src/demo/catalog.ts`. In demo mode (reducer
      reads `state.demoBundle !== null` and `summary.demo`) use `DEMO_SEED` for the
      glitch corruption seed and the rot seed so glitch params and rot outputs are
      reproducible across two renders of the same demo reading; boot frames,
      card-reveal order, and resurrection-frame content derive solely from the Reading,
      resurrection result, and `DEMO_SEED`. No new network access. Under `bootSignal`
      the boot fast-forwards but seeding stays `DEMO_SEED`; a demo run without the
      signal plays the full deterministic boot and animations.
    - _Requirements: 9.1, 9.3, 9.4, 12.5_

  - [x] 13.2 Write property test for demo reproducibility
    - `demo/visual-demo.pbt.test.ts`.
    - **Property 12: Demo reproducibility given Demo_Seed** â€” `describe("P12 (R9.2): demo reproducibility given Demo_Seed", â€¦)`: deriving glitch params and rot outputs with `DEMO_SEED` twice yields the same glitch-parameter sequence and the same rot outputs.
    - **Validates: Requirements 9.2**

- [x] 14. CSS keyframes, tokens, and phosphor palette
  - [x] 14.1 Add glitch/flip/rot keyframes and tokens to `crt.css` and `tokens.ts`
    - Add new tokens in `tokens.ts` and mirror them in the single `crt.css`: glitch
      (chromatic offset via duplicated `Â±offsetPx` text-shadow layers, `tearCount`
      clip-path slices, transient seeded corruption that never changes selectable
      text), flip, rot, tower shake, and reversed 180Â° rotation with counter-rotated
      text overlay. Keep the tarot-ux palette (foreground `#33ff66`, background
      `#001a00`, dim `#1f9e45`); amber `#ffb000` only for `tower`/`devil` via
      `data-burning`; error red `#ff3355` only for STILL DEAD. VT323 for display,
      IBM Plex Mono for evidence. Reduced motion disables pulsing glow, flicker, and
      afterglow. All glitch animations use `animation-iteration-count: 1` and the rot
      cadence stays â‰¤ 2 luminance changes/sec; document the Flash_Limit caps inline in
      `crt.css`. No new palette values.
    - _Requirements: 5.7, 5.8, 5.9, 5.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.3_

- [x] 15. Core sound cues
  - [x] 15.1 Wire the four core sound cues through existing sound machinery
    - Reuse the lazy `SoundEngine` / `useSound` / `soundReducer`. Dispatch an existing
      `{ type: "sound", event }` for boot completion, card reveal, glitch, and
      resurrection rebirth only when `soundActivity(state.sound)` resolves sound to
      on. Honour off-by-default, never before the user gesture, never autoplay, silent
      while off; sound and motion are independent (cues may fire in reduced motion if
      sound is on). No new dependency; engine stays in its own lazy chunk.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 15.2 Write unit tests for sound cues
    - Cues fire only when sound resolves on; silent while off; none before gesture; no
      autoplay; cues may fire in reduced motion when sound is on.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 16. Integration and wiring
  - [x] 16.1 Wire overlays and slices into Terminal and extend useTerminal
    - Extend `hooks/use-terminal.ts` wiring to drive `use-boot`, the reused
      `use-reveal` for the card-reveal slice, and the rot playback. Render
      `BootOverlay`, `AsciiCardView`, and `RotReveal` from `components/Terminal.tsx`
      over the already-mounted `main.crt`. Keep `Terminal.tsx` setting
      `document.documentElement.dataset.js = "ready"` unconditionally and immediately
      in its mount effect (never deferred by boot). Keep `OutputLog` `role="log"`,
      `aria-live="polite"`, `aria-relevant="additions"` unchanged. Ensure every new
      pure module and component is barrelled through `src/index.ts`.
    - `read` output: each drawn CardDraw renders through `AsciiCardView` â€” starting as
      the shared `Card_Back`, flipping to its `AsciiCard`, then typewriting its
      diagnosis via the reused `useReveal`, with `glitchProfile(severity)` applied to
      the card in full motion.
    - `resurrect` output: `RotReveal` plays the rot-then-rebirth animation first, and
      only after it completes does the unchanged diff (`renderFileResult`) and the
      Vitality_Delta (`renderResurrectVitality`) render.
    - First load: `BootOverlay` mounts over the already-mounted `main.crt` on first
      page load (boot phrase still the first Output_Block, `data-js="ready"` still set
      immediately and unconditionally).
    - _Requirements: 1.2, 1.9, 4.2, 4.7, 6.1, 10.1, 10.4, 12.1, 12.2, 12.4_

  - [x] 16.2 Read `?boot=skip` in apps/web and pass bootSignal
    - In `apps/web` (`browser-ports.ts` / `TerminalScreen.tsx`) read a `?boot=skip`
      query flag (also set by the Playwright runner) into `bootSignal: boolean` on the
      `boot` action. Do not modify `apps/web/src/app/layout.tsx`. A demo run without
      `?boot=skip` still plays the full deterministic boot.
    - _Requirements: 12.5, 10.7, 10.4_

  - [x] 16.3 Write integration tests for Terminal wiring
    - Boot phrase is the first Output_Block and `data-js="ready"` is set immediately in
      all paths; card reveal flips in order and typewriters each diagnosis; Escape
      completes all; reduced motion renders all cards face-up in one render;
      Live_Region receives each card once; empty spread renders nothing; `motion`
      command switch updates effects live.
    - _Requirements: 4.1, 4.2, 4.5, 4.7, 10.1, 10.4, 12.1, 12.4_

- [~] 17. Checkpoint - Ensure all tests pass
  - Ensure integration tests pass, ask the user if questions arise.

- [x] 18. End-to-end, accessibility, and regression
  - [x] 18.1 Write `apps/web/e2e/visual-necromancy.e2e.ts` (Playwright + axe)
    - In full motion (no `?boot=skip`): boot overlay appears and resolves to the ready
      prompt within budget; a demo reading reveals cards one-by-one; severe cards
      glitch; a resurrection plays rot-then-rebirth. With `?boot=skip` (and the
      Playwright env signal) and/or reduced motion: all animations skip to their final
      state instantly. `axe` finds no new violations on boot, cards, reveal, glitch,
      and resurrection states. Assert glitch/rot animations use
      `iteration-count: 1` and durations within the documented Flash_Limit caps.
    - Assert in a real browser that the three drawn cards of a demo reading are present
      in the DOM as framed ASCII cards (box-drawing border glyphs visible in the
      rendered card elements), not plain text.
    - Assert in a real browser that a severe card (e.g. THE TOWER) carries the glitch
      class / `data-burning` attribute on its card element in full motion.
    - Assert in a real browser that during `resurrect` a rot phase is observable in the
      DOM before the diff renders (a rot frame / decay state precedes the
      `renderFileResult` diff block).
    - Update the Playwright config and the existing e2e specs so they navigate with
      `?boot=skip` (and the Playwright env boot signal) so no existing spec waits for
      the boot sequence; the new visual spec is the only one that exercises the
      full-motion boot (by navigating WITHOUT `?boot=skip`). `playwright.config.ts` /
      the e2e support helper (`apps/web/e2e/support/terminal.ts`) is updated for the
      shared `?boot=skip` navigation, and `apps/web/src/app/layout.tsx` is still not
      modified.
    - _Requirements: 1.1, 3.1, 3.6, 4.1, 5.1, 6.1, 10.3, 10.5, 12.5_

  - [x] 18.2 Verify existing boot and no-JS e2e specs stay green
    - Run the existing `boot.e2e.ts` "boot" and "no JavaScript (R1.5)" specs plus the
      current unit/property/e2e suites; confirm the `bootSignal` path and the unchanged
      `layout.tsx` keep them passing. Fix any regression in Visual_Layer code (not in
      `layout.tsx`).
    - _Requirements: 10.7, 12.3_

- [x] 19. Bundle budget check
  - [x] 19.1 Verify terminal route stays within the 250 KB gzipped Bundle_Budget
    - Confirm the ASCII art table and sound engine load in their own lazy chunks
      outside the first terminal render; run the CI bundle check on the terminal route
      and assert it stays â‰¤ 250 KB gzipped with the Visual_Layer added. The budget is
      not raised.
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 20. Documentation
  - [x] 20.1 Update docs for new renderers, components, and Kiro usage
    - Update `docs/DECK.md` and `docs/ARCHITECTURE.md` for the new public renderers
      (`boot`, `ascii-card`, `ascii-art`, `rot`), motion math, components, and the boot
      overlay / card reveal / glitch / rot behavior. Append a dated entry to
      `docs/KIRO_USAGE.md` noting the spec-driven PBT workflow used for this feature.
    - _Requirements: 12.2_

## Optional polish (Requirement 13)

Each optional task below MUST be dropped rather than shipped if it breaks the
Bundle_Budget (250 KB gzipped), the Flash_Limit (â‰¤ 3 flashes/sec), or the axe scan.

- [x] 21. (Optional) Extra polish flourishes
  - [x] 21.1 (Optional) Ambient resurrection hum
    - A low continuous hum during the Resurrection_Animation, gated behind full motion
      and Sound_State (gesture-gated, default-off). Drop if it breaks Bundle_Budget,
      Flash_Limit, or axe.
    - _Requirements: 13.1, 13.4_

  - [x] 21.2 (Optional) Severity-3 phosphor bloom
    - A brief phosphor bloom when a severity-3 card is revealed in full motion, staying
      within the Flash_Limit. Drop if it breaks Bundle_Budget, Flash_Limit, or axe.
    - _Requirements: 13.2, 13.4_

  - [x] 21.3 (Optional) Animated vitality-delta counter
    - Animate the vitality delta counting up or down to its final value in full motion;
      show the final value immediately in reduced motion. Drop if it breaks
      Bundle_Budget, Flash_Limit, or axe.
    - _Requirements: 13.3, 13.4_

  - [x] 21.4 (Optional) Distinct reversed-art variants and extra sound cues
    - Provide orientation-specific `reversed` art variants beyond the CSS 180Â° flip for
      cards where it improves recognisability, and any extra sound cues beyond the core
      four, each gated by Sound_State. Drop if it breaks Bundle_Budget, Flash_Limit, or
      axe.
    - _Requirements: 3.12, 8.1, 13.4_

- [x] 22. (Optional) Demo-mode screenshot capture for README and Devpost
  - [x] 22.1 (Optional) Capture marketing screenshots in demo mode
    - Add a Playwright script (e.g. `apps/web/e2e/screenshots.e2e.ts` or a `scripts/`
      capture script) that runs in DEMO mode in full motion and writes PNG screenshots
      into `docs/screenshots/`: (1) the boot logo frame (`NECROMANTIC SYSTEMS 1986`),
      (2) a full 3-card reading showing the framed ASCII cards, (3) a THE TOWER glitch
      frame, and (4) the resurrection diff after rot-and-rebirth. Deterministic via
      `DEMO_SEED`; no network. These images feed the README and the Devpost write-up.
      This task is for capturing assets only â€” it adds no production code and must not
      alter the Visual_Layer. Drop or skip if it is not needed for submission.
    - _Requirements: 9.1, 9.3_

- [x] 23. Visual review fixes
  - [x] 23.1 Lay the spread out horizontally (CardReveal layout)
    - Render the drawn ASCII cards side by side, not stacked in one column: the
      `.crt-card-reveal` container lays its `.crt-card-slot` children in a
      horizontal row (flexbox/grid), each card 24 monospace cols wide, so a 3-card
      fates spread reads left-to-right (~72 cols). Wrap/stack to a single column
      only on narrow viewports (a `max-width` media query). CSS-only in `crt.css`;
      the slot order stays the Reading's spread order (no reorder/omit). Keep the
      layer `aria-hidden`, the log authoritative (design D1). No new palette values.
    - _Requirements: 4.6, 12.1, 12.2, 10.3_

  - [x] 23.2 Show the position label and orientation in the card footer
    - The ASCII card's bottom panel is an empty `framed("")` row
      (`render/ascii-card.ts` row 11). Render the spread position label and the
      orientation (UPRIGHT/REVERSED) in that footer. Thread the label from
      `VisualCard.label` through `CardReveal` -> `AsciiCardView` ->
      `asciiCard(cardId, orientation, art, footerLabel?)`. Footer text uppercased,
      fits `INNER_COLS` (22, truncate/pad), no emoji; frame stays exactly
      `CARD_ROWS x CARD_COLS`. Update ascii-card unit/property + art tests.
    - _Requirements: 3.1, 3.3, 3.12, 4.6_

  - [x] 23.3 Make the boot ASCII logo render and have the screenshot wait for it
    - Ensure the boot logo frame (`NECROMANTIC SYSTEMS 1986` big ASCII) is reachable
      and visible during the Boot_Sequence in full motion; hold it long enough to
      paint without breaking `BOOT_STEP_COUNT * BOOT_STEP_MS <= 3500`. Update the
      screenshot capture so shot (1) WAITS for the logo frame before capturing.
    - _Requirements: 1.1, 2.1, 2.3, 9.1, 9.3_

  - [x] 23.4 Apply the glitch only to severity > 0 and leave a clean resting state
    - Gate the `crt-glitch` class/attrs on `glitch.intensity > 0` (severity 0 => no
      glitch). Make the chromatic offset part of the ONE-SHOT animation, not a
      static resting `text-shadow`, so every card's resting state is clean,
      single-image, readable. Preserve Flash_Limit and reduced-motion suppression.
      Update AsciiCardView tests (sev 0 => no glitch; sev > 0 => glitch; clean rest).
    - _Requirements: 5.1, 5.3, 5.7, 5.11, 10.3_

  - [x] 23.5 Style DOWNLOAD PATCH as a CRT phosphor button and capture the diff
    - Style `.crt-patch-download` in `crt.css` to match the command buttons
      (transparent bg, `--crt-fg-dim` border, phosphor text, hover/pressed parity),
      keyboard-accessible and axe-clean. Fix screenshot shot (4) so it shows the
      per-file diff block (`FILE ...` / `-`/`+` lines) and the styled button.
    - _Requirements: 7.3, 8.1, 10.2, 10.3, 12.2_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all tasks
  under section 21 are additionally gated by Requirement 13's drop-if-it-breaks rule.
- Pure modules (sections 1â€“6) land first with their property + unit tests, then the
  reducer slices (7), then hooks/components (9â€“11), then CSS/sound/demo seeding
  (13â€“15), then Terminal and apps/web wiring (16), then e2e/axe/bundle/docs (18â€“20).
- Each task references specific requirement sub-clauses; property tasks reference the
  design's Property IDs (P1â€“P13) and are named with requirement IDs in `describe`.
- Unit and property tests use `FakeFramePort`, `FakeMediaPort`, the fake sound loader,
  and a manual clock â€” no network, clock, DOM, or real randomness.
- Determinism (`DEMO_SEED`), Flash_Limit (`iteration-count: 1`, â‰¤ 2 luminance
  changes/sec for rot), and the 250 KB gzipped Bundle_Budget are called out in their
  relevant tasks.
- `apps/web/src/app/layout.tsx` and the `#no-js-note` contract are only verified,
  never modified.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "3.3", "5.2", "5.3", "5.4", "6.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "7.1"] },
    { "id": 3, "tasks": ["7.2"] },
    { "id": 4, "tasks": ["7.3", "9.1", "10.1", "11.1", "14.1"] },
    { "id": 5, "tasks": ["9.2", "9.3", "10.2", "11.2", "13.1", "15.1"] },
    { "id": 6, "tasks": ["13.2", "15.2", "16.1"] },
    { "id": 7, "tasks": ["16.2", "16.3"] },
    { "id": 8, "tasks": ["18.1", "18.2", "19.1", "20.1"] },
    { "id": 9, "tasks": ["21.1", "21.2", "21.3", "21.4", "22.1"] }
  ]
}
```
