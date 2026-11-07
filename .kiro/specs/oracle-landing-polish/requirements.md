# Requirements Document

## Introduction

Oracle_Landing_Polish is a single additive layer over the existing Necro-Oracle
CRT terminal (Spec 03 "03-crt-terminal"), the Arcana_Visions pixel art (Spec 06
"arcana-visions"), and the Resurrection_Engine flow. It delivers two cohesive
parts as one spec while doing no harm to any prior spec behaviour.

- **Part A — Landing_State.** A Game Boy DMG-styled menu that fills the empty
  idle terminal: a HUD bar, a keyboard- and mouse-selectable LEGACY REPOS list,
  a PREVIEW window (pixel Seer, three face-down card backs, a per-repo ORACLE
  SAYS line), and a DMG hint bar with real key bindings. The Landing_State is
  shown until the first accepted command and is reachable again via a `home`
  command.
- **Part B — Bugs_And_Polish.** Four grounded fixes: the Seer not showing on the
  idle screen, the web-budget check failing because the resurrection view never
  becomes its own chunk, a palette/scaling/alignment audit (findings V1–V10)
  across every surface, and in-world DMG-styled error and empty states that keep
  clear DOM text for screen readers.

The governing rule is "do no harm to prior specs": every Spec 03, Arcana_Visions,
and Resurrection_Engine behaviour keeps working and all existing tests stay
green. The Landing_State is a new presentational region inside the existing
`<Terminal>` shell; it never replaces the command line, the button row, or the
log.

## Glossary

- **Landing_State**: The DMG-styled idle menu region rendered inside the
  existing `<Terminal>` shell when the pure predicate `landingVisible(state)`
  returns true.
- **Terminal_Shell**: The existing `@necro/ui-crt` `<Terminal>` component shell
  (boot/seer region, command line, button row, output log).
- **HUD_Bar**: The Landing_State top bar showing the `NECRO-ORACLE` label, the
  SOUL hearts, and `PY2 CURSE: ACTIVE`.
- **Legacy_Repo_List**: The selectable list of legacy repositories plus the
  "> ENTER ANY REPO..." affordance.
- **Legacy_Repo**: One selectable entry with a `ref`, display label, DMG tag,
  file-count caption, and an ORACLE SAYS line.
- **Enter_Any_Repo_Row**: The final `"> ENTER ANY REPO..."` row that focuses the
  `NECRO>` input instead of summoning a repository.
- **Preview_Window**: The Landing_State region rendering the pixel Seer, three
  face-down card backs, and the ORACLE SAYS line for the selected row.
- **Seer_Portrait**: The reused Arcana_Visions pixel Seer `<img>` component with
  an integer-scaled render and a text fallback.
- **Card_Back**: A face-down card graphic bearing an eye/moon sigil (never a
  pentagram).
- **Hint_Bar**: The DMG bottom hint bar showing `▲▼ SELECT  A:SUMMON  B:DEMO
  START:HELP`.
- **Selection_Model**: The pure cursor model (`SelectionState`, `move`,
  `selectedRow`, `activate`) over the Legacy_Repo_List rows.
- **Key_Binding_Handler**: The pure `landingKeyAction` function mapping a key
  descriptor to a Landing_State action.
- **DMG_Palette**: The strict 4-shade palette `#001a00`, `#0b4f1a`, `#2fa84a`,
  `#8cff9e` used for all DMG/pixel surfaces.
- **Motion_Zone**: A region marked for animation; candle flicker and cursor
  blink occur only inside Motion_Zones and only when motion is full.
- **Resurrect_View_Port**: The lazy-loading port that pulls
  `load-resurrection-view.ts` into the module graph so the bundler emits a
  distinct `ResurrectionResult` chunk.
- **Budget_Gate**: The `scripts/check-web-budget.mjs` check plus `budget.test.ts`
  that require a separate resurrection chunk and enforce `BUDGET_BYTES`.
- **Oracle_Voice**: The project narration style (a short mystical line, then the
  plain technical fact, ASCII-only, ≤ 72 columns, no emoji).
- **Bitmap_Pixel_Font**: The single OFL-licensed pixel font (e.g. VT323) bundled
  via an `@font-face` or framework font loader and applied to every DMG surface,
  rather than a fallback system monospace.
- **Command_Pipeline**: The existing Spec 03 parse/reduce command path
  (`parseCommand`, the session reducer).

## Requirements

### Requirement 1: Landing_State visibility and lifecycle

**User Story:** As a visitor to the idle Necro-Oracle terminal, I want a DMG-styled
landing menu to fill the empty screen, so that I have a clear starting point
before I issue any command.

#### Acceptance Criteria

1. WHILE the Landing_State dismissed flag is false AND the boot phase equals `done` AND the output log contains no command output (the boot banner block does not count) AND the summoned summary equals null, THE Landing_State SHALL render inside the Terminal_Shell above the output log.
2. WHEN a command is accepted while the Landing_State dismissed flag is false, THE Command_Pipeline SHALL set the Landing_State dismissed flag to true.
3. IF the Landing_State dismissed flag is true, THEN THE Landing_State SHALL render nothing in the Terminal_Shell.
4. WHEN the `home` command is reduced, THE Command_Pipeline SHALL empty the output log, set the summoned summary to null, remove all readings, remove the last ritual, and set the Landing_State dismissed flag to false.
5. THE Landing_State SHALL render only while `landingVisible(state)` returns true, where `landingVisible(state)` returns true exactly when the Landing_State dismissed flag is false AND the boot phase equals `done` AND the output log contains no command output (only the boot banner block, if any) AND the summoned summary equals null.
6. WHILE the Landing_State is visible, THE Terminal_Shell SHALL keep the command line and the button row mounted and operable.
7. WHEN the `clear` command is reduced, THE Command_Pipeline SHALL empty the output log and SHALL leave the Landing_State dismissed flag unchanged.

### Requirement 2: `home` command

**User Story:** As a user who has navigated away from the landing, I want a `home`
command, so that I can return to the Landing_State at any time.

#### Acceptance Criteria

1. WHEN the input `home` with no arguments is parsed, THE Command_Pipeline SHALL produce a `home` command.
2. IF the input `home` is parsed with one or more arguments, THEN THE Command_Pipeline SHALL produce no `home` command, SHALL emit an error output indicating an unknown command, and SHALL leave the output log and the Landing_State dismissed flag unchanged except for the appended error output.
3. WHEN the `home` command is reduced, THE Command_Pipeline SHALL set the Landing_State dismissed flag to false.
4. WHEN any input other than a no-argument `home` is parsed, THE Command_Pipeline SHALL produce the same command output as it produced before the `home` command was added.

### Requirement 3: HUD_Bar

**User Story:** As a user viewing the Landing_State, I want a HUD bar with the
system identity and status, so that I understand the oracle's framing at a glance.

#### Acceptance Criteria

1. WHILE the Landing_State is visible, THE HUD_Bar SHALL render the label `NECRO-ORACLE` as plain DOM text.
2. WHILE the Landing_State is visible, THE HUD_Bar SHALL render a SOUL hearts row with a fixed count between 1 and 5 hearts.
3. WHILE the Landing_State is visible, THE HUD_Bar SHALL expose a single text accessible label stating the soul status and SHALL mark the individual heart glyphs as decorative.
4. WHILE the Landing_State is visible, THE HUD_Bar SHALL render the text `PY2 CURSE: ACTIVE` as plain DOM text.

### Requirement 4: Legacy_Repo_List contents and selection

**User Story:** As a user, I want a selectable list of legacy repositories, so that
I can choose a target to summon without typing.

#### Acceptance Criteria

1. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render the entry `tomaes/pytarl` with the tag `DUNGEON` and the caption `4 FILES`.
2. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render the entry `ArmstrongJ/robotadventure` with the tag `NOIR MYSTERY` and the caption `21 FILES`.
3. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render the entry `neubig/test-repo` with the tag `PY2 SPECIMEN` and the caption `240 FILES`.
4. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render the three concrete repository entries in the order `tomaes/pytarl`, `ArmstrongJ/robotadventure`, `neubig/test-repo`, followed by the Enter_Any_Repo_Row with the label `> ENTER ANY REPO...` as the final row.
5. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render exactly one selected row, marked with the ▶ cursor and an inverted style, with `aria-selected="true"`, matching `selectedRow(state, rows)`.
6. WHEN the user issues one `move up` or `move down` action, THE Selection_Model SHALL change the selected index by exactly one toward the requested direction unless the index is already at the range boundary, and SHALL clamp the resulting index within the range `0` to `rowCount - 1` without wrapping.
7. WHEN the user clicks a row, THE Legacy_Repo_List SHALL set that row as the single selected row.
8. WHEN the user clicks a row, THE Legacy_Repo_List SHALL activate that row with the outcome defined by the Selection_Model `activate` function (`summon-read` for a concrete repository, `focus-input` for the Enter_Any_Repo_Row).

### Requirement 5: Row activation semantics

**User Story:** As a user, I want activating a row to do the right thing, so that a
concrete repository is read and the ENTER row lets me type my own.

#### Acceptance Criteria

1. WHEN a concrete Legacy_Repo row with a resolvable `ref` is activated, THE Command_Pipeline SHALL dispatch `summon <ref>` for that repository's `ref` and SHALL THEN dispatch `read fates`, with the `summon` dispatch ordered strictly before the `read fates` dispatch and no other command dispatched between them.
2. IF a concrete Legacy_Repo row with an empty or unresolvable `ref` is activated, THEN THE Command_Pipeline SHALL dispatch no `summon` or `read` command and SHALL leave the output log and the Landing_State dismissed flag unchanged.
3. WHEN the Enter_Any_Repo_Row is activated, THE Landing_State SHALL move focus to the `NECRO>` input, SHALL dispatch no `summon` or `read` command, and SHALL leave the output log and the Landing_State dismissed flag unchanged.
4. THE Selection_Model `activate` function SHALL return `summon-read` with the row's `ref` for a concrete repository and SHALL return `focus-input` for the Enter_Any_Repo_Row, with no other return value.

### Requirement 6: Preview_Window

**User Story:** As a user, I want a preview window with the Seer, card backs, and an
oracle line, so that the landing feels like a live tarot reading in waiting.

#### Acceptance Criteria

1. WHILE the Landing_State is visible AND the asset manifest contains the Seer asset, THE Preview_Window SHALL render the Seer_Portrait.
2. WHILE the Landing_State is visible, THE Preview_Window SHALL render exactly three face-down Card_Backs.
3. THE Preview_Window Card_Backs SHALL display an eye/moon sigil motif and SHALL NOT display a pentagram.
4. WHILE a concrete Legacy_Repo row is selected, THE Preview_Window SHALL render that repository's ORACLE SAYS line as plain DOM text, wrapped or clipped so that no rendered line exceeds 72 columns.
5. THE Preview_Window ORACLE SAYS line SHALL be at most 72 columns wide.
6. IF the asset manifest does not contain the Seer asset, THEN THE Preview_Window SHALL render the Seer text fallback and SHALL NOT render a broken-image indicator.
7. IF a Card_Back asset is missing, THEN THE Preview_Window SHALL render a plain phosphor box in that Card_Back's place and SHALL NOT render a broken-image indicator.

### Requirement 7: Hint_Bar and key bindings

**User Story:** As a keyboard user, I want DMG-style key bindings, so that I can
navigate and act on the landing without a mouse.

#### Acceptance Criteria

1. WHILE the Landing_State is visible, THE Hint_Bar SHALL render the text `▲▼ SELECT  A:SUMMON  B:DEMO  START:HELP`.
2. WHEN the `ArrowUp` key is pressed with no Alt, Ctrl, or Meta modifier, THE Key_Binding_Handler SHALL return the `move up` action.
3. WHEN the `ArrowDown` key is pressed with no Alt, Ctrl, or Meta modifier, THE Key_Binding_Handler SHALL return the `move down` action.
4. WHEN the `Enter` key or the `a` key (case-insensitive) is pressed with no Alt, Ctrl, or Meta modifier, THE Key_Binding_Handler SHALL return the `activate` action.
5. WHEN the `b` key or the `d` key (case-insensitive) is pressed with no Alt, Ctrl, or Meta modifier, THE Key_Binding_Handler SHALL return the `demo` action.
6. WHEN the `h` key (case-insensitive) is pressed with no Alt, Ctrl, or Meta modifier, THE Key_Binding_Handler SHALL return the `help` action.
7. IF a key carries an Alt, Ctrl, or Meta modifier OR the key is outside the binding set, THEN THE Key_Binding_Handler SHALL return the `none` action so the key falls through to the `NECRO>` input.
8. WHILE the Landing_State is visible, THE Terminal_Shell SHALL keep the existing command chips operable.
9. WHILE the Landing_State is visible, THE Terminal_Shell SHALL keep the `NECRO>` input operable.

### Requirement 8: Seer_Portrait visible on the idle landing (Part B bug 1)

**User Story:** As a user on the idle screen, I want to see the Seer, so that the
landing matches the design mockups instead of showing an empty frame.

#### Acceptance Criteria

1. WHILE the Landing_State is visible AND the asset manifest contains the Seer asset, THE Preview_Window SHALL render the Seer_Portrait regardless of the boot phase, including when the boot phase equals `done` and when the page loads with `?boot=skip`.
2. WHILE the boot phase equals `playing`, THE Terminal_Shell SHALL render the existing boot-region Seer so the boot-time Seer still appears.
3. IF the asset manifest does not contain the Seer asset, THEN THE Preview_Window SHALL render the Seer text fallback and SHALL NOT render a broken-image indicator.
4. THE Oracle_Landing_Polish test suite SHALL include a test asserting the Seer_Portrait is present in the DOM on the idle Landing_State when the boot phase equals `done`.

### Requirement 9: Resurrection chunk split (Part B bug 2)

**User Story:** As a maintainer, I want the resurrection view in its own lazy chunk,
so that the web-budget check passes without weakening any budget.

#### Acceptance Criteria

1. THE browser ports SHALL expose a Resurrect_View_Port built as a literal-path dynamic import of the resurrection result view.
2. WHEN the web bundle is built, THE Resurrect_View_Port SHALL cause the bundler to emit a `ResurrectionResult` chunk that is distinct from the initial route bundle and not loaded on initial route.
3. THE emitted `ResurrectionResult` chunk SHALL contain the markers `renderFileResults`, `renderResurrectVitality`, and `Residual_List`.
4. WHEN a `resurrect` command settles and the result view is shown, THE Terminal_Shell SHALL mount the resurrection result view through the Resurrect_View_Port.
5. THE Budget_Gate SHALL keep `BUDGET_BYTES` at `250000` and SHALL NOT raise any budget value above its prior value.
6. WHEN the Budget_Gate runs, THE Budget_Gate SHALL locate the resurrection chunk as a separate chunk and SHALL pass.
7. IF the Budget_Gate finds no separate resurrection chunk, THEN THE Budget_Gate SHALL fail.
8. THE Resurrect_View_Port addition SHALL be additive so that a host providing no Resurrect_View_Port continues to type-check.

### Requirement 10: DMG palette purity (V1, V2 — hard rule)

**User Story:** As a designer, I want every DMG surface to use only the 4-shade
palette, so that the pixel aesthetic stays strict and consistent.

#### Acceptance Criteria

1. THE Landing_State SHALL render every DMG surface computed `color`, `background-color`, and `border-color` as a member of the DMG_Palette (`#001a00`, `#0b4f1a`, `#2fa84a`, `#8cff9e`) or `transparent`, with no other color value present.
2. WHEN a Legacy_Repo_List row becomes the selected row, THE Legacy_Repo_List SHALL swap that row's foreground and background to two members of the DMG_Palette whose contrast ratio is at least 4.5:1.

### Requirement 11: Integer scaling and no smoothing on images (V3 — hard rule)

**User Story:** As a designer, I want every landing image integer-scaled with no
smoothing, so that the pixel art stays crisp.

#### Acceptance Criteria

1. THE Preview_Window SHALL render every landing image (the Seer_Portrait and each Card_Back) with rendered width and height each equal to the image's logical size multiplied by a single integer scale factor that is at least 1 and identical on both axes.
2. THE Preview_Window SHALL render every landing image with `image-rendering: pixelated`.
3. THE Preview_Window SHALL apply no color-shifting or blur CSS `filter` to any image surface.

### Requirement 12: Card_Back sigil motif (V4)

**User Story:** As a product owner, I want the card backs to use the eye/moon sigil,
so that the art respects the tarot UX rule against pentagrams.

#### Acceptance Criteria

1. THE Card_Back asset SHALL use the eye/moon sigil motif.
2. THE Card_Back asset SHALL NOT use a pentagram motif.

### Requirement 13: Panel pixel-grid alignment (V5)

**User Story:** As a designer, I want panels aligned on an integer pixel grid, so
that borders stay sharp without sub-pixel blur.

#### Acceptance Criteria

1. THE Landing_State SHALL render the HUD_Bar, Legacy_Repo_List, Preview_Window, and Hint_Bar panel boxes with computed width, height, padding, and border-width values each equal to a whole-number pixel value.
2. THE Landing_State SHALL position the HUD_Bar, Legacy_Repo_List, Preview_Window, and Hint_Bar panel boxes with computed top and left offsets each equal to a whole-number pixel value, with no fractional-pixel offset.

### Requirement 14: Text fit without overflow (V6)

**User Story:** As a user, I want text to fit its panel, so that long labels and
oracle lines never overflow or break the layout.

#### Acceptance Criteria

1. THE Landing_State SHALL render each ORACLE SAYS line at a width of at most 72 columns.
2. IF a repository label or an ORACLE SAYS line exceeds its column budget (72 columns for an ORACLE SAYS line, the enclosing column width for a repository label), THEN THE Landing_State SHALL render that text truncated to a single line ending in an ellipsis within the column budget, with no overflow beyond the panel box.

### Requirement 15: Single bitmap pixel font (V7 — hard rule)

**User Story:** As a designer, I want one bitmap pixel font across the DMG surfaces,
so that no proportional or smoothed font appears.

#### Acceptance Criteria

1. THE Landing_State SHALL render all DMG surface text with a computed `font-family` equal to one single bitmap pixel font-family token, with no other font-family token present on any DMG surface.

### Requirement 16: Motion zones only for flicker and blink (V8 — hard rule)

**User Story:** As a user who may be sensitive to motion, I want animation confined
to motion zones and disabled when motion is off, so that nothing flickers
unexpectedly.

#### Acceptance Criteria

1. THE Landing_State SHALL apply a running CSS animation only to the candle flicker element and the cursor blink element, and SHALL place each such element inside a Motion_Zone.
2. WHILE the motion mode is not full OR `prefers-reduced-motion` is set, THE Landing_State SHALL render with no running CSS animation or CSS transition on any element.

### Requirement 17: Consistent spacing (V9)

**User Story:** As a designer, I want consistent gutters and padding, so that panels
share one spacing scale without ad-hoc margins.

#### Acceptance Criteria

1. THE Landing_State SHALL draw every gutter, margin, and padding value on the HUD_Bar, Legacy_Repo_List, Preview_Window, and Hint_Bar panels from a single finite spacing-scale token set, with no spacing value outside that token set.

### Requirement 18: Cross-surface resurrection palette (V10)

**User Story:** As a user, I want the lazily mounted resurrection view to match the
rest of the terminal, so that there is no visual drift.

#### Acceptance Criteria

1. WHEN the resurrection result view is lazily mounted, THE resurrection result view SHALL render every computed `color`, `background-color`, and `border-color` as a member of the same phosphor palette the rest of the terminal uses, with no color value outside that palette.

### Requirement 19: In-world error and empty states (Part B bug 4)

**User Story:** As a user who hits an error, I want an in-world oracle message with
the plain technical fact, so that I know what happened and what to do next while
screen readers still read clear text.

#### Acceptance Criteria

1. IF a summon targets a nonexistent or invalid repository, THEN THE Oracle_Voice error SHALL present one mystical line followed by the technical fact that GitHub returned 404 for the named repository and reference, THE DOM live region SHALL contain the plain error text, and THE Landing_State SHALL remain operable with its prior selection preserved.
2. IF the GitHub API is rate-limited, THEN THE Oracle_Voice error SHALL present one mystical line followed by the technical fact that the API is rate-limited together with a retry wait expressed as a whole number of minutes between 1 and 60, and THE DOM live region SHALL contain the plain error text.
3. IF a network or stream error occurs, THEN THE Oracle_Voice error SHALL present one mystical line followed by the technical fact that a network error occurred together with an instruction to retry, and THE DOM live region SHALL contain the plain error text.
4. IF a summoned repository contains no `.py` files, THEN THE Oracle_Voice error SHALL present one mystical line followed by the technical fact that no `.py` files were found, and THE DOM live region SHALL contain the plain error text.
5. IF the Legacy_Repo_List renders with zero entries from a legitimate zero-repo result, THEN THE Landing_State SHALL render an empty-state message and SHALL expose an accessible list label on the Legacy_Repo_List.
6. THE Oracle_Voice error and empty copy SHALL keep each mystical line at most 16 words, each line at most 72 columns, and ASCII-only with no emoji, and THE DOM live-region text SHALL equal the plain technical fact presented in the visible error.
7. IF the Legacy_Repo_List has zero entries because an underlying fetch failed with a network error or a rate limit, THEN THE Landing_State SHALL render the corresponding Oracle_Voice error state instead of the empty-state message.

### Requirement 20: Accessibility compliance

**User Story:** As a user relying on assistive technology, I want the landing and its
error states to be accessible, so that the experience works for everyone.

#### Acceptance Criteria

1. WHILE the Landing_State is in the idle state, THE Landing_State SHALL report zero axe violations.
2. WHILE the Landing_State is in an error state, THE Landing_State SHALL report zero axe violations.
3. THE Legacy_Repo_List SHALL expose a container with `role="listbox"` and each row with `role="option"`, and SHALL mark the ▶ cursor as decorative so that each option's computed accessible name contains the row label, tag, and file count as plain text and excludes the ▶ cursor character.

### Requirement 21: No regression of prior specs (hard rule)

**User Story:** As a maintainer, I want every prior spec behaviour preserved, so that
this additive layer never breaks existing functionality.

#### Acceptance Criteria

1. THE Oracle_Landing_Polish layer SHALL preserve every Spec 03 behaviour (boot, command line, button row, live-region log, `?boot=skip`) such that the existing Spec 03 tests pass without modification.
2. THE Oracle_Landing_Polish layer SHALL preserve every Arcana_Visions behaviour (pixel spread, fullscreen card, Necronomicon ritual, `?ritual=force`, Seer during boot, background theme) such that the existing Arcana_Visions tests pass without modification.
3. THE Oracle_Landing_Polish layer SHALL preserve the whole Resurrection_Engine flow such that the existing Resurrection_Engine tests pass without modification.
4. THE Oracle_Landing_Polish layer SHALL keep every existing test passing without changes to that test's expected behaviour.
5. THE end-to-end and screenshot suites SHALL add coverage for the Landing_State, including new visual screenshot baselines for the Landing_State.
6. THE end-to-end and screenshot suites SHALL keep the existing `?ritual=force` behaviour asserted and passing.

### Requirement 22: Boot banner not clipped or overlapped (defect 1)

**User Story:** As a user on the idle landing, I want the boot banner line fully
visible, so that the opening narration is never clipped or hidden behind a panel.

#### Acceptance Criteria

1. THE Terminal_Shell SHALL lay out the boot banner line and the Landing_State so the boot banner line is fully visible and is neither clipped nor overlapped by the Hint_Bar or any Landing_State panel.
2. WHILE the Landing_State is visible, THE Landing_State SHALL render every Landing_State panel so that no Landing_State panel overlaps the output log's boot banner line.

### Requirement 23: Focus ring within the DMG palette (defect 2)

**User Story:** As a keyboard user on the landing, I want the focus indicator to
stay within the DMG palette while remaining clearly visible, so that focus is
obvious without breaking the pixel aesthetic.

#### Acceptance Criteria

1. WHILE a Landing_State control, including the `NECRO>` input while the Landing_State is visible, shows a visible focus indicator, THE Landing_State SHALL render that focus indicator color as a member of the DMG_Palette with a contrast ratio of at least 3:1 against both adjacent DMG_Palette shades the indicator sits between.
2. WHILE a Landing_State control shows a visible focus indicator, THE Terminal_Shell SHALL keep a visible focus indicator present and SHALL render no `outline-color` and no `border-color` on that focused Landing_State control outside the DMG_Palette.

### Requirement 24: Truly inverted selected row (defect 3)

**User Story:** As a user selecting a repository, I want the selected row fully
inverted like the mockup, so that the current selection reads clearly at a glance.

#### Acceptance Criteria

1. WHEN a Legacy_Repo_List row becomes the selected row, THE Legacy_Repo_List SHALL render that row with a solid `#8cff9e` background and `#001a00` text, with a contrast ratio of at least 4.5:1 and with no scanline or afterglow overlay visible over the inverted row.
2. WHEN a Legacy_Repo_List row becomes the selected row, THE Legacy_Repo_List SHALL render the inverted row foreground and background as two members of the DMG_Palette, preserving the palette-purity and contrast guarantees of Requirement 10.

### Requirement 25: Bitmap pixel font bundled and applied (defect 4)

**User Story:** As a designer, I want the pixel font actually bundled and applied,
so that DMG surfaces render in the intended bitmap font rather than a system
monospace fallback.

#### Acceptance Criteria

1. THE Terminal_Shell SHALL bundle the Bitmap_Pixel_Font through an `@font-face` declaration or a framework font loader so that the referenced font family loads.
2. WHILE the Landing_State is visible, THE Landing_State SHALL render all DMG surface text in the bundled Bitmap_Pixel_Font, integer-scaled with no smoothing, rather than a fallback system monospace font.
3. THE Terminal_Shell SHALL record the bundled Bitmap_Pixel_Font license in `docs/COMPLIANCE.md`.

### Requirement 26: Seer and card backs fill the preview (defect 5)

**User Story:** As a user viewing the preview, I want the Seer and card backs to
fill the panel, so that the preview matches the mockup instead of leaving large
empty space.

#### Acceptance Criteria

1. THE Preview_Window SHALL render the Seer_Portrait and each of the three Card_Backs scaled by an integer factor of at least 1, identical on both axes, so that the Seer_Portrait and Card_Backs substantially fill the Preview_Window panel with no large empty area.
2. THE Preview_Window SHALL render the Seer_Portrait and each Card_Back with `image-rendering: pixelated` and SHALL apply no color-shifting or blur CSS `filter` to any image surface.

### Requirement 27: Category and file-count separator (defect 6)

**User Story:** As a user reading the repo list, I want the tag and file count
joined by a middle-dot, so that each row reads as one caption like the mockup.

#### Acceptance Criteria

1. WHILE the Landing_State is visible, THE Legacy_Repo_List SHALL render each concrete Legacy_Repo row's tag and file count joined by a ` · ` middle-dot separator (for example `DUNGEON · 4 FILES`) as plain DOM text.

### Requirement 28: Terminal-wide off-palette color guard

**User Story:** As a maintainer, I want a test that fails on any off-palette color
anywhere in the terminal, so that palette drift is caught across every surface
including borders and outlines.

#### Acceptance Criteria

1. THE Oracle_Landing_Polish test suite SHALL include a test that renders the terminal, including the Landing_State, and asserts every computed `color`, `background-color`, `border-color`, and `outline-color` is a member of the allowed palette set (the DMG_Palette for DMG surfaces plus the audited Spec 03 phosphor chrome tokens) or `transparent`.
2. IF any computed `color`, `background-color`, `border-color`, or `outline-color` on the rendered terminal is outside the allowed palette set and is not `transparent`, THEN THE Oracle_Landing_Polish test suite SHALL fail.

### Requirement 29: Landing fits the viewport with no scrolling (supersedes the overshoot of Requirement 26)

**User Story:** As a user on the idle landing, I want the entire landing to fit on
screen, so that no part of the menu is pushed off-screen and I never have to
scroll vertically to see the Seer, the repo list, the hints, or the input.

#### Acceptance Criteria

1. WHILE the Landing_State is visible at a viewport of 1280×720, 1366×768, or 1920×1080, THE Terminal_Shell SHALL render the HUD_Bar, the Legacy_Repo_List, the Preview_Window (the Seer_Portrait, the three Card_Backs, and the ORACLE SAYS line), the Hint_Bar, the boot banner line, the `NECRO>` input, and the command chips all within the viewport with no vertical scrolling.
2. THE Preview_Window SHALL choose the Seer_Portrait and Card_Back integer scale factor as the largest integer factor that fits within both the available panel height budget and the available panel width budget, with a minimum factor of 1, and SHALL size no image so that the Landing_State overflows the viewport.
3. THE Preview_Window SHALL render the Seer_Portrait and Card_Backs to fill the Preview_Window panel bounded by the panel's height budget so that the whole Landing_State fits within the viewport, preserving the integer-scale and no-smoothing guarantees of Requirement 11.
4. THE Oracle_Landing_Polish test suite SHALL include an end-to-end test asserting, at viewports of 1280×720, 1366×768, and 1920×1080, that the terminal shows no vertical scrollbar (the terminal `scrollHeight` is at most its `clientHeight`) and that the HUD_Bar, the Legacy_Repo_List, each Card_Back, the ORACLE SAYS line, the Hint_Bar, the boot banner line, the `NECRO>` input, and the command chips are each within the viewport.

### Requirement 30: Idle landing screenshot captured at the top

**User Story:** As a maintainer reviewing the landing, I want the idle landing
screenshot captured at the top of the terminal, so that the baseline shows the
full landing in frame.

#### Acceptance Criteria

1. WHEN the idle landing screenshot `09-landing-idle` is captured, THE capture SHALL be taken scrolled to the top of the terminal with the full Landing_State visible in frame.

### Requirement 31: Separator spacing

**User Story:** As a user reading the repo list, I want the tag and file count
joined by a spaced middle-dot, so that each caption reads cleanly like the mockup.

#### Acceptance Criteria

1. THE Legacy_Repo_List SHALL render each concrete Legacy_Repo row's tag and file count joined by a middle-dot separator with a single space on both sides (for example `DUNGEON · 4 FILES`) as plain DOM text, refining Requirement 27 to require the surrounding spaces explicitly.

### Requirement 32: Global in-palette focus indicator (replaces the audited amber-brown token)

**User Story:** As a keyboard user anywhere in the terminal, I want the focus
indicator to stay within the DMG and phosphor palette, so that focus is clearly
visible without introducing an off-palette amber-brown color.

#### Acceptance Criteria

1. THE Terminal_Shell SHALL render the global focus indicator (the `.crt :focus-visible` ring bound to the `--crt-focus` token) using only DMG_Palette and phosphor-palette colors, such as a `#8cff9e` ring with a `#001a00` inner offset, and SHALL NOT use the former amber-brown color `#a85c30`.
2. THE Terminal_Shell SHALL render the focus indicator as a composed two-color ring in which the bright `#8cff9e` ring is separated from the bright `#33ff66` foreground by a `#001a00` offset, with the `#8cff9e` ring reaching a contrast ratio of at least 3:1 against both the `#001a00` offset and the background.
3. THE terminal-wide palette guard of Requirement 28 SHALL remove `#a85c30` from its allowed set so that the guard allows only DMG_Palette and phosphor-palette colors, and the focus indicator SHALL pass the guard.
4. THE `crt-tokens.test.ts` focus-contrast assertion SHALL assert the composed in-palette indicator (the bright `#8cff9e` ring against the dark `#001a00` offset and the background), preserving the requirement that a visible focus indicator meets a contrast ratio of at least 3:1.
