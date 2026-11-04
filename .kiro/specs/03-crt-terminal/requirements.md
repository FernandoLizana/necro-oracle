# Requirements Document

## Introduction

The CRT Terminal is the primary web surface of the Necro-Oracle. It is a
retro green-phosphor, DOS-style terminal in `apps/web` where a user types or
pastes a public GitHub repository reference, the oracle "summons" the
repository through `@necro/github`, and the terminal draws the tarot spread
produced by `runReading` from `@necro/oracle`, presenting each card as an
evidence-backed code diagnosis.

This spec covers the L0 slice of the terminal: the boot screen, a
keyboard-first command line (`help`, `summon`, `read`, plus `explain`, `clear`,
`motion`, `demo`, and `sound`), the CRT visual language (scanlines, phosphor
glow, typewriter text), a manual and OS-driven reduced-motion mode,
WCAG-oriented accessibility, error rendering in the Oracle_Voice, and the
server-side API routes that keep GitHub tokens, network access, and repository
parsing off the browser. It also covers a `demo` command that replays bundled,
clearly labelled sample Readings with no network at all, and optional retro
sound effects that are off by default and never autoplay. Rituals, patches,
pull requests, destiny readings, voice, card art images, and the Celtic Cross
are out of scope (see Out of Scope).

The terminal is a DOM-based component set living in `packages/ui-crt`
(`Screen`, `Terminal`, `Card`, `Spread*`, `EvidenceScroll`); `apps/web`
contains only the route, screen composition, and API routes. Per the
dependency-direction rule, the browser bundle imports only the
Client_Safe_Entry of `@necro/oracle` (schemas and types, with no parsers,
tree-sitter, or Node-only modules), which keeps the initial route under the
250 KB gzipped budget. The server routes are the composition root that injects
the `FetchPort`, `ClockPort`, `EnvPort`, and `RateLimitPort`.

Design decision: `@necro/coven` runners do not exist yet, so the API_Routes
import `@necro/github` directly (`parseRepoRef`, `GitHubSummoner`,
`fetchExternalData`) from server-only modules. This direct import is an
explicit, temporary requirement (Requirement 16); when `@necro/coven` provides
reading runners, the API_Routes migrate to them behind the same route
contracts. Every import crosses a package boundary only through that package's
`src/index.ts` (the Client_Safe_Entry being the one declared subpath export).

The rate limiter favours availability: if the shared Upstash limiter is
unavailable, the API_Routes fall back to a per-instance in-memory limiter with
the same limits, so the deployed demo does not go down because of a limiter
outage.

The terminal never decides whether a card is drawn. Card draws, orientation,
severity, spread positions, and vitality come exclusively from `runReading`;
the terminal only renders them. The terminal never executes repository code and
never receives repository file contents.

This document specifies requirements only. Design and implementation are out of
scope here.

## Glossary

- **Terminal**: The browser-side CRT terminal UI, implemented by the
  `packages/ui-crt` components and composed by the `apps/web` terminal route.
- **Terminal_Route**: The Next.js App Router page in `apps/web` that renders
  the Terminal.
- **Summon_Route**: The server-side HTTP endpoint `POST /api/summon` that
  accepts a Repo_Reference_String and returns a Summon_Summary.
- **Reading_Route**: The server-side HTTP endpoint `POST /api/readings` that
  accepts a Pinned_Reference and a spread kind and returns a Reading_Response.
- **API_Routes**: The Summon_Route and the Reading_Route together.
- **Command_Line**: The single-line text input, labelled for assistive
  technology, at which the user types commands.
- **Command**: A parsed Command_Line entry: one of `help`, `summon`, `read`,
  `explain`, `clear`, `motion`, `demo`, `sound`, or an `unknown` Command
  carrying the raw entry.
- **Command_Parser**: The pure function that maps a Command_Line string to a
  Command, performing no network, clock, environment, or DOM access.
- **Command_Printer**: The pure function that formats a Command back into its
  canonical Command_Line string.
- **Repo_Reference_String**: The `@necro/github` input form (`owner/repo` or a
  `https://github.com` URL, optionally with `#ref`, `@sha`, or `/tree/<ref>`),
  as defined by spec 02-github-summoner.
- **Pinned_Reference**: A Repo_Reference_String of the exact form
  `owner/repo@<sha>` where `<sha>` is a 40-character lowercase hexadecimal
  commit SHA taken from a Summon_Summary.
- **Summon_Summary**: The validated payload returned by the Summon_Route:
  the `RepoRef` (`owner`, `name`, `sha`, `defaultBranch`), `stars`,
  `hasWorkflowsDir`, `degradedFields`, `cache` (`hit` or `miss`), and the
  snapshot file count and `truncated` flag. It contains no file contents. A
  Summon_Summary built from a Demo carries a `demo` flag equal to true.
- **Reading_Response**: The validated payload returned by the Reading_Route:
  the `Reading` from `@necro/oracle` (`id`, `repo`, `draws`, `spread`,
  `vitality`, `createdAt`) plus the Summon_Summary. It is the final body of a
  reading and is always validated against the Reading_Response zod schema
  before the spread is rendered, after any Progress_Lines.
- **Reading_Phase**: One named stage of a reading reported by the
  Reading_Route, one of `SUMMON` (pinning the commit), `DOWNLOAD` (reading the
  body or tarball), `EXTERNAL` (consulting registries and OSV), and `READING`
  (drawing the spread), in that fixed order.
- **Progress_Line**: One Oracle_Voice Output_Line emitted when a Reading_Phase
  starts, shown live in the Terminal as an in-progress line (one short mystical
  line of at most 16 words followed by a technical line) before the final
  Reading_Response renders.
- **Progress_Event**: One streamed message from the Reading_Route carrying the
  name of a Reading_Phase that has started, or the skip note of the EXTERNAL
  phase, consumed by the Terminal to emit a Progress_Line.
- **Overall_Budget**: The Reading_Route's hard ceiling of 40 seconds for one
  reading, measured from request receipt, after which the Reading_Route aborts
  the reading with a NecroError of code `NETWORK_TIMEOUT`.
- **External_Sub_Budget**: The bounded portion of the Overall_Budget, 10
  seconds, allotted to the EXTERNAL phase (`fetchExternalData`), after which the
  Reading_Route skips external data and proceeds with the reading.
- **Session**: The in-memory Terminal state for one page load: the output
  log, the command history, the current Summon_Summary (if any), the current
  Reading_Response (if any), and the in-flight request (if any).
- **Output_Log**: The ordered list of output blocks shown in the Terminal.
- **Output_Block**: One unit of Output_Log content (an echoed command, a
  response, a reading, or an error), made of Output_Lines.
- **Output_Line**: One rendered line of Terminal text, at most 72 columns wide.
- **Live_Region**: The Output_Log container exposed to assistive technology
  with `role="log"`, `aria-live="polite"`, and `aria-relevant="additions"`.
- **Typewriter**: The visual effect that reveals Output_Block text
  progressively, character by character.
- **Motion_Mode**: The Terminal animation state, either `full` or `reduced`.
  In `reduced`, the Typewriter, flicker, afterglow, pulsing glow, and any other
  time-based animation are disabled.
- **Motion_Preference**: The user's choice `auto`, `on`, or `off`, where
  `auto` derives Motion_Mode from the `prefers-reduced-motion` media query,
  `on` forces `full`, and `off` forces `reduced`.
- **CRT_Effects**: The visual treatment of the Terminal: scanlines overlay,
  phosphor glow, screen flicker, and phosphor afterglow, in the palette
  `#33ff66` foreground on `#001a00` background.
- **Oracle_Voice**: The narration persona defined in the `oracle-voice`
  steering: a short mystical line (at most 16 words) followed by a technical
  line stating the facts; uppercase card names and verdict words; no emoji;
  at most 72 columns per line.
- **Voice_Table**: The static table in `packages/ui-crt` mapping every
  `CardId` and both orientations to its mystical line, taken from the
  `oracle-voice` steering "Card voice lines".
- **Fixed_Phrases**: The boot phrase
  `NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP` and the
  pre-reading phrase `Shuffle. Cut. The repository speaks.`
- **Error_Envelope**: The JSON body `{ error: { code, userMessage } }` returned
  by the API_Routes on failure, where `code` is a `NecroErrorCode` from
  `@necro/oracle` and `userMessage` is an Oracle_Voice message.
- **RateLimitPort**: The injected server-side dependency that counts requests
  per client IP and globally, backed in production by `@upstash/ratelimit`.
- **Fallback_Limiter**: The per-instance in-memory limiter, driven only by the
  ClockPort, that enforces the same per-IP and global limits as the
  RateLimitPort and is used when the RateLimitPort fails to answer.
- **Daily_Request_Ceiling**: The global maximum number of Summon_Route and
  Reading_Route requests per day, read from the validated environment key
  `NECRO_DAILY_REQUEST_CEILING` through the EnvPort.
- **Client_Safe_Entry**: The dedicated subpath export of `@necro/oracle`
  (for example `@necro/oracle/client`) that exposes only zod schemas and types
  and imports no parser, `web-tree-sitter`, detector, or Node-only module. The
  design defines the exact subpath name.
- **Demo**: A bundled sample repository snapshot replayed by the `demo`
  command, identified by a Demo_Name.
- **Demo_Name**: A lowercase token of 1 to 32 characters from `a-z`, `0-9`,
  and `-` that identifies one Demo in the Demo_Catalog.
- **Demo_Catalog**: The fixed list of 2 to 3 Demos: `lich-py2` (a legacy
  Python 2 repository), `mixed-ruins` (a mixed, partly ruined repository), and
  `green-garden` (a healthier repository).
- **Demo_Fixture**: The purpose-built repository directory of a Demo under
  `/fixtures/graveyard`.
- **Demo_Bundle**: The pre-computed, schema-validated Reading_Responses of all
  Demos (one per Demo and per spread among `fates` and `necropsy`), shipped as
  a lazily loaded chunk separate from the initial route.
- **Demo_Label**: The text marker `DEMO` shown in the header line of every
  Output_Block produced while the Session holds a demo Reading_Response, in the
  form `[DEMO] fixture replay, not a live repository`.
- **Sound_Preference**: The user's choice `on` or `off` for sound effects.
- **Sound_State**: The pure state `{ preference, gesture, visible }` where
  `gesture` is true once a user gesture has occurred in the Terminal during
  this page load and `visible` mirrors the document visibility.
- **Sound_Reducer**: The pure function that maps a Sound_State and an event
  (`load`, `sound_on`, `sound_off`, `gesture`, `hidden`, `visible`) to the next
  Sound_State, with no audio, DOM, or storage access.
- **Hum**: The continuous low CRT hum generated with the Web Audio API.
- **Click**: The short keyboard click generated with the Web Audio API for a
  keypress in the Command_Line.
- **Sanitized_Text**: Text from which all C0 and C1 control characters except
  line feed, all ANSI escape sequences, and all Unicode bidirectional override
  and isolate characters have been removed.
- **Evidence_Link**: A hyperlink to
  `https://github.com/{owner}/{name}/blob/{sha}/{path}#L{line}` built from a
  validated `Evidence` item and the Pinned_Reference.
- **NecroError**: The `@necro/oracle` typed error `{ code, userMessage, cause }`.

## Requirements

### Requirement 1: Boot screen and terminal shell

**User Story:** As a visitor, I want the terminal to boot into a ready prompt with the fixed oracle greeting, so that I immediately know what to type.

#### Acceptance Criteria

1. WHEN the Terminal_Route finishes loading, THE Terminal SHALL show the boot phrase `NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP` as the first Output_Block.
2. WHEN the boot Output_Block has been shown, THE Terminal SHALL show a Command_Line prompt and move keyboard focus to the Command_Line.
3. THE Terminal_Route SHALL render the Terminal as DOM elements and SHALL NOT render Terminal text into a canvas.
4. THE Terminal SHALL render all Output_Block text as selectable, copyable DOM text.
5. THE Terminal_Route SHALL be viewable without JavaScript as a static document containing the boot phrase and a statement that the terminal requires JavaScript.
6. THE Terminal SHALL keep the Session in browser memory only and SHALL NOT persist any Output_Log content, Repo_Reference_String, or Reading_Response to browser storage.

### Requirement 2: Command parsing and printing

**User Story:** As a keyboard-first user, I want a small, predictable command language, so that I can drive the oracle without touching the mouse.

#### Acceptance Criteria

1. THE Command_Parser SHALL recognise the command names `help`, `summon`, `read`, `explain`, `clear`, `motion`, `demo`, and `sound`, matching the name case-insensitively.
2. WHEN a Command_Line entry has the form `summon <Repo_Reference_String>`, THE Command_Parser SHALL return a `summon` Command carrying the Repo_Reference_String unchanged.
3. WHEN a Command_Line entry consists of a single token that parses as a Repo_Reference_String with a host of `github.com` or `www.github.com`, or of the form `owner/repo` with optional `#ref` or `@sha`, THE Command_Parser SHALL return a `summon` Command carrying that token, so that pasting a bare URL summons the repository.
4. WHEN a Command_Line entry has the form `read` optionally followed by one spread name from `fates`, `necropsy`, or `celtic`, THE Command_Parser SHALL return a `read` Command whose spread is the given name, or `necropsy` when no name is given.
5. WHEN a Command_Line entry has the form `explain <target>` where `<target>` is a 1-based spread position number or a snake_case `CardId`, THE Command_Parser SHALL return an `explain` Command carrying that target.
6. WHEN a Command_Line entry has the form `motion` optionally followed by one argument from `on`, `off`, or `auto`, THE Command_Parser SHALL return a `motion` Command carrying the argument, or no argument when none is given.
7. WHEN a Command_Line entry has the form `demo` optionally followed by one Demo_Name, THE Command_Parser SHALL return a `demo` Command carrying the Demo_Name, or no name when none is given.
8. WHEN a Command_Line entry has the form `sound` optionally followed by one argument from `on` or `off`, THE Command_Parser SHALL return a `sound` Command carrying the argument, or no argument when none is given.
9. WHEN a Command_Line entry has leading or trailing whitespace or repeated internal whitespace between tokens, THE Command_Parser SHALL ignore the surplus whitespace.
10. WHEN a Command_Line entry is empty or whitespace only, THE Command_Parser SHALL return no Command, and THE Terminal SHALL show a new prompt without error output.
11. IF a Command_Line entry matches no recognised form, THEN THE Command_Parser SHALL return an `unknown` Command carrying the raw entry, and THE Terminal SHALL show an Oracle_Voice message that names the unrecognised first token and tells the user to type `help`.
12. THE Command_Parser SHALL accept every input string, including strings of any length and any Unicode content, and return a Command or no Command without throwing.
13. IF a Command_Line entry is longer than 200 characters, THEN THE Terminal SHALL reject the entry before parsing with an Oracle_Voice message stating the 200-character limit, and SHALL NOT send any request.
14. THE Command_Printer SHALL format every valid non-`unknown` Command into a canonical Command_Line string using the lowercase command name and single spaces between tokens, including `demo`, `demo <Demo_Name>`, `sound`, `sound on`, and `sound off`.
15. FOR ALL valid non-`unknown` Commands, including every `demo` and `sound` form, parsing the Command_Printer output SHALL return a Command equal to the original Command (round-trip property).
16. THE Command_Parser SHALL perform no network access, no clock access, no environment access, and no DOM access.

### Requirement 3: Keyboard-first interaction and click equivalents

**User Story:** As a keyboard user, I want standard terminal keys and a button row, so that I can work fast by keyboard or reach every command with a pointer or switch device.

#### Acceptance Criteria

1. WHEN the user presses Enter in the Command_Line, THE Terminal SHALL echo the entry as an Output_Block, clear the Command_Line, add a non-empty entry to the command history, and execute the parsed Command.
2. THE Terminal SHALL keep a command history of at most 50 entries, discarding the oldest entry when a 51st is added.
3. WHEN the user presses the Up Arrow or Down Arrow in the Command_Line, THE Terminal SHALL replace the Command_Line text with the previous or next history entry, and SHALL stop at the oldest entry and at an empty Command_Line without wrapping.
4. WHEN the user presses Ctrl+L in the Command_Line, THE Terminal SHALL execute the `clear` Command.
5. WHEN the user presses Escape while a Typewriter reveal is running, THE Terminal SHALL complete the reveal immediately.
6. WHILE a Summon_Route or Reading_Route request is in flight, WHEN the user presses Ctrl+C in the Command_Line, THE Terminal SHALL abort the request and show an Oracle_Voice message stating that the ritual of summoning was interrupted.
7. THE Terminal SHALL leave the Tab and Shift+Tab keys to native browser focus movement so that the Command_Line never traps keyboard focus.
8. THE Terminal SHALL render a button row offering `HELP`, `SUMMON`, `READ`, `DEMO`, `CLEAR`, `MOTION`, and `SOUND` buttons, each reachable by keyboard and each a native `button` element with a text label.
9. WHEN the user activates the `HELP`, `READ`, `DEMO`, `CLEAR`, or `MOTION` button, THE Terminal SHALL execute the same Command as typing the corresponding command name with no argument.
10. WHEN the user activates the `SUMMON` button, THE Terminal SHALL place the text `summon ` in the Command_Line and move keyboard focus to the Command_Line.
11. WHILE a Summon_Route or Reading_Route request is in flight, WHEN the user submits a `summon` or `read` Command, or a `demo` Command carrying a Demo_Name, THE Terminal SHALL reject the Command with an Oracle_Voice message stating that a ritual is already underway and that Ctrl+C interrupts it, and SHALL send no second request.
12. WHEN the user activates the `SOUND` button, THE Terminal SHALL execute `sound off` while the Sound_Preference is `on` and `sound on` otherwise, and the activation SHALL count as the user gesture required by Requirement 19.

### Requirement 4: Help command

**User Story:** As a new user, I want `help` to explain the commands in the oracle's voice, so that I can start without reading documentation.

#### Acceptance Criteria

1. WHEN the user executes the `help` Command, THE Terminal SHALL show an Output_Block listing `summon`, `read`, `explain`, `clear`, `motion`, `demo`, and `sound`, each with its argument form and a one-line technical description.
2. THE Terminal SHALL begin the `help` Output_Block with one mystical line of at most 16 words, followed by the technical lines.
3. THE Terminal SHALL list in the `help` Output_Block the keyboard shortcuts Up Arrow, Down Arrow, Ctrl+L, Ctrl+C, and Escape with their effects.
4. THE Terminal SHALL execute the `help` Command without any network request.

### Requirement 5: Summon a repository

**User Story:** As a user, I want to paste a repository and have the oracle pin an exact commit, so that every reading is anchored to one immutable state of the repository.

#### Acceptance Criteria

1. WHEN the user executes a `summon` Command, THE Terminal SHALL send the Repo_Reference_String to the Summon_Route and show an Oracle_Voice in-progress line.
2. WHEN the Summon_Route receives a request, THE Summon_Route SHALL validate the request body with a zod schema, parse the Repo_Reference_String with `parseRepoRef` from `@necro/github`, and summon the repository with `GitHubSummoner.summon` using server-injected FetchPort, ClockPort, and EnvPort.
3. WHEN the summon succeeds, THE Summon_Route SHALL return a Summon_Summary containing the canonical `owner`, `name`, 40-character `sha`, and `defaultBranch` from the `RepoRef`, the `stars`, `hasWorkflowsDir`, `degradedFields`, and `cache` values from the summon result, the snapshot file count, and the `truncated` flag.
4. WHEN the Terminal receives a valid Summon_Summary, THE Terminal SHALL store it in the Session, discard any previous Reading_Response in the Session, and show an Output_Block with a mystical line followed by a technical line naming `owner/name`, the first 7 characters of the `sha`, the file count, and the star count.
5. WHEN a Summon_Summary has a non-empty `degradedFields` list, THE Terminal SHALL show an additional technical line naming each degraded field and stating that its metadata was replaced by neutral defaults.
6. WHEN a Summon_Summary has `cache` equal to `hit`, THE Terminal SHALL show a technical line stating that the pinned commit was served from the oracle's memory.
7. WHEN a Summon_Summary has `truncated` equal to true, THE Terminal SHALL show a technical line stating that only the first 5000 files were read.
8. WHEN the Terminal has shown a Summon_Summary, THE Terminal SHALL show a final line suggesting the `read` command.
9. THE Summon_Route SHALL return no file contents, no manifest contents, and no token or Authorization header value in any response.
10. IF the summon raises a NecroError, THEN THE Summon_Route SHALL return an Error_Envelope carrying that error's `code` and `userMessage`, and THE Terminal SHALL show the `userMessage` as an error Output_Block per Requirement 11.

### Requirement 6: Read the spread

**User Story:** As a user, I want `read` to draw the tarot spread for the summoned commit, so that I see the repository's diagnoses as cards.

#### Acceptance Criteria

1. WHEN the user executes a `read` Command and the Session holds a Summon_Summary, THE Terminal SHALL show the pre-reading phrase `Shuffle. Cut. The repository speaks.` as an Output_Block before the Reading_Route request completes, and SHALL send the Pinned_Reference built from the Summon_Summary and the requested spread to the Reading_Route.
2. IF the user executes a `read` Command and the Session holds no Summon_Summary, THEN THE Terminal SHALL show an Oracle_Voice message stating that no repository has been summoned and instructing the user to run `summon <owner/repo>`, and SHALL send no request.
3. IF the user executes `read celtic`, THEN THE Terminal SHALL show an Oracle_Voice message stating that the Celtic Cross is not yet available and that `fates` and `necropsy` are, and SHALL send no request.
4. WHEN the Reading_Route receives a request, THE Reading_Route SHALL validate the request body with a zod schema, validate that the Pinned_Reference parses with `parseRepoRef` and carries a 40-character lowercase hexadecimal SHA, and obtain the snapshot through `GitHubSummoner.summon`.
5. WHEN the Reading_Route has obtained the snapshot, THE Reading_Route SHALL obtain RegistryData and OsvData through `fetchExternalData` from `@necro/github`, and SHALL call `runReading` from `@necro/oracle` with that snapshot, the requested `spreadKind`, the RegistryData, and the OsvData.
6. WHEN `runReading` returns a Reading, THE Reading_Route SHALL return a Reading_Response containing the Reading and the Summon_Summary, and SHALL return no snapshot file contents.
7. WHEN the Reading_Route returns a Reading_Response, THE Reading_Route SHALL validate it against the Reading_Response zod schema before sending.
8. WHEN the Terminal receives a Reading_Response, THE Terminal SHALL validate it against the Reading_Response zod schema, store it in the Session, and render it per Requirement 7.
9. IF the Reading_Response fails zod validation in the Terminal, THEN THE Terminal SHALL show an error Output_Block built from a NecroError with code `VALIDATION_FAILED` and SHALL NOT render any part of the unvalidated response.
10. WHERE the Reading_Response `Reading.spread` contains a position whose card is the void sentinel, THE Terminal SHALL render that position as a void position using the position label and the sentinel description from the Reading.
11. THE Reading_Route SHALL run on the Node.js runtime, SHALL keep any single serverless invocation to at most 50 seconds, and SHALL enforce an Overall_Budget of 40 seconds per reading measured from request receipt, so that the oracle's ritual budget is tighter than the serverless limit.
12. IF a `read` Command targets a spread already held in the Session for the same `sha`, THEN THE Terminal SHALL re-render the held Reading_Response without sending a request.
13. WHILE the Session holds a demo Summon_Summary, WHEN the user executes a `read` Command for `fates` or `necropsy`, THE Terminal SHALL render the matching Reading_Response from the Demo_Bundle per Requirement 18, and SHALL send no request.
14. WHEN the Reading_Route processes a reading, THE Reading_Route SHALL stream a Progress_Event to the Terminal as each Reading_Phase among `SUMMON`, `DOWNLOAD`, `EXTERNAL`, and `READING` starts, over an incrementally readable response (a streamed, chunked response body), before the final Reading_Response is sent as the last message of the same response.
15. WHEN the Terminal receives a Progress_Event for a Reading_Phase, THE Terminal SHALL emit one Progress_Line in the Oracle_Voice for that phase, rendered incrementally as an in-progress Output_Line, with a mystical line of at most 16 words followed by a technical line naming the phase.
16. THE Reading_Route SHALL report the Reading_Phases in the fixed order `SUMMON`, `DOWNLOAD`, `EXTERNAL`, `READING`, SHALL report each Reading_Phase at most once per reading, and SHALL NOT report a later Reading_Phase before an earlier one.
17. IF the connection carrying the streamed response fails before the final Reading_Response arrives, THEN THE Terminal SHALL abort the reading and show an error Output_Block built from a NecroError with code `NETWORK_TIMEOUT` per Requirement 11.
18. WHEN the Terminal has received the final Reading_Response from the stream, THE Terminal SHALL validate it against the Reading_Response zod schema before rendering the spread per criterion 8, so that streamed Progress_Lines never cause an unvalidated Reading to render.
19. IF the Overall_Budget of 40 seconds elapses before `runReading` returns, THEN THE Reading_Route SHALL abort the reading, send a final message mapping to a NecroError of code `NETWORK_TIMEOUT`, and THE Terminal SHALL show that error as an Output_Block together with a visible Oracle_Voice line stating that the ritual ran out of time.
20. IF the EXTERNAL phase through `fetchExternalData` exceeds the External_Sub_Budget of 10 seconds, or `fetchExternalData` reports its `skipped` indicator, THEN THE Reading_Route SHALL skip external data and call `runReading` without RegistryData and without OsvData (both omitted), and SHALL stream a Progress_Event noting the skip rather than failing the reading.
21. WHEN the Reading_Route skips external data per criterion 20, THE Terminal SHALL show a visible Oracle_Voice note stating that the mists hid the registries and vulnerabilities and that the reading proceeded without them.
22. WHERE external data is skipped per criterion 20, THE Reading_Route SHALL let cards that depend on RegistryData or OsvData be absent or lower-confidence as `runReading` produces them, and SHALL NOT fabricate RegistryData or OsvData.

### Requirement 7: Render the spread as code diagnoses

**User Story:** As a user, I want each card shown with its position, orientation, severity, voice line, and evidence, so that the tarot is the interface and every diagnosis is traceable.

#### Acceptance Criteria

1. WHEN the Terminal renders a Reading, THE Terminal SHALL render one Output_Block per spread position, in position order, each beginning with the 1-based position number and the position label from the Reading.
2. THE Terminal SHALL render each drawn card as its roman numeral and its card name in uppercase (for example `XVI THE TOWER`), followed by its orientation word `UPRIGHT` or `REVERSED` and its severity as an integer from 0 to 3 rendered exactly as received from the CardDraw.
3. THE Terminal SHALL render, below each card heading, the mystical line from the Voice_Table for that `CardId` and orientation, followed by the technical line taken from the `CardDraw.summary`.
4. THE Voice_Table SHALL contain, for every value of `CardIdSchema` and for both orientations, exactly one mystical line of at most 16 words, written in present tense for `upright` and in conditional or latent tense for `reversed`.
5. THE Terminal SHALL render, for each drawn card, up to the first 3 `Evidence` items as lines of the form `path:line  detail` (omitting `:line` when `line` is absent and `path` when `path` is absent), and SHALL render a line stating the number of remaining Evidence items when more than 3 exist.
6. WHERE an Evidence item has a `path` and the Session holds a Pinned_Reference of a live (non-demo) Summon_Summary, THE Terminal SHALL render that Evidence item's path as an Evidence_Link.
7. THE Terminal SHALL render the vitality score as an integer from 0 to 100 on its own Output_Line together with a text gauge made of ASCII characters.
8. THE Terminal SHALL render orientation and severity as text and SHALL NOT rely on colour alone to convey either.
9. WHEN rendering is complete, THE Terminal SHALL show a final line suggesting `explain <position>` for evidence detail.
10. THE Terminal SHALL render card names, orientation words, and verdict words in uppercase and SHALL emit no emoji in any Output_Line.
11. THE Terminal SHALL produce identical Output_Lines for equal Reading_Response inputs.
12. THE Terminal SHALL derive every Output_Line shown for a card from the Reading_Response and the Voice_Table, and SHALL NOT alter, add, or remove any draw, orientation, severity, or spread position.

### Requirement 8: Explain a card

**User Story:** As a user, I want to open the evidence behind any card, so that I can verify the diagnosis in the repository.

#### Acceptance Criteria

1. WHEN the user executes an `explain` Command whose target is a spread position number and the Session holds a Reading_Response, THE Terminal SHALL show an Output_Block with the card heading, the mystical line, the technical summary, and every `Evidence` item of the card at that position.
2. WHEN the user executes an `explain` Command whose target is a `CardId` and the Session holds a Reading_Response containing a draw of that card, THE Terminal SHALL show the same Output_Block as for that card's position.
3. THE Terminal SHALL render each Evidence item in the explain Output_Block with its `kind`, `source`, `path`, `line`, and `detail`, and SHALL render the path as an Evidence_Link where Requirement 7 criterion 6 applies.
4. IF the user executes an `explain` Command and the Session holds no Reading_Response, THEN THE Terminal SHALL show an Oracle_Voice message stating that no reading has been cast and instructing the user to run `read`.
5. IF the `explain` target is a position number outside the range of the current spread, or a `CardId` with no draw in the current Reading, or a string that is not a `CardId`, THEN THE Terminal SHALL show an Oracle_Voice message naming the invalid target and stating the valid position range or the drawn card ids.
6. IF the target position is a void position, THEN THE Terminal SHALL show the position label and the void sentinel description.

### Requirement 9: CRT visual effects

**User Story:** As a visitor, I want the terminal to look and feel like a 1986 green-phosphor CRT, so that the oracle has atmosphere without costing legibility.

#### Acceptance Criteria

1. THE Terminal SHALL display text in the foreground colour `#33ff66` on the background colour `#001a00` by default.
2. THE Terminal SHALL render a scanlines overlay over the Terminal screen area using CSS only.
3. THE Terminal SHALL render a phosphor glow around Terminal text using CSS only.
4. WHILE Motion_Mode is `full`, THE Terminal SHALL apply a screen flicker effect with at most 3 luminance changes per second and a luminance change of at most 5 percent.
5. THE Terminal SHALL implement the scanlines, the glow, and the flicker as presentation layers that do not intercept pointer events and are hidden from assistive technology.
6. THE `packages/ui-crt` package SHALL define the CRT_Effects colours, glow, and scanline parameters as named design tokens consumed by all Terminal components.
7. WHEN the user executes the `motion` Command or activates the `MOTION` button, THE Terminal SHALL apply the new Motion_Preference to CRT_Effects without a page reload.
8. THE Terminal SHALL render all CRT_Effects layers without loading image files.

### Requirement 10: Typewriter text and reduced motion

**User Story:** As a user who is sensitive to motion or who uses a screen reader, I want the typewriter effect to be skippable, disabled on request, and silent for assistive technology, so that the atmosphere never blocks access.

#### Acceptance Criteria

1. WHILE Motion_Mode is `full`, THE Terminal SHALL reveal each Output_Block produced by the oracle at 60 characters per second.
2. WHILE Motion_Mode is `full`, THE Terminal SHALL complete the reveal of any single Output_Block within 3 seconds by raising the reveal rate for long blocks.
3. WHILE Motion_Mode is `reduced`, THE Terminal SHALL show each Output_Block in full at once, with no Typewriter reveal, no flicker, no afterglow, no pulsing glow, and no animated spinner.
4. THE Terminal SHALL place the complete text of each Output_Block into the Live_Region as plain text at the moment the Output_Block is added, and SHALL render any animated reveal as a separate presentation copy hidden from assistive technology with `aria-hidden="true"`, so that a screen reader announces each Output_Block once and in full rather than character by character.
5. WHEN the user submits a Command while a Typewriter reveal is running, THE Terminal SHALL complete the running reveal immediately before executing the Command.
6. WHEN Motion_Preference is `auto`, THE Terminal SHALL set Motion_Mode to `reduced` while the `prefers-reduced-motion: reduce` media query matches and to `full` otherwise, and SHALL update Motion_Mode when the media query result changes.
7. WHEN Motion_Preference is `on`, THE Terminal SHALL set Motion_Mode to `full`, and WHEN Motion_Preference is `off`, THE Terminal SHALL set Motion_Mode to `reduced`, regardless of the media query.
8. WHEN the user executes `motion` with no argument, THE Terminal SHALL show the current Motion_Preference and Motion_Mode in an Output_Block.
9. WHEN the user executes `motion on`, `motion off`, or `motion auto`, THE Terminal SHALL set Motion_Preference to the given value and show an Output_Block stating the resulting Motion_Mode.
10. WHEN the user changes Motion_Preference, THE Terminal SHALL store only the Motion_Preference value in browser `localStorage` under a fixed key, and WHEN the Terminal_Route loads, THE Terminal SHALL read that stored value, falling back to `auto` when the value is absent or not one of `auto`, `on`, or `off`.
11. WHEN the Terminal_Route loads with Motion_Preference `auto` and the `prefers-reduced-motion: reduce` media query matches, THE Terminal SHALL show the first Output_Block with no Typewriter reveal.
12. THE Terminal SHALL define the reveal schedule as a pure function of the text length, the Motion_Mode, and the elapsed time, so that the schedule is testable without a DOM or a real clock.

### Requirement 11: Errors in the oracle's voice

**User Story:** As a user, I want every failure to tell me in-world what happened and what to do next, so that I am never left with a stack trace or a silent screen.

#### Acceptance Criteria

1. WHEN the Terminal shows an error, THE Terminal SHALL render the `userMessage` of the NecroError as an error Output_Block whose first line is the mystical line and whose following lines state what happened and what to do next.
2. THE Terminal SHALL render the `userMessage` text received from the API_Routes without altering its wording, other than wrapping lines to at most 72 columns and applying Sanitized_Text rules.
3. THE Terminal SHALL show an error Output_Block for every `NecroErrorCode` in `NecroErrorCodeSchema` that an API_Route can return, with a non-empty mystical line and a non-empty technical line.
4. IF the browser fails to reach an API_Route because of a connection-level failure, THEN THE Terminal SHALL show an error Output_Block built from a NecroError with code `NETWORK_TIMEOUT` and an Oracle_Voice `userMessage` instructing the user to check the connection and retry.
5. IF an API_Route responds with a status of 500 or above and a body that is not a valid Error_Envelope, THEN THE Terminal SHALL show an error Output_Block built from a NecroError with code `UPSTREAM_UNAVAILABLE` and an Oracle_Voice `userMessage` instructing the user to retry later.
6. IF a Summon_Route request exceeds 55 seconds without a response, or a Reading_Route streamed response delivers no final Reading_Response within 55 seconds, THEN THE Terminal SHALL abort the request and show an error Output_Block built from a NecroError with code `NETWORK_TIMEOUT`, serving as a client-side backstop above the Reading_Route's 40-second Overall_Budget.
7. WHEN the Terminal shows an error for a `RATE_LIMITED` code, THE Terminal SHALL show the wait duration stated in the `userMessage` unchanged.
8. THE Terminal SHALL present an error Output_Block with a leading text marker `ERROR` and a distinct colour, so that the error is distinguishable without colour.
9. THE Terminal SHALL NOT show a stack trace, a `cause` chain, an internal file path, or a raw exception message in any Output_Block.
10. THE Terminal SHALL return to a ready Command_Line with focus after every error Output_Block.
11. WHEN the Terminal shows an Oracle_Voice error message for an unrecognised command, THE Terminal SHALL use the unrecognised token verbatim as Sanitized_Text.
12. WHERE the Oracle_Voice in-progress line or an error line contains repository-derived text, THE Terminal SHALL render that text as Sanitized_Text.

### Requirement 12: API route contracts

**User Story:** As an operator, I want the API routes to validate every boundary and map failures predictably, so that the browser never talks to GitHub and no internal detail leaks.

#### Acceptance Criteria

1. THE API_Routes SHALL validate every request body with a zod schema and SHALL reject a body that fails validation with an Error_Envelope of code `VALIDATION_FAILED` and HTTP status 400.
2. THE API_Routes SHALL accept only the HTTP method `POST` and SHALL reject any other method with HTTP status 405.
3. THE API_Routes SHALL accept only a `Content-Type` of `application/json` and a request body of at most 2 KB, and SHALL reject a violating request with an Error_Envelope of code `VALIDATION_FAILED` and HTTP status 400 or 413.
4. WHEN an API_Route raises a NecroError, THE API_Route SHALL return an Error_Envelope with the NecroError `code` and `userMessage`, and an HTTP status mapped as follows: `INVALID_REPO_URL`, `VALIDATION_FAILED`, `REF_NOT_FOUND` to 400 (`REF_NOT_FOUND` to 404); `REPO_NOT_FOUND` to 404; `REPO_PRIVATE` to 403; `RATE_LIMITED` to 429; `DOWNLOAD_TOO_LARGE` to 413; `AUTH_INVALID`, `UPSTREAM_UNAVAILABLE`, and `NETWORK_TIMEOUT` to 502, 502, and 504 respectively; every other code to 500.
5. IF an API_Route catches an error that is not a NecroError, THEN THE API_Route SHALL return an Error_Envelope with code `UPSTREAM_UNAVAILABLE`, an Oracle_Voice `userMessage` that contains no raw exception text, and HTTP status 500.
6. THE API_Routes SHALL read `GITHUB_TOKEN` only through the `EnvPort` backed by the `@necro/config` zod env schema at the server composition root, and SHALL NOT expose the token or any Authorization header value in a response body, response header, log line, or `userMessage`.
7. THE API_Routes SHALL NOT include the `cause` of a NecroError in any response.
8. THE API_Routes SHALL set the response header `Cache-Control: no-store` on every response.
9. THE Reading_Route SHALL complete a reading for a repository of at most 500 files with a median latency of at most 20 seconds, measured from request receipt to the final Reading_Response, on a cache miss, and SHALL in every case abort with code `NETWORK_TIMEOUT` once the 40-second Overall_Budget of Requirement 6 criterion 11 elapses.
10. WHEN the Reading_Route is called for a Pinned_Reference whose snapshot is held in the `@necro/github` Snapshot_Cache, THE Reading_Route SHALL obtain the snapshot without a tarball download.
11. THE API_Routes SHALL never load, import, evaluate, or execute any file content of the summoned repository, and SHALL only pass it to the parsers and detectors of `@necro/oracle`.
12. THE API_Routes SHALL receive their FetchPort, ClockPort, EnvPort, and RateLimitPort through a single composition module so that tests can substitute fixture-backed ports.

### Requirement 13: Rate limiting and abuse protection

**User Story:** As an operator, I want per-IP and global limits on the API routes, so that the deployed demo survives abuse and stays within quotas.

#### Acceptance Criteria

1. WHEN an API_Route receives a request, THE API_Route SHALL consult the RateLimitPort with the client IP before any GitHub request is made.
2. THE API_Routes SHALL allow at most 10 Reading_Route requests per client IP per hour, and at most 20 Summon_Route requests per client IP per hour.
3. THE API_Routes SHALL enforce the Daily_Request_Ceiling, shared by the Summon_Route and the Reading_Route, and SHALL read it only through the EnvPort.
4. THE `@necro/config` env schema SHALL define a validated key `NECRO_DAILY_REQUEST_CEILING` as a positive integer with a default of 1000, and SHALL reject a non-integer, zero, or negative value at startup with a typed error that does not print the value.
5. IF a request exceeds a per-IP or global limit, THEN THE API_Route SHALL return an Error_Envelope with code `RATE_LIMITED`, HTTP status 429, a `Retry-After` header in whole seconds, and an Oracle_Voice `userMessage` stating the wait in whole minutes rounded up with a minimum of one minute, and SHALL make no GitHub request.
6. IF the RateLimitPort fails to answer, THEN THE API_Route SHALL evaluate the request with the Fallback_Limiter using the same per-IP limits (criterion 2) and the same Daily_Request_Ceiling (criterion 3), and SHALL NOT return an Error_Envelope of code `UPSTREAM_UNAVAILABLE` solely because the RateLimitPort failed.
7. WHEN the Fallback_Limiter rejects a request, THE API_Route SHALL respond as specified in criterion 5.
8. THE Fallback_Limiter SHALL keep its counters in the memory of one server instance, SHALL obtain the current time only through the ClockPort, and SHALL expire each counter at the end of its hourly or daily window.
9. THE API_Routes SHALL derive the client IP only from the platform-provided forwarding header configured for the deployment, and SHALL treat a missing client IP as a single shared anonymous identity.
10. THE API_Routes SHALL obtain the current time for rate-limit arithmetic only through the ClockPort.

### Requirement 14: Safe rendering of repository-derived text

**User Story:** As a user, I want repository-derived strings rendered as inert text, so that a hostile repository cannot inject markup, escape sequences, links, or secrets into the terminal.

#### Acceptance Criteria

1. THE Terminal SHALL render every repository-derived string (Evidence `detail`, `path`, `kind`, `CardDraw.summary`, repository names, and `Reading.spread` descriptions) as a text node and SHALL NOT use `dangerouslySetInnerHTML` or any HTML-parsing API for Output_Block content.
2. THE Terminal SHALL pass every repository-derived string through a Sanitized_Text function before rendering.
3. THE Sanitized_Text function SHALL be idempotent, so that sanitizing a sanitized string returns the same string.
4. THE Terminal SHALL build an Evidence_Link only for a live (non-demo) Summon_Summary, only from a validated `RepoRef` owner, name, and sha, and a path and line from a validated `Evidence` item, with the path percent-encoded segment by segment.
5. THE Terminal SHALL render every Evidence_Link as an anchor with `rel="noopener noreferrer"` and `target="_blank"`, and SHALL render no other repository-derived string as a link.
6. THE Terminal SHALL show Evidence `detail` text exactly as received from the Reading_Response, since masking of secret-like values is performed by `@necro/oracle` before the Reading is created.
7. THE Reading_Route SHALL additionally replace any occurrence of the configured `GITHUB_TOKEN` value in any string of the Reading_Response with a fixed redaction marker before sending.
8. THE Terminal SHALL perform no `eval`, `Function` construction, dynamic `import` of repository-derived text, or `postMessage` of repository-derived text.
9. THE Terminal_Route SHALL be served with a Content-Security-Policy header that disallows inline script execution and permits scripts only from the application origin.

### Requirement 15: Accessibility

**User Story:** As a user of assistive technology, I want the terminal to be operable and understandable by keyboard and screen reader, so that the CRT aesthetic does not exclude me.

#### Acceptance Criteria

1. THE Terminal SHALL expose the Output_Log as the Live_Region with `role="log"`, `aria-live="polite"`, and `aria-relevant="additions"`.
2. THE Terminal SHALL give the Command_Line a programmatically associated visible or visually hidden text label, and SHALL give the Terminal a landmark `main` region with a descriptive accessible name.
3. WHILE a Summon_Route or Reading_Route request is in flight, THE Terminal SHALL set `aria-busy="true"` on the Live_Region and SHALL keep it set until the final Output_Block of that request is added.
4. WHEN the Terminal_Route finishes loading, THE Terminal SHALL move focus to the Command_Line, and WHEN a Command finishes executing, THE Terminal SHALL return focus to the Command_Line unless focus is on a button the user activated.
5. WHEN the user activates a button in the button row, THE Terminal SHALL keep focus on that button after a `HELP`, `READ`, `DEMO`, `CLEAR`, `MOTION`, or `SOUND` activation, and SHALL move focus to the Command_Line after a `SUMMON` activation.
6. THE Terminal SHALL show a visible focus indicator with a contrast ratio of at least 3:1 against adjacent colours on every focusable element.
7. THE Terminal SHALL maintain a contrast ratio of at least 4.5:1 between normal-size text and its background, measured with all static CRT_Effects layers enabled.
8. THE Terminal SHALL keep all content and operability when the browser text size is increased to 200 percent and when the viewport width is 320 CSS pixels, without horizontal scrolling of the Command_Line and button row.
9. THE Terminal SHALL convey every state (error, orientation, severity, in-progress) with text in addition to any colour or animation.
10. WHEN the user executes `clear`, THE Terminal SHALL remove all Output_Blocks from the Output_Log, show a single Output_Block stating that the screen was cleared, and keep the Session's Summon_Summary and Reading_Response.
11. THE Terminal SHALL contain no element that flashes more than 3 times in any one-second period.
12. THE Terminal SHALL set the document `lang` attribute to `en` and a descriptive `title`.
13. WHEN a Reading_Phase Progress_Line is emitted, THE Terminal SHALL place that Progress_Line into the Live_Region as one concise status Output_Block, announcing at most one status per Reading_Phase so that the Live_Region is not spammed.

### Requirement 16: Non-functional requirements

**User Story:** As a maintainer, I want the terminal to meet the project's budgets and boundaries, so that the deployed demo is fast, small, and architecturally sound.

#### Acceptance Criteria

1. THE Terminal_Route SHALL load at most 250 KB of JavaScript, gzip-compressed, for the initial route, with card images and any non-essential assets loaded lazily.
2. THE Terminal browser bundle SHALL NOT include `web-tree-sitter`, tree-sitter WASM files, `@necro/github` runtime code, `@octokit/*` packages, or any Node-only module.
3. THE Terminal browser bundle SHALL import from `@necro/oracle` only through the Client_Safe_Entry, and only the schemas and types needed to validate a Reading_Response.
4. THE `apps/web` package SHALL import `@necro/oracle`, `@necro/github`, `@necro/config`, and `@necro/ui-crt` only through each package's `src/index.ts`, with the Client_Safe_Entry as the single permitted additional `@necro/oracle` subpath, and SHALL import `@necro/github` only from server-only modules.
5. THE `@necro/oracle` package SHALL expose the Client_Safe_Entry as a subpath export containing only zod schemas and types, and no module reachable from the Client_Safe_Entry SHALL import a parser, `web-tree-sitter`, a detector, or a Node-only module.
6. THE API_Routes SHALL import `@necro/github` directly (`parseRepoRef`, `GitHubSummoner`, `fetchExternalData`) because no `@necro/coven` runner exists yet, so that the web routes need no intermediate package, and WHEN a `@necro/coven` reading runner is introduced, THE maintainer SHALL migrate the API_Routes to it without changing the route contracts of Requirement 12.
7. THE `@necro/ui-crt` package SHALL depend on no adapter package and no server-only module.
8. WHEN the user submits a local Command (`help`, `clear`, `motion`, `demo` after the Demo_Bundle is loaded, `sound off`, an empty entry, an unknown Command, or an over-length entry), THE Terminal SHALL show the echoed Output_Block within 100 milliseconds.
9. WHILE the Terminal is idle, THE Terminal SHALL use no CPU-driven animation loop when Motion_Mode is `reduced`.
10. THE Terminal SHALL run in the current evergreen versions of Chromium, Firefox, and Safari.
11. THE test suites for the Command_Parser, Command_Printer, Sanitized_Text function, line-wrapping function, reveal schedule, Reading renderer, error mapper, Sound_Reducer, Fallback_Limiter, Demo_Bundle, and API_Route handlers SHALL run offline, using fixture-backed FetchPort, ClockPort, EnvPort, and RateLimitPort, and a Mock `Reading`, with no real network access.
12. THE Demo_Bundle chunk and the sound chunk of Requirement 19 SHALL be excluded from the 250 KB initial-route budget of criterion 1, and each SHALL be loaded only on first use.
13. WHEN the Terminal behaviour, an API_Route, or a public export of `@necro/ui-crt` changes, THE maintainer SHALL update `docs/ARCHITECTURE.md` in the same change.

### Requirement 17: Output formatting

**User Story:** As a user, I want terminal text wrapped consistently at 72 columns, so that the layout stays readable and matches the CLI.

#### Acceptance Criteria

1. THE Terminal SHALL wrap every Output_Line to at most 72 columns, breaking at whitespace where possible and breaking within a token that is longer than 72 columns.
2. THE Terminal SHALL render each Output_Block with a mystical line first and the technical lines after it for every oracle response, except the echoed command and the boot phrase.
3. THE line-wrapping function SHALL preserve all non-whitespace characters of its input in order, so that joining its output lines and removing whitespace equals the input with whitespace removed.
4. THE Terminal SHALL use a monospace font and SHALL render each Output_Line in a block that scrolls the Output_Log, not the page, when the Output_Log exceeds the viewport.
5. WHEN a new Output_Block is added, THE Terminal SHALL scroll the Output_Log to show the end of the new Output_Block, unless Motion_Mode is `reduced` and the user has scrolled up, in which case THE Terminal SHALL not move the scroll position.
6. THE Terminal SHALL keep at most 500 Output_Lines in the Output_Log, discarding the oldest Output_Blocks first.

### Requirement 18: Demo command with bundled sample repositories

**User Story:** As a visitor, I want a `demo` command that replays sample repositories without any network, so that the terminal always works, even offline or when GitHub rate-limits.

#### Acceptance Criteria

1. THE Demo_Catalog SHALL contain between 2 and 3 Demos, of which `lich-py2` SHALL be a legacy Python 2 repository, one SHALL be a mixed, partly ruined repository, and one SHALL be a healthier repository whose vitality is higher than the vitality of each other Demo.
2. WHEN the user executes the `demo` Command with no Demo_Name, THE Terminal SHALL show an Output_Block listing every Demo_Name in the Demo_Catalog with a one-line description and the usage `demo <name>`.
3. WHEN the user executes the `demo` Command with a Demo_Name in the Demo_Catalog, THE Terminal SHALL load the Demo from the Demo_Bundle, store in the Session a Summon_Summary and a Reading_Response both flagged as demo, and show an Output_Block naming the Demo_Name and suggesting the `read` command.
4. IF the `demo` Command carries a Demo_Name that is not in the Demo_Catalog, THEN THE Terminal SHALL show an Oracle_Voice message naming the Demo_Name as Sanitized_Text and listing the available Demo_Names.
5. WHILE the Session holds a demo Summon_Summary, THE Terminal SHALL show the Demo_Label as the first Output_Line of every Output_Block produced by the `demo`, `read`, and `explain` Commands.
6. THE Terminal SHALL execute the `demo` Command, and the `read` and `explain` Commands on a demo Session, with zero network requests, including none to the API_Routes and none to GitHub.
7. THE Terminal SHALL NOT count a `demo` Command, or a `read` or `explain` Command on a demo Session, against any rate limit of Requirement 13.
8. THE Demo_Bundle SHALL be shipped as a static chunk that the Terminal loads lazily on the first `demo` Command or, earlier, by a low-priority prefetch during browser idle time after boot, so that once the chunk is loaded every demo operation works with the network disabled, and THE Demo_Bundle SHALL contain a pre-computed Reading_Response for each Demo and for each of the `fates` and `necropsy` spreads.
9. WHEN the Terminal loads the Demo_Bundle, THE Terminal SHALL validate every Reading_Response against the Reading_Response zod schema before use, and IF a Reading_Response fails validation, THEN THE Terminal SHALL show an error Output_Block built from a NecroError with code `VALIDATION_FAILED` and SHALL NOT render any part of it.
10. IF the Demo_Bundle chunk cannot be loaded, THEN THE Terminal SHALL show an error Output_Block built from a NecroError with code `NETWORK_TIMEOUT` instructing the user to reload the page while online.
11. THE Terminal SHALL render each Evidence path of a demo Reading_Response as plain Sanitized_Text prefixed with `fixture:` and SHALL NOT build an Evidence_Link for it.
12. THE maintainer SHALL regenerate the Demo_Bundle with a script that runs the real `runReading` from `@necro/oracle` on each Demo_Fixture with a fixed ClockPort and fixture RegistryData and OsvData, so that no Demo Reading is hand-written.
13. THE test suite SHALL verify, offline, that every Demo_Bundle Reading_Response is valid against the Reading_Response zod schema and equals the Reading produced by a fresh `runReading` on the corresponding Demo_Fixture.
14. WHEN the user executes a `summon` Command that succeeds, THE Terminal SHALL replace the demo Summon_Summary and Reading_Response in the Session with the live ones, so that no live Reading carries the demo flag.
15. WHILE the Session holds a demo Summon_Summary, WHEN the user executes `read celtic`, THE Terminal SHALL show the same "not yet available" message as Requirement 6 criterion 3.

### Requirement 19: Optional retro sound effects

**User Story:** As a user who enjoys the 1986 atmosphere, I want optional keyboard clicks and a CRT hum that I switch on myself, so that I get the ambience without ever being surprised by noise.

#### Acceptance Criteria

1. THE Terminal SHALL start with the Sound_Preference `off` when no valid stored value exists.
2. THE Terminal SHALL produce no sound, create no audio context, and download no sound code until the Sound_Preference is `on` and a user gesture has occurred.
3. WHEN the user executes `sound on` by pressing Enter in the Command_Line or by activating the `SOUND` button, THE Terminal SHALL lazily load the sound chunk, set the Sound_Preference to `on`, and start the Click and the Hum through the Web Audio API.
4. WHEN the user executes `sound off`, THE Terminal SHALL set the Sound_Preference to `off`, stop the Hum within 200 milliseconds, and release the audio context.
5. WHEN the user executes `sound` with no argument, THE Terminal SHALL show the current Sound_Preference and whether audio is playing in an Output_Block.
6. WHILE the Sound_Preference is `on` and a user gesture has occurred, THE Terminal SHALL play one Click for each keypress in the Command_Line.
7. WHILE the Sound_Preference is `on`, a user gesture has occurred, and the document is visible, THE Terminal SHALL play the Hum.
8. WHEN the document becomes hidden, THE Terminal SHALL stop the Hum and the Clicks, and WHEN the document becomes visible while the Sound_Preference is `on` and a user gesture has occurred, THE Terminal SHALL resume them.
9. THE Terminal SHALL generate every sound with the Web Audio API and SHALL NOT load any audio file.
10. THE Terminal SHALL cap the master gain of all sound at a linear value of 0.2 or lower.
11. THE Terminal SHALL keep sound independent of Motion_Mode, so that `motion` changes do not start or stop sound and `sound` changes do not alter Motion_Mode.
12. WHEN the user changes the Sound_Preference, THE Terminal SHALL store only the value `on` or `off` in browser `localStorage` under a fixed key distinct from the Motion_Preference key, and WHEN the Terminal_Route loads, THE Terminal SHALL read that stored value, falling back to `off` when it is absent or not one of `on` or `off`.
13. WHEN the Terminal_Route loads with a stored Sound_Preference of `on`, THE Terminal SHALL keep all audio silent until the first user gesture in the Terminal, and THE Terminal SHALL NOT autoplay any sound.
14. IF the browser provides no Web Audio API, or the audio context cannot start, or the sound chunk fails to load, THEN THE Terminal SHALL set the Sound_Preference to `off`, show an Oracle_Voice message stating that sound is unavailable, and continue to operate normally.
15. THE Terminal SHALL convey no state, result, or error by sound alone, and SHALL NOT alter any Live_Region content because of sound.
16. THE Terminal SHALL define the transitions of Sound_State as the Sound_Reducer, a pure function of the Sound_State and the event, so that the Hum and Click activity is derivable without audio, DOM, or a real clock.
17. THE sound chunk SHALL be loaded only on first use and SHALL be excluded from the 250 KB initial-route budget of Requirement 16 criterion 1.

## Correctness Properties

These properties are amenable to fast-check property-based testing. Each
property test's `describe` title names its property id and the requirements it
covers (for example `describe("P1 (R2.14, R2.15): command round-trip", …)`).

- **P1 — Command round-trip (R2.7, R2.8, R2.14, R2.15):** For all valid
  non-`unknown` Commands, including `demo`, `demo <Demo_Name>`, `sound`,
  `sound on`, and `sound off`, `parse(print(c))` equals `c`.
- **P2 — Parser totality (R2.12, R2.16):** For all strings, including empty,
  very long, and arbitrary Unicode, the Command_Parser returns a Command or no
  Command and never throws.
- **P3 — Whitespace insensitivity (R2.9):** For all valid Commands and all
  amounts of leading, trailing, and internal surplus whitespace, parsing yields
  the same Command.
- **P4 — Line width (R17.1, R17.3):** For all strings and all words longer than
  72 columns, every wrapped Output_Line is at most 72 columns and the
  non-whitespace characters are preserved in order.
- **P5 — Sanitized_Text (R14.2, R14.3):** For all strings, the output contains
  no C0 or C1 control character other than line feed, no ANSI escape sequence,
  and no bidirectional override or isolate character, and sanitizing twice
  equals sanitizing once.
- **P6 — Voice_Table totality (R7.3, R7.4):** For every `CardId` and both
  orientations, the Voice_Table has exactly one non-empty mystical line of at
  most 16 words, and the rendered card heading uses the uppercase card name.
- **P7 — Reading renderer fidelity (R7.1, R7.2, R7.12):** For all valid
  Readings, the rendered Output_Blocks contain exactly one block per spread
  position in order, every drawn card's `CardId`, orientation, and severity
  (an integer from 0 to 3) appear in the output exactly as received from the
  CardDraw, no card appears that is not in the Reading, and rendering the same
  Reading twice yields identical lines.
- **P8 — Evidence is always shown (R7.5, R8.1):** For all valid Readings and
  all drawn cards with at least one Evidence item, the card Output_Block shows
  at least one Evidence line, and the `explain` Output_Block shows every
  Evidence item.
- **P9 — Reveal schedule (R10.1, R10.2, R10.3, R10.12):** For all text lengths
  and elapsed times, the number of revealed characters is monotonically
  non-decreasing in elapsed time and never exceeds the text length, reaches the
  full length within 3 seconds in `full` mode, and equals the full length at
  elapsed time zero in `reduced` mode.
- **P10 — Motion_Mode resolution (R10.6, R10.7):** For all Motion_Preference
  values and media query results, Motion_Mode is `reduced` exactly when the
  preference is `off`, or the preference is `auto` and the media query matches.
- **P11 — Stored preference validation (R10.10, R19.1, R19.12):** For all
  stored string values, the loaded Motion_Preference is the stored value when
  it is one of `auto`, `on`, or `off`, and `auto` otherwise; the loaded
  Sound_Preference is the stored value when it is one of `on` or `off`, and
  `off` otherwise.
- **P12 — Error rendering (R11.1, R11.3, R11.9):** For all `NecroErrorCode`
  values and all `userMessage` strings of the Oracle_Voice shape, the rendered
  error Output_Block starts with the `ERROR` marker, has a non-empty mystical
  line and technical line, is at most 72 columns wide, and contains no stack
  trace text or `cause` text.
- **P13 — Error status mapping (R12.4, R12.5):** For all `NecroErrorCode`
  values, the API error mapper returns the status listed in Requirement 12
  criterion 4 and an Error_Envelope whose `code` and `userMessage` equal the
  NecroError's, with no `cause` field; for all non-NecroError throwables, it
  returns status 500, code `UPSTREAM_UNAVAILABLE`, and a `userMessage` that
  contains none of the throwable's message text.
- **P14 — Token never leaks (R12.6, R14.7):** For all `GITHUB_TOKEN` values and
  all Readings, Summon_Summaries, and error paths, no response body, response
  header, or rendered Output_Line contains the token value.
- **P15 — History bounds (R3.2, R3.3):** For all sequences of submitted entries
  and Up Arrow and Down Arrow presses, the history length is at most 50, the
  history index stays within the history bounds, and the oldest entry is
  discarded first.
- **P16 — Rate limit arithmetic (R13.2, R13.5):** For all request sequences
  against a fixture-backed RateLimitPort and ClockPort, the 11th Reading_Route
  request from one IP within one hour returns `RATE_LIMITED` with a
  `Retry-After` of at least 1 second and a `userMessage` wait of at least one
  whole minute, and no GitHub request is made for a limited request.
- **P17 — Evidence_Link construction (R14.4, R14.5):** For all valid `RepoRef`
  and `Evidence` values, the Evidence_Link target begins with
  `https://github.com/{owner}/{name}/blob/{sha}/`, contains no unencoded
  character outside the URL path-safe set, and parses back to the original path
  segments.
- **P18 — Pinned_Reference round-trip (R5.3, R6.1, R6.4):** For all valid
  `RepoRef` values, formatting a Pinned_Reference and parsing it with
  `parseRepoRef` yields the same owner, name, and `sha`.
- **P19 — Single in-flight request (R3.11):** For all interleavings of `summon`
  and `read` submissions while a request is in flight, the Terminal sends at
  most one request at a time.
- **P20 — Output_Log cap (R17.6):** For all sequences of Output_Blocks, the
  Output_Log holds at most 500 Output_Lines and the retained lines are the most
  recent ones in order.
- **P21 — Limiter fallback enforcement (R13.2, R13.3, R13.5, R13.6, R13.7,
  R13.8):** For all request sequences, IPs, and ClockPort times against a fake
  RateLimitPort that always fails, the Fallback_Limiter allows exactly the
  requests the same limits would allow (at most 10 Reading_Route and 20
  Summon_Route requests per IP per hour, and at most the
  Daily_Request_Ceiling per day), returns `RATE_LIMITED` for the rest, never
  returns `UPSTREAM_UNAVAILABLE` solely because of the limiter outage, and
  makes no GitHub request for a limited request.
- **P22 — Daily ceiling config (R13.4):** For all candidate values of
  `NECRO_DAILY_REQUEST_CEILING`, the env schema accepts exactly the positive
  integers, applies the default of 1000 when the key is absent, and rejects all
  other values.
- **P23 — Demo bundle validity and equality (R18.9, R18.12, R18.13):** For
  every Demo in the Demo_Catalog and each of the `fates` and `necropsy`
  spreads, the bundled Reading_Response is valid against the Reading_Response
  zod schema and equals the Reading from a fresh `runReading` on the
  Demo_Fixture with the fixed ClockPort and fixture data.
- **P24 — Demo labelling and isolation (R18.5, R18.6, R18.7, R18.11):** For all
  sequences of `demo`, `read`, and `explain` Commands on a demo Session, every
  produced Output_Block starts with the Demo_Label, no network request is
  issued, no rate-limit counter changes, and no Evidence_Link is rendered.
- **P25 — Demo Command resolution (R18.2, R18.3, R18.4):** For all strings
  matching the Demo_Name form, `demo <name>` loads a Demo exactly when the name
  is in the Demo_Catalog, and otherwise yields an Oracle_Voice message listing
  every catalog name.
- **P26 — Sound_Reducer (R19.1, R19.2, R19.7, R19.8, R19.13, R19.16):** For
  all event sequences starting from any loaded Sound_Preference, the Click and
  Hum are inactive until a `gesture` event has occurred after `load`, so no
  sound occurs at load even when the stored Sound_Preference is `on`; the Hum
  is active exactly when the preference is `on`, a gesture has occurred, and
  the document is visible; Click is active exactly when the preference is `on`
  and a gesture has occurred and the document is visible; and after `sound_off`
  both are inactive regardless of other events.
- **P27 — Sound independence (R19.11, R19.15):** For all interleavings of
  `motion` and `sound` Commands, the resulting Motion_Mode depends only on the
  `motion` Commands and the media query, and the resulting Sound_State depends
  only on the `sound` Commands, gesture, and visibility events.
- **P28 — Progress phases are a monotonic sequence (R6.14, R6.15, R6.16):** For
  all readings, the sequence of reported Reading_Phases is a prefix of
  `SUMMON`, `DOWNLOAD`, `EXTERNAL`, `READING` in that fixed order, each phase is
  emitted at most once, phases only advance (never repeat or go backwards), and
  each reported phase yields exactly one Progress_Line. The phase-advance state
  transition is a pure function of the current phase and the next Progress_Event.
- **P29 — External-skip decision and note (R6.20, R6.21, R6.22):** For all
  values of elapsed EXTERNAL time and all values of the `fetchExternalData`
  `skipped` indicator, the decision to skip external data is a pure function of
  `(elapsed, skipped)` that returns skip exactly when `elapsed` exceeds the
  External_Sub_Budget of 10 seconds or `skipped` is true, and whenever it
  returns skip the Oracle_Voice skip note is produced and `runReading` is
  called with RegistryData and OsvData both omitted.

## Out of Scope

- Rituals, grimoires, the Ritual Mode sigil, ledger streaming, patch download,
  pull requests, and destiny readings (`ritual`, `body`, `pr`, `destiny`
  commands).
- The Celtic Cross spread (`deep audit`); the `read celtic` command is parsed
  and answered with an Oracle_Voice "not yet available" message only.
- Card art images, the card forge, the 3D flip animation, and shareable PNG
  cards.
- Oracle voice (text-to-speech), the Graveyard list, and DEMO replay of
  rituals, patches, or pull requests. Only the `demo` Reading replay of
  Requirement 18 is in scope.
- Audio files, music, ritual or card sound effects, and any sound beyond the
  Click and Hum of Requirement 19.
- A service worker or full offline-first application shell: the `demo`
  command works offline only once the Terminal and Demo_Bundle chunk have
  loaded.
- A standalone Server-Sent Events endpoint or a general event-streaming
  infrastructure: Reading_Route progress is streamed as Progress_Events over
  the single incrementally readable (chunked) `POST /api/readings` response of
  Requirement 6, which is sufficient; a separate SSE channel, reconnection or
  event-id replay, and any streaming beyond the four Reading_Phases and the
  final Reading_Response are out of scope.
- Global spend circuit breaker for LLM tokens and sandbox minutes (no LLM or
  sandbox is called by this spec).
- User accounts or GitHub sign-in.
- Full WCAG conformance certification: this spec defines WCAG-oriented
  requirements; conformance validation requires manual testing with assistive
  technologies and expert accessibility review.
