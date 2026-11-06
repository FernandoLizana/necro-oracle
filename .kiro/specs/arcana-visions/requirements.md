# Requirements Document

## Introduction

Arcana_Visions upgrades the presentation of The Necro-Oracle with the pixel-art arcana that already exist in `apps/web/public/arcana/` (15 lossless WebP images plus `manifest.json`). It renders the 12 major-arcana diagnosis cards, the Seer landing image, and the Necronomicon ritual as pixel-perfect, integer-scaled sprites with CSS-only motion zones, an original DOS-flavoured background theme, and a Necronomicon resurrection ritual.

Arcana_Visions is an additive presentation layer over the existing Visual_Necromancy feature (Spec 05). Everything Spec 05 ships — boot sequence, ASCII cards, severity glitch, rot-and-rebirth, CRT styling — MUST keep working. The ASCII card stays the compact and no-image fallback view. Arcana_Visions never regenerates, edits, downloads, or replaces any image, and never modifies `.env*`, `.gitignore`, or the committed `.kiro` tree.

The manifest supplies only card ids, logical pixel sizes, and header/footer band rows; its `png`, `preview`, `box`, and workspace paths are ignored. The header and footer bands of every 120×160 card are intentionally blank so the application renders the Roman numeral, title, and position/orientation/diagnosis as real CRT-font DOM text over those bands.

## Glossary

- **Arcana_Visions**: The pixel-art presentation layer specified by this document.
- **Visual_Layer**: The existing Spec 05 presentation layer (boot, ASCII cards, glitch, rot-and-rebirth, CRT) over the terminal. Its behaviour is preserved, not replaced.
- **Pixel_Card**: A rendered arcana image sprite for one of the 12 major-arcana diagnosis cards (`judgement`, `tower`, `devil`, `death`, `wheel`, `hermit`, `hanged_man`, `temperance`, `justice`, `moon`, `star`, `world`) at logical size 120×160 px.
- **ASCII_Card**: The box-drawing text card rendered by the Visual_Layer, used as the compact and fallback view.
- **Seer_Image**: The `seer` landscape image (256×144 logical px) shown as the oracle's portrait in the boot/landing area.
- **Necronomicon_Closed**: The `necronomicon-closed` image (108×144 logical px).
- **Necronomicon_Open**: The `necronomicon-open` image (256×144 logical px).
- **Logical_Size**: The native logical pixel dimensions of an image declared in the manifest (`120×160`, `256×144`, or `108×144`).
- **Integer_Scale**: The largest positive integer factor by which a Pixel_Card's Logical_Size fits within the available viewport region along both axes.
- **Text_Bands**: The blank header rows `[0,19]` and footer rows `[147,160]` of a 120×160 card, reserved for DOM text — the Roman numeral and title in the header band, and the position and orientation in the footer band. The one-line diagnosis is rendered as DOM text directly below the card image, outside the Text_Bands.
- **Diagnosis_Caption**: The one-line diagnosis text rendered as DOM text directly below the card image, outside the card image and the Text_Bands, present in both the Spread_View and the Fullscreen_Card_View.
- **Motion_Zone**: A typed, pure-data rectangular region in logical pixels within a card image that animates with CSS only.
- **Motion_Zone_Table**: The pure-data module authored by the implementer that declares the Motion_Zones per card.
- **Flash_Limit**: At most 2 luminance changes per second per animated region, for photosensitivity safety.
- **Reduced_Motion**: The user state in which motion is disabled, set by the OS `prefers-reduced-motion` setting or the terminal `motion off` command.
- **Glitch_Profile**: The existing Spec 05 severity-to-glitch parameter mapping (`glitchProfile(severity)`).
- **Severity**: The integer 0–3 diagnosis severity of a drawn card.
- **CardDraw**: A single drawn card in a Reading, carrying its card id, orientation, position, and Severity (`CardDraw severity`).
- **Motion_Mode**: The active motion setting with value `full` when motion is enabled and `reduced` when Reduced_Motion is active.
- **Fullscreen_Card_View**: The full-screen presentation of a single Pixel_Card opened after a reading.
- **Spread_View**: The horizontal 3-card layout that renders the drawn cards of a fates spread.
- **Resurrection_Ritual**: The Necronomicon animation played by the `resurrect` command before the diff/patch view.
- **Ritual_Force_Flag**: The explicit opt-in signal (`?ritual=force`) that forces the Resurrection_Ritual to play even while a Playwright run or `?boot=skip` is active, used only by the ritual end-to-end test and the screenshot test with a controlled clock.
- **Background_Theme**: The original looping DOS-style music synthesized at runtime with Web Audio.
- **Sound_State**: The existing on/off sound state controlled by the `sound on` / `sound off` commands.
- **Palette**: The fixed 4-shade set `#001a00`, `#0b4f1a`, `#2fa84a`, `#8cff9e`.
- **Bundle_Budget**: The gzipped JavaScript size ceiling of 250 KB for the terminal route.
- **Demo_Seed**: The existing `DEMO_SEED` constant that makes demo-mode playback deterministic.
- **Oracle_Voice**: The narration persona and formatting rules in `.kiro/steering/oracle-voice`.
- **Terminal_Route**: The Next.js App Router route that renders the CRT terminal.

## Requirements

### Requirement 1: Pixel-perfect card rendering

**User Story:** As a developer viewing a reading, I want the arcana drawn as crisp integer-scaled pixel art, so that the cards look like authentic 1986 console sprites rather than blurred images.

#### Acceptance Criteria

1. WHEN a Pixel_Card is rendered, THE Arcana_Visions SHALL apply `image-rendering: pixelated` to the card image element.
2. WHEN a Pixel_Card is rendered in an available viewport region, THE Arcana_Visions SHALL display its 120×160 source image scaled on both axes by the Integer_Scale factor for that region.
3. THE Arcana_Visions SHALL render every Pixel_Card at an Integer_Scale that is a whole number of 1 or greater and never a fractional factor.
4. IF the available viewport region is smaller than 120 px wide or 160 px tall, THEN THE Arcana_Visions SHALL render the Pixel_Card at scale factor 1 and allow the containing region to scroll or clip.
5. THE Arcana_Visions SHALL render every Pixel_Card using only the 4 Palette colors with no CSS filter that blurs, smooths, or alters the rendered pixel colors applied to the image element.
6. WHEN a Pixel_Card is displayed, THE Arcana_Visions SHALL render the Roman numeral and card title as CRT-font DOM text within the header rows [0,19] of the Text_Bands, and SHALL render the position and orientation as CRT-font DOM text within the footer rows [147,160] of the Text_Bands.
7. WHEN a Pixel_Card is displayed, THE Arcana_Visions SHALL render the Diagnosis_Caption as CRT-font DOM text directly below the card image and outside the Text_Bands, in both the Spread_View and the Fullscreen_Card_View.
8. WHILE a Pixel_Card is rendered at Integer_Scale 1, THE Arcana_Visions SHALL keep the header, footer, and Diagnosis_Caption text legible, clipping overflowing text with an ellipsis and never overflowing the footer band or the header band.
9. IF a Pixel_Card image fails to load, THEN THE Arcana_Visions SHALL render the ASCII_Card content for that card in place of the image element with no broken-image indicator.

### Requirement 2: Full-screen card view

**User Story:** As a developer, I want to open any drawn card full-screen and move between cards by keyboard, so that I can inspect each diagnosis closely without a mouse.

#### Acceptance Criteria

1. WHEN a user activates a drawn card by mouse click, THE Arcana_Visions SHALL open the Fullscreen_Card_View for that card within 500 milliseconds.
2. WHEN a focused drawn card receives the Enter key, THE Arcana_Visions SHALL open the Fullscreen_Card_View for that card within 500 milliseconds.
3. WHEN a user enters the command `explain <position|card>` for a card present in the current reading, THE Arcana_Visions SHALL open the Fullscreen_Card_View for the referenced card within 500 milliseconds.
4. IF the `explain` command references a position or card absent from the current reading, THEN THE Arcana_Visions SHALL return an Oracle_Voice error message that states the reference was not found and names the valid positions or cards, and SHALL leave the view unchanged.
5. WHILE the Fullscreen_Card_View is open, THE Arcana_Visions SHALL advance to the next drawn card in spread order on the Right or Down arrow key and to the previous drawn card in spread order on the Left or Up arrow key, wrapping from the last card to the first and from the first card to the last.
6. WHILE the Fullscreen_Card_View is open AND the reading contains exactly one drawn card, THE Arcana_Visions SHALL keep that card displayed on any navigation action.
7. WHILE the Fullscreen_Card_View is open, THE Arcana_Visions SHALL confine keyboard focus to the controls of the Fullscreen_Card_View.
8. WHEN the Escape key is received while the Fullscreen_Card_View is open, THE Arcana_Visions SHALL close the Fullscreen_Card_View and return keyboard focus to the element that had focus before the view opened.
9. WHILE a reversed card is shown in the Fullscreen_Card_View, THE Arcana_Visions SHALL rotate the card image 180 degrees and SHALL keep the numeral, title, position, orientation, and diagnosis text upright and readable.

### Requirement 3: Spread view

**User Story:** As a developer, I want the three-card fates spread shown as horizontal pixel cards with a reliable text fallback, so that the reading is legible whether or not images load.

#### Acceptance Criteria

1. WHEN a fates reading completes, THE Arcana_Visions SHALL render exactly 3 drawn cards in the Spread_View as a left-to-right horizontal row in the Reading's spread order.
2. WHEN the Spread_View renders a Pixel_Card, THE Arcana_Visions SHALL display the image scaled by an Integer_Scale factor with no fractional scaling applied.
3. IF a card image fails to load or is unavailable, THEN THE Arcana_Visions SHALL render the ASCII_Card for that position in the same slot.
4. WHERE JavaScript is disabled, THE Arcana_Visions SHALL present the ASCII_Card content for each of the 3 drawn positions in the Reading's spread order.
5. WHEN the Spread_View renders, THE Arcana_Visions SHALL keep the slot order equal to the Reading's spread order with no position reordered, duplicated, or omitted.

### Requirement 4: Motion zones

**User Story:** As a developer, I want subtle living detail on the cards — flickering flames, shimmering water, a pulsing glow — so that the arcana feel alive while staying safe and faithful to the pixel aesthetic.

#### Acceptance Criteria

1. THE Motion_Zone_Table SHALL be a typed, pure-data module that declares each Motion_Zone as a rectangle in logical pixels associated with a card id.
2. THE Arcana_Visions SHALL animate Motion_Zones using CSS only, with `steps()` timing functions.
3. THE Motion_Zone_Table SHALL define Motion_Zones for `tower` flame flicker, `star` hair and water shimmer, `moon` glow pulse, `hermit` lantern flicker, `judgement` light rays, and `seer` candle and crystal-ball glow.
4. THE Arcana_Visions SHALL render every Motion_Zone animation using only the 4 Palette colors.
5. WHILE a Motion_Zone animates, THE Arcana_Visions SHALL limit luminance changes within that Motion_Zone to the Flash_Limit of at most 2 luminance changes per second.
6. WHILE a Motion_Zone animates, THE Arcana_Visions SHALL keep every animated pixel displacement and amplitude fully within the bounds of its declared rectangle, with no rendered change outside that rectangle.
7. WHILE Reduced_Motion is active, THE Arcana_Visions SHALL display Motion_Zones as static images with no animation.
8. THE Motion_Zone_Table SHALL define every Motion_Zone rectangle to lie fully within the card's Logical_Size and fully outside the Text_Bands.
9. IF a Motion_Zone rectangle extends beyond the card's Logical_Size or overlaps any Text_Band, THEN THE Arcana_Visions SHALL omit that Motion_Zone's animation, display the affected region as a static image, and emit a development-time console warning identifying the invalid Motion_Zone, with no user-visible message in the terminal.

### Requirement 5: Severity glitch on pixel cards

**User Story:** As a developer, I want unhealthy cards to glitch visibly, so that severity reads at a glance consistent with the existing terminal.

#### Acceptance Criteria

1. WHEN a Pixel_Card whose CardDraw severity is greater than 0 and at most 3 is rendered WHILE Motion_Mode is `full`, THE Arcana_Visions SHALL apply the Glitch_Profile derived from that severity to the Pixel_Card.
2. WHEN a Pixel_Card whose CardDraw severity is 0 is rendered, THE Arcana_Visions SHALL render the Pixel_Card with no chromatic offset, no scanline tear, and no text corruption.
3. WHEN a glitch effect plays on a Pixel_Card, THE Arcana_Visions SHALL play the glitch as a one-shot animation with an iteration count of 1 lasting at most 300 milliseconds.
4. WHEN a glitch animation completes, THE Arcana_Visions SHALL leave the Pixel_Card in a single-image resting state with no chromatic offset, no scanline tear, and no text corruption.
5. WHILE Motion_Mode is `reduced`, THE Arcana_Visions SHALL render every Pixel_Card with no chromatic offset, no scanline tear, and no text corruption.
6. THE Arcana_Visions SHALL keep every Pixel_Card glitch effect within the Flash_Limit of at most 2 luminance changes per second.

### Requirement 6: Necronomicon resurrection ritual

**User Story:** As a developer running `resurrect`, I want a Necronomicon ritual that opens the book and raises the resurrected code, so that the patch arrives with the gravity of a ritual before I read the diff.

#### Acceptance Criteria

1. WHEN the `resurrect` command begins its result presentation in full motion, THE Arcana_Visions SHALL display the Necronomicon_Closed image with a glitch effect, then a brief tremble, then a crossfade to the Necronomicon_Open image, then the resurrected diff lines rising from the pages line by line, then the standard diff and patch view.
2. WHEN the Resurrection_Ritual plays in full motion, THE Arcana_Visions SHALL complete the Resurrection_Ritual within 3 seconds measured from the first rendered frame to the display of the standard diff and patch view.
3. WHEN the Escape key is received during the Resurrection_Ritual, THE Arcana_Visions SHALL end the Resurrection_Ritual and display the standard diff and patch view within 100 milliseconds.
4. WHILE Reduced_Motion is active, THE Arcana_Visions SHALL skip the Resurrection_Ritual animation and display the standard diff and patch view in a single render.
5. WHILE a Playwright run or the `?boot=skip` flag is active AND the Ritual_Force_Flag is not set, THE Arcana_Visions SHALL skip the Resurrection_Ritual animation and display the standard diff and patch view in a single render.
6. WHILE the Ritual_Force_Flag is set AND Reduced_Motion is not active, THE Arcana_Visions SHALL play the full Resurrection_Ritual even during a Playwright run or while `?boot=skip` is active.
7. WHILE demo mode is active in full motion, THE Arcana_Visions SHALL play the full Resurrection_Ritual.
8. WHEN the Resurrection_Ritual plays in demo mode, THE Arcana_Visions SHALL produce the same ritual timeline and frame content for a given Demo_Seed across repeated renders.
9. THE Arcana_Visions SHALL render the diff and patch content of a resurrection unchanged by the Resurrection_Ritual.
10. IF the Necronomicon_Closed image or the Necronomicon_Open image fails to load during the Resurrection_Ritual, THEN THE Arcana_Visions SHALL skip the remaining ritual animation and display the standard diff and patch view in a single render.

### Requirement 7: Seer landing image

**User Story:** As a visitor, I want the Seer shown on the landing screen, so that the oracle has a face when I arrive.

#### Acceptance Criteria

1. WHEN the boot and landing area is displayed, THE Arcana_Visions SHALL render the Seer_Image at its native 256×144 resolution scaled by the largest Integer_Scale factor of 1 or greater that fits within the landing area, as the oracle's portrait.
2. THE Arcana_Visions SHALL render the Seer_Image with `image-rendering: pixelated` using only the 4 Palette colors.
3. WHEN the Seer_Image is rendered, THE Arcana_Visions SHALL preserve the 16:9 aspect ratio of its native 256×144 resolution with no distortion or cropping.
4. IF the Seer_Image is unavailable, THEN THE Arcana_Visions SHALL display the existing text landing content with no Seer_Image, with no layout error or broken-image indicator.

### Requirement 8: Original DOS-style background theme

**User Story:** As a visitor with sound on, I want an original looping chiptune theme, so that the terminal feels like a 1986 machine without using anyone else's music.

#### Acceptance Criteria

1. THE Background_Theme SHALL be an original looping composition synthesized at runtime with Web Audio using square and triangle oscillators and simple arpeggios at a peak output gain of at most 0.2 on the normalized 0.0–1.0 scale.
2. THE Background_Theme SHALL loop with no audible gap or restart artifact at the loop boundary.
3. THE Arcana_Visions SHALL play the Background_Theme using no audio files, no audio samples, and no melody copied from any existing game or song.
4. WHILE Sound_State is off, THE Arcana_Visions SHALL play no Background_Theme audio.
5. WHEN a user gesture occurs WHILE Sound_State is on, THE Arcana_Visions SHALL start the Background_Theme within 1 second.
6. WHILE no user gesture has occurred, THE Arcana_Visions SHALL play no Background_Theme audio.
7. WHEN Sound_State transitions from on to off, THE Arcana_Visions SHALL stop the Background_Theme within 1 second.
8. IF Web Audio is unavailable, THEN THE Arcana_Visions SHALL play no Background_Theme audio and SHALL keep the Terminal_Route usable.
9. THE Arcana_Visions SHALL load the Background_Theme synthesis code in a lazy chunk outside the first Terminal_Route render.
10. WHILE a test or CI run is active, THE Arcana_Visions SHALL start no Background_Theme audio.

### Requirement 9: Help and spread-type consistency

**User Story:** As a developer reading the help text, I want the listed `read` spreads to match the spreads the system actually supports, so that help never advertises a spread that does not work.

#### Acceptance Criteria

1. THE Arcana_Visions SHALL record, in a help-consistency resolution note, the investigation of whether the `celtic` spread is accepted by the `read` command and produces a valid reading end to end, together with the chosen resolution and its reason.
2. WHERE the `celtic` spread is accepted by the `read` command and produces a valid reading end to end, THE Arcana_Visions SHALL document the `celtic` spread in the `help` output.
3. WHERE the `celtic` spread is not accepted by the `read` command or does not produce a valid reading end to end, THE Arcana_Visions SHALL remove the `celtic` spread from the spread types and from every surface that offers it.
4. THE set of `read` spreads listed in the `help` output SHALL equal exactly the set of spread types the system accepts for the `read` command.

### Requirement 10: Accessibility

**User Story:** As a keyboard and screen-reader user, I want the arcana fully usable without a mouse and without relying on motion, so that the reading is accessible.

#### Acceptance Criteria

1. WHEN a Pixel_Card is rendered, THE Arcana_Visions SHALL provide alternative text containing the card name, its orientation stated as either "upright" or "reversed", and a one-line meaning of at most 120 characters for that card.
2. THE Arcana_Visions SHALL present every diagnosis, orientation, and verdict as DOM text that remains readable when all animation is stopped.
3. WHILE a user operates the interface using only a keyboard, THE Arcana_Visions SHALL allow the user to reach and activate every interactive control in the Spread_View, Fullscreen_Card_View, and Resurrection_Ritual via keyboard input, with focus moving in a consistent reading order.
4. WHEN an automated axe accessibility scan runs on the Spread_View, Fullscreen_Card_View, landing with the Seer_Image, and Resurrection_Ritual states, THE Arcana_Visions SHALL report zero axe violations.
5. WHILE any interactive control has keyboard focus, THE Arcana_Visions SHALL display a visible focus indicator on that control.
6. WHEN the Fullscreen_Card_View opens, THE Arcana_Visions SHALL move keyboard focus into the Fullscreen_Card_View, and WHEN the Fullscreen_Card_View closes, THE Arcana_Visions SHALL return keyboard focus to the control that opened it.

### Requirement 11: Performance

**User Story:** As a visitor on a constrained connection, I want the terminal route to stay light, so that the first reading loads fast.

#### Acceptance Criteria

1. WHEN the Terminal_Route performs its first render, THE Arcana_Visions SHALL load the card images of the currently visible Spread_View and SHALL defer loading of all other card images until they enter the viewport.
2. WHEN the Terminal_Route performs its first render, THE Arcana_Visions SHALL exclude the Motion_Zone_Table and the Background_Theme synthesis code from the initial render, loading each as a separate lazy chunk only after the first render completes.
3. THE Arcana_Visions SHALL keep the gzipped JavaScript size of the Terminal_Route at or below the Bundle_Budget of 250 KB.
4. IF the gzipped JavaScript size of the Terminal_Route exceeds the Bundle_Budget of 250 KB, THEN THE Arcana_Visions SHALL fail the build and SHALL report an error indicating the measured size and the exceeded budget.

### Requirement 12: Asset and audio disclosure documentation

**User Story:** As a judge or contributor, I want the provenance of the art and music documented, so that the AI-generated art and the original synthesized music are disclosed.

#### Acceptance Criteria

1. THE Arcana_Visions SHALL provide a `docs/ASSETS.md` document that is committed to the repository.
2. THE `docs/ASSETS.md` SHALL state, in English, that the card art, Seer art, and Necronomicon art were AI-generated by the author and subsequently converted to pixel art.
3. THE `docs/ASSETS.md` SHALL state, in English, that the Background_Theme music is original, is synthesized in code, and uses no external audio files and no audio samples.

### Requirement 13: Verification coverage

**User Story:** As a maintainer, I want the behaviour of Arcana_Visions pinned by unit, property, and end-to-end tests, so that regressions and safety limits are caught automatically.

#### Acceptance Criteria

1. THE Arcana_Visions SHALL provide a property test asserting that the computed Integer_Scale is a whole number of 1 or greater for any generated viewport region and Logical_Size.
2. THE Arcana_Visions SHALL provide a property test asserting that every Motion_Zone rectangle in the Motion_Zone_Table lies fully within its card's Logical_Size and fully outside the Text_Bands, failing if any Motion_Zone violates that invariant.
3. THE Arcana_Visions SHALL provide a property test asserting that every Motion_Zone animation stays within the Flash_Limit of at most 2 luminance changes per second.
4. THE Arcana_Visions SHALL provide a test asserting that the Resurrection_Ritual timeline completes within 3 seconds and is not truncated before its final step in full motion.
5. THE Arcana_Visions SHALL provide a test asserting that the Background_Theme starts only after a user gesture and starts no audio while Sound_State is off.
6. THE Arcana_Visions SHALL provide a Playwright end-to-end test asserting full-screen card open and close by keyboard, static images under Reduced_Motion, the Resurrection_Ritual rendered before the diff on `resurrect` with the Ritual_Force_Flag set and a controlled clock, and an automated axe accessibility scan reporting zero axe violations.
7. THE Arcana_Visions SHALL update `apps/web/e2e/screenshots.e2e.ts` to capture the Spread_View with Pixel_Cards, a Fullscreen_Card_View, the Resurrection_Ritual open-book frame, and the landing with the Seer_Image.
