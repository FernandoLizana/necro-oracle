# Kiro Spec Prompts — The Necro-Oracle

How to use this file
1. Commit `docs/DESIGN.md` (this kit's DESIGN.md) and the steering files in `.kiro/steering/` **before** creating any spec.
2. In Kiro: open the **Specs** section → **+** (or choose *Spec* in the chat pane) → choose **Feature** (or **Bug** for bugfix specs) → paste ONE block below → choose the workflow indicated (*Requirements-First* or *Design-First*).
3. Review each phase with the **Review** button before approving. Do not approve requirements that are not in EARS form.
4. Create the specs in the order given; each spec lists the specs it depends on. Spec folder names are suggested in each header so `.kiro/specs/` stays ordered.
5. For property-based testing, make sure the design phase extracts **correctness properties** (Kiro's PBT runs in the IDE; PBT tasks are optional by default — run them).

Every block begins with the same **shared preamble** so each spec is self-contained. Copy the preamble + the block together.

---

## Shared preamble (paste at the top of EVERY spec prompt)

```
PROJECT: The Necro-Oracle — a multi-agent code-resurrection system disguised as a tarot reader, built for Kiroween 2026 (Frankenstein category). Read docs/DESIGN.md and the steering files before writing anything; they are the source of truth. If this prompt conflicts with docs/DESIGN.md, ask me before proceeding.

OUTPUT RULES FOR THIS SPEC:
- requirements.md: write user stories ("As a <role>, I want <capability>, so that <benefit>") and, for each story, numbered acceptance criteria in strict EARS notation using only these patterns:
  * Ubiquitous: "THE <system> SHALL <response>"
  * Event-driven: "WHEN <trigger>, THE <system> SHALL <response>"
  * State-driven: "WHILE <state>, THE <system> SHALL <response>"
  * Unwanted behavior: "IF <condition>, THEN THE <system> SHALL <response>"
  * Optional feature: "WHERE <feature is enabled>, THE <system> SHALL <response>"
  * Complex: combinations of the above.
  Every criterion must be testable, name concrete limits (numbers, timeouts, sizes), and have an ID like R<story>.<n>.
- Include a "Non-functional requirements" story (performance, security, accessibility, cost) and a "Out of scope" list.
- design.md: architecture, components and interfaces (TypeScript signatures), data models (zod), sequence diagrams (mermaid), error handling, and a "Correctness Properties" section that turns every requirement that can be expressed as "for any <input> where <precondition>, <property> holds" into a numbered property linked to its requirement IDs, suitable for fast-check (TypeScript) or Hypothesis (Python inside sandboxes). Add a testing strategy (unit, property, golden fixtures, e2e).
- tasks.md: small, incremental, test-first tasks (each ≤ ~2 hours of work), each referencing requirement IDs, ordered so the system is runnable after every few tasks. Mark property-based test tasks explicitly. No task may require secrets in the repository.
- Conventions: TypeScript strict, pnpm monorepo, Vitest + fast-check, zod at all boundaries, pure functions where possible, no network or LLM calls in unit tests (use the Mock LLM provider and recorded fixtures).
```

---

## Spec 01 — `01-oracle-deck-engine` (Requirements-First) · depends on: none

```
FEATURE: The Oracle Deck Engine (packages/oracle) — the deterministic heart of the product.

Build a pure TypeScript library that turns a RepoSnapshot into tarot card draws and spreads.
Scope:
1. Card registry for the Major Arcana defined in docs/DESIGN.md §3 and §3A: core diagnostic cards Judgement (XX), The Tower (XVI), The Devil (XV), Death (XIII), Wheel of Fortune (X), The Hermit (IX), The Hanged Man (XII), Temperance (XIV), Justice (XI), The Moon (XVIII); narrative cards The Star (XVII) and The World (XXI). Each card has id, numeral, name, upright meaning, reversed meaning (technical, per §3A.1), weight, detector, linked grimoire ids.
2. Detectors: one pure function per card, (snapshot) => CardDraw | null, implementing the detection rules in the DESIGN table. Severity 0-3; orientation derived from severity and the reversed rules (never random). Every draw MUST include at least one Evidence item; secret-like strings in evidence MUST be masked (first 4 chars + "****").
3. Python parsing via web-tree-sitter (tree-sitter-python WASM) for Judgement/Death/Moon; manifest parsers for requirements*.txt, setup.py (AST only, never executed), pyproject.toml, Pipfile, package.json.
4. Spread engine: assignSpread(draws, kind, sha) for kinds "fates" (3), "necropsy" (5), "celtic" (10) with position semantics from §3A.2. Deterministic, seeded by commit SHA.
5. Vitality score 0-100 from weights and severities.
6. RepoSnapshot builders: from a local directory (for CLI) and from a provided file map (for tests). The GitHub-backed builder belongs to spec 06; define the interface here.
Important limits: max 5,000 files, max 1 MB per analyzed file (skip larger with evidence "too large to divine").
Properties I expect at minimum: determinism (same snapshot+sha => identical reading), every drawn card has evidence whose paths exist in the snapshot, severity/orientation consistency, no card twice in a spread, primary position holds the most severe card, vitality is monotonic (lowering any severity never lowers vitality), secret masking never leaks the original secret, detectors never throw on arbitrary file contents (including binary/invalid UTF-8).
```

## Spec 02 — `02-card-forge-and-crt-design-system` (Design-First) · depends on: 01

```
FEATURE: Card Forge + CRT design system (scripts/card-forge, packages/ui-crt).

1. card-forge: a Node build script that takes the public-domain 1909 card scans (Pamela Colman Smith, "Roses & Lilies" printing, downloaded once into assets/cards/source with SOURCES.md listing each Wikimedia Commons URL and PD status) and produces, for each card: (a) a green-phosphor dithered PNG/WebP (ordered or Floyd-Steinberg dithering to a 4-level phosphor palette #001a00..#33ff66), (b) an upside-down variant is NOT needed (rotation is done in CSS), (c) an ASCII-art text rendition for the CLI (width 40 and 60 columns), (d) a framed card face with numeral, name and a diagnosis sigil (SVG). Output to apps/web/public/cards and packages/cli/assets. Pure image-processing functions must be unit and property tested (output dimensions, palette membership, determinism).
2. packages/ui-crt: React components and CSS for the CRT world: Screen (scanlines, phosphor glow, subtle flicker, curvature), Terminal (DOM-based, accessible, command history, clickable command chips), Card (deal, flip with CSS 3D, reversed rendering with right-side-up subtitle, evidence snippet on face), Spread layouts for fates/necropsy/celtic, EvidenceScroll, SigilRitual (5-vertex ASCII sigil bound to external progress events). All motion disabled under prefers-reduced-motion and via a `quiet` prop.
3. Accessibility: every card exposes an accessible name "<numeral> <name>, <orientation>: <summary>"; terminal output is an aria-live region; full keyboard operation; contrast ratio ≥ 4.5:1.
Never use the trademark "Rider-Waite" in UI or code; credit "Card art after Pamela Colman Smith (1909), public domain".
```

## Spec 03 — `03-web-terminal-experience` (Requirements-First) · depends on: 01, 02

```
FEATURE: The web CRT terminal (apps/web, Next.js App Router).

Commands (typed or clicked): help, about, summon <github url|owner/repo>, spread <fates|necropsy|celtic>, explain <card>, deep audit (Celtic Cross), graveyard (curated demo repos), ritual <grimoire>, confirm, abort, body (diff viewer), pr, destiny, voice on|off, quiet, clear.
Flows: boot sequence (≤ 2 s, skippable) → summon → live reading (seer events streamed) → spread dealt → evidence scrolls → ritual offer with plan, budget and cost estimate → confirmation → ritual mode (sigil + Celtic Cross + live ledger) → verdict → body/pr/destiny.
Requirements to include: first reading for a ≤ 500-file repo in ≤ 20 s (p50) or show cached reading; resilient SSE reconnection with Last-Event-ID; in-world error messages with next action for GitHub rate limits, invalid URLs, private repos, oversized repos, LLM unavailable (fallback to template narration), sandbox unavailable (offer DEMO replay clearly labelled "replay"); rate limits surfaced as "The spirits need rest (try again in N min)"; shareable reading URL /r/<readingId> with OG "card of fate" image; mobile layout readable at 375 px.
Playwright e2e against the Mock LLM and recorded fixtures.
```

## Spec 04 — `04-coven-orchestrator-and-ledger` (Design-First) · depends on: 01

```
FEATURE: The Coven — multi-agent orchestration with an event-sourced Ritual Ledger (packages/coven, packages/llm).

1. Agents per docs/DESIGN.md §4.1: Hierophant (planner), Arcana Seers (one per card; deterministic detector + narration), Gravedigger (sandbox), Necromancer (migration), Alchemist (test-weaver), Judge, Scribe. Each agent is a module with: typed input/output (zod), an explicit tool allowlist, a token budget, and a function run(ctx) that only acts through injected ports (LlmPort, SandboxPort, GitHubPort, LedgerPort).
2. Ledger: append-only typed events (AgentStarted, ToolCalled, EvidenceFound, Rationale, ArtifactProduced, GateResult, Verdict, AgentFailed, Narration) with monotonically increasing seq per ritual; stored in Upstash Redis Streams with 7-day TTL; replayable to rebuild ritual state (event sourcing). Rationale events are short structured decision summaries, never raw chain-of-thought.
3. Runners: LocalRunner (in-process, for CLI/MCP/Action/tests) and InngestRunner (durable steps on Vercel; long sandbox commands run in background and are polled with durable sleeps). Same agent code for both.
4. LLM abstraction on the Vercel AI SDK: providers Bedrock (default), Anthropic, OpenAI, Mock (deterministic, fixture-driven). Structured outputs via zod schemas; response caching by prompt hash; per-ritual token budget; global daily spend circuit breaker.
5. Prompt-injection posture: repository content always passed as delimited data; agents have no tools beyond their allowlist; outputs failing schema validation are retried once then fail the step.
Properties: ledger replay(fold(events)) equals live state; seq strictly increasing with no gaps; budget never exceeded (calls beyond budget are refused); a failed agent always produces AgentFailed and the ritual reaches a terminal state; runners produce the same event sequence for the same Mock inputs.
```

## Spec 05 — `05-sandbox-gravedigger` (Requirements-First) · depends on: 04

```
FEATURE: Sandbox abstraction and the Gravedigger agent (packages/sandbox, infra/sandbox-templates).

1. SandboxPort interface: create(template, limits), exec(cmd, {background, timeoutMs, cwd}), poll(handle), readFile/writeFile/list, setNetwork(policy) where supported, destroy(). Providers: E2B (Firecracker micro-VMs, TS SDK) and LocalDocker (for CLI/dev). Provider chosen by config.
2. Templates: necro-py27 (Python 2.7 + pip + virtualenv + pytest 4.x + Hypothesis 4.x replay harness), necro-py312 (Python 3.12 + pytest + Hypothesis + mutation tool). Dockerfiles in infra/sandbox-templates; build scripts documented.
3. Gravedigger: clone repo at pinned SHA (depth 1), detect test runner, create venv, install deps (with timeout and retries), run tests with JSON/JUnit reporting, compute SHA-256 hashes of all test files, produce a Baseline. Commands only from an allowlist (pip/python/pytest/git with constrained args); any LLM-proposed command is validated against the allowlist and rejected otherwise.
4. Security: no secrets in sandbox env; outbound network allowed only during install phase where the provider supports per-phase policies; CPU/RAM/time limits; output truncation at 1 MB per command; sandbox destroyed in all terminal states (including crashes) — verified by a reaper job.
Properties: allowlist validator rejects any command containing shell metacharacters outside the allowlisted grammar; test-file hashing is stable and order-independent; baseline parsing of JUnit XML never throws on malformed input.
```

## Spec 06 — `06-github-integration-and-pr` (Requirements-First) · depends on: 01, 04

```
FEATURE: GitHub integration (packages/github): repo intake, public data sources, and PR delivery.

1. Intake: parse and validate GitHub URLs/owner-repo strings; reject private, archived-with-no-tree, > 50 MB or > 5,000 files repos with clear reasons; pin default-branch HEAD SHA; build RepoSnapshot via the Git Trees API + raw blob fetches with concurrency limits and caching by SHA.
2. Public data: repo metadata, contributors, issues/PR ages, license API; OSV.dev querybatch for vulnerabilities; PyPI JSON and npm registry for dependency freshness. All behind a cache with TTL.
3. Delivery: using a machine account token, fork the repo into the coven namespace (idempotent), create branch necro/revive-<shortsha>-<grimoire>, commit the patch, open a PR against the FORK's default branch (never upstream), with a PR body generated by the Scribe (verdict, gates table, divergences, mutation score, destiny reading, how to upstream). One PR per ritual; refuse when verdict is STILL_DEAD.
4. Tokens: server-side only, least privilege, never logged; GitHub rate-limit headers respected with backoff and surfaced to the UI.
Properties: URL parser accepts every valid owner/repo form and rejects path traversal and non-GitHub hosts; branch names are always valid git refs; generated patches applied to the original tree reproduce the migrated tree (round-trip).
```

## Spec 07 — `07-grimoire-framework-and-py2to3` (Requirements-First) · depends on: 04, 05

```
FEATURE: Grimoire plugin framework + Grimoire I "The Serpent Sheds Its Skin" (Python 2.7 → 3.12) + the Necromancer agent.

1. Framework: the Grimoire interface from docs/DESIGN.md §5.1, a registry, a scaffold generator (`necro grimoire new <id>` creates packages/grimoires/<id> with fixtures/, fixers/, README, and a failing golden test), golden-fixture test runner (fixtures/<case>/before → after).
2. Grimoire I deterministic fixers (TypeScript, tree-sitter based) for: print statement (incl. `print >>f` and trailing comma), exec statement, `except X, e`, `raise E, msg`, `<>`, backticks, `has_key`, iteritems/itervalues/iterkeys, xrange, raw_input, unicode/basestring/long names, long and octal literals, renamed stdlib imports (urllib2, urlparse, ConfigParser, Queue, StringIO/cStringIO, cPickle, HTMLParser, httplib, Tkinter).
3. LLM fixer for semantic cases (str/bytes boundaries, division intent, dict views used as lists, map/filter/zip laziness, sorting with cmp=, __nonzero__/__unicode__/__div__ methods, metaclass syntax) returning {newContent, changes[{line, construct, rationale}]} validated by schema.
4. Validation per file: py3 parse with tree-sitter (no ERROR nodes, no print_statement/exec_statement nodes, no legacy tokens) and `python3 -m py_compile` in the sandbox.
5. Necromancer agent: applies fixers file by file in batches, then runs tests in py312 via the Gravedigger; on failures runs a bounded self-repair loop (max 3 attempts per failing test cluster) that may NOT modify test files (enforced by SandboxPort write guard); records every repair as a RepairTrace for the Grimoire Smith (spec 10).
Properties: every deterministic fixer is idempotent (f(f(x)) == f(x)); valid Python 3 code without legacy constructs is unchanged by all fixers; fixers never alter the contents of string literals or comments; fixers' output for generated py2 programs (from a grammar-based generator) parses as py3; applying all fixers never increases the number of tree-sitter ERROR nodes.
```

## Spec 08 — `08-judgement-verification` (Design-First) · depends on: 05, 07

```
FEATURE: The Alchemist (differential property-based testing + mutation testing) and the Judge (verdict gates).

1. Differential PBT: harvest candidate target functions from the original code (pure-ish: no I/O calls, simple signatures) with static heuristics plus an LLM classifier; infer Hypothesis strategies from defaults, type comments, docstrings, call sites and tests; generate N inputs (default 200 per target, capped by budget) in the py312 sandbox, serialize to JSON-safe form, replay the SAME inputs on the original code under py2.7 and the migrated code under py3.12, normalize outputs/exceptions (unicode↔str, long↔int, dict/set order-insensitive), compare, shrink divergences to minimal repros, classify as allowlisted | explained | unexplained.
2. Mutation testing on changed lines only in the py312 sandbox (tool chosen after a spike: mutmut or cosmic-ray), time-capped; produce MutationReport with score on changed lines.
3. Judge: deterministic gates G1–G6 exactly as in docs/DESIGN.md §4.4 producing REVIVED | UNDEAD | STILL_DEAD, then an LLM review that can only keep or DOWNGRADE the verdict, with reasons recorded as Rationale events.
4. Characterization tests path when baseline tests cannot run: generate tests against the old runtime, freeze them (hash), and cap the best verdict at UNDEAD unless mutation score ≥ threshold.
Properties: verdict function is monotonic (making any gate fail can never improve the verdict); LLM review can never upgrade; the normalizer is idempotent and symmetric; equal outputs always compare equal after normalization; any change to a test file's bytes makes G1 fail.
```

## Spec 09 — `09-necro-mcp-cli-action-power` (Requirements-First) · depends on: 01, 04, 06, 07

```
FEATURE: The oracle beyond the web: necro-mcp server, `necro` CLI, GitHub Action, and Kiro Power packaging.

1. necro-mcp (packages/mcp-server) using the official MCP TypeScript SDK, stdio transport (Streamable HTTP optional): tools read_tarot(repo, spread), explain_card(readingId, card), list_grimoires(), cast_ritual(repo, grimoire, options) → ritualId (async), ritual_status(ritualId), get_revived_body(ritualId), get_destiny(ritualId); resources necro://deck, necro://grimoires/<id>. Inputs validated with zod; long operations never block a tool call longer than 30 s.
2. CLI `necro` (packages/cli): read, cast, grimoires, grimoire new, ledger tail; ANSI phosphor theme with ASCII card art; works on local paths with the LocalDocker sandbox; --json output for scripting; exit codes documented.
3. GitHub Action (packages/action): on pull_request, compute a Three Fates reading for the DIFF (new Devil sins, new Death, Tower changes vs base), post or update ONE sticky comment; never fail the build unless `fail-on` is configured (e.g. fail-on: devil-upright).
4. Kiro Power: package necro-mcp as a Kiro Power (Agent Plugins format: manifest + skills + mcp config) with activation keywords (tarot, legacy, python 2, migrate, resurrect, code health) and a skill describing when/how to use each tool.
Properties: CLI --json output always validates against the published schema; MCP tool input schemas reject malformed input without crashing; the diff-reading only reports findings located in changed hunks.
```

## Spec 10 — `10-mutant-layer` (Requirements-First) · depends on: 07, 08 · STRETCH

```
FEATURE: Mutant layer — self-evolving grimoires (Learned Incantations), Grimoire II (setup.py → pyproject.toml), Grimoire III (jQuery → vanilla ES2022) and the Oracle Voice.

1. Grimoire Smith agent: from RepairTraces of successful self-repairs, propose LearnedRule objects in a declarative DSL (tree-sitter query + replacement template + optional guard; no arbitrary code). Validate each rule: idempotent, fixes its originating case, changes no non-matching golden fixture, keeps all golden fixtures green. Store as quarantined with provenance; promote to accepted manually (CLI command) or automatically after N successful REVIVED rituals where it applied. Accepted rules run before the LLM fixer.
2. Grimoire II: parse setup.py via AST, emit PEP 621 pyproject.toml; verify by building sdist+wheel before/after in the sandbox and diffing METADATA, entry points and file lists.
3. Grimoire III (only if time allows): jQuery → vanilla for small static sites; verify with Playwright in a sandbox replaying an interaction script and comparing normalized DOM + accessibility tree snapshots and console errors. Fallback grimoire: Travis CI → GitHub Actions verified with actionlint.
4. Oracle Voice: packages/voice with Amazon Polly (SSML, cached audio per line hash) and Web Speech API fallback; `voice on|off`.
Properties: a learned rule never applies to code that does not match its query; promotion requires all validations; generated pyproject files are valid TOML and round-trip through a TOML parser; voice cache key is stable for identical text.
```

## Bugfix spec template (use with the **Bug** option whenever a real bug appears)

```
BUG: <one-line title>
Observed: <what happens, with ledger excerpt / stack trace / failing PBT counterexample>
Expected: <what should happen, citing requirement IDs>
Unchanged behavior: <what must NOT change; list related properties and golden fixtures>
Scope: <package/files>
Please produce a bug analysis (root cause), a minimal fix design, and tasks including a regression test (a property-based test when the bug was found by PBT).
```
Use at least two bugfix specs during the project (they are great material for the write-up: "PBT found X, the bugfix spec fixed it without regressions").

## Quick Spec candidates
For small, well-understood pieces use **Quick Spec** (all three artifacts without approval gates): `check-kiro-dir` CI script, OG image generator, `graveyard` command, voice cache.
