# Implementation Plan: Oracle_Landing_Polish

## Overview

This plan implements Oracle_Landing_Polish as one additive layer: Part A (the
DMG-styled Landing_State) and Part B (four grounded bugs/polish fixes). It is
sequenced test-first and bottom-up: pure core modules + their property tests
come first, then screen-only components and their style/a11y tests, then the
wiring into the existing `<Terminal>` shell, then the two Part B bug fixes
(Seer visibility, resurrection chunk split), then the oracle-voice error/empty
states, then end-to-end + screenshots, and finally the no-regression + budget
gate and docs. Every step builds on the previous and ends by wiring into the
existing shell; no code is left orphaned. The hard rule throughout is "do no
harm to prior specs" — all existing tests must stay green (R21).

All code is TypeScript (strict, ESM) per the design and the project tech stack.

## Tasks

- [x] 1. Add the `landingDismissed` state field and the `home` command (pure core foundation)
  - [x] 1.1 Add additive `landingDismissed` field to `SessionState`
    - Add `readonly landingDismissed: boolean` to `SessionState` in `packages/ui-crt/src/session/state.ts`; seed `landingDismissed: false` in `initialState()`.
    - Keep every other field byte-identical; this is purely additive.
    - _Requirements: 1.2, 1.5_

  - [x] 1.2 Add the `home` command to the parser
    - In `packages/ui-crt/src/command/parse.ts` add `case "home"` returning `{ kind: "home" }` only when there are zero args; with one or more args return the existing unknown-command result.
    - Add `{ kind: "home" }` to the `Command` union; leave every other command name and its parsing byte-identical (G6).
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 1.3 Add reducer transitions for first-command dismiss, `home`, and `clear`
    - In `packages/ui-crt/src/session/reducer.ts`: set `landingDismissed = true` on the first accepted command/submit path that produces output; add the `home` transition that empties the log, nulls `summary`/`readings`/`lastRitual`, and sets `landingDismissed = false`; leave `clear` unchanged (empties log, flag untouched).
    - _Requirements: 1.2, 1.4, 1.7, 2.3_

  - [x]* 1.4 Write unit tests for parse `home` and reducer transitions
    - Assert `home` with no args parses to `{ kind: "home" }`; `home x` is unknown; all other commands parse byte-identically.
    - Assert first-command sets the flag true; `home` resets state and flag; `clear` leaves the flag untouched.
    - _Requirements: 2.1, 2.2, 2.4, 1.4, 1.7_

- [x] 2. Implement the LEGACY REPOS table (pure)
  - [x] 2.1 Create `landing/repos.ts`
    - Create `packages/ui-crt/src/landing/repos.ts` with `LegacyRepoSchema` (zod, `.strict()`), `LegacyRepo`, the three concrete rows (`tomaes/pytarl` DUNGEON 4 FILES; `ArmstrongJ/robotadventure` NOIR MYSTERY 21 FILES; `neubig/test-repo` PY2 SPECIMEN 240 FILES) with their ORACLE SAYS lines (≤ 72 cols), `ENTER_ANY_LABEL`, the `LandingRow` union, and `LANDING_ROWS` (repos then the ENTER row).
    - Validate each row against the schema at module load.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 2.2 Write unit tests for the repos table
    - Assert the three rows, order, tags, captions, ENTER row placement, and that every ORACLE SAYS line is ≤ 72 columns and ASCII-only.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.5_

- [x] 3. Implement the selection model (pure)
  - [x] 3.1 Create `landing/selection.ts`
    - Create `packages/ui-crt/src/landing/selection.ts` with `SelectionState`, `move(state, dir, rowCount)` (clamp, no wrap), `selectedRow(state, rows)`, `activate(row)` returning `summon-read` for a concrete repo or `focus-input` for the ENTER row.
    - _Requirements: 4.5, 4.6, 5.3, 5.4_

  - [x]* 3.2 Write property test for selection index range (clamp, no wrap)
    - **Property 1: Selection index stays in range under any key sequence**
    - **Validates: Requirements 4.6**
    - File `packages/ui-crt/src/landing/selection.pbt.test.ts`, 1000 runs; also cover Property 2 (single selected row) via `selectedRow`.
    - **Property 2: The cursor and inverted row mark the same single row**
    - **Validates: Requirements 4.5**

  - [x]* 3.3 Write property test for `activate` semantics
    - **Property 3: `activate` maps each row to exactly one effect**
    - **Validates: Requirements 5.3**
    - File `packages/ui-crt/src/landing/activate.pbt.test.ts`; include Property 10 (ENTER focuses input, concrete repo yields summon then read fates).
    - **Property 10: The ENTER row focuses the input and never summons**
    - **Validates: Requirements 5.1, 5.2**

- [x] 4. Implement the key-binding handler (pure)
  - [x] 4.1 Create `landing/key-binding.ts`
    - Create `packages/ui-crt/src/landing/key-binding.ts` with `KeyDescriptor`, `LandingAction`, and `landingKeyAction(ev)` per the design algorithm: `none` for any Alt/Ctrl/Meta-modified key or unmapped key; case-insensitive letters; ArrowUp/Down → move; Enter/a → activate; b/d → demo; h → help.
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 4.2 Write property test for key bindings
    - **Property 4: Key bindings never steal modified or unmapped keys**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
    - File `packages/ui-crt/src/landing/key-binding.pbt.test.ts`, 1000 runs.

- [x] 5. Implement the landing visibility + HUD/preview model (pure)
  - [x] 5.1 Create `landing/landing-model.ts`
    - Create `packages/ui-crt/src/landing/landing-model.ts` with `landingVisible(state)` (`!landingDismissed && boot.phase==="done" && log empty && summary===null`), `hudModel(state)` (label `NECRO-ORACLE`, SOUL hearts 1–5, `PY2 CURSE: ACTIVE`), and `previewModel(state, selected, manifest)` (showSeer from `manifest.has("seer")`, 3 card backs, selected oracleSays).
    - _Requirements: 1.1, 1.5, 3.1, 3.2, 3.4, 6.1, 6.2, 6.4_

  - [x]* 5.2 Write property tests for landing visibility and the round-trip
    - **Property 5: Landing-dismiss / `home` round-trip is identity on visibility**
    - **Validates: Requirements 1.2, 1.3, 2.3**
    - **Property 6: `landingVisible` is false whenever any command output or summary exists**
    - **Validates: Requirements 1.1, 1.4**
    - **Property 11: `home` is a superset of `clear` plus landing restore**
    - **Validates: Requirements 1.6, 2.1, 2.3**
    - File `packages/ui-crt/src/session/landing-reducer.pbt.test.ts`; add `arbSessionStateIdle` / `arbSessionStateDismissed` to `packages/ui-crt/test/arbitraries.ts`.

- [x] 6. Checkpoint - pure core complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Author the DMG landing stylesheet
  - [x] 7.1 Create `landing/landing.css`
    - Create `packages/ui-crt/src/landing/landing.css`: panel chrome for HUD/list/preview/hint; `DMG_PALETTE` (`#001a00 / #0b4f1a / #2fa84a / #8cff9e`) bound to `--dmg-0..3` CSS vars (V1); inverted-row = two palette shades ≥ 4.5:1 (V2); `image-rendering: pixelated`, no `filter` on images (V3); a single bitmap pixel `font-family` token (V7); a single spacing-scale token set, integer `--px` grid (V5, V9); `text-overflow: ellipsis` single-line clipping (V6); candle-flicker + cursor-blink animations only inside `.crt[data-motion="full"]` motion zones, off under reduced motion (V8).
    - Export `DMG_PALETTE` as a `const` tuple for test enforcement.
    - _Requirements: 10.1, 10.2, 11.1, 11.2, 11.3, 13.1, 13.2, 14.1, 14.2, 15.1, 16.1, 16.2, 17.1_

- [x] 8. Implement the screen-only landing components
  - [x] 8.1 Implement `HudBar` and `HintBar`
    - Create `packages/ui-crt/src/components/HudBar.tsx` (plain-DOM `NECRO-ORACLE`, SOUL hearts with a single text accessible label + decorative glyphs, `PY2 CURSE: ACTIVE`) and `HintBar.tsx` (renders `▲▼ SELECT  A:SUMMON  B:DEMO  START:HELP` as text).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.1_

  - [x] 8.2 Implement `LegacyRepoList`
    - Create `packages/ui-crt/src/components/LegacyRepoList.tsx`: `role="listbox"` with `role="option"` rows, `aria-selected="true"` on the selected row, inverted class, ▶ cursor `aria-hidden`; `onSelect` (hover/click) and `onActivate` (click/Enter). Option accessible name contains label, tag, file count; excludes the ▶ cursor char.
    - _Requirements: 4.5, 4.7, 4.8, 20.3_

  - [x] 8.3 Implement `PreviewWindow`
    - Create `packages/ui-crt/src/components/PreviewWindow.tsx`: reused `SeerPortrait` rendered whenever `model.showSeer` (independent of boot phase) using the `integerScale` + ResizeObserver pattern and text fallback; three face-down eye/moon Card_Backs (no pentagram), integer-scaled, pixelated, no filter; ORACLE SAYS line as plain DOM text ≤ 72 cols with ellipsis; missing-seer and missing-card-back degrade to text/phosphor box with no broken-image indicator.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 8.1, 8.3, 11.1, 11.2, 11.3, 12.1, 12.2, 14.1, 14.2_

  - [x]* 8.4 Write property + style tests for palette, scaling, motion
    - **Property 8: DMG palette purity**
    - **Validates: Requirements 10.1, 10.2**
    - File `packages/ui-crt/src/components/landing-palette.pbt.test.ts` (jsdom computed styles; include inverted-row ≥ 4.5:1 contrast).
    - **Property 9: Integer scaling and no smoothing on every landing image**
    - **Validates: Requirements 11.1, 11.2**
    - File `packages/ui-crt/src/components/landing-image.pbt.test.ts`.
    - **Property 7: Motion-off disables every landing animation**
    - **Validates: Requirements 16.1, 16.2**
    - File `packages/ui-crt/src/components/landing-motion.pbt.test.ts`.

  - [x]* 8.5 Write style/a11y example tests for the visual audit
    - Assert single bitmap pixel font on DMG surfaces (R15.1), integer panel box metrics/offsets (R13.1, R13.2), single spacing-scale tokens (R17.1), ORACLE SAYS ellipsis single-line fit (R14.1, R14.2), eye/moon card-back asset id (never a pentagram, R12.1, R12.2), and `listbox`/`option` roles with the ▶ cursor excluded from the accessible name (R20.3).
    - _Requirements: 12.1, 12.2, 13.1, 13.2, 14.1, 14.2, 15.1, 17.1, 20.3_

- [x] 9. Wire the `Landing` component into the Terminal shell (Part A integration)
  - [x] 9.1 Implement the `Landing` component
    - Create `packages/ui-crt/src/components/Landing.tsx`: returns `null` when `!landingVisible(state)`; owns local `SelectionState`; attaches a `keydown` handler calling `landingKeyAction` and dispatching move→local, activate→`activate(selectedRow)` (concrete repo: `submit("summon <ref>","button")` then `submit("read fates","button")`; ENTER row: `focusInput()`), demo→`submit("demo","button")`, help→`submit("help","button")`; mouse click selects + activates. Composes HudBar, LegacyRepoList, PreviewWindow, HintBar. Imports `landing.css`.
    - _Requirements: 1.1, 5.1, 5.2, 5.3, 7.8, 7.9_

  - [x] 9.2 Mount `Landing` inside `<Terminal>` and keep the shell operable
    - In `packages/ui-crt/src/components/Terminal.tsx` render `<Landing>` as a sibling above `OutputLog`, gated by `landingVisible(state)`, passing `submit`/`prefillSummon` (focusInput); keep the boot/seer region, command line, button row (chips), and `NECRO>` input mounted and operable; do not trap focus. Export `Landing` and the new pure modules from `packages/ui-crt/src/index.ts`.
    - _Requirements: 1.1, 1.3, 1.6, 7.8, 7.9_

  - [x]* 9.3 Write Seer-visibility unit test (Part B bug 1, RED→GREEN)
    - Render `Landing` idle (`?boot=skip`, boot done) and assert `.crt-seer-portrait` is in the DOM (RED before 8.3/9.2, GREEN after); a second test asserts the boot-time Seer (`boot.phase==="playing"`) still renders (no regression).
    - _Requirements: 8.1, 8.2, 8.4_

- [x] 10. Checkpoint - Part A landing renders and is operable
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Resurrection chunk split (Part B bug 2)
  - [x] 11.1 Add the `ResurrectViewPort` type and live port
    - Create `apps/web/src/terminal/resurrect-view-port.ts` with `ResurrectViewPort` and `createResurrectViewPort()` returning `() => loadResurrectionView()` (literal-path dynamic import of `ResurrectionResult`). Add the additive optional `resurrectView?: ResurrectViewPort` to `TerminalPorts` in `packages/ui-crt/src/ports.ts` so port-less hosts still type-check.
    - _Requirements: 9.1, 9.8_

  - [x] 11.2 Wire the port into `createBrowserPorts` and mount the result view through it
    - In `apps/web/src/terminal/browser-ports.ts` add `resurrectView: createResurrectViewPort()`. Thread the port through `apps/web/src/components/TerminalScreen.tsx` (no behaviour change) and mount the resurrection result view through the port when a `resurrect` settles, so `import("../components/ResurrectionResult.js")` becomes live and the bundler emits a distinct chunk containing `renderFileResults` / `renderResurrectVitality` / `Residual_List`. Keep `BUDGET_BYTES` at `250000`.
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 18.1_

  - [x]* 11.3 Write unit test for the resurrection view port
    - Assert `createBrowserPorts().resurrectView` is a function and calling it returns a Promise; confirm `budget.test.ts` still pins `findSeparateChunks().resurrection !== null`.
    - _Requirements: 9.1, 9.6, 9.7_

- [x] 12. In-world oracle-voice error and empty states (Part B bug 4)
  - [x] 12.1 Implement DMG-styled error and empty-state copy and routing
    - Load the `oracle-voice` steering file before writing any copy. Route all failures through the typed `NecroError` → `mapError` → oracle-voice path and restyle (CSS only) the error surfaces; the DOM live-region text stays the authoritative plain fact. Cover bad/nonexistent repo (404), rate limit (retry 1–60 min), network/stream failure, repo with no `.py` files, a legitimate zero-entry list (empty-state message + accessible list label), and route a fetch-failure-empty list to the matching error state instead of the empty message.
    - Keep each mystical line ≤ 16 words, each line ≤ 72 columns, ASCII-only, no emoji; the live-region text equals the visible plain fact.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

  - [x]* 12.2 Write property + example tests for error/empty copy
    - **Property 12: Oracle-voice error/empty copy stays within the column and ASCII budget**
    - **Validates: Requirements 19.6**
    - File `packages/ui-crt/src/landing/oracle-copy.pbt.test.ts`; plus example tests for the four error states + the empty-list state asserting oracle-voice shape and live-region parity.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.7_

- [x] 13. End-to-end and screenshot coverage
  - [x]* 13.1 Write the landing end-to-end suite
    - Create `apps/web/e2e/landing.e2e.ts`: idle landing renders HUD, list, preview (Seer visible), hint bar; arrow keys move the selection and the inverted row follows; `A`/Enter on a concrete repo runs `summon` then `read fates` and the landing dismisses; `home` returns to the landing; `B` runs demo; `H` runs help; `NECRO>` input and command chips still work; axe reports zero violations on the idle landing and on an error state; under reduced motion no landing animation runs.
    - _Requirements: 1.1, 2.3, 5.1, 7.8, 7.9, 8.1, 16.2, 20.1, 20.2_

  - [x]* 13.2 Add Landing_State screenshot baselines and preserve `?ritual=force`
    - Update `apps/web/e2e/screenshots.e2e.ts` with `landing-idle` and `landing-summon` capture-only frames (gated by `CAPTURE_SCREENSHOTS`); re-exercise and assert the existing `?ritual=force` behaviour in the resurrect flow.
    - _Requirements: 21.5, 21.6_

- [x] 14. No-regression gate and documentation
  - [x] 14.1 Run the full suite, typecheck, lint, and the web-budget gate
    - Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `scripts/check-web-budget.mjs`; confirm all existing Spec 03 / Arcana_Visions / Resurrection_Engine tests pass unchanged and the budget gate finds all four lazy chunks (demo, sound, resurrection, background-theme) as distinct non-initial chunks. Fix any regression before proceeding.
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 9.6_

  - [x] 14.2 Update docs per docs-discipline
    - Update `docs/ARCHITECTURE.md` (new landing region + resurrect-view port) and `docs/DECK.md` (landing/preview surfaces); append a dated entry to `docs/KIRO_USAGE.md` noting the spec-driven landing work.
    - _Requirements: 21.4_

- [x] 15. Final checkpoint - full suite green and no regression
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Fix landing visual-fidelity defects (22–27)
  - [x] 16.1 Bundle the bitmap pixel font (VT323 OFL)
    - Commit a VT323 `woff2` and declare it via `@font-face` (or `next/font/local`); ensure `crt.css` / `landing/landing.css` resolve `--dmg-font` to the bundled face rather than falling back to system monospace. Record the font license in `docs/COMPLIANCE.md`.
    - _Requirements: 25_

  - [x] 16.2 Fix the focus ring to a DMG_Palette color on landing controls
    - Override the global `.crt :focus-visible` outline for Landing_State controls (including the `NECRO>` input while the landing is visible) so the focus indicator color is a DMG_Palette member, keeping a visible indicator with ≥ 3:1 contrast against both adjacent palette shades; emit no off-palette `outline-color` or `border-color`.
    - _Requirements: 23_

  - [x] 16.3 Make the selected row a solid inverted row
    - In `landing/landing.css` set the selected row to a solid `#8cff9e` background with `#001a00` text and suppress the scanline/afterglow overlay over the inverted row; keep both colors DMG_Palette members at ≥ 4.5:1 contrast.
    - _Requirements: 24, 10.2_

  - [x] 16.4 Scale the Seer and card backs to fill the PREVIEW panel
    - In `PreviewWindow` / `landing.css` raise the integer scale factor for the Seer_Portrait and the three Card_Backs so they substantially fill the Preview_Window panel; keep `image-rendering: pixelated`, integer factor ≥ 1 on both axes, and no CSS `filter`.
    - _Requirements: 26, 11.1, 11.2_

  - [x] 16.5 Add the ` · ` separator between tag and file count
    - In `LegacyRepoList` render each concrete repo row's tag and file count joined by a ` · ` middle-dot separator as plain DOM text (for example `DUNGEON · 4 FILES`).
    - _Requirements: 27_

  - [x] 16.6 Fix the boot-banner layout
    - Adjust the Terminal_Shell / Landing_State layout so the boot banner line stays fully visible and is never clipped or overlapped by the Hint_Bar or any Landing_State panel.
    - _Requirements: 22_

- [x] 17. Palette-guard test + regenerate landing screenshots
  - [x] 17.1 Add the terminal-wide off-palette computed-color guard test
    - Add a test that renders the terminal (landing included) and asserts every computed `color`, `background-color`, `border-color`, and `outline-color` is in the allowed palette set (DMG_Palette for DMG surfaces plus the audited Spec 03 phosphor chrome tokens) or `transparent`; borders and outlines explicitly included, failing on any off-palette value.
    - _Requirements: 28_

  - [x]* 17.2 Regenerate landing screenshots and re-run the gate
    - Regenerate `docs/screenshots/09-landing-idle.png` and `docs/screenshots/10-landing-summon.png`; re-run the full no-regression suite and the web-budget gate; confirm all tests stay green and `BUDGET_BYTES` is unchanged.
    - _Requirements: 21.1, 21.4, 21.5_

- [x] 18. Fix landing viewport fit and the smaller review items (29–32)
  - [x] 18.1 Height-bound the Preview_Window scale
    - In `PreviewWindow` / `landing/landing.css`, compute the Seer_Portrait and Card_Back integer scale factor from the available panel HEIGHT as well as its width — the largest integer factor that fits within both the panel's height budget and width budget, minimum 1 — so the whole landing fits 1280×720, 1366×768, and 1920×1080 with no vertical scroll; the preview still fills its (now height-bounded) panel. Keep `image-rendering: pixelated`, integer factor ≥ 1 on both axes, and no CSS `filter`.
    - _Requirements: 29, 26, 11.1, 11.2_

  - [x] 18.2 Fit the whole landing within the viewport with no vertical scroll
    - Ensure the landing layout (HUD_Bar + Legacy_Repo_List + Preview_Window + Hint_Bar) plus the boot banner line, the `NECRO>` input, and the command chips all fit the viewport with no vertical scroll at 1280×720, 1366×768, and 1920×1080; cap the preview's height budget so the output log/landing share the column without overflow.
    - _Requirements: 29_

  - [x] 18.3 Add single spaces on both sides of the separator
    - In `LegacyRepoList` render each concrete repo row's tag and file count joined by a middle-dot separator with a single space on both sides (`DUNGEON · 4 FILES`) as plain DOM text.
    - _Requirements: 31, 27_

  - [x] 18.4 Replace the amber-brown `--crt-focus` with an in-palette composed focus indicator
    - In `tokens.ts` + `crt.css`, replace the `--crt-focus` `#a85c30` value with an in-palette composed focus indicator (`#8cff9e` ring + `#001a00` offset); update the `crt-tokens.test.ts` focus assertion to reflect the composed in-palette indicator (the bright ring vs the dark offset/background) without weakening the ≥ 3:1 visible-focus requirement; remove the landing-only focus override if the global ring is now in-palette, or keep it consistent with the global ring.
    - _Requirements: 32_

  - [x] 18.5 Remove `#a85c30` from the palette-guard allowed set
    - Remove `#a85c30` from the Requirement 28 palette-guard allowed set so the guard allows only DMG_Palette and phosphor-palette colors; keep the guard green with the new in-palette focus indicator.
    - _Requirements: 32, 28_

- [x] 19. Viewport e2e + regenerate screenshots
  - [x] 19.1 Add the no-vertical-scroll + all-parts-in-viewport e2e
    - Add an end-to-end test asserting, at 1280×720, 1366×768, and 1920×1080, that the terminal shows no vertical scrollbar (`scrollHeight <= clientHeight`) and that the HUD_Bar, the Legacy_Repo_List, each Card_Back, the ORACLE SAYS line, the Hint_Bar, the boot banner line, the `NECRO>` input, and the command chips are each within the viewport.
    - _Requirements: 29_

  - [x]* 19.2 Regenerate landing screenshots and re-run the gate
    - Regenerate `docs/screenshots/09-landing-idle.png` (scrolled to the top of the terminal with the full landing in frame) and `docs/screenshots/10-landing-summon.png`; re-run the full no-regression suite and the web-budget gate; confirm all tests stay green and `BUDGET_BYTES` is unchanged.
    - _Requirements: 29, 30, 21.1, 21.4, 21.5_

## Notes

- Tasks marked with `*` are optional (tests/coverage) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property test names its property number and the requirement clause it validates, placed close to the implementation it checks so errors surface early.
- The design has a Correctness Properties section, so property-based tests (fast-check) are included for P1–P12; unit/example tests complement them.
- All pure core modules read no clock, DOM, network, or audio, so their properties are testable with Mock inputs only (no network/LLM/sandbox in unit or property tests).
- The governing rule is "do no harm": task 14.1 is the explicit no-regression + budget gate (R21, R9.6) and runs before the final checkpoint.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "7.1"] },
    { "id": 2, "tasks": ["1.3", "3.1", "5.1"] },
    { "id": 3, "tasks": ["1.4", "3.2", "3.3", "5.2"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["8.4", "8.5"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["9.3", "11.1"] },
    { "id": 9, "tasks": ["11.2", "12.1"] },
    { "id": 10, "tasks": ["11.3", "12.2"] },
    { "id": 11, "tasks": ["13.1", "13.2"] },
    { "id": 12, "tasks": ["14.1"] },
    { "id": 13, "tasks": ["14.2"] },
    { "id": 14, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6"] },
    { "id": 15, "tasks": ["17.1"] },
    { "id": 16, "tasks": ["17.2"] },
    { "id": 17, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5"] },
    { "id": 18, "tasks": ["19.1"] },
    { "id": 19, "tasks": ["19.2"] }
  ]
}
```
