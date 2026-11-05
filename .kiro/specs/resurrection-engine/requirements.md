# Requirements Document

## Introduction

The Resurrection Engine lets a user who has completed a reading in the
Necro-Oracle run `resurrect <card-or-file>` in the CRT terminal to
AI-modernize legacy code found inside the summoned repository. The first
supported language pair is Python 2 → Python 3.

The engine is modelled as the project's grimoire system: a grimoire plugin
(`packages/grimoires/<id>`) executed as a Ritual through the coven runners
(`packages/coven`, runners `{local, inngest}`). The local Coven_Runner is the
default and fully satisfies every requirement in this document with no external
orchestration or sandbox account; the inngest runner is an optional enhancement
enabled only where configured. The terminal `resurrect` command triggers a
Ritual. The engine is built around a Language_Pair_Registry so that additional
pairs (for example PHP 5→8 or jQuery→modern JS) can be added later without
redesign.

Resurrection runs in two passes. A deterministic Pre_Pass performs pure
TypeScript AST and string rewrites over parsed code (via `web-tree-sitter` with
the Python tree-sitter grammar), applying well-known mechanical Python 2→3
transforms. A LLM_Pass then handles what the Pre_Pass could not, behind a
provider port (`LlmPort`) with a deterministic Mock provider for tests and demo
mode. Every engine output is validated to parse as Python 3 (via tree-sitter in
TypeScript by default, with an optional parse-only check inside an E2B
sandbox). Without the sandbox configured, validation uses the tree-sitter
Target_Parser only, and the E2B Sandbox_Parse_Check is an optional enhancement
enabled only where configured. User repository code is never executed; it is
parsed only and treated as untrusted data.

After resurrection, the engine re-diagnoses the repository by re-running a full
Oracle reading with the resurrected files swapped in, reusing the oracle's
`runReading`, `computeVitality`, and `computeVitalityDelta`. It reports a
before/after vitality score and the set of cards that changed.

This spec ends at a per-file before/after diff rendered CRT-style in the
terminal plus a downloadable patch. Progress streams over the existing NDJSON
protocol with resurrection phases and per-phase time budgets, rate limiting and
spend circuit breakers reuse the existing server limiter and breakers, and
errors are redacted exactly as the CRT terminal spec requires. Opening a pull
request against the fork is explicitly out of scope (a later spec).

This document specifies requirements only. Design and implementation are out of
scope here.

## Glossary

- **Resurrection_Engine**: The system under specification: the pluggable
  code-modernization engine that transforms legacy source into a target
  language version, modelled as a grimoire executed as a Ritual.
- **Grimoire**: A migration plugin under `packages/grimoires/<id>` that
  contains the pure fixers, LLM prompt definitions, validation, and fixtures
  for one Language_Pair. A Grimoire imports no adapters.
- **Ritual**: One execution of a Grimoire against a set of Candidate_Files,
  orchestrated by the coven runners.
- **Coven_Runner**: The `local` or `inngest` runner in `packages/coven` that
  executes a Ritual, injecting the adapter ports.
- **Language_Pair**: An ordered source-to-target language-version pairing (for
  example `python2 → python3`).
- **Language_Pair_Registry**: The registry that maps a Language_Pair
  identifier to its Grimoire, enabling new pairs to be registered without
  changing the engine.
- **Pre_Pass**: The deterministic, pure TypeScript pass that applies
  well-known mechanical Python 2→3 transforms over tree-sitter-parsed code.
- **LLM_Pass**: The pass that sends residual constructs the Pre_Pass could not
  convert to a language model through the Llm_Port and applies the validated
  result.
- **Llm_Port**: The provider-port interface through which the LLM_Pass obtains
  completions, with a deterministic Mock_Provider implementation.
- **Mock_Provider**: The deterministic Llm_Port implementation used in tests
  and demo mode, requiring no network access.
- **Target_Parser**: The tree-sitter-based parser used in TypeScript to
  determine whether a produced source text is valid Python 3.
- **Sandbox_Parse_Check**: The optional parse-only (compile-only) check that
  runs inside an E2B sandbox and never executes repository code.
- **Candidate_File**: A Python 2 `.py` file selected for resurrection, derived
  from the reading evidence, within the per-file size limit.
- **Reading**: The oracle reading object of shape `{ id, repo, draws, spread,
  vitality, createdAt, engineVersion, errors }`.
- **Card_Draw**: One drawn card within a Reading carrying its severity and
  orientation.
- **Vitality**: The integer repository-health score in the range 0 to 100
  produced by `computeVitality`.
- **Vitality_Delta**: The value `after_vitality - before_vitality` produced by
  `computeVitalityDelta`.
- **Before_Content**: The original source text of a Candidate_File prior to
  resurrection.
- **After_Content**: The resurrected source text of a Candidate_File produced
  by the Resurrection_Engine.
- **Residual_List**: The explicit per-file list of constructs the engine could
  not convert.
- **File_Result**: The per-file outcome of a Ritual: Before_Content,
  After_Content, the per-file diff, and the Residual_List.
- **Patch**: The downloadable unified-diff artifact covering all File_Results
  of a Ritual.
- **Resurrect_Command**: The terminal command `resurrect [<card-or-file>]` that
  triggers a Ritual.
- **Resurrect_Target**: The parsed argument of a Resurrect_Command: a card
  identifier, a file path, or absent.
- **Resurrection_Route**: The server-side HTTP endpoint that accepts a
  Resurrect_Command request and streams Ritual progress as NDJSON.
- **Stream_Line**: One NDJSON line of the Resurrection_Route response: a
  Phase_Line, a Skip_Note_Line, a Result_Line, or an Error_Line.
- **Phase_Line**: A progress line of shape `{ phase }` naming a
  Resurrection_Phase.
- **Skip_Note_Line**: A line of shape `{ skip: true, note }`.
- **Result_Line**: The final success line of shape `{ result }`.
- **Error_Line**: The final failure line of shape `{ error: { code,
  userMessage } }`.
- **Resurrection_Phase**: One of the named phases surfaced during a Ritual
  (for example SELECT, PRE_PASS, LLM_PASS, VALIDATE, REDIAGNOSE, DIFF).
- **Degraded_Mode**: The mode in which the Resurrection_Engine runs the
  Pre_Pass only because no LLM API key is configured.
- **Rate_Limiter**: The existing per-IP and global limiter in
  `apps/web/src/server/limiter`.
- **Spend_Breaker**: The existing spend circuit breaker for LLM tokens and
  sandbox minutes.
- **Secret_Value**: Any value matching a secret-like pattern (token, key,
  password, credential).
- **Demo_Mode**: The offline mode that replays bundled fixtures from
  `fixtures/graveyard/lich-py2`, labelling every output `[DEMO]`.
- **Env_Schema**: The environment-variable schema in `packages/config` that
  validates configuration at startup, including the LLM API key.

## Requirements

### Requirement 1: Trigger resurrection from the terminal

**User Story:** As a developer reviewing a reading, I want to run a `resurrect` command in the terminal, so that I can modernize legacy code found in the summoned repository.

#### Acceptance Criteria

1. WHEN a user submits a Resurrect_Command after a completed Reading, THE Resurrection_Engine SHALL start exactly one Ritual against the resolved Candidate_Files and report the started Ritual identifier and the count of selected files.
2. WHEN a Resurrect_Command carries a card identifier, THE Resurrection_Engine SHALL select the distinct set of Candidate_Files whose evidence that card flagged.
3. WHEN a Resurrect_Command carries a file path, THE Resurrection_Engine SHALL select the single Candidate_File whose path exactly matches that argument.
4. WHEN a Resurrect_Command carries no argument, THE Resurrection_Engine SHALL select all Candidate_Files in ascending file-path order up to the per-run file cap.
5. WHEN the resolved selection exceeds the per-run file cap, THE Resurrection_Engine SHALL select the first files in ascending file-path order up to the cap and record a Skip_Note_Line stating how many files were deferred.
6. IF a Resurrect_Command is submitted with no completed Reading in scope, THEN THE Resurrection_Engine SHALL reject the command, start no Ritual, and return an Error_Line whose userMessage states that a reading is required first.
7. IF a Resurrect_Target resolves to zero Candidate_Files, THEN THE Resurrection_Engine SHALL return a Result_Line reporting that no Python 2 files were found for that target.
8. IF a Resurrect_Command names a card identifier or file path absent from the current Reading, THEN THE Resurrection_Engine SHALL reject the command, start no Ritual, and return an Error_Line stating the named target was not found in the reading.

### Requirement 2: Candidate file selection from reading evidence

**User Story:** As a user, I want the engine to pick files from the reading's own evidence, so that resurrection targets the code the cards already diagnosed.

#### Acceptance Criteria

1. THE Resurrection_Engine SHALL derive Candidate_Files as the set of distinct `.py` file paths referenced by the evidence of Card_Draws whose detector classified the file as Python 2.
2. WHERE a card identifier is supplied, THE Resurrection_Engine SHALL restrict Candidate_Files to the `.py` paths referenced by the evidence of Card_Draws matching that card identifier.
3. IF a card identifier is supplied and no Card_Draw in the reading matches that card identifier, THEN THE Resurrection_Engine SHALL return an Error_Line stating that the supplied card identifier was not found in the reading, and SHALL make no modification to any file.
4. IF the resolved set of Candidate_Files is empty, THEN THE Resurrection_Engine SHALL return a Result_Line reporting that no Python 2 candidate files were found in the reading evidence, and SHALL make no modification to any file.
5. IF a Candidate_File exceeds the per-file size limit of 1 MB, THEN THE Resurrection_Engine SHALL exclude that file from Candidate_Files and record a Skip_Note_Line naming the excluded path.
6. WHEN the number of resolved Candidate_Files exceeds the per-run file cap of 50 files, THE Resurrection_Engine SHALL process Candidate_Files up to the per-run file cap of 50 files and record a Skip_Note_Line stating how many files were deferred.
7. IF the summoned repository exceeds 50 MB or 5,000 files, THEN THE Resurrection_Engine SHALL return an Error_Line stating that the repository exceeds the supported size, and SHALL make no modification to any file.

### Requirement 3: Deterministic pre-pass transforms

**User Story:** As a user, I want predictable mechanical fixes applied first, so that common Python 2→3 changes are correct and repeatable without a model.

#### Acceptance Criteria

1. WHEN the Pre_Pass processes a Candidate_File, THE Pre_Pass SHALL parse the file with tree-sitter and apply the supported mechanical Python 2→3 transforms, including print-statement to `print()` conversion, `except X, e` to `except X as e`, `dict.iteritems`/`iterkeys`/`itervalues` replacement, and `unicode`/`str` normalization.
2. THE Pre_Pass SHALL be a pure function that performs no network, sandbox, clock, or filesystem side effects.
3. THE Pre_Pass SHALL parse repository code without executing it.
4. WHEN the Pre_Pass is applied twice to the same Before_Content, THE Pre_Pass SHALL produce output byte-identical to applying the Pre_Pass once (idempotence).
5. WHEN the Pre_Pass completes for a Candidate_File, THE Pre_Pass SHALL record each construct it could not convert in that file's Residual_List.
6. WHEN the Pre_Pass is applied to identical Before_Content on separate invocations, THE Pre_Pass SHALL produce byte-identical output and an identical Residual_List across all invocations.
7. IF tree-sitter cannot parse the Candidate_File, THEN THE Pre_Pass SHALL leave the Before_Content unchanged, apply no transforms, and record the unparsed file in that file's Residual_List with an indication that parsing failed.
8. WHEN the Pre_Pass finds no supported transform applicable to a Candidate_File, THE Pre_Pass SHALL return output byte-identical to the Before_Content.

### Requirement 4: LLM pass for residual conversions

**User Story:** As a user, I want a model to resolve the changes mechanical rules cannot, so that more of the file is modernized correctly.

#### Acceptance Criteria

1. WHILE an LLM API key is configured, THE LLM_Pass SHALL send each construct remaining in a file's Residual_List to the language model through the Llm_Port, bounded by a per-construct token budget and timeout.
2. WHEN repository code is sent to the Llm_Port, THE LLM_Pass SHALL wrap that code in explicit data delimiters, mark it as untrusted data, and mask any secret-like content before transmission.
3. WHEN the Llm_Port returns a completion, THE LLM_Pass SHALL validate the completion against a zod schema before applying it.
4. IF an Llm_Port completion fails zod validation, THEN THE LLM_Pass SHALL retry the call once, and if the retry also fails validation THE LLM_Pass SHALL leave the affected construct unconverted and record it in the Residual_List.
5. IF the Llm_Port times out or is unavailable, THEN THE LLM_Pass SHALL leave the affected construct unconverted and record it in the Residual_List.
6. IF no LLM API key is configured, THEN THE LLM_Pass SHALL be skipped and every residual construct SHALL remain in the Residual_List.
7. THE LLM_Pass SHALL obtain completions only through the Llm_Port and SHALL support the Mock_Provider for tests and Demo_Mode.
8. WHEN a Ritual runs in tests or Demo_Mode, THE LLM_Pass SHALL use the Mock_Provider and perform no network calls.

### Requirement 5: Output always parses or is reported unconverted

**User Story:** As a user, I want to trust that converted code is valid, so that the engine never presents broken code as modernized.

#### Acceptance Criteria

1. WHEN the Resurrection_Engine produces After_Content for a file, THE Resurrection_Engine SHALL validate that After_Content parses as Python 3 using the Target_Parser, treating zero parser error nodes as valid.
2. IF produced content for a construct does not parse as Python 3, or the Target_Parser reports any error node for it, THEN THE Resurrection_Engine SHALL exclude that content from After_Content and record the construct in the Residual_List.
3. THE Resurrection_Engine SHALL present every File_Result as either valid Python 3 After_Content or explicitly reported residual content, and SHALL NOT present unparseable content as converted.
4. THE Resurrection_Engine SHALL NOT execute repository code during validation.
5. WHERE the Sandbox_Parse_Check is enabled, THE Resurrection_Engine SHALL run a parse-only (compile-only) check inside an E2B sandbox and SHALL NOT execute repository code.
6. IF the Sandbox_Parse_Check times out or the sandbox is unavailable, THEN THE Resurrection_Engine SHALL fall back to the Target_Parser result and record a Skip_Note_Line stating the sandbox check was skipped.
7. WHERE no E2B sandbox is configured, THE Resurrection_Engine SHALL validate output using the tree-sitter Target_Parser only, and this SHALL fully satisfy the parse-validation requirement within the 50-second local execution limit.
8. IF validation of a file does not complete within the VALIDATE phase time budget, THEN THE Resurrection_Engine SHALL mark that file as not validated in its Residual_List and SHALL exclude it from the Patch.

### Requirement 6: Vitality re-diagnosis

**User Story:** As a user, I want a before/after health comparison, so that I can see whether resurrection improved the repository.

#### Acceptance Criteria

1. WHEN a Ritual produces After_Content for its files, THE Resurrection_Engine SHALL run a full Reading over the repository snapshot with the resurrected files swapped in, using `runReading` with the same spread used by the pre-resurrection Reading.
2. THE Resurrection_Engine SHALL compute before_vitality from the pre-resurrection Reading and after_vitality from the post-resurrection Reading using `computeVitality`, each an integer in the range 0 to 100.
3. WHEN both the pre-resurrection and post-resurrection Readings exist, THE Resurrection_Engine SHALL compute and report a Vitality_Delta equal to `computeVitalityDelta(before_vitality, after_vitality)`, which equals `after_vitality - before_vitality`.
4. THE Resurrection_Engine SHALL report the set of cards whose draw changed between the pre-resurrection Reading and the post-resurrection Reading, where a draw is changed if the card's presence, severity, or orientation differs.
5. IF the post-resurrection Reading fails to complete, THEN THE Resurrection_Engine SHALL preserve the pre-resurrection Reading, report that re-diagnosis is incomplete, and emit an Error_Line for the re-diagnosis step without discarding the produced File_Results.

### Requirement 7: Per-file diff and downloadable patch

**User Story:** As a user, I want a per-file diff and a patch I can download, so that I can review and apply the changes myself.

#### Acceptance Criteria

1. WHEN a File_Result is produced, THE Resurrection_Engine SHALL render a line-by-line before/after diff of that file in the CRT terminal, visually marking each line as added, removed, or unchanged.
2. IF the Before_Content and After_Content of a File_Result are identical, THEN THE Resurrection_Engine SHALL render the file as unchanged with no added or removed lines.
3. WHEN all File_Results of the Ritual are produced, THE Resurrection_Engine SHALL produce a single downloadable Patch in unified diff format covering all File_Results.
4. IF the Ritual produces zero changed File_Results, THEN THE Resurrection_Engine SHALL produce an empty Patch containing no file changes.
5. WHEN the Patch is applied to the Before_Content of a file, THE Resurrection_Engine SHALL yield byte-for-byte exactly the After_Content of that file.
6. THE Resurrection_Engine SHALL NOT open a pull request against the fork within this feature.
7. THE Resurrection_Engine SHALL exclude from the Patch any file reported as not validated.

### Requirement 8: Unconverted constructs reported explicitly

**User Story:** As a user, I want to know what the engine could not convert, so that I can finish the migration with full information.

#### Acceptance Criteria

1. WHEN a Ritual completes for a file, THE Resurrection_Engine SHALL include that file's Residual_List in its File_Result, where each Residual_List entry identifies the source location (file path and line number) and the unconverted construct.
2. THE Resurrection_Engine SHALL ensure that the number of entries in a file's Residual_List equals the number of constructs the engine attempted but failed to convert in that file, with no failed construct omitted.
3. WHEN a file's Residual_List contains zero entries, THE Resurrection_Engine SHALL report a fully-converted indication in that File_Result.
4. IF a Ritual terminates for a file before conversion completes, THEN THE Resurrection_Engine SHALL include in that File_Result a Residual_List containing every construct not yet confirmed as converted and an indication that the Ritual did not complete.

### Requirement 9: Streaming progress over the NDJSON protocol

**User Story:** As a user, I want live progress during a resurrection, so that I can follow the Ritual as it runs.

#### Acceptance Criteria

1. WHILE a Ritual runs, THE Resurrection_Route SHALL stream its response body as NDJSON, writing each Stream_Line as a single line terminated by a newline character and reusing the existing Phase_Line, Skip_Note_Line, Result_Line, and Error_Line line shapes.
2. WHEN a Resurrection_Phase begins, THE Resurrection_Route SHALL emit exactly one Phase_Line naming that phase, and SHALL emit Phase_Lines in the defined Resurrection_Phase order without repeating or skipping a phase.
3. THE Resurrection_Route SHALL emit exactly one terminal line as the last line of the stream, being either a Result_Line carrying the Ritual result or an Error_Line carrying an error envelope whose payload contains only the error code and a user-facing message with no cause field and no secret-like content.
4. WHEN a Resurrection_Phase's elapsed running time reaches its configured per-phase time budget before that phase completes, THE Resurrection_Route SHALL emit one Skip_Note_Line indicating the phase was time-bounded and SHALL continue the Ritual with the next Resurrection_Phase.
5. THE Resurrection_Route SHALL validate every Stream_Line against its zod schema before writing it to the stream.
6. IF a Stream_Line fails zod validation before being written, THEN THE Resurrection_Route SHALL NOT write that line and SHALL terminate the stream with an Error_Line carrying a redacted error envelope.
7. IF the VALIDATE phase reaches its time budget before completing, THEN THE Resurrection_Engine SHALL report every file not yet validated as not validated in that file's Residual_List, SHALL exclude those files from the Patch, and SHALL NOT silently skip validation.

### Requirement 10: Serverless-safe long-running execution

**User Story:** As an operator, I want long sandbox work to run in the background, so that serverless functions stay within their limits.

#### Acceptance Criteria

1. THE Resurrection_Engine SHALL run every Ritual to completion on the local Coven_Runner by default, satisfying all functional requirements without any external orchestration or sandbox account.
2. WHERE the inngest runner is configured, THE Coven_Runner SHALL run long sandbox work in the background and poll it with `step.sleep`.
3. THE Resurrection_Route SHALL return control from any single serverless function invocation within 50 seconds.
4. WHEN a Ritual exceeds its configured wall-clock budget, THE Resurrection_Engine SHALL end the Ritual, destroy any sandbox it opened, and emit an Error_Line reporting the budget was exhausted, including partial File_Results produced so far.
5. IF the inngest runner or a sandbox is configured and a background sandbox poll fails or stalls beyond its budget, THEN THE Resurrection_Engine SHALL end the Ritual, destroy the sandbox, and emit an Error_Line reporting the sandbox step did not complete.

### Requirement 11: Rate limiting and spend breakers

**User Story:** As an operator, I want resurrection throttled and spend-capped, so that the deployed demo stays available and within budget.

#### Acceptance Criteria

1. WHEN a Resurrect_Command request is received, THE Resurrection_Route SHALL apply the existing per-IP and global Rate_Limiter before starting a Ritual.
2. IF the Rate_Limiter rejects a request, THEN THE Resurrection_Route SHALL return an Error_Line stating the rate limit was reached and after how many seconds to retry.
3. IF the Spend_Breaker for LLM tokens is open, THEN THE Resurrection_Engine SHALL skip the LLM_Pass and record a Skip_Note_Line stating the LLM spend limit was reached.
4. IF the Spend_Breaker for sandbox minutes is open, THEN THE Resurrection_Engine SHALL skip the Sandbox_Parse_Check and record a Skip_Note_Line stating the sandbox spend limit was reached.
5. WHEN a pass is skipped because a Spend_Breaker is open, THE Resurrection_Engine SHALL continue the Ritual with the remaining passes and complete with the partial File_Results produced.

### Requirement 12: Error redaction and secret masking

**User Story:** As a user, I want errors shown safely, so that no secret or raw internal detail is ever exposed.

#### Acceptance Criteria

1. WHEN the Resurrection_Route returns an Error_Line, THE Resurrection_Route SHALL emit a redacted error envelope containing exactly two fields, a code and a userMessage, and SHALL exclude the cause, the stack trace, and any other internal diagnostic field.
2. IF an Error_Line's underlying NecroError lacks a recognized code, THEN THE Resurrection_Route SHALL emit the envelope with a generic fallback code and a generic oracle-voice userMessage, and SHALL still exclude the cause and stack trace.
3. WHEN a Secret_Value appears in any diff, Patch, Stream_Line, log entry, or error, THE Resurrection_Engine SHALL replace every occurrence of that Secret_Value with a fixed non-reversible mask token before the containing content is stored, displayed, logged, or sent to the language model.
4. IF masking of a detected Secret_Value cannot be completed for a given content item, THEN THE Resurrection_Engine SHALL withhold that content item from storage, display, logging, and transmission to the language model, and SHALL raise a typed NecroError.
5. THE Resurrection_Engine SHALL raise every failure as a typed NecroError value carrying a non-empty code and a non-empty oracle-voice userMessage, where the userMessage states what happened and what to do next and contains no file paths, no secret values, and no stack trace.

### Requirement 13: Degraded mode without an LLM API key

**User Story:** As a user without an LLM key configured, I want the engine to still run its mechanical pass, so that I get mechanical fixes and a clear explanation.

#### Acceptance Criteria

1. THE Resurrection_Engine SHALL read the LLM API key only from the server Env_Schema at startup and SHALL NOT include the key in any response sent to the client.
2. THE Resurrection_Engine SHALL NOT write the LLM API key, or any substring of it, to any log, ledger entry, error message, or trace output.
3. WHEN the Resurrection_Engine starts a run and no LLM API key is present in the server Env_Schema, THE Resurrection_Engine SHALL enter Degraded_Mode and execute the Pre_Pass only, performing zero LLM calls.
4. WHILE in Degraded_Mode, THE Resurrection_Engine SHALL emit exactly one Skip_Note_Line in the oracle voice that states only the deterministic pass ran because no model is configured.
5. IF the LLM API key is absent or an empty string at startup, THEN THE Resurrection_Engine SHALL complete startup in Degraded_Mode without raising a fatal error and SHALL make the Degraded_Mode state observable to the caller.

### Requirement 14: Offline demo mode

**User Story:** As a presenter, I want resurrection to run offline from fixtures, so that I can demo it reliably with no network.

#### Acceptance Criteria

1. WHILE Demo_Mode is active, THE Resurrection_Engine SHALL run the Ritual from the bundled `fixtures/graveyard/lich-py2` fixtures.
2. WHILE Demo_Mode is active, IF any outbound network call is attempted, THEN THE Resurrection_Engine SHALL block the call and fail without accessing the network.
3. WHILE Demo_Mode is active, THE Resurrection_Engine SHALL prefix every output line with the `[DEMO]` label.
4. WHILE Demo_Mode is active, THE Resurrection_Engine SHALL use the Mock_Provider for the LLM_Pass.
5. WHILE Demo_Mode is active, THE Resurrection_Engine SHALL produce byte-identical output across repeated runs on the same fixtures.
6. IF a required demo fixture is missing or unreadable, THEN THE Resurrection_Engine SHALL return an Error_Line stating the demo fixture could not be loaded.

### Requirement 15: Pluggable language-pair registry

**User Story:** As a maintainer, I want to add new language pairs without redesign, so that the engine grows beyond Python 2→3.

#### Acceptance Criteria

1. WHEN a Ritual is started with a Language_Pair identifier that is registered in the Language_Pair_Registry, THE Resurrection_Engine SHALL resolve and return the single Grimoire bound to that identifier.
2. IF a Ritual is started with a Language_Pair identifier that is not registered in the Language_Pair_Registry, THEN THE Resurrection_Engine SHALL reject the Ritual, return a typed error indicating the identifier is unknown, and start no sandbox or LLM work.
3. IF a Grimoire is registered under a Language_Pair identifier that is already present in the Language_Pair_Registry, THEN THE Resurrection_Engine SHALL reject the registration and return a typed error indicating the identifier is already bound, leaving the existing binding unchanged.
4. WHERE a new Language_Pair Grimoire is registered, THE Resurrection_Engine SHALL execute it through the same Ritual lifecycle and the same port contracts used by existing Grimoires, with no modification to source files of the engine core.
5. THE Resurrection_Engine SHALL register the Python 2→3 Language_Pair as a Grimoire under `packages/grimoires/<id>`.
6. THE Grimoire fixers SHALL import no adapter modules, verifiable by static inspection of their import statements.
7. WHEN a Grimoire fixer requires the Llm_Port, the sandbox port, or any other adapter, THE Resurrection_Engine SHALL supply that adapter to the fixer only as a parameter injected through the Coven_Runner.

### Requirement 16: Deterministic demo improvement

**User Story:** As a presenter, I want the lich-py2 demo to show a clear, repeatable improvement, so that the recorded video reliably demonstrates resurrection working.

#### Acceptance Criteria

1. WHEN the Resurrection_Engine runs the lich-py2 demo in Demo_Mode, THE Resurrection_Engine SHALL report a Vitality_Delta strictly greater than zero.
2. WHEN the Resurrection_Engine runs the lich-py2 demo in Demo_Mode, THE Resurrection_Engine SHALL report at least one changed card, including at least one card whose draw improves (for example The Tower becoming The Star).
3. WHILE Demo_Mode runs the lich-py2 demo, THE Resurrection_Engine SHALL produce the identical Vitality_Delta and the identical set of changed cards on every run.
4. THE lich-py2 demo fixtures SHALL be authored so that the deterministic Pre_Pass alone, with no LLM API key configured, produces the positive Vitality_Delta and the changed card required by criteria 1 and 2.
