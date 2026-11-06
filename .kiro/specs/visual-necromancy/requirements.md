# Requirements Document

## Introduction

Visual Necromancy is a presentation layer that makes the Necro-Oracle's CRT
terminal dramatically more striking for the Kiroween judges while changing none
of the decisions the oracle already makes. It layers on top of the existing CRT
terminal (spec 03-crt-terminal) and resurrection engine (spec
resurrection-engine): a retro boot sequence, framed ASCII-art tarot cards with a bespoke illustration for each of the twelve registered cards, a
one-by-one card reveal with flip, severity-driven glitch effects, a
code "rot then rebirth" animation during resurrection, and tasteful phosphor
polish with optional sound cues bound to the existing sound toggle.

Every effect in this feature is purely presentational. The Visual_Layer never
decides whether a card is drawn, its orientation, its severity, its evidence,
whether a resurrection is REVIVED, or the vitality delta. It renders only what
the `Reading` from `runReading` and the resurrection result already contain.

Every effect is gated by the existing Motion_Mode: in reduced motion the
Visual_Layer skips all animation and renders the final visual state instantly,
with no flicker, glitch, typewriter, or flip. Every effect keeps the existing
accessibility contract: the Live_Region semantics of spec 03-crt-terminal are
preserved, decorative ASCII art is not announced by assistive technology, text
equivalents are available, and no visual flashes faster than three times per
second. In Demo mode every animation is deterministic so end-to-end tests and
screenshots are stable.

This feature adds only CSS and small TypeScript. It introduces no new heavy
runtime dependency and keeps the terminal route within its JavaScript bundle
budget. Where a requirement is a nice-to-have rather than a core deliverable, it
is marked **(OPTIONAL)** so it can be scheduled as a later task.

This document specifies requirements only. Design and implementation are out of
scope here. Concepts named in spec 03-crt-terminal (Motion_Mode,
Motion_Preference, Sound_State, Sound_Reducer, Live_Region, Output_Block,
Typewriter, Reading, CardDraw, Demo) are reused as defined there and are not
redefined except where this feature extends them.

## Glossary

- **Visual_Layer**: The presentation components and pure renderers added by this
  feature, living in `packages/ui-crt` and composed by `apps/web`, that render
  the boot sequence, ASCII cards, reveal, glitch, and resurrection animation on
  top of the existing Terminal.
- **Motion_Mode**: The existing Terminal animation state from spec
  03-crt-terminal, either `full` or `reduced`. In `reduced`, all time-based
  animation is disabled.
- **Motion_Preference**: The existing user choice `auto`, `on`, or `off` from
  spec 03-crt-terminal that, with the `prefers-reduced-motion` media query,
  determines Motion_Mode.
- **Sound_State**: The existing pure state `{ preference, gesture, visible }`
  from spec 03-crt-terminal governing sound effects.
- **Live_Region**: The existing Output_Log container from spec 03-crt-terminal,
  exposed to assistive technology with `role="log"`, `aria-live="polite"`, and
  `aria-relevant="additions"`.
- **Output_Block**: One unit of Output_Log content from spec 03-crt-terminal.
- **Typewriter**: The existing effect from spec 03-crt-terminal that reveals
  Output_Block text progressively, character by character.
- **Reading**: The validated result from `runReading` in `@necro/oracle`
  (`id`, `repo`, `draws`, `spread`, `vitality`, `createdAt`), as defined by
  `@necro/oracle`.
- **CardDraw**: One drawn card from a Reading, carrying a `CardId`, an
  `orientation` of `upright` or `reversed`, an integer `severity` from 0 to 3,
  a `summary`, and `evidence`, as defined by `@necro/oracle`.
- **CardId**: One of the identifiers in `CardIdSchema` of `@necro/oracle`, each
  a Major Arcana card with a roman numeral and a name in the card registry.
- **Deck_Card_Set**: The complete set of CardIds in `CardIdSchema`, the cards
  for which the ASCII_Card_Renderer must produce a frame.
- **Boot_Sequence**: The one-time retro startup animation shown on first load:
  a memory-check readout, the `NECROMANTIC SYSTEMS 1986` ASCII logo, and a
  phosphor warm-up flicker, ending at the ready prompt.
- **Boot_Frame**: One rendered text frame of the Boot_Sequence, produced by the
  Boot_Frame_Renderer as plain terminal text.
- **Boot_Frame_Renderer**: The pure function that maps a Boot_Sequence step
  index to a Boot_Frame, performing no clock, network, or DOM access.
- **ASCII_Card**: The framed text rendering of one CardDraw: a box-drawing border enclosing the roman numeral, the card name in uppercase, and a bespoke ASCII illustration evoking that card's motif (falling back to a generic illustration only when a card has none), rendered as selectable DOM text.
- **ASCII_Card_Renderer**: The pure function that maps a CardId and an
  orientation to an ASCII_Card frame, performing no clock, network, DOM, or
  random access.
- **Card_Back**: The face-down ASCII frame shown for a card before its reveal,
  identical for every card.
- **Card_Reveal**: The animation that flips a card from its Card_Back to its
  ASCII_Card, after which the card's diagnosis text types out via the
  Typewriter.
- **Glitch_Effect**: The brief visual disturbance (chromatic offset, scanline
  tear, and transient text corruption) applied to a card during its reveal.
- **Glitch_Intensity**: An integer from 0 to 3 that scales a Glitch_Effect,
  derived purely from a CardDraw's severity.
- **Glitch_Profile**: The pure mapping from a severity of 0 to 3 to a
  Glitch_Intensity of 0 to 3 and its bounded parameters (offset magnitude, tear
  count, corruption character count, and duration).
- **Resurrection_Animation**: The animation shown during the `resurrect` flow in
  which the pre-ritual code visibly decays (Rot_Transform) and is then reborn as
  the revived code, before the diff and vitality delta render.
- **Rot_Transform**: The pure function that maps a source text and a decay
  amount from 0 to 1 to a corrupted text in which a bounded, deterministic set
  of characters is replaced by decay glyphs.
- **Decay_Sequence**: The ordered list of decay amounts from 0 to 1 that drives
  the Rot_Transform frames of the Resurrection_Animation.
- **Demo_Seed**: The fixed seed used in Demo mode to make every Visual_Layer
  animation and any pseudo-random choice deterministic.
- **Bundle_Budget**: The JavaScript size ceiling for the terminal route, 250 KB
  gzipped, inherited from the project performance budget.
- **Flash_Limit**: The accessibility ceiling of at most three visual flashes per
  one-second window for any Visual_Layer effect.

## Requirements

### Requirement 1: One-time CRT boot sequence

**User Story:** As a judge opening the terminal, I want a short retro boot sequence, so that the first impression is a convincing 1986 necromantic machine coming to life.

#### Acceptance Criteria

1. WHEN the Terminal loads for the first time in a page session and Motion_Mode is `full`, THE Visual_Layer SHALL play the Boot_Sequence consisting of a memory-check readout, the `NECROMANTIC SYSTEMS 1986` ASCII logo, and a phosphor warm-up flicker, ending at the ready prompt within 3.5 seconds of the Boot_Sequence starting.
2. WHEN the Boot_Sequence ends, THE Visual_Layer SHALL show the existing boot phrase `NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP` as the first Output_Block and move keyboard focus to the Command_Line, preserving the behaviour of spec 03-crt-terminal Requirement 1.
3. WHEN the user presses any key other than a key producing only a modifier (Shift, Control, Alt, or Meta), or activates any control, while the Boot_Sequence is playing, THE Visual_Layer SHALL end the Boot_Sequence immediately and reach the same end state as criterion 2, showing the ready prompt and the boot phrase as the first Output_Block and moving keyboard focus to the Command_Line.
4. WHILE the Boot_Sequence is playing, THE Visual_Layer SHALL display a persistent visible hint that any key skips the boot sequence.
5. WHEN the Terminal has shown the Boot_Sequence once in a page session, THE Visual_Layer SHALL NOT replay the Boot_Sequence for the remainder of that page session.
6. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL skip the Boot_Sequence animation and show the ready prompt and the boot phrase immediately, with no memory-check scroll, no logo reveal animation, and no warm-up flicker.
7. THE Visual_Layer SHALL render every Boot_Frame as selectable DOM text and SHALL NOT render Boot_Sequence text into a canvas.
8. THE Visual_Layer SHALL mark the Boot_Sequence decorative ASCII logo so that assistive technology announces the text equivalent `NECROMANTIC SYSTEMS 1986` rather than the individual decorative glyphs.
9. IF the Boot_Sequence animation cannot run, THEN THE Visual_Layer SHALL show the ready prompt and the boot phrase as the first Output_Block immediately and move keyboard focus to the Command_Line, so that the Terminal always reaches the ready state.

### Requirement 2: Deterministic boot-frame rendering

**User Story:** As a maintainer, I want the boot frames produced by a pure renderer, so that the boot sequence is testable and stable in Demo mode.

#### Acceptance Criteria

1. THE Boot_Frame_Renderer SHALL map a Boot_Sequence step index to a Boot_Frame without clock access, network access, DOM access, or unseeded randomness.
2. WHEN the Boot_Frame_Renderer is called twice with the same step index, THE Boot_Frame_Renderer SHALL return an equal Boot_Frame (determinism property).
3. THE Boot_Frame_Renderer SHALL produce every Boot_Frame with lines of at most 72 columns, matching the Terminal column limit of spec 03-crt-terminal.
4. THE Boot_Frame_Renderer SHALL accept every step index in the Boot_Sequence range and return a Boot_Frame without throwing, and SHALL return the final ready frame for any index at or beyond the last step.

### Requirement 3: Framed ASCII tarot cards

**User Story:** As a user reading a spread, I want each card drawn as a framed ASCII card, so that the tarot is a vivid visual interface rather than plain text.

#### Acceptance Criteria

1. WHEN the Terminal renders a drawn CardDraw, THE Visual_Layer SHALL render an ASCII_Card containing a box-drawing border, the card's roman numeral, the card's name in uppercase, and a small ASCII illustration.
2. THE ASCII_Card_Renderer SHALL produce exactly one ASCII_Card for every CardId in the Deck_Card_Set and SHALL produce no ASCII_Card for any identifier that is not a member of the Deck_Card_Set, so that the set is complete and closed across the registered Major Arcana.
3. THE ASCII_Card_Renderer SHALL produce every ASCII_Card, in both orientations, with the same outer width in columns and the same outer height in rows.
4. WHEN a CardDraw has orientation `reversed`, THE Visual_Layer SHALL rotate the ASCII_Card 180 degrees while rendering the card name, roman numeral, and subtitle text in normal top-to-bottom, left-to-right reading order, preserving the orientation-is-meaning rule.
5. THE Visual_Layer SHALL render card names, roman numerals, and verdict words in uppercase and SHALL emit no emoji in any card.
6. THE Visual_Layer SHALL render each ASCII_Card as selectable DOM text and SHALL NOT render the card into a canvas.
7. THE Visual_Layer SHALL mark the decorative ASCII illustration of each ASCII_Card so that assistive technology announces an accessible text equivalent naming the card and orientation rather than the decorative glyphs, and SHALL NOT remove the card name and roman numeral from the accessible text.
8. THE ASCII_Card_Renderer SHALL perform no clock access, no network access, no DOM access, and no unseeded randomness.
9. WHEN the ASCII_Card_Renderer is called twice with the same CardId and orientation, THE ASCII_Card_Renderer SHALL return an equal ASCII_Card (determinism property).
10. IF the ASCII_Card_Renderer receives a CardId that is not a member of the Deck_Card_Set, THEN THE ASCII_Card_Renderer SHALL fail with a typed error rather than render a partial or blank card.
11. THE ASCII_Card_Renderer SHALL render a bespoke, recognisable ASCII illustration for each of the 12 CardIds in the Deck_Card_Set, each illustration evoking that card's motif (for example a lightning-struck tower for `tower`, a skull and scythe for `death`, a lantern for `hermit`, a spoked wheel for `wheel`), and SHALL use the generic illustration only as a fallback when a CardId has no bespoke illustration.
12. THE ASCII_Card_Renderer SHALL render every bespoke illustration within the same outer frame width and outer frame height as every other ASCII_Card, and SHALL render a recognisably distinct result for a CardId's `reversed` orientation versus its `upright` orientation.

### Requirement 4: One-by-one card reveal

**User Story:** As a user, I want cards to appear face-down and flip over one at a time before their diagnosis types out, so that the reading feels like a performed tarot draw.

#### Acceptance Criteria

1. WHEN the Terminal renders a Reading and Motion_Mode is `full`, THE Visual_Layer SHALL first show every spread position as a Card_Back, then reveal the positions one at a time in position order, flipping each Card_Back to its ASCII_Card and completing that card's diagnosis text before beginning the next position's flip.
2. WHEN a card's Card_Reveal flip completes, THE Visual_Layer SHALL type the card's diagnosis text using the existing Typewriter, preserving the rendering of spec 03-crt-terminal Requirement 7.
3. THE Visual_Layer SHALL render the identical Card_Back frame for every face-down position.
4. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL render every ASCII_Card already face-up with its full diagnosis text in its final complete state within the same render, with no Card_Back, no flip, and no Typewriter.
5. WHEN the user presses Escape during a Card_Reveal sequence, THE Visual_Layer SHALL immediately reveal all remaining cards and complete all diagnosis text to their final complete state with no further animation, extending the Escape behaviour of spec 03-crt-terminal Requirement 3.
6. WHEN a Reading is rendered, THE Visual_Layer SHALL render the spread positions in the same order and with the same position labels as the Reading, and SHALL NOT reorder, add, or omit any position.
7. THE Visual_Layer SHALL preserve the existing Live_Region semantics so that each revealed card's text is added to the `role="log"` region exactly once per reveal.
8. IF a Reading contains no spread positions, THEN THE Visual_Layer SHALL render no Card_Back and no ASCII_Card and SHALL complete without error.

### Requirement 5: Severity-driven glitch effects

**User Story:** As a user, I want severe cards such as THE TOWER and DEATH to visibly glitch while calm cards stay steady, so that danger is felt, not just read.

#### Acceptance Criteria

1. WHEN a card is revealed and Motion_Mode is `full`, THE Visual_Layer SHALL apply a Glitch_Effect whose Glitch_Intensity is derived purely from that CardDraw's severity through the Glitch_Profile.
2. THE Glitch_Profile SHALL map severity 0 to Glitch_Intensity 0, severity 1 to Glitch_Intensity 1, severity 2 to Glitch_Intensity 2, and severity 3 to Glitch_Intensity 3.
3. WHEN a CardDraw has severity 0, THE Visual_Layer SHALL apply no chromatic offset, no scanline tear, and no text corruption to that card.
4. WHEN a CardDraw has a higher severity than another CardDraw, THE Glitch_Profile SHALL assign the higher-severity CardDraw a Glitch_Intensity greater than or equal to the lower-severity CardDraw (monotonicity property).
5. THE Glitch_Profile SHALL derive the Glitch_Intensity and each glitch parameter (offset magnitude, tear count, corruption character count, and duration) as finite bounded values from severity alone, without clock access, network access, DOM access, or unseeded randomness.
6. WHEN the Glitch_Profile is called twice with the same severity, THE Glitch_Profile SHALL return an equal Glitch_Intensity and equal bounded parameters (determinism property).
7. WHERE a CardDraw is one of the burning cards `tower` or `devil`, THE Visual_Layer MAY tint the Glitch_Effect with the warning amber `#ffb000`.
8. IF a CardDraw is not one of the burning cards `tower` or `devil`, THEN THE Visual_Layer SHALL NOT tint its Glitch_Effect with the warning amber `#ffb000`.
9. WHEN the `tower` card is revealed at severity 2 or greater and Motion_Mode is `full`, THE Visual_Layer SHALL shake the card for at most 300 milliseconds, matching the tarot-ux shake allowance.
10. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL apply no Glitch_Effect and SHALL render every card in its final steady state with no chromatic offset, no scanline tear, and no text corruption.
11. THE Visual_Layer SHALL keep every Glitch_Effect within the Flash_Limit of at most three flashes in any rolling one-second window.
12. THE Visual_Layer SHALL convey severity through the rendered severity integer and card text and SHALL NOT rely on the Glitch_Effect alone to convey severity.

### Requirement 6: Resurrection rot-and-rebirth animation

**User Story:** As a user running a resurrection, I want to watch the old code rot and then be reborn, so that the revival is dramatic before I read the diff and vitality delta.

#### Acceptance Criteria

1. WHEN the `resurrect` flow transitions from the pre-ritual code to the revived code and Motion_Mode is `full`, THE Visual_Layer SHALL play the Resurrection_Animation that first decays the pre-ritual code through the Rot_Transform and then reveals the revived code.
2. WHEN the Resurrection_Animation completes, THE Visual_Layer SHALL render the diff and the vitality delta exactly as produced by the resurrection engine, and SHALL NOT alter the diff content or the vitality delta.
3. THE Visual_Layer SHALL drive the Resurrection_Animation frames from the Decay_Sequence, whose first decay amount is 0 and whose last decay amount is 1 and whose amounts are non-decreasing, and SHALL NOT change which lines the diff adds, removes, or keeps.
4. THE Rot_Transform SHALL map a source text and a decay amount of 0 to the original source text unchanged.
5. WHEN the Rot_Transform receives a decay amount of 1, THE Rot_Transform SHALL replace characters with decay glyphs only at existing character positions, with a corrupted-character count that never exceeds the source text length, while preserving the line count and the total length of the source text.
6. WHEN the Rot_Transform receives a higher decay amount than another, THE Rot_Transform SHALL corrupt at least as many characters as the lower decay amount (monotonicity property).
7. THE Rot_Transform SHALL perform no clock access, no network access, no DOM access, and no unseeded randomness, taking any pseudo-random choice from a seed passed as an argument.
8. WHEN the Rot_Transform is called twice with the same source text, decay amount, and seed, THE Rot_Transform SHALL return an equal corrupted text (determinism property).
9. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL skip the Resurrection_Animation and render the revived code, the diff, and the vitality delta in a single synchronous render with zero intermediate rot or rebirth frames.
10. THE Visual_Layer SHALL render the revived code, the diff, and the vitality delta as selectable DOM text and SHALL preserve the existing Live_Region semantics for the resurrection result.
11. THE Visual_Layer SHALL keep the Resurrection_Animation within the Flash_Limit of at most three flashes in any rolling one-second window.
12. WHEN the Rot_Transform receives a decay amount outside the range 0 to 1, THE Rot_Transform SHALL clamp the decay amount to the nearest value within the range 0 to 1 before corrupting the source text.

### Requirement 7: Phosphor polish and palette discipline

**User Story:** As a user, I want tasteful phosphor glow and correct colours, so that the terminal looks authentic without becoming hard to read.

#### Acceptance Criteria

1. THE Visual_Layer SHALL render the terminal foreground in phosphor `#33ff66` on background `#001a00`, with dim text in `#1f9e45`, matching the tarot-ux palette.
2. THE Visual_Layer SHALL use the warning amber `#ffb000` only for the burning cards `tower` and `devil`, and SHALL use the error red `#ff3355` only for a STILL DEAD verdict.
3. THE Visual_Layer SHALL render display text in the VT323 font and evidence text in the IBM Plex Mono font, matching the tarot-ux typography.
4. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL disable pulsing glow, flicker, and afterglow, preserving the behaviour of spec 03-crt-terminal.
5. THE Visual_Layer SHALL maintain a text contrast ratio of at least 4.5 to 1 between rendered foreground text and its background.
6. THE Visual_Layer SHALL keep every added animation within the Flash_Limit of at most three flashes per one-second window.

### Requirement 8: Sound cues bound to the existing sound toggle

**User Story:** As a user, I want optional sound cues for the new effects, so that the drama can be heard, but only when I have turned sound on.

#### Acceptance Criteria

1. WHERE Sound_State resolves sound to on under the existing Sound_Reducer rules, THE Visual_Layer MAY play a short sound cue for a Boot_Sequence completion, a Card_Reveal, a Glitch_Effect, and a resurrection rebirth.
2. WHILE Sound_State resolves sound to off, THE Visual_Layer SHALL play no sound cue for any Visual_Layer effect.
3. THE Visual_Layer SHALL play no Visual_Layer sound cue before the user gesture required by the existing Sound_State rules has occurred, and SHALL NOT autoplay any sound cue.
4. THE Visual_Layer SHALL default every Visual_Layer sound cue to off, following the existing sound-off default.
5. WHILE Motion_Mode is `reduced`, THE Visual_Layer SHALL still honour Sound_State for sound cues, treating sound and motion as independent preferences.

### Requirement 9: Determinism in Demo mode

**User Story:** As a maintainer, I want every new animation to be deterministic in Demo mode, so that end-to-end tests and screenshots are stable.

#### Acceptance Criteria

1. WHILE the Terminal is in Demo mode, THE Visual_Layer SHALL drive every Glitch_Effect, Rot_Transform, and other pseudo-random choice from the Demo_Seed rather than from the wall clock or unseeded randomness.
2. WHEN a Demo reading is rendered twice with the same Demo_Seed, THE Visual_Layer SHALL produce the same sequence of Glitch_Effect parameters and the same Rot_Transform outputs (reproducibility property).
3. THE Visual_Layer SHALL derive the Boot_Sequence frames, the Card_Reveal order, and the Resurrection_Animation frame content solely from the Reading, the resurrection result, and the Demo_Seed in Demo mode.
4. THE Visual_Layer SHALL keep Demo-mode rendering free of network access, matching the no-network guarantee of spec 03-crt-terminal Demo replay.

### Requirement 10: Accessibility and no-JavaScript fallback preserved

**User Story:** As a user relying on assistive technology or with JavaScript disabled, I want the new visuals to stay accessible, so that the drama never costs me the content.

#### Acceptance Criteria

1. THE Visual_Layer SHALL preserve the existing Live_Region semantics of spec 03-crt-terminal, keeping `role="log"`, `aria-live="polite"`, and `aria-relevant="additions"` on the Output_Log container.
2. THE Visual_Layer SHALL mark every decorative ASCII glyph region as hidden from assistive technology or SHALL provide an accessible text equivalent, so that assistive technology announces the card name, roman numeral, orientation, and diagnosis rather than the decorative glyphs.
3. THE Visual_Layer SHALL keep every added effect within the Flash_Limit of at most three flashes per one-second window, so that no effect flashes faster than three times per second.
4. THE Visual_Layer and the Boot_Sequence SHALL preserve the existing no-JavaScript contract of spec 03-crt-terminal exactly as implemented: a visible, server-rendered element `<p id="no-js-note" class="crt-no-js" role="note">` that is the first child of `<body>` and carries the boot phrase and the requires-JavaScript note, hidden for JavaScript users only through the existing `html[data-js="ready"] .crt-no-js { display: none }` rule, plus the secondary `<noscript>` fallback; the Visual_Layer and the Boot_Sequence SHALL NOT remove, move, or re-parent that element, SHALL NOT hide it by any other mechanism, and SHALL NOT delay setting `html[data-js="ready"]` in a way that keeps the note visible after the terminal mounts.
5. THE Visual_Layer SHALL pass an automated accessibility scan (axe) with no new violations introduced by the boot sequence, ASCII cards, card reveal, glitch effects, or resurrection animation.
6. WHEN keyboard focus reaches any Visual_Layer control, THE Visual_Layer SHALL keep the control operable by keyboard, preserving the keyboard-first contract of spec 03-crt-terminal.
7. THE Boot_Sequence SHALL NOT prevent, delay, or alter the appearance of the boot phrase for the existing end-to-end tests of spec 03-crt-terminal, so that the `boot.e2e.ts` "boot" and "no JavaScript (R1.5)" specs stay green.

### Requirement 11: Bundle budget and dependency discipline

**User Story:** As a maintainer, I want the new visuals to stay light, so that the terminal route stays fast and within budget.

#### Acceptance Criteria

1. THE Visual_Layer SHALL keep the terminal route JavaScript within the Bundle_Budget of 250 KB gzipped.
2. IF the Visual_Layer requires a Bundle_Budget larger than 250 KB gzipped, THEN the design SHALL state the new budget and its justification explicitly rather than exceeding the budget silently.
3. THE Visual_Layer SHALL be implemented with CSS and TypeScript only and SHALL add no new heavy runtime dependency.
4. THE Visual_Layer SHALL lazily load any asset that is not required for the first terminal render, keeping the initial route within the Bundle_Budget.

### Requirement 12: Regression safety for the existing terminal

**User Story:** As a maintainer, I want the existing terminal behaviour to keep working, so that adding drama breaks nothing that already passes.

#### Acceptance Criteria

1. THE Visual_Layer SHALL preserve the existing command behaviour of spec 03-crt-terminal for `help`, `summon`, `read`, `explain`, `clear`, `motion`, `demo`, and `sound`.
2. THE Visual_Layer SHALL render only the cards, orientations, severities, evidence, and positions present in the Reading, and SHALL NOT add, remove, reorder, or alter any draw, orientation, severity, or evidence.
3. THE Visual_Layer SHALL keep the existing unit, property, and end-to-end test suites passing.
4. WHEN the `motion` command changes Motion_Preference, THE Visual_Layer SHALL update every Visual_Layer effect to the resulting Motion_Mode, so that switching to `off` immediately stops animation and switching to `on` re-enables it for subsequent effects.
5. WHEN the Terminal runs under reduced motion or under an explicit test signal (such as a query-string flag or an environment variable set by the Playwright end-to-end runner), THE Boot_Sequence SHALL be skipped or fast-forwarded to the ready state so that the boot phrase is available to the existing end-to-end tests without added delay, and the design SHALL document that test signal; in Demo mode WITHOUT such a test signal, THE Boot_Sequence SHALL still play in full (Motion_Mode permitting) and SHALL remain deterministic, so that judges using Demo mode see the boot sequence.

### Requirement 13: Optional visual and audio polish

**User Story:** As a user, I want extra flourishes, so that the oracle feels even richer when time allows, without blocking the core feature.

#### Acceptance Criteria

1. **(OPTIONAL)** WHERE additional ambient sound cues are enabled and Sound_State resolves sound to on, THE Visual_Layer MAY play a low continuous hum during the Resurrection_Animation, following all Sound_State gesture and default-off rules.
2. **(OPTIONAL)** WHERE Motion_Mode is `full`, THE Visual_Layer MAY add a brief phosphor bloom when a severity 3 card is revealed, staying within the Flash_Limit.
3. **(OPTIONAL)** WHERE Motion_Mode is `full`, THE Visual_Layer MAY animate the vitality delta counting up or down to its final value, showing the final value immediately in reduced motion.
4. IF any optional flourish cannot meet the Bundle_Budget, the Flash_Limit, or the accessibility scan, THEN the design SHALL drop that flourish rather than ship it.
