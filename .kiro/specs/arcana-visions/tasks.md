# Implementation Plan: Arcana_Visions

## Overview

Arcana_Visions is an additive pixel-art presentation layer over Spec 05 (Visual_Necromancy). The plan builds bottom-up: first the shared motion/ritual tokens and the pure modules (each shipping with its fast-check property test), then the screen-only React components, then the `apps/web` Terminal_Route wiring (spread, fullscreen, ritual, seer, background theme, `?ritual=force`), then the public export surface, then Playwright e2e and screenshot capture, then docs and a final bundle-budget verification.

Every pure module ships with its property test in the same task. Property tests use `*.pbt.test.ts` and name their requirement in the `describe` title (`P<n> (R..): ...`); example tests use `*.test.ts`; Playwright specs use `*.e2e.ts`. No task touches images, `.env*`, or `.gitignore`, and nothing regenerates assets or pushes/opens a PR. All work is verifiable with `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:pbt`, `pnpm build`, and `pnpm e2e`.

## Tasks

- [x] 1. Add motion and ritual tokens
  - Extend `packages/ui-crt/src/tokens.ts` with the new bounded tokens: `RITUAL_TOTAL_MS` (<= 3000) and the motion-zone period/step tokens, reusing the existing `CRT_GLITCH_MAX_MS = 300`, `CRT_SHAKE_MS`, `CRT_BLOOM_MS` conventions; keep all values honouring the Flash_Limit of <= 2 luminance changes/sec.
  - Do not alter existing phosphor palette tokens; add only new constants.
  - _Requirements: 4.5, 5.3, 6.2_

- [x] 2. Pure module: integer scale
  - [x] 2.1 Implement `packages/ui-crt/src/arcana/integer-scale.ts`
    - Export `Size` interface and `integerScale(available, logical): number` returning the largest whole factor fitting both axes, clamped to >= 1; regions smaller than logical on either axis return 1; NaN/<=0 inputs clamp to 1.
    - _Requirements: 1.2, 1.3, 1.4_
  - [x]* 2.2 Write property tests for integer scale
    - `packages/ui-crt/src/arcana/integer-scale.pbt.test.ts`, 1000 runs, arbitraries `arbViewport` + `arbLogicalSize`.
    - `describe("P1 (R1.3, R1.4, R13.1): integer scale is a whole number >= 1", ...)` — result is an integer >= 1, never fractional; sub-logical region yields exactly 1.
    - `describe("P2 (R1.2, R3.2, R7.1, R7.3, R13.1): rendered dims equal logical x scale, aspect preserved", ...)` — width `w*s`, height `h*s` for the single `s`, ratio preserved.
    - _Requirements: 1.2, 1.3, 1.4, 3.2, 7.1, 7.3, 13.1_

- [x] 3. Pure module: manifest loader (zod)
  - [x] 3.1 Implement `packages/ui-crt/src/arcana/manifest.ts`
    - zod `ManifestBandsSchema`, `ManifestImageSchema` (`.passthrough()` to tolerate but ignore `png`/`preview`/`box`/workspace fields), `ManifestSchema`; `loadManifest(raw): ReadonlyMap<string, ArcanaAsset>` validating at the boundary and throwing a typed `NecroError` on invalid shape; export `DIAGNOSIS_CARD_IDS` (12 ids in deck order).
    - Consume the manifest JSON as imported static data (no network).
    - _Requirements: 1.6, 3.1_
  - [x]* 3.2 Write unit tests for manifest loader
    - `packages/ui-crt/src/arcana/manifest.test.ts` — valid manifest yields the trusted map with correct logical sizes and bands; extra fields are ignored; invalid shape throws a typed `NecroError`; the 12 diagnosis ids resolve to 120x160 with bands header `[0,19]`/footer `[147,160]`, seer/necronomicon-open are 256x144 bands null, necronomicon-closed is 108x144.
    - _Requirements: 1.6_

- [x] 4. Pure module: Motion_Zone table + validator
  - [x] 4.1 Implement `packages/ui-crt/src/arcana/motion-zones.ts`
    - Export `MotionEffect`, `Rect`, `MotionZone`, `Bands`, `MotionZoneIssue`; the authored `MOTION_ZONES` table (tower flicker, star shimmer, moon pulse, hermit flicker, judgement rays, seer glow); `luminanceChangesPerSecond(z) = z.steps / (z.periodMs/1000)`; `validateMotionZone(z, logical, bands): MotionZoneIssue[]` checking rect in `[0,w]x[0,h]`, no header/footer band overlap, and flash limit <= 2.
    - Every declared zone must lie fully within its card and outside the Text_Bands.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.8_
  - [x]* 4.2 Write property tests for motion zones
    - `packages/ui-crt/src/arcana/motion-zones.pbt.test.ts`, 1000 runs.
    - `describe("P4 (R4.8, R13.2): every Motion_Zone lies within its card and outside Text_Bands", ...)` — no `out-of-bounds`/`overlaps-band` issue for any table entry against its card asset.
    - `describe("P5 (R4.5, R13.3): every Motion_Zone stays within the Flash_Limit", ...)` — `luminanceChangesPerSecond(zone) <= 2` for all zones.
    - _Requirements: 4.5, 4.8, 13.2, 13.3_

- [x] 5. Pure module: ritual timeline
  - [x] 5.1 Implement `packages/ui-crt/src/arcana/ritual-timeline.ts`
    - Export `RitualPhase`, `RitualStep`, `RitualOpts`, `RITUAL_TOTAL_MS` (<= 3000 from tokens), and `ritualTimeline(opts): RitualStep[]`. Return `[]` iff `motionMode === "reduced"` OR `!imagesReady` OR `((playwright || bootSkip) && !ritualForce)`; otherwise the four phases `closed-glitch -> tremble -> crossfade -> rising-diff` with non-decreasing `startMs` and summed durations <= `RITUAL_TOTAL_MS`. Deterministic in `seed`; pure (no clock/DOM).
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.8, 6.10_
  - [x]* 5.2 Write property tests for ritual timeline
    - `packages/ui-crt/src/arcana/ritual-timeline.pbt.test.ts`, 1000 runs, `arbRitualOpts` covering all gate combinations.
    - `describe("P6 (R6.4, R6.5, R6.6, R6.10): ritual gating is empty exactly when it must be skipped", ...)`.
    - `describe("P7 (R6.1, R6.2, R13.4): a playing ritual is ordered and completes within 3 s", ...)`.
    - `describe("P8 (R6.8): the ritual timeline is deterministic in its seed", ...)`.
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.8, 6.10, 13.4_

- [x] 6. Pure module: pixel-card model
  - [x] 6.1 Implement `packages/ui-crt/src/arcana/pixel-card-model.ts`
    - Export `PixelCardModel`, `pixelCardModel(card: VisualCard): PixelCardModel`, and `cardAltText(card, orientation): string`. Derive `numeral`/`title` from the card registry, `caption` (<= 72 cols, oracle voice, reusing `VOICE_TABLE`), and `altText` = `"<Name>, <upright|reversed> — <one-line meaning <= 120 chars>"`. Severity flows unchanged for the glitch contract.
    - _Requirements: 1.6, 1.7, 2.9, 5.1, 5.2, 10.1_
  - [x]* 6.2 Write property test for pixel-card model
    - `packages/ui-crt/src/arcana/pixel-card-model.pbt.test.ts`, 200 runs.
    - `describe("P12 (R10.1): alt text contains the name, orientation word, and a meaning <= 120 chars", ...)`.
    - _Requirements: 10.1_

- [x] 7. Pure module + gate: background theme
  - [x] 7.1 Implement `packages/ui-crt/src/sound/background-theme.ts`
    - Export `ThemeVoice`, `ThemeScore`, `composeTheme(seed): ThemeScore` (seeded, deterministic, original; square/triangle voices, simple arpeggios), `peakGain(score): number`, and `backgroundThemeActive(state, env): boolean` mirroring `soundCueAllowed` (on + gesture + visible + `!env.isTest`). Pure, no audio.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10_
  - [x]* 7.2 Write property tests for background theme
    - `packages/ui-crt/src/sound/background-theme.pbt.test.ts`, 200 runs.
    - `describe("P13 (R8.4, R8.5, R8.6, R8.10, R13.5): theme plays only when every gate condition holds", ...)`.
    - `describe("P14 (R8.1): composed theme never exceeds peak gain 0.2 and uses only square/triangle", ...)`.
    - `describe("P15 (R8.2): composed theme loops gaplessly", ...)` — end of final bar meets start of first with no silent gap.
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.10, 13.5_

- [x] 8. Lazy engine: background theme (Web Audio behind a port)
  - Implement `packages/ui-crt/src/sound/background-theme-engine.ts`: `BackgroundThemeEngine` (`start(score)` builds oscillators with gapless loop and peak gain <= 0.2; `stop()` within 1 s) and `BackgroundThemeLoaderPort`. The production loader is a string-literal dynamic import (permitted by `boundary.guard.test.ts`) that resolves to a no-op engine when `AudioContext` is unavailable so the route stays usable.
  - This module is a lazy chunk, excluded from the initial Terminal_Route render.
  - _Requirements: 8.7, 8.8, 8.9, 11.2_

- [x] 9. Checkpoint - pure modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Help/celtic spread consistency
  - [x] 10.1 Update `packages/ui-crt/src/render/help.ts`
    - Change the `read` help line to `read <fates|necropsy|celtic>` so the help's spread set equals the accepted `SPREAD_ARGS`; keep `renderHelp` a pure, byte-stable block. Record that celtic is accepted end to end (R9.1 note lives in design.md; R9.3 does not apply).
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x]* 10.2 Write property test for help/spread consistency
    - `packages/ui-crt/src/render/help-consistency.pbt.test.ts`.
    - `describe("P16 (R9.2, R9.4): help spread list equals the accepted spread set", ...)` — the set named in `renderHelp()` equals the `read` spreads `parseCommand` accepts (`fates`, `necropsy`, `celtic`).
    - _Requirements: 9.2, 9.4_

- [x] 11. Arcana stylesheet
  - Create `packages/ui-crt/src/arcana/arcana.css`: `image-rendering: pixelated` and no colour-altering filter on card/seer/necronomicon images; `--arcana-scale` sizing; phosphor DOM text for header/footer bands and the caption with `text-overflow: ellipsis` at scale 1; motion-zone `steps()` keyframes bounded to each rect; reversed-image 180° rotation with counter-upright text; one-shot glitch (`animation-iteration-count: 1`, <= 300 ms) reusing the Spec 05 glitch selector; ritual keyframes mirroring `tokens.ts`.
  - _Requirements: 1.1, 1.5, 1.8, 2.9, 4.2, 4.6, 5.3, 5.4, 7.2_

- [x] 12. Component: PixelCard
  - [x] 12.1 Implement `packages/ui-crt/src/components/PixelCard.tsx`
    - Single `<img>` with `image-rendering: pixelated`, width/height = logical x scale, no blur filter, `alt={model.altText}`; header band `[0,19]` = numeral+title, footer band `[147,160]` = position·orientation, caption below the image outside the bands; `data-motion` and (full motion, severity 1..3) `data-glitch-intensity = glitchProfile(severity).intensity` reusing the Spec 05 CSS contract; reversed = image 180° with upright text; `onError` swaps to `AsciiCardView` in place with no broken-image indicator; per-card motion-zone overlays rendered only when `validateMotionZone` returns no issues and motion is `full`, otherwise static with a dev-time `console.warn` (no terminal message).
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 1.8, 1.9, 2.9, 4.1, 4.2, 4.6, 4.7, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.1, 10.2_
  - [x]* 12.2 Write property + unit tests for PixelCard
    - `packages/ui-crt/src/components/pixel-spread.pbt.test.ts` (Testing Library + jsdom), 200 runs:
      - `describe("P9 (R1.6, R1.7): pixel card renders band text and caption below the image", ...)`.
      - `describe("P10 (R2.9): reversed card rotates the image while text stays upright", ...)`.
      - `describe("P11 (R5.1, R5.2): glitch contract follows glitchProfile, steady at severity 0", ...)`.
    - `packages/ui-crt/src/components/pixel-card.test.ts` — `onError` → ASCII fallback (R1.9); scale-1 ellipsis clipping style (R1.8); glitch one-shot resting state (R5.3, R5.4, R5.6); reduced-motion steadiness (R5.5); invalid-zone runtime guard with a `console.warn` spy and no terminal message (R4.9); `steps()`/rect-clipping overflow (R4.2, R4.6).
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 2.9, 4.2, 4.6, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 13. Component: SpreadPixelView
  - [x] 13.1 Implement `packages/ui-crt/src/components/SpreadPixelView.tsx`
    - Render a left-to-right `.crt-spread-pixel` row of `PixelCard`s in the reading's exact spread order (none reordered/duplicated/omitted), one slot per drawn card, each computing its own `integerScale(available/slots, logical)`; a fates reading renders exactly 3 slots. Server-rendered markup falls back to `AsciiCardView` content per position so a no-JS reader sees the ASCII spread in order; per-slot image failure falls back to the ASCII card in that slot.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x]* 13.2 Write property + unit tests for SpreadPixelView
    - `packages/ui-crt/src/components/pixel-spread.pbt.test.ts` adds `describe("P3 (R3.1, R3.5): spread slot order equals the reading's spread order", ...)` with an example asserting exactly 3 fates slots.
    - Unit test: image-unavailable slot renders the ASCII card (R3.3); no-JS SSR renders ASCII in order (R3.4).
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

- [x] 14. Component: FullscreenCardView
  - [x] 14.1 Implement `packages/ui-crt/src/components/FullscreenCardView.tsx`
    - `role="dialog" aria-modal="true"` with focus moved inside on open and Tab/Shift+Tab trapped; on close restore focus to the opener via the deferred-focus technique; open within 500 ms from click/Enter; Arrow Right/Down → next, Left/Up → previous with wrap; single-card readings make any navigation a no-op; Escape closes and restores focus; shows the single large `PixelCard` (own `integerScale`), reversed image rotated 180° with upright text, caption below the image; visible focus indicator (`CRT_FOCUS`) on focused controls.
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 10.3, 10.5, 10.6_
  - [x]* 14.2 Write unit tests for FullscreenCardView
    - `packages/ui-crt/src/components/fullscreen-card.test.ts` — open on click/Enter (R2.1, R2.2); arrow wrap both ends (R2.5); single-card no-op (R2.6); focus trap (R2.7); Escape close + focus restore (R2.8, R10.6); visible focus ring present (R10.5).
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 10.5, 10.6_

- [x] 15. Component: NecronomiconRitual
  - [x] 15.1 Implement `packages/ui-crt/src/components/NecronomiconRitual.tsx`
    - Driven by `ritualTimeline` steps via the Spec 05 `FramePort` (no wall-clock `setTimeout`): closed+glitch → tremble → crossfade to open → diff lines rising, then render `children` (unchanged Spec 05 diff/patch view); `steps === []` renders `children` immediately; Escape calls `onComplete` within 100 ms; `onImageError` (decode failure of either frame) skips to `children`; the diff/patch content is never altered by the ritual.
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.7, 6.9, 6.10_
  - [x]* 15.2 Write unit tests for NecronomiconRitual
    - `packages/ui-crt/src/components/necronomicon-ritual.test.ts` — empty steps render children immediately (R6.4, R6.5); Escape skip within 100 ms to diff (R6.3); image error skips to diff (R6.10); diff/patch content unchanged by the ritual (R6.9); demo determinism for a given seed (R6.7, R6.8).
    - _Requirements: 6.3, 6.4, 6.5, 6.7, 6.9, 6.10_

- [x] 16. Component: SeerPortrait
  - [x] 16.1 Implement `packages/ui-crt/src/components/SeerPortrait.tsx`
    - Render the Seer at `integerScale(available, {w:256,h:144})` with `image-rendering: pixelated`, preserving native 16:9 (no distortion/crop); `onError` renders the provided text-landing `fallback` with no broken-image indicator.
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x]* 16.2 Write unit tests for SeerPortrait
    - `packages/ui-crt/src/components/seer-portrait.test.ts` — pixelated + no filter (R7.2); aspect preserved (R7.3); `onError` → text landing, no broken-image indicator (R7.4).
    - _Requirements: 7.2, 7.3, 7.4_

- [x] 17. Export surface
  - Update `packages/ui-crt/src/index.ts` to export the new public API only through the package index: `integerScale`/`Size`, manifest loader + types, `MOTION_ZONES`/`validateMotionZone`/`luminanceChangesPerSecond`/types, `ritualTimeline`/`RITUAL_TOTAL_MS`/types, `pixelCardModel`/`cardAltText`/`PixelCardModel`, `composeTheme`/`peakGain`/`backgroundThemeActive`/`ThemeScore`, `BackgroundThemeLoaderPort`, and the five components (`PixelCard`, `SpreadPixelView`, `FullscreenCardView`, `NecronomiconRitual`, `SeerPortrait`). Keep the lazy engine chunk importable only via the loader port.
  - _Requirements: 1.1, 2.1, 3.1, 6.1, 7.1, 8.1_

- [x] 18. Checkpoint - components and exports
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Wire spread + fullscreen into the Terminal_Route
  - In `apps/web/src`, render `SpreadPixelView` from the Spec 05 session selectors (`visualCards`, `currentVisualReading`) when a reading completes, and open `FullscreenCardView` on card click, Enter on a focused card, and the `explain <position|card>` command for a card present in the reading; an absent `explain` reference returns an oracle-voice error naming valid positions/cards via the existing `renderExplain`/`renderError` path and leaves the view unchanged.
  - _Requirements: 2.3, 2.4, 3.1_

- [x] 20. Wire the Necronomicon ritual into `resurrect` + `?ritual=force` plumbing
  - Gate the `resurrect` result presentation through `ritualTimeline` using detected `motionMode`, `playwright`, `?boot=skip`, and the new `?ritual=force` flag; play `NecronomiconRitual` before the standard diff/patch view in full motion (or when forced), and render the diff in a single render when skipped. Plumb `?ritual=force` so it forces the ritual even during a Playwright run or `?boot=skip`, and keep demo mode (DEMO_SEED) deterministic.
  - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 21. Wire the Seer onto boot/landing and the background theme onto the sound-on gesture
  - Render `SeerPortrait` in the boot/landing area with the existing text landing as fallback. Subscribe the Terminal_Route to `backgroundThemeActive`: on a transition to true, lazily import the engine chunk and `start(composeTheme(seed))` within 1 s; on a transition to false (sound off / Web Audio unavailable / test or CI), `stop()` within 1 s; never start before a user gesture.
  - _Requirements: 7.1, 7.4, 8.4, 8.5, 8.7, 8.8, 8.10_

- [x] 22. Lazy-loading and chunking per performance budget
  - Load only the 3 visible Spread_View card images eagerly and set `loading="lazy"` on all other card images; keep the Motion_Zone_Table and the background-theme synthesis in separate lazy chunks excluded from the first Terminal_Route render. Extend `scripts/check-web-budget.mjs` `findSeparateChunks` to locate the new background-theme chunk alongside the demo/sound/resurrection chunks and keep `collectInitialRouteJs` excluding the motion-zone and theme synthesis.
  - _Requirements: 11.1, 11.2, 8.9_

- [x] 23. Checkpoint - wiring
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. Playwright end-to-end: arcana
  - Create `apps/web/e2e/arcana.e2e.ts` driving the offline demo path (Mock LLM, DEMO_SEED): full-screen card open and close by keyboard with focus restored; static images under Reduced_Motion (no zone/glitch animation); the Resurrection_Ritual rendered before the diff on `resurrect` using `?ritual=force` + `page.clock` for a deterministic <= 3 s timeline; lazy-loading assertion (3 eager spread cards, others `loading="lazy"`); and an automated axe scan reporting zero violations on the Spread_View, Fullscreen_Card_View, landing with the Seer, and the Resurrection_Ritual states.
  - _Requirements: 2.1, 2.2, 2.5, 2.7, 2.8, 4.7, 5.5, 6.1, 6.6, 10.3, 10.4, 10.5, 10.6, 11.1, 13.6_

- [x] 25. Screenshot capture update
  - Extend `apps/web/e2e/screenshots.e2e.ts` (capture-only, `CAPTURE_SCREENSHOTS`-gated) with four deterministic frames: the Spread_View with Pixel_Cards, a Fullscreen_Card_View, the Resurrection_Ritual open-book frame (clock frozen on the crossfade step with `?ritual=force`), and the landing with the Seer_Image. Add no production code and alter no Spec 05 behaviour.
  - _Requirements: 13.7_

- [x] 26. Asset and audio disclosure docs
  - Create `docs/ASSETS.md` stating, in English, that the card/Seer/Necronomicon art was AI-generated by the author and converted to pixel art, and that the Background_Theme is original, synthesized in code, and uses no external audio files or samples.
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 27. Update project docs
  - Update `docs/DECK.md` and `docs/ARCHITECTURE.md` to reflect the new public components, pure modules, and the background-theme subsystem, and append a dated entry to `docs/KIRO_USAGE.md` describing how the spec/steering/PBT workflow produced Arcana_Visions. (Docs discipline; no requirement number — supports R12 provenance context.)
  - _Requirements: 12.1_

- [x] 28. Final bundle-budget verification
  - Run the repo's existing budget check contract (`scripts/check-web-budget.mjs` / `apps/web/src/budget.test.ts`) to confirm the Terminal_Route gzipped JS stays at or below `BUDGET_BYTES = 250_000`, and that an over-budget build fails with an error reporting the measured size and the exceeded budget. Fix any overage by moving code into the lazy chunks from task 22.
  - _Requirements: 11.3, 11.4_

- [x] 29. Final checkpoint - full verification
  - Ensure `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:pbt`, `pnpm build`, and `pnpm e2e` all pass; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks; core implementation tasks are never optional. No task in this plan is marked "(Optional)" because every behaviour here is L0/L1 core for Arcana_Visions.
- Each pure module ships with its property test in the same parent task so correctness properties are pinned as the module is written.
- Requirement coverage: R1 → 2, 11, 12; R2 → 12, 14, 19, 24; R3 → 2, 13; R4 → 1, 4, 11, 12; R5 → 1, 11, 12; R6 → 5, 15, 20; R7 → 2, 16, 21; R8 → 7, 8, 21, 22; R9 → 10; R10 → 6, 12, 14, 24; R11 → 22, 28; R12 → 26, 27; R13 → property/unit sub-tasks throughout plus 24 and 25. Every requirement is covered by at least one task.
- No task touches `apps/web/public/arcana/*` images, `.env*`, or `.gitignore`, regenerates assets, or pushes/opens a PR.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1", "3.1", "4.1", "6.1", "7.1", "10.1"] },
    { "id": 1, "tasks": ["2.2", "3.2", "4.2", "5.1", "6.2", "7.2", "10.2", "11"] },
    { "id": 2, "tasks": ["5.2", "8", "12.1"] },
    { "id": 3, "tasks": ["12.2", "13.1", "14.1", "15.1", "16.1"] },
    { "id": 4, "tasks": ["13.2", "14.2", "15.2", "16.2", "17"] },
    { "id": 5, "tasks": ["19", "20", "21"] },
    { "id": 6, "tasks": ["22"] },
    { "id": 7, "tasks": ["24", "25", "26", "27"] },
    { "id": 8, "tasks": ["28"] }
  ]
}
```
