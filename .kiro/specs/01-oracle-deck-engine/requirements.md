# Requirements Document

## Introduction

The Oracle Deck Engine is the deterministic, pure-TypeScript heart of the Necro-Oracle system (`packages/oracle`). It transforms a `RepoSnapshot` — a structured representation of a public GitHub repository — into an evidence-backed tarot reading: a set of `CardDraw` objects, a positional spread, and a vitality score. All detection logic is purely deterministic; LLMs interpret evidence but never decide whether a card is drawn. The engine is the foundation on which every surface (web terminal, CLI, MCP server, GitHub Action) is built.

## Glossary

- **CardDraw**: A single card diagnosis: `{ card: CardId; severity: Severity; orientation: "upright" | "reversed"; evidence: Evidence[]; summary: string; grimoires: string[] }`.
- **CardId**: A snake_case string identifier for a Major Arcana card (e.g. `"judgement"`, `"tower"`).
- **Deck_Engine**: The `packages/oracle` library. The system referred to in all `THE Deck_Engine SHALL` requirements.
- **Detector**: A pure function `(snapshot: RepoSnapshot) => CardDraw | null` that decides whether a card is drawn and at what severity.
- **Evidence**: `{ kind: string; path?: string; line?: number; detail: string; source: "static" | "github" | "osv" | "registry" | "sandbox" }`. The factual basis for a card draw.
- **Manifest**: A dependency or configuration file: `requirements*.txt`, `setup.py`, `pyproject.toml`, `Pipfile`, `package.json`.
- **Reading**: The complete output of divination: draws, spread positions, vitality score, and metadata.
- **RepoSnapshot**: The in-memory representation of a repository at a pinned commit SHA. Contains `ref`, `files`, `meta`, `manifests`, and a lazily-loaded `contents` map.
- **Severity**: An integer `0 | 1 | 2 | 3`. `0` = not drawn; `1` = reversed (minor); `2` = upright; `3` = upright, burning (critical).
- **Spread**: A positional assignment of drawn cards to named positions (e.g. "The Corpse", "The Wound").
- **SpreadKind**: `"fates"` (3 positions) | `"necropsy"` (5 positions) | `"celtic"` (10 positions).
- **Vitality**: An integer `0–100` representing the repository's overall health score, derived from card weights and severities.
- **AST_Parser**: The component that parses `setup.py` as an abstract syntax tree without executing it.
- **Tree_Sitter_Parser**: The component that parses Python source files using `web-tree-sitter` + `tree-sitter-python` WASM.
- **Manifest_Parser**: The component that parses dependency and configuration manifests.
- **Snapshot_Builder**: The component that constructs a `RepoSnapshot` from a local directory or a provided file map.

---

## Requirements

### Requirement 1: Card Registry

**User Story:** As a developer integrating the Oracle, I want a typed registry of all 12 Major Arcana cards with their metadata, so that detectors, spreads, and narration layers have a single authoritative source of truth for card definitions.

#### Acceptance Criteria

1. R1.1: THE Deck_Engine SHALL register exactly 12 cards: `judgement` (XX), `tower` (XVI), `devil` (XV), `death` (XIII), `wheel` (X), `hermit` (IX), `hanged_man` (XII), `temperance` (XIV), `justice` (XI), `moon` (XVIII), `star` (XVII), and `world` (XXI).
2. R1.2: THE Deck_Engine SHALL expose each card's `id` (snake_case string of 1–40 characters), `numeral` (Roman numeral string matching one of the 12 registered numerals), `name` (display name string of 1–60 characters), `uprightMeaning` (technical upright description string of 1–500 characters per §3A.1), `reversedMeaning` (technical reversed description string of 1–500 characters per §3A.1), `weight` (non-negative integer in the range 0–100 used in vitality scoring; narrative cards `star` and `world` have weight 0), and `linkedGrimoireIds` (array of 0–20 grimoire id strings, each 1–40 characters).
3. R1.3: THE Deck_Engine SHALL validate the entire card registry at module load time using a zod schema; IF any card entry fails validation, THEN THE Deck_Engine SHALL throw a `NecroError` with code `REGISTRY_INVALID` and a `userMessage` indicating which card id failed validation, before any exported function or constant is callable.
4. R1.4: THE Deck_Engine SHALL export a `CARD_REGISTRY` constant typed as `ReadonlyMap<CardId, CardDefinition>` so that consumers cannot mutate it at runtime.
5. R1.5: THE Deck_Engine SHALL export a `getCard(id: CardId): CardDefinition` function that returns the card definition for a valid registered id; IF the id is not in the registry, THEN THE Deck_Engine SHALL throw a `NecroError` with code `CARD_NOT_FOUND` and a `userMessage` indicating the unrecognized id.
6. R1.6: IF two or more card entries in the registry share the same `id` or the same `numeral`, THEN THE Deck_Engine SHALL throw a `NecroError` with code `REGISTRY_INVALID` at module load time before any exported function or constant is callable.

---

### Requirement 2: RepoSnapshot Interface and Builders

**User Story:** As a CLI user or test author, I want to construct a `RepoSnapshot` from a local directory or a provided file map, so that the deck engine can be exercised without a live GitHub connection.

#### Acceptance Criteria

1. R2.1: THE Deck_Engine SHALL define a `RepoRef` type with fields: `owner` (string), `name` (string), `sha` (string), and `defaultBranch` (string); and a `RepoSnapshot` type with fields: `ref` (`RepoRef`), `files` (array of `FileEntry`), `meta` (`RepoMeta`), `manifests` (array of `Manifest`), `contents` (a `Map<string, string>` keyed by file path where `contents.get(path)` returns the full text of that file), `oversizeFiles` (array of evidence items with shape `{ kind: "file_skipped"; path: string; detail: string; source: "static" }`), `truncated` (boolean), and `createdAt` (ISO 8601 UTC string set at snapshot construction time, representing the moment the snapshot was taken).
2. R2.2: THE Deck_Engine SHALL define a `FileEntry` type with fields: `path` (string), `size` (number of bytes), `lang` (`"python" | "js" | "ts" | "html" | "other"`), and `sha` (string); where `lang` is assigned by file extension: `.py` → `"python"`, `.js` or `.mjs` or `.cjs` → `"js"`, `.ts` or `.tsx` or `.mts` → `"ts"`, `.html` or `.htm` → `"html"`, all other extensions → `"other"`.
3. R2.3: THE Deck_Engine SHALL export `buildSnapshotFromDirectory(dir: string): Promise<RepoSnapshot>` exclusively from the Node-only entry point `@necro/oracle/node` (i.e. `packages/oracle/src/node.ts`), NOT from the main `@necro/oracle` entry point (`packages/oracle/src/index.ts`), so that the main bundle remains free of Node.js `fs` module imports and satisfies the browser bundle constraint in R21.7.
4. R2.4: IF the directory path supplied to `buildSnapshotFromDirectory` (exported from `@necro/oracle/node`) does not exist or is not accessible, THEN THE Deck_Engine SHALL reject the returned promise with a `NecroError` with code `SNAPSHOT_DIR_NOT_FOUND`.
5. R2.5: THE Deck_Engine SHALL export a `buildSnapshotFromFileMap(ref: RepoRef, files: Record<string, string>): RepoSnapshot` function that accepts a plain object mapping file paths to file contents and constructs a `RepoSnapshot` synchronously, to support tests without filesystem access.
6. R2.6: WHEN building a snapshot from any source, THE Deck_Engine SHALL skip any file whose size exceeds 1,048,576 bytes (1 MB), appending a `{ kind: "file_skipped", path, detail: "too large to divine", source: "static" }` item to `oversizeFiles` on the snapshot for each skipped file.
7. R2.7: IF the source contains more than 5,000 files after applying the per-file size filter, THEN THE Deck_Engine SHALL include only the first 5,000 files sorted lexicographically by path, set `truncated` to `true` on the snapshot, and set `truncated` to `false` when the source contains 5,000 or fewer files after filtering.
8. R2.8: THE Deck_Engine SHALL define and export the `GitHubSnapshotBuilder` interface as `{ build(ref: RepoRef): Promise<RepoSnapshot> }` so that the GitHub adapter in `packages/github` can implement it without importing adapter code from `packages/oracle`.

---

### Requirement 3: Tree-Sitter Python Parsing

**User Story:** As the Oracle Deck Engine, I want to parse Python source files using `web-tree-sitter` with the `tree-sitter-python` WASM grammar, so that card detectors can identify legacy syntax nodes with structural accuracy rather than fragile regex.

#### Acceptance Criteria

1. R3.1: THE Tree_Sitter_Parser SHALL initialize the `web-tree-sitter` parser with the `tree-sitter-python` WASM grammar file exactly once per process, caching the parser instance for subsequent calls.
2. R3.2: IF WASM initialization fails, THEN THE Tree_Sitter_Parser SHALL throw a `NecroError` with code `PARSER_INIT_FAILED` before any parse call is attempted.
3. R3.3: THE Tree_Sitter_Parser SHALL export a `parsePython(source: string): Tree` function that returns a `web-tree-sitter` `Tree` object whose root node is of type `module`.
4. R3.4: WHEN `parsePython` is called with a string containing valid Python 2 or Python 3 syntax, THE Tree_Sitter_Parser SHALL return a `Tree` with no `ERROR` node whose byte range spans the full input.
5. R3.5: IF `parsePython` is called with a string containing binary or invalid UTF-8 sequences, THEN THE Tree_Sitter_Parser SHALL return a best-effort partial `Tree` with a non-null root node rather than throwing, ensuring detectors never crash on arbitrary file contents.
6. R3.6: THE Tree_Sitter_Parser SHALL export a `queryPython(tree: Tree, sexpPattern: string): QueryMatch[]` function that runs a tree-sitter S-expression query against a parsed tree; IF the S-expression pattern is syntactically invalid, THEN THE Tree_Sitter_Parser SHALL throw a `NecroError` with code `INVALID_QUERY_PATTERN`.
7. R3.7: THE Tree_Sitter_Parser SHALL export a `hasLegacyPythonNodes(tree: Tree): boolean` function that returns `true` if the tree contains any of the following: (a) a named node of type `print_statement`; (b) a named node of type `exec_statement`; (c) an `except_clause` node with a comma (`,`) token as a direct unnamed child (Python 2 `except E, e` form); (d) a `comparison_operator` node whose `operators` field contains a `<>` token (matched by token text `"<>"`); (e) an `integer` node (named node type `integer`) whose text matches the regex `/^0[0-7]+$/` (legacy 0-prefixed octal, e.g. `0777`) — NOTE: this is a token-text match on the `integer` node, not a distinct named node type; (f) an `integer` node whose text ends with `L` or `l` (Python 2 long integer literal, e.g. `10L`) — NOTE: token-text match on the `integer` node, not a distinct named node type; (g) the text content of any node containing a backtick character (`` ` ``) at position 0 of the node's text (Python 2 backrepr expression, e.g. `` `x` ``) — NOTE: tree-sitter-python does not expose a dedicated named node for backtick repr; detection is by scanning `integer`-sibling node text or using a cursor walk for nodes whose text starts and ends with backticks.
8. R3.8: IF `parsePython` is called with a string whose byte length exceeds 1,048,576 bytes, THEN THE Tree_Sitter_Parser SHALL throw a `NecroError` with code `FILE_TOO_LARGE` rather than attempting to parse it.

---

### Requirement 4: Manifest Parsing

**User Story:** As the Oracle Deck Engine, I want to parse dependency and configuration manifest files, so that detectors for The Tower, Judgement, Temperance, and other cards can access structured dependency and runtime metadata.

#### Acceptance Criteria

1. R4.1: THE Manifest_Parser SHALL parse `requirements*.txt` files (any filename matching `requirements*.txt` at any depth) into an array of `ParsedDependency` objects containing at minimum `name` (string), `versionSpec` (raw specifier string as written in the file, e.g. `">=1.2"`, or `""` when absent), and `extras` (array of strings, e.g. `["security"]`, empty array when absent).
2. R4.2: THE Manifest_Parser SHALL parse `setup.py` files by constructing an AST using `web-tree-sitter` (never executing the file) and extracting `install_requires`, `python_requires`, `classifiers`, and `name` fields when present as static string or list literals; WHEN a field is a dynamic expression, THE Manifest_Parser SHALL omit that field from the result rather than throwing.
3. R4.3: THE Manifest_Parser SHALL parse `pyproject.toml` files using a TOML parser, extracting `[project]` `dependencies`, `requires-python`, `name`, `version`, and the following `[tool.poetry]` equivalents: `name`, `version`, `python` (under `[tool.poetry.dependencies]`), and `packages`.
4. R4.4: THE Manifest_Parser SHALL parse `Pipfile` files (TOML format) extracting `[packages]`, `[dev-packages]`, and `[requires]` `python_version`.
5. R4.5: THE Manifest_Parser SHALL parse `package.json` files as JSON, extracting `dependencies`, `devDependencies`, `engines`, and `scripts`.
6. R4.6: IF a manifest file contains syntactically invalid content, THEN THE Manifest_Parser SHALL return a `ParseResult` with `parsed: false`, a `parseError` string (human-readable description of the syntax error), and an empty `dependencies` array rather than throwing.
7. R4.7: THE Manifest_Parser SHALL export a `detectPythonVersion(manifests: Manifest[]): PythonVersionSignal` function that synthesises a signal (`"py2_only" | "py3_only" | "straddling" | "unknown"`) from all available manifests in priority order: `setup.py` classifiers > `pyproject.toml` `requires-python` > `Pipfile` `python_version`; WHEN no structured signal is found in any manifest, THE Manifest_Parser SHALL return `"unknown"`.
8. R4.8: THE Manifest_Parser SHALL export a `parseAllManifests(snapshot: RepoSnapshot): Manifest[]` function that identifies and parses all manifest files in a snapshot, attaching the result to the snapshot's `manifests` field.

---

### Requirement 5: Judgement Detector (XX — Dead Runtime)

**User Story:** As a developer inheriting a Python 2 codebase, I want the Judgement card to be drawn when the repository contains Python 2 syntax or only supports Python 2, so that I receive an immediate, evidence-backed diagnosis of a dead runtime.

#### Acceptance Criteria

1. R5.1: WHEN a snapshot contains Python files (excluding files under `vendor/`, `.tox/`, `node_modules/`, or `site-packages/` directories) with one or more `print_statement`, `exec_statement`, `<>` comparison operator token (detected via `comparison_operator` node with `<>` in its `operators` field), Python 2 long integer literals (detected by `integer` node text matching `/[Ll]$/`, e.g. `10L`), Python 2 legacy octal literals (detected by `integer` node text matching `/^0[0-7]+$/`, e.g. `0777`), or Python 2 backtick repr expressions (detected by cursor-walking for nodes whose text starts and ends with a backtick character, e.g. `` `x` ``) detected via tree-sitter, THE Deck_Engine SHALL draw the `judgement` card; each named node type counts as a distinct construct type for evidence purposes.
2. R5.2: WHEN the snapshot contains manifest files (`requirements*.txt`, `setup.py`, `pyproject.toml`, `Pipfile`) with `python_requires` or `classifiers` restricted exclusively to `Python :: 2` versions, THE Deck_Engine SHALL set `judgement` severity to `3` (upright, burning) and orientation to `"upright"`.
3. R5.3: WHEN the snapshot contains Python files that import `six`, use `__future__` imports (e.g. `from __future__ import print_function`), or use `2to3`-compatible compatibility shims alongside py2 syntax, THE Deck_Engine SHALL set `judgement` severity to `1` and orientation to `"reversed"` (straddling); this criterion takes precedence over R5.2 when both conditions are satisfied simultaneously.
4. R5.4: THE Deck_Engine SHALL include at least one `Evidence` item per detected construct type, referencing the `path` and `line` of the first occurrence of that construct type.
5. R5.5: WHEN a snapshot contains no Python files (by R2.2 extension mapping) and no Python manifests, THE Deck_Engine SHALL return `null` for the `judgement` detector.
6. R5.6: THE Deck_Engine SHALL set `judgement` `linkedGrimoireIds` to `["py2to3", "pyproject"]`.

---

### Requirement 6: The Tower Detector (XVI — Rotting Dependencies)

**User Story:** As an engineering lead assessing a repository, I want The Tower card to be drawn when the project's dependencies are broken or dangerously stale, so that I understand the extent of dependency rot.

#### Acceptance Criteria

1. R6.1: WHEN a snapshot contains at least one dependency file (`requirements*.txt`, `setup.py`, `pyproject.toml`, `Pipfile`, or `package.json`), THE Deck_Engine SHALL evaluate each parsed dependency against the Tower detection rules.
2. R6.2: WHEN the Deck_Engine identifies one or more dependencies that are yanked, deprecated, have Python 2-only classifiers, or are 2 or more major versions behind the latest published version (where "major version" is determined by the leftmost non-zero segment of the semantic version: for `1.x.y` it is `1`; for `0.x.y` it is `x`), THE Deck_Engine SHALL draw the `tower` card with severity `2` and orientation `"upright"`.
3. R6.3: WHEN the Deck_Engine identifies dependencies that have an empty `versionSpec` (unpinned) or are exactly 1 major version behind the latest published version but are still installable, and no dependency meets the R6.2 upright threshold, THE Deck_Engine SHALL draw the `tower` card with severity `1` and orientation `"reversed"`.
4. R6.4: WHEN the Deck_Engine detects no stale, broken, or unpinned dependencies, THE Deck_Engine SHALL return `null` for the tower detector.
5. R6.5: THE Deck_Engine SHALL include one `Evidence` item per affected dependency, recording the dependency `name`, the `versionSpec` as written in the dependency file, and a `detail` string describing the staleness reason.
6. R6.6: THE Deck_Engine SHALL NOT make any live network calls to PyPI or npm in the detector; dependency freshness data SHALL be provided as a pre-fetched `RegistryData` parameter injected into the detector, so the detector function remains pure.
7. R6.7: WHEN `RegistryData` contains no entry for a given dependency, THE Deck_Engine SHALL skip that dependency without generating evidence and without treating the absence as a staleness signal.

---

### Requirement 7: The Devil Detector (XV — Security Sins)

**User Story:** As a security-conscious developer, I want The Devil card to be drawn when the repository contains security vulnerabilities, dangerous call patterns, or committed secrets, so that I receive immediate, evidence-backed warnings before proceeding with any migration.

#### Acceptance Criteria

1. R7.1: THE Deck_Engine SHALL scan all Python files in the snapshot for the following dangerous call patterns using tree-sitter queries: `eval(`, `exec(`, `pickle.loads(`, `yaml.load(` without a `Loader=` keyword argument, `subprocess` calls with `shell=True`, `os.system(`, `requests.get` or `urllib` calls with `verify=False`, and hash algorithm identifiers `md5` or `sha1` where the enclosing function name, call arguments, or same-assignment variable name matches one of: `password`, `passwd`, `credential`, `secret`, `token`, `api_key`, `apikey` (case-insensitive).
2. R7.2: WHEN one or more dangerous patterns appear in files outside test directories (`**/tests/**`, `test_*.py`, `*_test.py`, `**/conftest.py`, `**/examples/**`), THE Deck_Engine SHALL draw the `devil` card with severity `2` and orientation `"upright"`.
3. R7.3: WHEN dangerous patterns appear exclusively within test or example paths (as enumerated in R7.2), THE Deck_Engine SHALL draw the `devil` card with severity `1` and orientation `"reversed"`.
4. R7.4: THE Deck_Engine SHALL detect secret-like strings using the following patterns: AWS access key IDs matching `/AKIA[0-9A-Z]{16}/`, private key headers (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`), and high-entropy assignments where an identifier name contains `secret`, `password`, `token`, `api_key`, or `apikey` (case-insensitive) and the assigned value is a quoted string of 8 or more characters (measured by character count, excluding surrounding quote characters).
5. R7.5: WHEN a secret-like string is detected, THE Deck_Engine SHALL include its evidence with the `detail` field masked to the first 4 characters followed by `"****"`, and SHALL NOT store, log, or return the original unmasked value anywhere.
6. R7.6: WHEN the snapshot includes OSV vulnerability data (provided as a pre-fetched `OsvData` parameter), THE Deck_Engine SHALL include one `Evidence` item per vulnerability with `kind: "osv"`, `detail` containing the CVE/GHSA id and one of the OSV severity level strings (`"CRITICAL"`, `"HIGH"`, `"MEDIUM"`, `"LOW"`, `"UNKNOWN"`), and `source: "osv"`.
7. R7.7: WHEN no dangerous patterns, secrets, or vulnerabilities are found, THE Deck_Engine SHALL return `null` for the devil detector.

---

### Requirement 8: Death Detector (XIII — Dead Code)

**User Story:** As a developer cleaning up a repository, I want the Death card to be drawn when the codebase contains significant dead code (unreachable modules, unused top-level symbols, or large commented-out blocks), so that I know the maintenance burden before undertaking a migration.

#### Acceptance Criteria

1. R8.1: THE Deck_Engine SHALL build an intra-repository import graph from `import` and `from … import` statements in all Python files, resolving both absolute and relative module names to file paths within the snapshot; modules that cannot be resolved to a file path within the snapshot SHALL be treated as external dependencies and excluded from dead-code analysis.
2. R8.2: WHEN the import graph reveals one or more Python modules that are never imported by any other module in the snapshot and are not entrypoint candidates (i.e. not named `__main__.py`, `manage.py`, `wsgi.py`, `asgi.py`, `app.py`, `run.py`, or listed in `setup.py`/`pyproject.toml` `entry_points`, `[project.scripts]`, `[project.entry-points]`, or `[options.entry_points]`), THE Deck_Engine SHALL draw the `death` card with severity `2` and orientation `"upright"`; THE Deck_Engine SHALL include up to 20 such module paths as evidence, ordered lexicographically.
3. R8.3: THE Deck_Engine SHALL detect top-level functions and classes defined in Python files that are never referenced by name in any other file in the snapshot; WHEN 5 or more such symbols are found, THE Deck_Engine SHALL include up to 20 of them as evidence items (ordered lexicographically by file path, then by line number), each recording the symbol name, file path, and line number.
4. R8.4: THE Deck_Engine SHALL detect large commented-out code blocks: consecutive comment lines (`#`) of 5 or more lines where each line's content, when the leading `#` and any following whitespace is stripped, forms part of a block that tree-sitter parses as valid Python; WHEN such blocks are found, THE Deck_Engine SHALL draw the `death` card with severity `1` and orientation `"reversed"` if no unreachable modules are found, or add them as additional evidence items recording file path and starting line number if the card is already drawn at severity `2`.
5. R8.5: WHEN no unreachable modules, unused top-level symbols (5 or more), or commented-out code blocks of 5 or more lines are found, THE Deck_Engine SHALL return `null` for the death detector.

---

### Requirement 9: Wheel of Fortune Detector (X — No Tests)

**User Story:** As an engineering lead, I want the Wheel of Fortune card to be drawn when the repository has no tests or has tests that cannot run, so that I understand the risk to behavioral equivalence before any resurrection attempt.

#### Acceptance Criteria

1. R9.1: THE Deck_Engine SHALL count test files by matching file paths against the following patterns (deduplicated — a file matching multiple patterns is counted once): `test_*.py`, `*_test.py`, any file (with any extension) directly under a directory named `tests/` or `test/` at any depth, `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`; files matched by multiple patterns SHALL be counted only once, ordered lexicographically by path.
2. R9.2: WHEN the snapshot contains zero test files matching the patterns in R9.1, THE Deck_Engine SHALL draw the `wheel` card with severity `2` and orientation `"upright"`.
3. R9.3: WHEN test files exist but no test runner configuration is found — where runner configuration includes: `pytest.ini`, a `[tool:pytest]` section in `setup.cfg` (detected by section presence, not file presence), `tox.ini`, a `[tool.pytest.ini_options]` or `[tool.pytest]` section in `pyproject.toml`, any file matching `jest.config.js`, `jest.config.ts`, `jest.config.mjs`, `jest.config.cjs`, or any file matching `.mocharc.js`, `.mocharc.cjs`, `.mocharc.yaml`, `.mocharc.yml`, `.mocharc.json`, `.mocharc.jsonc` — THE Deck_Engine SHALL draw the `wheel` card with severity `1` and orientation `"reversed"`.
4. R9.4: WHEN test files exist and at least one runner configuration matching R9.3 is found, THE Deck_Engine SHALL return `null` for the wheel detector.
5. R9.5: THE Deck_Engine SHALL include as evidence: the exact count of test files found, up to 10 test file paths ordered lexicographically, and the names of any runner config files detected.

---

### Requirement 10: The Hermit Detector (IX — Missing Documentation)

**User Story:** As a developer inheriting a repository, I want The Hermit card to be drawn when the project lacks adequate documentation, so that I know where the knowledge gaps are before attempting to work with the code.

#### Acceptance Criteria

1. R10.1: THE Deck_Engine SHALL check for the presence of a README file at the repository root by matching filenames (no directory separator in path) case-insensitively against: `readme`, `readme.md`, `readme.rst`, `readme.txt`, `readme.adoc`; the first match found (lexicographically) SHALL be used.
2. R10.2: WHEN no README file is found at the repository root, THE Deck_Engine SHALL draw the `hermit` card with severity `2` and orientation `"upright"`.
3. R10.3: WHEN a README file is found but its content is fewer than 200 bytes, OR the README content does not contain at least one of the keywords `install`, `usage`, `getting started`, or `quickstart` (case-insensitive), THE Deck_Engine SHALL draw the `hermit` card with severity `1` and orientation `"reversed"`; evidence SHALL indicate which sub-condition triggered the draw.
4. R10.4: THE Deck_Engine SHALL compute the docstring coverage ratio for Python files by counting public top-level functions and classes (names not beginning with `_`) with a docstring node as the first statement, divided by the total count of public top-level functions and classes, rounded to 2 decimal places; WHEN the ratio is below 0.25 and at least 4 public symbols exist in the snapshot, THE Deck_Engine SHALL add a docstring-coverage evidence item regardless of orientation; WHEN a Python file cannot be parsed, THE Deck_Engine SHALL record a parse-error evidence item for that file and exclude its symbols from the coverage calculation.
5. R10.5: WHEN a README exists and satisfies both the 200-byte threshold and the keyword condition, and docstring coverage is not below 0.25 (or fewer than 4 public symbols exist), THE Deck_Engine SHALL return `null` for the hermit detector.

---

### Requirement 11: The Hanged Man Detector (XII — Stagnation)

**User Story:** As an engineering lead evaluating a repository, I want The Hanged Man card to be drawn when the project shows signs of abandonment or prolonged stagnation, so that I can factor sustainability risk into my decision to invest in a resurrection.

#### Acceptance Criteria

1. R11.1: THE Deck_Engine SHALL accept a `RepoMeta` object on the snapshot containing: `pushedAt` (ISO 8601 UTC string or null), `isArchived` (boolean), `openIssueCount` (non-negative integer), `openPRCount` (non-negative integer), `oldestOpenPRAgeDays` (non-negative integer or null — the age in whole days of the oldest open pull request), `latestReleaseAt` (ISO 8601 UTC string or null), and `licenseKey` (string or null — the SPDX identifier of the detected license, or `"NOASSERTION"` if the license cannot be determined, or `null` if absent); IF `RepoMeta` fails zod validation, THEN THE Deck_Engine SHALL throw a `NecroError` with code `INVALID_REPO_META`.
2. R11.2: WHEN `meta.isArchived` is `true`, THE Deck_Engine SHALL draw the `hanged_man` card with severity `2` and orientation `"upright"`.
3. R11.3: WHEN `meta.isArchived` is `false` AND `meta.pushedAt` is a valid timestamp AND the computed age of `pushedAt` relative to the `now` value from `ReadingOpts` exceeds 730 days AND `meta.openIssueCount` is ≥ 3, THE Deck_Engine SHALL draw the `hanged_man` card with severity `2` and orientation `"upright"`; R11.2 takes precedence when `isArchived` is `true`.
4. R11.4: WHEN neither R11.2 nor R11.3 applies AND (`meta.pushedAt` is a valid timestamp AND the computed age of `pushedAt` is in the range (183, 730] days inclusive of 730 exclusive of 183), OR (`meta.openPRCount` is ≥ 3 AND `meta.oldestOpenPRAgeDays` is ≥ 180), THE Deck_Engine SHALL draw the `hanged_man` card with severity `1` and orientation `"reversed"`.
5. R11.5: WHEN `meta.pushedAt` is a valid timestamp AND the computed age of `pushedAt` is ≤ 183 days AND `meta.isArchived` is `false` AND `meta.openPRCount` is < 3, THE Deck_Engine SHALL return `null` for the hanged_man detector.
6. R11.6: WHEN the hanged_man card is drawn, THE Deck_Engine SHALL include as evidence: the `pushedAt` value (or `"unknown"` if null), the `isArchived` flag, the `openIssueCount`, the `openPRCount`, and the computed age of `pushedAt` in whole days.

---

### Requirement 12: Temperance Detector (XIV — No CI / Dead CI)

**User Story:** As a developer evaluating a repository, I want the Temperance card to be drawn when the project has no continuous integration or only uses a legacy CI provider, so that I understand the automation health of the project.

#### Acceptance Criteria

1. R12.1: THE Deck_Engine SHALL check for the presence of CI configuration files at their canonical paths: any `.yml` or `.yaml` file directly under `.github/workflows/` (GitHub Actions; subdirectories nested more than one level under `.github/workflows/` SHALL NOT be scanned), `.travis.yml` or `.travis.yaml` at the repository root (Travis CI), `.circleci/config.yml` (CircleCI), `Jenkinsfile` at the repository root (Jenkins), and `azure-pipelines.yml` at the repository root (Azure Pipelines).
2. R12.2: WHEN no CI configuration file of any kind is found, THE Deck_Engine SHALL draw the `temperance` card with severity `2` and orientation `"upright"`.
3. R12.3: WHEN a Travis CI file (`.travis.yml` or `.travis.yaml`) is found AND no GitHub Actions, CircleCI, Jenkins, or Azure Pipelines files are present, THE Deck_Engine SHALL draw the `temperance` card with severity `1` and orientation `"reversed"`.
4. R12.4: WHEN at least one non-Travis CI configuration file is found (regardless of whether a Travis CI file is also present), THE Deck_Engine SHALL return `null` for the temperance detector.
5. R12.5: WHEN the temperance card is drawn, THE Deck_Engine SHALL include as evidence the list of all CI config file paths detected relative to the repository root, each annotated with its provider name (`"github-actions"`, `"travis-ci"`, `"circleci"`, `"jenkins"`, or `"azure-pipelines"`); WHEN no CI files are found, THE Deck_Engine SHALL include an evidence item with `kind: "no-ci-found"` and `detail: "no CI configuration detected"`.

---

### Requirement 13: Justice Detector (XI — Missing License)

**User Story:** As a developer assessing whether a repository is legally usable or forkable, I want the Justice card to be drawn when the license is missing or ambiguous, so that I understand the legal risk before investing in a resurrection.

#### Acceptance Criteria

1. R13.1: THE Deck_Engine SHALL scan for license files at the repository root (no directory separator in path) by matching filenames case-insensitively against: `license`, `license.md`, `license.txt`, `license.rst`, `copying`, `copying.md`, and `unlicense`.
2. R13.2: WHEN no license file is found AND `RepoMeta.licenseKey` is neither `"NOASSERTION"` nor `null`, THE Deck_Engine SHALL draw the `justice` card with severity `2` and orientation `"upright"`.
3. R13.3: WHEN `RepoMeta.licenseKey` is `"NOASSERTION"` or `null` (regardless of whether a license file is present), THE Deck_Engine SHALL draw the `justice` card with severity `2` and orientation `"upright"`; R13.3 takes precedence over R13.2 and R13.5.
4. R13.4: WHEN exactly one license file is found AND `RepoMeta.licenseKey` is not `"NOASSERTION"` and not `null`, THE Deck_Engine SHALL return `null` for the justice detector.
5. R13.5: WHEN more than one distinct license filename (from the list in R13.1) is found AND `RepoMeta.licenseKey` is not `"NOASSERTION"` and not `null`, THE Deck_Engine SHALL draw the `justice` card with severity `1` and orientation `"reversed"`.
6. R13.6: THE Deck_Engine SHALL NOT propose, select, or suggest any specific license; evidence SHALL report only the detected license file paths relative to the repository root and the `RepoMeta.licenseKey` value observed.

---

### Requirement 14: The Moon Detector (XVIII — Complexity and Illusion)

**User Story:** As a developer reviewing a codebase's maintainability, I want The Moon card to be drawn when the code is excessively complex or confused, so that I understand the cognitive burden of the migration before starting.

#### Acceptance Criteria

1. R14.1: THE Deck_Engine SHALL detect files exceeding 1,000 lines (counting all lines including blank and comment lines); WHEN 1 or more such files exist, THE Deck_Engine SHALL record each file's path and exact line count as an evidence item.
2. R14.2: THE Deck_Engine SHALL use tree-sitter to compute the maximum nesting depth for each Python file, defined as the deepest level of nested block structures (function definitions, class bodies, `if`/`for`/`while`/`with`/`try` statements); WHEN any file has a maximum nesting depth exceeding 6, THE Deck_Engine SHALL record that file's path and exact depth value as an evidence item.
3. R14.3: THE Deck_Engine SHALL count confusion markers per file: lines containing `TODO`, `FIXME`, `HACK`, or `XXX` matched case-insensitively as whole words or standard comment prefixes (e.g. `# TODO`, `// FIXME`); a single line matching multiple markers SHALL be counted once; WHEN a file has more than 10 such marker lines, THE Deck_Engine SHALL record that file's path and exact marker count as an evidence item.
4. R14.4: WHEN at least 2 files exceed 1,000 lines OR any file has a nesting depth greater than 6, THE Deck_Engine SHALL draw the `moon` card with severity `2` and orientation `"upright"`; R14.4 takes precedence over R14.5.
5. R14.5: WHEN R14.4 does not apply AND (exactly 1 file exceeds 1,000 lines OR at least 1 file has more than 10 confusion markers), THE Deck_Engine SHALL draw the `moon` card with severity `1` and orientation `"reversed"`.
6. R14.6: WHEN no files exceed 1,000 lines AND no file has nesting depth greater than 6 AND no file has more than 10 confusion markers, THE Deck_Engine SHALL return `null` for the moon detector.

---

### Requirement 15: The Star Detector (XVII — Hope and Strengths)

**User Story:** As a developer or engineering lead, I want The Star card to always reflect the genuine strengths present in the repository, so that even a dire reading acknowledges what is worth preserving.

#### Acceptance Criteria

1. R15.1: THE Deck_Engine SHALL compute a strength score (integer 0–5) based on the following factors (1 point each): (a) a valid license file detected by the same rules as R13.1 with `RepoMeta.licenseKey` not `"NOASSERTION"` and not `null`; (b) at least 1 test file detected by the same patterns as R9.1; (c) at least 1 CI configuration file detected by the same rules as R12.1; (d) a README whose byte length is ≥ 200 and whose content contains at least one of `install`, `usage`, `getting started`, or `quickstart` (case-insensitive); (e) `RepoMeta.pushedAt` being a timestamp no more than 365 days before the `now` value from `ReadingOpts`; IF `RepoMeta.pushedAt` is absent or null, that factor SHALL contribute 0 points.
2. R15.2: WHEN the strength score is 3 or more, THE Deck_Engine SHALL draw the `star` card with severity `2` and orientation `"upright"`.
3. R15.3: WHEN the strength score is 1 or 2, THE Deck_Engine SHALL draw the `star` card with severity `1` and orientation `"reversed"`.
4. R15.4: WHEN the strength score is 0, THE Deck_Engine SHALL return `null` for the star detector.
5. R15.5: WHEN the star card is evaluated, THE Deck_Engine SHALL include one evidence item per strength factor, indicating the factor name, whether it contributed a point (boolean), and the observed value (e.g. license filename, test file count, CI provider found, README byte length, days since last push).

---

### Requirement 16: The World Detector (XXI — Destiny After Resurrection)

**User Story:** As a developer who has completed a ritual, I want The World card to appear in the destiny spread reflecting the final verdict, so that the post-ritual reading has a clear closing card that communicates the outcome.

#### Acceptance Criteria

1. R16.1: THE Deck_Engine SHALL expose a pure function `computeWorldDraw(verdict: Verdict, vitalityDelta: number): CardDraw | null` that accepts a `Verdict` (containing `status: "REVIVED" | "UNDEAD" | "STILL_DEAD"`, a list of passed gate ids, and a list of failed gate ids) and a `vitalityDelta` value in the range −100 to 100 inclusive.
2. R16.2: WHEN `verdict.status` is `"REVIVED"`, THE Deck_Engine SHALL return a `world` draw with severity `2` and orientation `"upright"`.
3. R16.3: WHEN `verdict.status` is `"UNDEAD"`, THE Deck_Engine SHALL return a `world` draw with severity `1` and orientation `"reversed"`.
4. R16.4: WHEN `verdict.status` is `"STILL_DEAD"`, THE Deck_Engine SHALL return `null`; the calling spread assembler SHALL insert a `tower` draw with severity `2` and orientation `"upright"` as the closing card of the destiny spread.
5. R16.5: WHEN the function returns a non-null draw, THE Deck_Engine SHALL include as evidence the `vitalityDelta` value, the list of passed gate ids, and the list of failed gate ids from the verdict.

---

### Requirement 17: Spread Engine

**User Story:** As a consumer of the Oracle, I want the deck engine to assign drawn cards to named spread positions deterministically using the commit SHA as a seed, so that every reading of the same repository commit produces identical card placements.

#### Acceptance Criteria

1. R17.1: THE Deck_Engine SHALL export an `assignSpread(draws: CardDraw[], kind: SpreadKind, sha: string): SpreadPosition[]` pure function.
2. R17.2: WHEN `kind` is `"fates"`, THE Deck_Engine SHALL return exactly 3 `SpreadPosition` objects with names `"Past"`, `"Present"`, and `"Future"` per §3A.2 semantics: Past receives the draw with the highest history signal (preferring `hanged_man` then `temperance`), Present receives the most severe current affliction, Future receives the highest projected-risk draw (preferring `tower` then `devil`); WHEN no candidate draw exists for a position, that position SHALL be filled with the void object per R17.6.
3. R17.3: WHEN `kind` is `"necropsy"`, THE Deck_Engine SHALL return exactly 5 `SpreadPosition` objects: `"The Corpse"` (highest severity × weight draw), `"The Wound"` (second highest severity × weight), `"The Shadow"` (the `devil` draw if present, else third highest severity × weight), `"The Hope"` (the `star` draw if present), and `"The Call"` (the `judgement` draw if present and a grimoire is linked, otherwise the void object with description `"no ritual can be performed"`); each position SHALL be filled with the void object per R17.6 if no candidate draw is available.
4. R17.4: WHEN `kind` is `"celtic"`, THE Deck_Engine SHALL return exactly 10 `SpreadPosition` objects in order: 1 `"Present"`, 2 `"Crossing"`, 3 `"Foundation"`, 4 `"Recent Past"`, 5 `"Crown"`, 6 `"Near Future"`, 7 `"Self"`, 8 `"Environment"`, 9 `"Hopes and Fears"`, 10 `"Outcome"`; assignment follows §3A.2 semantics.
5. R17.5: WHEN two draws have equal severity × weight and both are candidates for the same position, THE Deck_Engine SHALL break the tie using a deterministic pseudo-random seed derived from the sha string, ensuring the same sha always produces the same tiebreak result.
6. R17.6: IF a spread position has no candidate draw, THE Deck_Engine SHALL fill that position with `{ card: null, label: "The Void", description: "This position holds no card — the void is a sign." }`.
7. R17.7: THE Deck_Engine SHALL guarantee that no `CardId` appears more than once across all filled positions in a single spread result.
8. R17.8: WHEN called with the same `draws`, `kind`, and `sha` values, THE Deck_Engine SHALL return an identical `SpreadPosition[]` array on every invocation.

---

### Requirement 18: Vitality Scoring

**User Story:** As a developer reviewing a repository health report, I want a single vitality score from 0 to 100 that summarises the overall code health, so that I can quickly grasp how much life remains in the project and track improvement after a resurrection.

#### Acceptance Criteria

1. R18.1: THE Deck_Engine SHALL export a `computeVitality(draws: CardDraw[]): number` pure function that returns an integer in the range `[0, 100]`.
2. R18.2: THE Deck_Engine SHALL compute vitality as `Math.round(Math.max(0, 100 - Σ(card.weight × draw.severity)))` clamped to `[0, 100]`, where the sum runs over all non-null draws passed to the function.
3. R18.3: THE Deck_Engine SHALL use the following weights (matching the card registry entries): `judgement` = 20, `tower` = 15, `devil` = 18, `death` = 10, `wheel` = 12, `hermit` = 5, `hanged_man` = 8, `temperance` = 7, `justice` = 6, `moon` = 9; `star` and `world` SHALL have weight 0 and SHALL NOT reduce vitality.
4. R18.4: WHEN the computed sum of `card.weight × draw.severity` across all draws exceeds 100, THE Deck_Engine SHALL return `0`.
5. R18.5: WHEN `draws` is an empty array or contains only `null` entries, THE Deck_Engine SHALL return `100`.
6. R18.6: THE Deck_Engine SHALL export a `computeVitalityDelta(before: number, after: number): number` pure function returning `after - before`, where a positive result indicates the resurrection improved vitality.

---

### Requirement 19: Reading Assembly

**User Story:** As any surface (web, CLI, MCP), I want to call a single `runReading(snapshot, opts)` function that runs all detectors, assigns a spread, and returns a complete `Reading` object, so that I do not need to wire up each detector individually.

#### Acceptance Criteria

1. R19.1: THE Deck_Engine SHALL export a `runReading(snapshot: RepoSnapshot, opts: ReadingOpts): Promise<Reading>` function that executes all registered detectors, filters non-null draws, assigns a spread, and computes the vitality score.
2. R19.2: THE Deck_Engine SHALL define `ReadingOpts` with fields: `spreadKind: SpreadKind` (optional, default `"necropsy"`), `registryData?: RegistryData` (pre-fetched dependency freshness data for the Tower detector), `osvData?: OsvData` (pre-fetched vulnerability data for the Devil detector), and `now: string` (ISO 8601 UTC string representing the current instant, used by time-sensitive detectors; THE Deck_Engine SHALL NOT call `Date.now()` or `new Date()` inside any detector, ensuring readings are deterministic for any given snapshot and `now` value).
3. R19.3: THE Deck_Engine SHALL run all detectors that are independent of each other concurrently using `Promise.all`; detectors that require parsed manifests SHALL be run only after `parseAllManifests` completes.
4. R19.4: IF any individual detector throws an unhandled error, THEN THE Deck_Engine SHALL catch it, record a `NecroError` with code `DETECTOR_FAILED` and the card id in the reading's `errors` array, and continue running remaining detectors rather than aborting the entire reading.
5. R19.5: THE Deck_Engine SHALL populate the returned `Reading` with: `id` (UUID v4 string), `repo` (from `snapshot.ref`), `draws` (array of non-null `CardDraw` objects), `spread` (`SpreadPosition[]`), `vitality` (integer 0–100), `createdAt` (ISO 8601 UTC string), `engineVersion` (the `version` string from the package's `package.json`), and `errors` (array of `NecroError` objects, empty when all detectors succeed).

---

### Requirement 20: Secret Masking

**User Story:** As a security-conscious operator, I want all secret-like strings found by the detectors to be masked before they appear in any output, so that the Oracle never leaks credentials or tokens through its evidence data.

#### Acceptance Criteria

1. R20.1: THE Deck_Engine SHALL export a `maskSecret(value: string): string` pure function; WHEN `value` has 4 or more characters, THE Deck_Engine SHALL return the first 4 characters concatenated with `"****"`; IF `value` has fewer than 4 characters, THEN THE Deck_Engine SHALL return `"****"`.
2. R20.2: WHEN a secret-like string is detected per R7.4, THE Deck_Engine SHALL call `maskSecret` on the raw value immediately before assigning it to any `Evidence.detail` field; the original unmasked value SHALL NOT be stored in any variable that outlives the masking call within that detector invocation.
3. R20.3: THE Deck_Engine SHALL apply `maskSecret` as a safety net to any string in an `Evidence.detail` field that matches the AWS access key ID pattern `/AKIA[0-9A-Z]{16}/` or either private key header pattern (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`), even if the calling detector already passed a masked value.
4. R20.4: IF `maskSecret` is called with a string of length less than 4, THEN THE Deck_Engine SHALL return `"****"`.

---

### Requirement 21: Non-Functional Requirements

**User Story:** As a system operator and hackathon judge, I want the Oracle Deck Engine to be performant, secure, accessible via documented APIs, and cost-predictable, so that it can handle real repositories within the product's stated performance budget and remain demoable throughout the judging period.

#### Acceptance Criteria

1. R21.1: WHEN `runReading` is called on a snapshot of ≤ 500 files using pre-fetched `RegistryData` and `OsvData`, THE Deck_Engine SHALL complete within 5,000 milliseconds at the p50 percentile on a standard Node 22 process.
2. R21.2: THE Deck_Engine SHALL make zero outbound network calls; all external data (registry freshness, OSV vulnerabilities, repo metadata) SHALL be injected as parameters, keeping the library purely computational and testable without network mocks.
3. R21.3: THE Deck_Engine SHALL export all public types, functions, and constants exclusively through `packages/oracle/src/index.ts`; no internal module path within `packages/oracle` SHALL be imported from outside the package.
4. R21.4: THE Deck_Engine SHALL compile with `"strict": true` in `tsconfig.json` and pass `pnpm typecheck` with zero errors.
5. R21.5: THE Deck_Engine SHALL achieve 100% passing unit tests under `pnpm test` with no network, LLM, or sandbox calls in any test file.
6. R21.6: THE Deck_Engine SHALL defer WASM initialization to the first call of `parsePython`; no side effects SHALL occur at module import time other than synchronous in-memory constant initialization.
7. R21.7: WHEN the main entry point `@necro/oracle` (`packages/oracle/src/index.ts`) is bundled for a browser context, its total gzipped bundle contribution (excluding the separately-loaded tree-sitter WASM file and excluding `@necro/oracle/node`) SHALL NOT exceed 50 KB; the Node-only entry point `@necro/oracle/node` is exempt from this constraint.
8. R21.8: THE Deck_Engine SHALL return `null` for all Python-specific detectors without throwing when the snapshot contains no files with `.py` extension; THE Deck_Engine SHALL complete `runReading` successfully for snapshots containing only non-Python files.

---

## Out of Scope

The following items are explicitly excluded from this spec and will be addressed in later specs:

- **GitHub-backed `RepoSnapshot` builder** (fetching real repositories via the GitHub API) — this belongs to spec 06 (`06-github-integration-and-pr`).
- **LLM-based narration** of card draws — narration is generated by the Arcana Seers in spec 04 (`04-coven-orchestrator-and-ledger`); the detector only populates `summary` with a short deterministic text.
- **Live PyPI / npm registry calls** inside detectors — the Tower detector accepts pre-fetched `RegistryData`; the adapter that calls PyPI/npm belongs to spec 06.
- **Live OSV.dev API calls** inside detectors — the Devil detector accepts pre-fetched `OsvData`.
- **Sandbox execution** of any kind — no Python is run outside the sandbox (spec 05).
- **Reading storage and retrieval** (Redis, caching) — spec 04.
- **Spread rendering / UI** — `packages/ui-crt` (spec 02).
- **Celtic Cross deep audit** in the web terminal — spec 03.
- **Grimoire I (py2→py3) fixer logic** — spec 07.
- **Differential PBT harness** — spec 08.
- **Rate limiting and spend circuit breaker** — spec 04 / `packages/config`.
- **The Fool, The Magician, The High Priestess** stretch cards — spec 10.
