# The Necro-Oracle — Design Document

> *"Shuffle the deck. Name the repository. The dead will speak."*

**Hackathon:** Kiroween 2026 (Devpost, sponsored by AWS) — **Category: Frankenstein**
**Author:** Fernando Lizana Núñez (solo) · **Built with:** Kiro (IDE + CLI, optionally Crew)
**Deadline:** Dec 4, 2026, 2:00 pm PST (= 19:00 Chile time). Internal target: submit on **Dec 3**.
**License (planned):** MIT · **Language of all artifacts:** English
**Compliance & self-evaluation:** see [`COMPLIANCE.md`](./COMPLIANCE.md)

---

## 0. TL;DR

The Necro-Oracle is a **multi-agent code-resurrection system disguised as a tarot reader**.

1. You name a public GitHub repository in a green-phosphor CRT terminal.
2. A **coven of specialized agents** draws a tarot spread. Every card is a **real, evidence-backed diagnosis** produced by deterministic static analysis plus LLM interpretation (The Tower = rotting dependencies, Death = dead code, The Devil = security sins, Judgement = a dead runtime like Python 2…).
3. You choose a **resurrection ritual** from a **grimoire** (a migration plugin). The coven clones the repo into an **isolated Firecracker micro-VM sandbox**, **runs the original tests in the original runtime**, migrates the code, runs the tests again in the new runtime, and runs **differential property-based testing** (same generated inputs, old runtime vs new runtime) plus **mutation testing** on the changed lines.
4. A **Judge agent** (Judgement card) only declares the project **REVIVED** if deterministic gates pass. Then it opens a **real pull request** on a fork with the revived body and a final **destiny reading**.
5. Every agent's actions and rationale stream **live** into the terminal as a traceable "ritual ledger", optionally **spoken aloud** by the oracle (TTS) while an ASCII sigil animates with real progress.
6. The same oracle is also available as an **MCP server (`necro-mcp`)**, a **CLI (`necro`)**, a **GitHub Action** that reads tarot on every PR, a **Kiro Power**, and (stretch) a **Kiro Crew app**.

It is a Frankenstein in the literal sense: tarot × CRT retro UI × static analysis × multi-agent LLMs × micro-VM sandboxes × property-based/differential/mutation testing × GitHub automation × MCP.

---

## 1. Problem, audience, impact

### The problem
Public and private code dies quietly. Repositories get abandoned on runtimes that reached end-of-life (Python 2 reached EOL on Jan 1, 2020), dependencies rot, tests stop running, and the only people who understood the code leave. Teams that inherit such code face three expensive questions:

1. **What is actually wrong with it?** (diagnosis is slow, subjective, and scattered across tools)
2. **Can it be modernized safely?** (migrations are feared because nobody trusts that behavior is preserved)
3. **How do I prove the migration did not break anything?** (green CI on a weak test suite proves little)

AI coding agents make (2) cheap, but they make (3) *worse*: an agent can "migrate" code and claim success while silently changing behavior or weakening tests. **The Necro-Oracle's core thesis is that an AI migration is only worth something if it comes with machine-checked evidence of behavioral equivalence.**

### Audience
- **Maintainers and inheritors of legacy/abandoned repos** (open-source adopters, forks of dead projects, internal teams with "the old service").
- **Engineering leads** who need a fast, shareable health assessment of a codebase before deciding to invest in it.
- **OSS ecosystems** with large long tails of unmaintained packages that downstream users still depend on.
- **Developers using AI agents** who want a verification harness around agentic migrations (via MCP/CLI/Action, not only the web UI).

### Why it matters (the impact case for judges)
- **Diagnosis is evidence-based, not vibes:** every card cites files, lines, API facts, or vulnerability IDs. The tarot layer is the UX, not the logic.
- **Resurrection is verified:** "revived" means *original tests pass under the new runtime + differential testing found no unexplained divergence + tests were not tampered with + mutation score on changed lines meets a threshold.*
- **It meets developers where they work:** web terminal for the wow, CLI and GitHub Action for daily use, MCP server so any agent (including Kiro itself) can consult the oracle.
- **Honest failure is a feature:** "STILL DEAD" or "UNDEAD (partially revived)" verdicts with explanations are more useful than fake success.

---

## 2. User flows

### 2.1 Web terminal (primary demo)
```
NECRO-ORACLE v1.0  ·  (c) 1986 Necromantic Systems  ·  type HELP
> summon https://github.com/<owner>/<repo>
  [coven] Hierophant: commit 3f2a9c1 pinned. 412 files. Python 2.7 suspected.
  [seer:tower]  parsing requirements.txt ... 14 deps, 9 stale (PyPI)
  [seer:devil]  OSV querybatch ... 2 advisories
  ...
  THE SPREAD IS CAST.
  I.   THE CORPSE    — XX  JUDGEMENT (upright, burning)  Python 2 syntax in 37 files
  II.  THE WOUND     — XVI THE TOWER (upright)            9 stale deps, 1 Py2-only
  III. THE SHADOW    — XV  THE DEVIL (reversed)           yaml.load without Loader (2)
  IV.  THE HOPE      — XVII THE STAR                      tests exist (41), MIT license
  V.   THE CALL      — ritual available: GRIMOIRE I · "The Serpent Sheds" (py2 → py3)
> explain tower         (evidence, file paths, how it was detected)
> ritual py2to3         (shows plan, cost estimate, asks to confirm)
> confirm
  ... live ritual ledger: Gravedigger exhumes, baseline tests 39/41 pass on 2.7 ...
  ... Necromancer transmutes 37 files ... Alchemist generates 600 differential cases ...
  ... Judge: gates G1..G6 passed. VERDICT: REVIVED ...
> body                  (diff viewer, per-file, side-by-side)
> pr                    (opens PR on the coven fork; prints URL)
> destiny               (final 3-card destiny reading + vitality score before/after)
```
- Every command also has a **clickable equivalent** (button row / menu) for judges who do not want to type.
- `ritual mode` (visual): ASCII pentagram/sigil whose five points light up as the five ritual phases complete; candles flicker on agent activity; can be disabled (`prefers-reduced-motion`, `quiet` command).
- `voice on`: the oracle speaks key narration lines (TTS).
- Curated **Graveyard**: a list of known dead repos (prepared by the author, including purpose-built fixture repos) with **cached readings** so the demo always works even if LLM quota is exhausted.

### 2.2 CLI
```
npx necro-oracle read <owner/repo | path>        # tarot reading in your terminal
npx necro-oracle cast py2to3 <owner/repo> --sandbox e2b|docker [--pr]
npx necro-oracle grimoires                        # list installed grimoires
npx necro-oracle grimoire new <name>              # scaffold a new grimoire
```
The CLI uses the same packages as the web app and can run against a **local path** with a **local Docker sandbox** (no cloud needed).

### 2.3 MCP server (`necro-mcp`)
Any MCP client (Kiro, other IDEs, agents) can call `read_tarot`, `explain_card`, `list_grimoires`, `cast_ritual`, `ritual_status`, `get_revived_body`, `get_destiny`. The author dogfoods it **inside Kiro**: the oracle reads the Necro-Oracle's own repo every day (see playbook).

### 2.4 GitHub Action
`necro-oracle/read-action` runs on `pull_request`: reads tarot on the **diff** (new Devil sins, new Death, Tower changes) and posts a single sticky PR comment with the spread. Optional second workflow runs **Kiro CLI headless** with `necro-mcp` configured to produce a narrative review.

---

## 3. The Deck: card → diagnosis → detection → ritual

**Principles**
- **Detectors are deterministic and pure** (`RepoSnapshot → CardDraw | null`). The LLM never decides *whether* a card is drawn; it only interprets evidence and writes narration. This makes readings reproducible and property-testable.
- **Severity** 0–3: 0 = not drawn, 1 = **reversed** (minor), 2 = **upright**, 3 = **upright, burning** (critical).
- **Every draw carries evidence**: `{kind, path?, line?, detail, source}`; secrets are always masked.
- **Vitality score** (0–100) = 100 − Σ(weight_card × severity) clamped; shown before and after resurrection.

| # | Card | Diagnosis | How it is detected (technical) | Ritual / grimoire | Tier |
|---|------|-----------|-------------------------------|-------------------|------|
| XX | **Judgement** | A **dead runtime** calls for resurrection (Python 2; jQuery-era front end; legacy `setup.py` packaging) | tree-sitter-python parse: `print_statement`/`exec_statement` nodes, ERROR nodes under py3 grammar, `except X, e`, `<>`, backticks, `0777`, `10L`; `setup.py` classifiers `Python :: 2` only; `.travis.yml` `python: 2.7`; jQuery: `<script src=*jquery*>`, `package.json` dep, `$(`/`jQuery(` density | **Grimoire I: py2→py3** (core); II: setup.py→pyproject; III: jQuery→vanilla | Core |
| XVI | **The Tower** | Rotting/broken dependencies | Parse `requirements*.txt`, `setup.py` (AST, no execution), `pyproject.toml`, `Pipfile`, `package.json`; compare with PyPI JSON API / npm registry: majors behind, yanked/deprecated, unpinned, Py2-only classifiers | Upgrade plan inside Grimoire I/II | Core |
| XV | **The Devil** | Security sins | Secret patterns (AWS key IDs, private-key headers, high-entropy assignments) — masked; dangerous calls (`eval`, `exec`, `pickle.loads`, `yaml.load` w/o Loader, `subprocess(..., shell=True)`, `os.system`, `verify=False`, MD5/SHA1 for passwords); known vulns via **OSV.dev** `querybatch` | Report only (never auto-"fix" secrets); stretch: safe-pattern grimoire | Core |
| XIII | **Death** | Dead code | Intra-repo import graph (modules never imported and not entrypoints), defined-but-never-referenced top-level functions/classes (name index), large commented-out code blocks (comment runs that parse as code) | Stretch: "Burial" grimoire removing confirmed dead code (verified by tests) | Core (detect) |
| X | **Wheel of Fortune** | No tests — fate decides | Test file ratio (`test_*.py`, `*_test.py`, `tests/`, `*.spec.*`), runner config (pytest/tox/nose/unittest), CI test steps | The Alchemist generates characterization tests during rituals | Core |
| IX | **The Hermit** | Missing documentation | README missing/short, no usage/install headings, docstring coverage of public functions, no `docs/` | Scribe writes README "Resurrection notes" in the PR | Core |
| XII | **The Hanged Man** | Stagnation / abandonment | GitHub API: `pushed_at`, `archived`, open issues/PRs age, last release | Narrative only | Core |
| XIV | **Temperance** | No CI / dead CI | `.github/workflows/*`, `.travis.yml` (Travis-only = dead CI), `.circleci/` | Grimoire I adds a GitHub Actions workflow to the PR | Core |
| XI | **Justice** | Missing/unclear license | GitHub license API (`null`/`NOASSERTION`), `LICENSE*` files | Report only (the oracle never chooses a license for the owner) | Core |
| XVIII | **The Moon** | Illusion & confusion (complexity) | Files > 1,000 lines, long functions, nesting depth (tree-sitter), TODO/FIXME/HACK/XXX density | Report only | Core |
| XVII | **The Star** | Hope — strengths (positive card) | License present, tests present, CI present, recent activity, docs | — | Core |
| XXI | **The World** | Destiny after resurrection (closing card) | Computed from the Judge's verdict + vitality delta | — | Core |
| 0 | The Fool | Not reproducible (no manifest/lockfile/pinned runtime) | Manifest/lockfile/`.python-version` presence | Grimoire II | Stretch |
| I | The Magician | No tooling (lint/format/type config) | ruff/flake8/black/mypy/eslint/prettier/tsconfig configs | Stretch | Stretch |
| II | The High Priestess | Bus factor — knowledge lives in one mind | Contributors API: top contributor ≥ 80% of commits | Narrative | Stretch |

### The spreads (summary — full detail in §3A)
- **The Necropsy Spread (5 positions)** — deterministic selection: I. *The Corpse* (highest severity × weight), II. *The Wound* (next), III. *The Shadow* (The Devil if drawn, else next), IV. *The Hope* (The Star, always present with whatever strengths exist), V. *The Call* (Judgement if a grimoire applies; otherwise "no ritual can be performed — here is why").
- **The Destiny Spread (3 positions)** after a ritual: *Past* (vitality before), *Present* (what the ritual changed, verdict), *Future* (remaining afflictions + The World/The Sun if REVIVED, The Tower if STILL DEAD).
- All readings are **seeded by commit SHA** so the same commit always yields the same cards (property-tested).

---

## 3A. The tarot is the interface (not decoration)

The cards are the **primary information architecture** of the product. Every screen, every output format (web, CLI, MCP, PR comment) is organized as a *spread of cards*. A user who never reads a log line still understands the state of the repo by looking at which cards fell, whether they are upright or reversed, and where they sit in the spread.

### 3A.1 Upright vs reversed = a precise technical distinction
Orientation is **not random**. It encodes *how* the affliction manifests, computed by the detector:

| Card | Upright (active, confirmed) | Reversed (latent, partial or mitigated) |
|---|---|---|
| XX Judgement | Legacy runtime **is the only** supported runtime (py2-only syntax that fails under py3) | Code is **2/3 straddling** (`six`, `__future__` imports) — half-resurrected already |
| XVI The Tower | Dependencies are **broken**: yanked, unresolvable, Py2-only, ≥ 2 majors behind | Dependencies **drift**: unpinned or 1 major behind, still installable |
| XV The Devil | **Exploitable** pattern or known vuln (OSV) in reachable code, or committed secret | **Risky** pattern guarded or in tests/examples only |
| XIII Death | **Dead code**: unreachable modules/functions never imported or called | **Zombie code**: large commented-out blocks, code kept "just in case" |
| X Wheel of Fortune | **No tests at all** | Tests exist but **don't run** (no runner config, CI absent, or they fail on baseline) |
| IX The Hermit | **No README / no usage docs** | README exists but **stale** (references dead runtime, broken badges, no install section) |
| XII The Hanged Man | **Abandoned**: archived or no push in > 2 years with unanswered issues | **Suspended**: slow activity, PRs waiting > 6 months |
| XIV Temperance | **No CI** | **Dead CI**: only Travis/legacy CI config, or workflows disabled |
| XI Justice | **No license** (legally unusable) | License **ambiguous** (`NOASSERTION`, multiple conflicting files) |
| XVIII The Moon | **Labyrinth**: god-files > 1,000 lines, nesting > 6 | **Fog**: high TODO/FIXME/HACK density, long functions |
| XVII The Star | Strong hope: tests + license + CI + docs | Faint hope: some strengths present |
| XXI The World | Destiny: **REVIVED** | Destiny: **UNDEAD** (partially revived) — The Tower upright replaces it for STILL DEAD |

Reversed cards are rendered **physically upside down** in the CRT spread, with their technical subtitle always readable (right-side-up overlay), so the visual metaphor never costs legibility.

### 3A.2 Spreads (all deterministic, seeded by commit SHA)
| Spread | Cards | Where it's used | Positions → technical meaning |
|---|---|---|---|
| **The Three Fates** | 3 | CLI default, GitHub Action PR comment, MCP `read_tarot(spread="fates")` | **Past** = history signals (Hanged Man, Temperance, commit/CI history) · **Present** = most severe current affliction · **Future** = projected risk (deps nearing EOL, vuln trend, bus factor) |
| **The Necropsy** | 5 | Web default reading | Corpse · Wound · Shadow · Hope · Call (see §3) |
| **The Celtic Cross** | 10 | `deep audit` command — the full audit, shown in Ritual Mode | 1 *Present* (core affliction) · 2 *Crossing* (what blocks the fix) · 3 *Foundation* (root cause: runtime/deps) · 4 *Recent past* (last year of commits) · 5 *Crown* (best achievable outcome: which grimoire, projected vitality) · 6 *Near future* (what will break next) · 7 *Self* (code health: tests, complexity) · 8 *Environment* (community: issues, forks, contributors) · 9 *Hopes & fears* (security posture) · 10 *Outcome* (vitality projection if no ritual vs after ritual) |
| **The Destiny** | 3 | After a ritual | Past (vitality before) · Present (verdict & gates) · Future (The World / UNDEAD / The Tower) |

Position assignment is a pure function `assignSpread(draws, spreadKind, sha) → SpreadPosition[]`; property tests guarantee: every position filled or explicitly "empty — the void is a sign", no card appears twice, identical input → identical spread, and the most severe card always lands on the primary position.

### 3A.3 Card art and visual language
- **Base art:** the original 1909 "Roses & Lilies" printing of the deck illustrated by **Pamela Colman Smith** (scans on Wikimedia Commons). Published 1909 → public domain in the US; Smith died 1951 and Waite in 1942 → also out of copyright in life+70 jurisdictions, including Chile. **Never** use the 1971 U.S. Games recolored edition or later redraws (their new coloring is copyrighted). "Rider-Waite" is a trademark of U.S. Games Systems: the product never uses that name; credits say *"Card art after Pamela Colman Smith (1909), public domain."*
- **Necro treatment (original work by the author):** each card is converted by a build script (`scripts/card-forge`) into a **green-phosphor dithered** image (grayscale → 1-bit/4-level ordered or Floyd–Steinberg dithering → phosphor palette `#33ff66` on `#001a00`) and framed with an original border containing the Roman numeral, card name, and a **code sigil** (an icon per diagnosis: broken chain for The Tower, `#` comment glyph for Death, padlock for The Devil…). Optional ASCII-art rendition for the CLI (`chafa`/custom converter at build time; stored as text assets).
- **Evidence on the card:** when a card is turned, its face shows the most damning evidence snippet (e.g. `print "hello"` in `legacy/main.py:42`) in tiny CRT type; clicking opens the **evidence scroll** (all evidence with links to GitHub lines).
- **Motion:** shuffle animation (deterministic, seeded by SHA), deal, flip (CSS 3D), phosphor afterglow on flip, screen flicker on The Tower. All motion respects `prefers-reduced-motion` and a `quiet` command.
- **Ritual Mode (mutant visual):** during a ritual the Celtic Cross is laid out around an ASCII **sigil** (pentagram of 5 phases: Exhume · Transmute · Reanimate · Prove · Judge). Each vertex ignites when its phase's ledger events complete; candles flicker with agent activity; the Judge's verdict flips the outcome card. The visuals are **bound to real ledger events**, never to timers.
- **Oracle voice (mutant):** key lines (card reveals, verdict) are spoken with Amazon Polly (SSML, slow rate, low pitch, cached per line) or the browser's Web Speech API fallback; `voice on/off`.
- **Shareable card:** each reading generates a PNG "card of fate" (OG image) for social sharing — feeds the Social Blitz bonus.

---

## 3B. The Frankenstein: technologies that should never have been stitched together

| Body part | Technology | Why it "shouldn't" go with the rest | What the stitch achieves |
|---|---|---|---|
| The soul | **Tarot** (1909 occult symbolism, Major Arcana) | Esoteric divination vs deterministic engineering | A memorable, human mental model for code health; severity and orientation map to real metrics |
| The skin | **1980s green-phosphor CRT terminal** | 40-year-old UI paradigm vs modern web app | Focus, drama, and a text-first UI that also works in a real terminal (CLI) |
| The brain | **Deterministic static analysis** (tree-sitter, AST parsing, import graphs, OSV, package registries) | Rigid, rule-based | Reproducible, evidence-backed diagnoses (the cards cannot lie) |
| The nervous system | **Multi-agent LLM coven** (Bedrock via AI SDK) | Non-deterministic, creative | Planning, semantic migrations, interpretation, narration |
| The crypt | **Firecracker micro-VM sandboxes** (E2B) running **Python 2.7** — a dead runtime — next to **Python 3.12** | Running EOL software on purpose, in 2026 | Real before/after execution of a project in its original and its new life |
| The heartbeat test | **Property-based + differential + mutation testing** (Hypothesis, fast-check, mutation tools) | Academic verification techniques in a spooky toy | Proof that the resurrection preserves behavior and that tests are strong enough |
| The bloodstream | **Durable workflows** (Inngest) on **serverless** (Vercel) | Minutes-long rituals on platforms built for second-long requests | Reliable long-running rituals with retries and live streaming |
| The hands | **GitHub API** (fork, branch, PR) + **GitHub Action** | The supernatural touching your real repo | Tangible output: a real PR, readings on every PR |
| The voice | **Text-to-speech** (Amazon Polly / Web Speech) | A talking terminal | An oracle that actually speaks |
| The mind-link | **MCP server** + **Kiro Power** + **CLI** | A web toy exposing a protocol for agents | The oracle can be consulted by other AI agents — including Kiro, which built it |
| The evolution | **Self-evolving grimoires** (learned rules) | A migration tool that rewrites its own rulebook | Each resurrection makes the next one cheaper and more deterministic |

---

## 4. The Coven: multi-agent architecture

### 4.1 Agents
| Agent (arcana persona) | Role | Inputs → Outputs | Tools allowed | LLM? |
|---|---|---|---|---|
| **The Hierophant** (Planner/Orchestrator) | Pins commit, builds `RepoSnapshot`, schedules seers, builds the **Ritual Plan DAG** | repo URL → snapshot, plan | GitHub read, planner LLM | Yes (plan), deterministic validation |
| **Arcana Seers** (one per card) | Run the card detector, then interpret evidence in the oracle's voice | snapshot → `CardDraw` | none (pure) + narration LLM | Narration only |
| **The Gravedigger** (Sandbox agent) | Exhume: create sandbox, clone at pinned SHA, provision old runtime, install deps, run original tests, record **baseline** | plan → `Baseline` | sandbox exec (allowlisted commands) | Yes, only to *propose* test commands; validated against allowlist |
| **The Necromancer** (Migration agent) | Apply grimoire: deterministic codemods first, LLM edits second, file by file; self-repair loop on failures | baseline + grimoire → patched tree | sandbox fs write **except test files** | Yes |
| **The Alchemist** (Test-weaver / verifier) | Discover pure-ish functions, generate inputs (Hypothesis), run **differential old-vs-new**, run **mutation testing** on changed lines | patched tree → `DifferentialReport`, `MutationReport` | sandbox exec | Yes (harness generation), deterministic execution |
| **The Judge** (Judgement) | Independent verdict: deterministic gates + LLM review that may only **downgrade** | all reports → `Verdict` | read-only | Yes (review), gates are code |
| **The Scribe** | PR title/body, resurrection notes, destiny reading, narration | verdict → PR + destiny | GitHub write (fork only) | Yes |
| **The Grimoire Smith** (mutant, stretch) | Distills successful self-repairs into **learned incantations** (candidate codemod rules), validates them against the fixture corpus, quarantines until accepted | repair traces → rule candidates | sandbox exec, fixture corpus | Yes |

### 4.2 Orchestration model
- **Event-sourced Ritual Ledger.** Every agent emits typed events: `AgentStarted`, `ToolCalled`, `EvidenceFound`, `Rationale` (a short structured *decision summary*, not raw chain-of-thought), `ArtifactProduced`, `GateResult`, `Verdict`, `AgentFailed`. The terminal renders the ledger live; the ledger is the audit trail and the replay source for demos.
- **Durable workflow:** each agent phase is a durable step (Inngest functions on Vercel, see §6). Long sandbox commands run **in the background inside the sandbox**; the orchestrator polls with durable sleeps, so no serverless timeout is ever hit.
- **Parallelism:** seers run in parallel (bounded by concurrency); Necromancer runs files in batches; Alchemist runs differential cases in batches.
- **Budgets:** each ritual has a token budget, a wall-clock budget (default 20 min), and a sandbox budget; exceeding any → graceful `STILL DEAD (budget)` verdict with partial evidence.
- **Same core everywhere:** the coven is a plain TypeScript library (`@necro/coven`) with a pluggable *runner*: `InngestRunner` (web), `LocalRunner` (CLI, MCP, Action).

### 4.3 Resurrection pipeline (Grimoire I example)
```
P1 EXHUME     Gravedigger: sandbox(py27 template) → git clone --depth 1 @SHA → pip install (py2.7) → run tests → Baseline{passed, failed, skipped, durations, test-file hashes}
P2 TRANSMUTE  Necromancer: deterministic fixers → LLM fixers for semantic cases → py3 syntax validation (tree-sitter + `python3 -m py_compile`) per file
P3 REANIMATE  Gravedigger: sandbox(py312 template) → install → run same tests → After{...}
              on failure: Necromancer self-repair loop (max N attempts; tests are read-only)
P4 PROVE      Alchemist: differential PBT (inputs generated once, replayed in py2.7 and py3.12) + mutation testing on changed lines
P5 JUDGE      Judge: gates G1..G6 + LLM review (downgrade-only) → REVIVED | UNDEAD | STILL DEAD
P6 DELIVER    Scribe: fork → branch necro/revive-<sha> → commit → PR (to the fork) + destiny reading
```

### 4.4 Verification gates (the Judge's law)
| Gate | Rule |
|---|---|
| **G1 Tests intact** | SHA-256 of every test file is identical before/after; no test was deleted, skipped, or marked xfail by the coven |
| **G2 No regressions** | Every test that passed on the old runtime passes on the new runtime |
| **G3 Syntax resurrected** | Every migrated file parses under the target runtime (`py_compile`) and has no legacy constructs left (tree-sitter query) |
| **G4 Differential equivalence** | Zero *unexplained* divergences between old and new outputs on generated inputs. Known, intended divergences (e.g. `/` true division, `str`/`bytes`, dict ordering) must be listed in the grimoire's **divergence allowlist** and appear in the PR body |
| **G5 Evidence strength** | Mutation score on changed lines ≥ threshold (default 60%) **or** verdict is capped at UNDEAD with an explanation ("your tests are too weak to prove the resurrection") |
| **G6 Scope** | Only files in the plan were touched; diff size within budget; no new network calls/dangerous calls introduced (re-run The Devil on the diff) |

**Verdicts:** `REVIVED` (all gates pass) · `UNDEAD` (G1–G3 pass, G4/G5 inconclusive or capped) · `STILL DEAD` (any of G1–G3 fail or budget exceeded). The LLM review can move a verdict down, never up.

**Baseline problems:** if the original tests cannot run on the old runtime (common in dead repos), the Alchemist first writes **characterization tests** against the old runtime (they become frozen baseline tests, hashed and committed in the PR under `tests/necro_characterization/`). If even that fails, the ritual proceeds as *syntax-only* and the best possible verdict is `UNDEAD`.

---

## 5. Grimoires (migration plugins)

### 5.1 Grimoire contract
```ts
export interface Grimoire {
  id: string;                         // "py2to3"
  title: string;                      // "The Serpent Sheds Its Skin"
  arcana: CardId;                     // card that unlocks it (e.g. "judgement")
  applies(snapshot: RepoSnapshot): Applicability;    // pure
  plan(snapshot: RepoSnapshot): RitualPlan;          // pure: files, phases, budgets
  runtimes: { before: SandboxTemplateId; after: SandboxTemplateId };
  testCommands(snapshot: RepoSnapshot): TestCommand[];          // allowlisted
  fixers: DeterministicFixer[];       // pure string/AST transforms, idempotent
  llmFixer?: LlmFixerSpec;            // prompt + output schema + validation
  validate(file: FileAfter): ValidationResult;                  // syntax + residue check
  differential?: DifferentialSpec;    // how to harvest targets & compare outputs
  divergenceAllowlist: DivergenceRule[];
  incantations?: LearnedRule[];       // mutant: learned rules (quarantined/accepted)
}
```
Grimoires live in `packages/grimoires/<id>/` with a fixture corpus (`fixtures/<case>/before|after`) used by golden tests and property tests. A scaffold command (`necro grimoire new`) and a Kiro custom agent (`grimoire-smith`) generate new ones.

### 5.2 Grimoire I — "The Serpent Sheds Its Skin" (Python 2.7 → 3.12) — **CORE**
**Why this is the flagship migration (vs jQuery → vanilla/React):**
1. **Objective success criteria** exist and are checkable by machines: py3 compiles, legacy constructs absent, the *same* tests pass, and outputs can be compared **across two real runtimes** in a sandbox.
2. **Finite, well-documented transformation set** (print, `except X, e`, `raise E, msg`, `<>`, backticks, `has_key`, `iteritems/itervalues/iterkeys`, `xrange`, `raw_input`, `unicode/basestring/long`, octal/long literals, `exec` statement, renamed stdlib modules like `urllib2`, `ConfigParser`, `Queue`, `StringIO`, `cPickle`, `dict.keys()` views, integer division, `str`/`bytes`).
3. **Narrative fit:** Python 2 is officially dead (EOL 2020). Literal resurrection.
4. **Mostly file-local** transformations → parallelizable and fits per-file LLM calls.
5. **Property-testing friendly:** fixers are idempotent; valid py3 input is unchanged; differential behavior is measurable.

jQuery is visually attractive but behavior equivalence needs a browser, DOM fixtures, and interaction recording; it is kept as **Grimoire III (stretch)**.

**Fixer strategy:** deterministic fixers (TypeScript, token/tree-sitter based) for mechanical constructs → LLM fixer for semantic cases (bytes/str boundaries, division intent, `dict.keys()` mutation-while-iterating, `map/filter` laziness, renamed modules usage) with a JSON schema output `{file, newContent, changes[{line, construct, rationale}]}` → validation → retry once → else mark file `UNRESURRECTED` honestly.

**Differential PBT (the key innovation):**
1. Alchemist harvests candidate targets: top-level functions with simple signatures and no I/O (static heuristics + LLM classification, validated by a dry run).
2. In the **py3.12** sandbox it uses **Hypothesis** to generate inputs per target (strategies inferred from defaults, docstrings, call sites, and tests), serializing them to JSON-safe form.
3. The *same* inputs are replayed against the **original code under py2.7** and the **migrated code under py3.12** by a tiny harness; outputs/exceptions are normalized (type-aware: `unicode`↔`str`, `long`↔`int`, ordering-insensitive for dicts/sets) and compared.
4. Divergences are classified: *allowlisted* (documented intended change), *explained by LLM + confirmed by a minimal repro*, or *unexplained* (fails G4). Minimal repro comes from Hypothesis shrinking.

**Mutation testing (G5):** run a Python mutation tool (e.g. mutmut or cosmic-ray, py3 side) restricted to **changed lines only**, with a time cap; report the score as the "**strength of the soul**". (Exact tool to be chosen in the spec after a spike; both are py3-only, which is fine because mutation runs on the revived body.)

**Sandbox templates:** `necro-py27` (Debian + Python 2.7 built from source or a legacy image, pip, virtualenv, pytest 4.x, Hypothesis 4.x for replay only) and `necro-py312` (Python 3.12, pytest, Hypothesis, mutation tool).

### 5.3 Grimoire II — "The Coffin Is Rebuilt" (`setup.py` → `pyproject.toml`) — **LAYER 1**
Deterministic and cheap: parse `setup.py` via AST (never executed outside the sandbox), emit PEP 621 `pyproject.toml`. **Verification:** build sdist + wheel *before* and *after* in the sandbox and diff the `METADATA`, entry points, and file lists. Differences must be empty or allowlisted.

### 5.4 Grimoire III — "Exorcism of the Dollar Sign" (jQuery → vanilla ES2022) — **LAYER 2 / STRETCH**
Scope: small static sites/widgets. **Verification:** Playwright inside the sandbox loads the page before/after, replays a recorded interaction script, and compares normalized DOM + accessibility tree snapshots and console errors (DOM differential testing). Fallback third grimoire if this slips: **"Travis → GitHub Actions"** (Temperance), verified with `actionlint`.

### 5.5 Mutant feature: self-evolving grimoires (Learned Incantations) — **STRETCH (Layer 3)**
When the Necromancer's self-repair loop turns a failing file into a passing one, the repair is a *lesson*. The Grimoire Smith:
1. Extracts the before/after hunk pair and the failure that motivated it.
2. Asks the LLM to generalize it into a **declarative rule** in a tiny DSL (tree-sitter query + replacement template + guard), never arbitrary code.
3. **Validates** the rule: must be idempotent, must not change any fixture that does not match, must fix the original case, must keep all golden fixtures green (property-tested).
4. Stores it as `quarantined` in `packages/grimoires/<id>/incantations/*.json` with provenance (ritual id, repo, commit). A human (or the Judge in a later ritual where the rule helped and gates passed N times) promotes it to `accepted`. Accepted rules run as deterministic fixers *before* the LLM — the grimoire literally gets stronger and cheaper with each resurrection.

---

## 6. System architecture

```
                         ┌───────────────────────────── Surfaces ─────────────────────────────┐
                         │ Web CRT terminal (Next.js)  CLI `necro`  necro-mcp  GitHub Action  │
                         │ Kiro Power (wraps necro-mcp)       Crew app (stretch)              │
                         └──────────────┬───────────────────────┬─────────────────────────────┘
                                        │                       │
                              @necro/coven (TS library: agents, ledger, gates)
                                        │
        ┌────────────┬──────────────────┼──────────────────┬─────────────────┬────────────────┐
   @necro/oracle  @necro/grimoires   @necro/sandbox      @necro/github     @necro/llm      @necro/voice
   deck+detectors  py2to3, pyproject, E2B | Docker       Octokit, OSV,     AI SDK: Bedrock  Polly | Web
   (pure, PBT)     jquery (+ DSL)     providers          registries        | Anthropic |     Speech API
                                                                          OpenAI | Mock
   Runners: InngestRunner (web, durable) · LocalRunner (CLI/MCP/Action)
   State: Upstash Redis (ledger streams, cache, rate limits, TTL)   Artifacts: diff/patch in Redis/S3
```

### 6.1 Recommended stack and justification
| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere** (Node 22), pnpm workspaces monorepo | One language for web, CLI, MCP, Action; Python only *inside sandboxes* |
| Web | **Next.js (App Router) + React**, custom DOM-based CRT terminal component (CSS scanlines, phosphor glow, flicker; `prefers-reduced-motion`) | DOM terminal = accessible (screen readers, copy/paste, links) and fully stylable; xterm.js is an alternative but harder to make accessible and clickable |
| Durable orchestration | **Inngest** (free plan: 50k executions/month, 5 concurrent steps; integrates with Vercel; Realtime streaming) | Serverless functions time out (Vercel Hobby ≈ 60 s); rituals take minutes. Durable steps + sleeps remove timeout risk and give retries and traces for free |
| Sandbox | **E2B** (Firecracker micro-VMs, TS SDK, custom templates from Dockerfiles, internet access can be disabled; Hobby: one-time $100 credit, 20 concurrent sandboxes, 1 h max session) + **local Docker** provider for CLI/dev | Most practical isolated execution for a solo dev: no infra to run, real VM isolation, per-second billing (default 2 vCPU/4 GiB ≈ $0.17/h → $100 ≈ hundreds of ritual-hours). Alternatives considered: AWS Fargate (more AWS-native but much more infra), Vercel Sandbox, Daytona |
| LLM | **Vercel AI SDK** abstraction with providers: **Amazon Bedrock** (default, sponsor-aligned), Anthropic/OpenAI (fallback), **MockProvider** (tests, offline demo) | `generateObject` + zod schemas give structured, validated agent outputs; provider switch by env var |
| State | **Upstash Redis** (Streams for ledger, KV cache, `@upstash/ratelimit`) with TTL | Serverless-friendly, free tier, no DB to operate; nothing needs to live longer than 7 days |
| GitHub | **Octokit**; read via server token (fine-grained, public read-only); writes via a **dedicated machine account/org ("necro-coven")** that forks and opens PRs **only against its own fork** | No user login needed for judges; never spams upstream maintainers. Stretch: "Sign in with GitHub" to fork into the user's own account |
| Vulnerabilities | **OSV.dev** API | Free, ecosystem-wide |
| Voice (mutant) | **Amazon Polly** (server, cached per line) with **Web Speech API** fallback | Sponsor-aligned; fallback is free and offline |
| Hosting | **Vercel** (web + API + Inngest endpoint). Alternative: **AWS Amplify Hosting** for Next.js | Fastest path with preview deploys per PR; Amplify keeps it all-AWS if preferred. Either way the coven runs on durable steps, so host limits do not matter much |
| Tests | **Vitest**, **fast-check** (PBT), Playwright (web e2e), golden fixtures per grimoire | fast-check is the standard PBT lib for TS and matches Kiro's PBT workflow |
| MCP | `@modelcontextprotocol/sdk` (stdio + Streamable HTTP) | Official TS SDK |
| CLI | `commander` + `ink` (or plain ANSI) | Same CRT vibe in a real terminal |

### 6.2 Deployment topology
- **Vercel project** `necro-oracle` → `apps/web` (UI + `/api/*` + `/api/inngest`).
- **Inngest** app connected to the Vercel project.
- **E2B** templates `necro-py27`, `necro-py312`, (`necro-node22-playwright` for Grimoire III) built from `infra/sandbox-templates/*`.
- **Upstash Redis** database.
- **GitHub**: machine account + fine-grained tokens stored only as Vercel env vars.
- **npm**: `necro-oracle` (CLI) and `necro-mcp` published (or run from GitHub via `npx github:` if publishing is skipped).
- **Demo resilience:** `DEMO_MODE` replays recorded ledgers for Graveyard repos if live quotas are exhausted (clearly labelled "replay").

---

## 7. Data model (TypeScript, zod-validated)

```ts
type RepoRef = { owner: string; name: string; sha: string; defaultBranch: string };
type FileEntry = { path: string; size: number; lang: "python"|"js"|"ts"|"html"|"other"; sha: string };
type RepoSnapshot = { ref: RepoRef; files: FileEntry[]; meta: RepoMeta; manifests: Manifest[];
                      contents: Map<string, string> /* lazily loaded, size-capped */ };

type CardId = "judgement"|"tower"|"devil"|"death"|"wheel"|"hermit"|"hanged_man"
            |"temperance"|"justice"|"moon"|"star"|"world"|"fool"|"magician"|"high_priestess";
type Severity = 0|1|2|3;
type Evidence = { kind: string; path?: string; line?: number; detail: string; source: "static"|"github"|"osv"|"registry"|"sandbox" };
type CardDraw = { card: CardId; severity: Severity; orientation: "upright"|"reversed";
                  evidence: Evidence[]; summary: string; narration?: string; grimoires: string[] };
type Reading = { id: string; repo: RepoRef; draws: CardDraw[]; spread: SpreadPosition[];
                 vitality: number; createdAt: string; engineVersion: string };

type LedgerEvent = { ritualId: string; seq: number; at: string; agent: AgentId;
  type: "AgentStarted"|"ToolCalled"|"EvidenceFound"|"Rationale"|"ArtifactProduced"
       |"GateResult"|"Verdict"|"AgentFailed"|"Narration"; payload: unknown };

type Baseline = { runtime: string; passed: string[]; failed: string[]; skipped: string[];
                  testFileHashes: Record<string,string>; durationMs: number };
type DifferentialReport = { targets: number; cases: number; divergences: Divergence[] };
type Divergence = { target: string; input: unknown; before: unknown; after: unknown;
                    class: "allowlisted"|"explained"|"unexplained"; ruleId?: string };
type MutationReport = { tool: string; mutants: number; killed: number; survived: number; scoreChangedLines: number };
type GateResult = { gate: "G1"|"G2"|"G3"|"G4"|"G5"|"G6"; passed: boolean; detail: string };
type Verdict = { status: "REVIVED"|"UNDEAD"|"STILL_DEAD"; gates: GateResult[]; llmReview?: string; downgradedBy?: "llm"|"budget" };
type Ritual = { id: string; readingId: string; grimoire: string; status: "queued"|"running"|"done"|"failed";
                plan: RitualPlan; baseline?: Baseline; after?: Baseline; differential?: DifferentialReport;
                mutation?: MutationReport; verdict?: Verdict; patch?: string; prUrl?: string; destiny?: Reading };
type LearnedRule = { id: string; grimoire: string; query: string; template: string; guard?: string;
                     status: "quarantined"|"accepted"|"rejected"; provenance: { ritualId: string; repo: string } };
```
Retention: readings 7 days, rituals/ledgers/patches 7 days (Redis TTL). No user accounts in core.

---

## 8. API surface (web)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/readings` | `{repoUrl}` → `{readingId}`; starts reading (fast path, < 60 s, may run inline) |
| GET | `/api/readings/:id` | Reading JSON |
| POST | `/api/rituals` | `{readingId, grimoire, options}` → `{ritualId}`; emits Inngest event |
| GET | `/api/rituals/:id/events` | SSE stream of ledger events (resume with `Last-Event-ID`) |
| GET | `/api/rituals/:id/patch` | unified diff (`.patch`) |
| POST | `/api/rituals/:id/pr` | open PR on the coven fork (only if verdict ≠ STILL_DEAD) |
| GET | `/api/grimoires` | installed grimoires |
| POST | `/api/voice` | `{lineId}` → cached audio (Polly) |

`necro-mcp` tools mirror these: `read_tarot`, `explain_card`, `list_grimoires`, `cast_ritual` (async, returns id), `ritual_status`, `get_revived_body`, `get_destiny`. Resources: `necro://deck` (card reference), `necro://grimoires/<id>`.

---

## 9. Security & abuse model
- **Never execute user code outside the sandbox.** Web/API process only *reads* text; parsing is done with tree-sitter/AST parsers. `setup.py` is parsed, never run, outside the sandbox.
- **Sandbox isolation:** Firecracker micro-VM per ritual, killed at the end; no secrets injected (no GitHub/LLM keys inside); install phase allows outbound network to package indexes; test phase runs with outbound network disabled where the provider supports it; CPU/RAM/time caps; output size caps.
- **Command allowlist:** sandbox commands come from the grimoire (`pip install …`, `python -m pytest …`); LLM-proposed commands are validated against an allowlist regex set before execution.
- **Prompt-injection posture:** repo content is untrusted data, wrapped in delimiters; agents have **no general tools** — each agent gets only the narrow tools of its role; all outputs pass zod schemas; the Judge's gates are code, not prompts; test files are immutable for the Necromancer (enforced by the sandbox fs layer + G1).
- **Rate limits** (`@upstash/ratelimit`, per IP + global): readings 10/h/IP, rituals 2/h/IP and N/day global, PRs 1 per ritual; **global spend circuit breaker** (LLM tokens + sandbox minutes per day) → falls back to DEMO replay.
- **Repo caps:** public repos only, ≤ 50 MB archive, ≤ 5,000 files, ≤ 300 files migrated per ritual in core.
- **GitHub tokens:** server-side only, fine-grained, least privilege: read token (public repos, read-only), write token (machine account, can fork/push/PR only in its own namespace). PRs are opened **against the coven fork**, never upstream; the PR body links back so a human can choose to upstream.
- **Secrets in evidence:** The Devil masks all secret-like strings (first 4 chars + ****); masking is property-tested; masked values never reach the LLM.
- **Supply-chain hygiene for the project itself:** lockfile, Dependabot, CodeQL or `npm audit` in CI, Kiro `PreToolUse` hook blocking writes to `.env*`.

---

## 10. Scope: bulletproof core and progressive layers

| Layer | Contents | Must be done by |
|---|---|---|
| **L0 — The Bones (bulletproof core)** | Monorepo + CI · deck engine with 10 diagnostic cards + Star + World (upright/reversed), deterministic & PBT-tested · **card forge** (PD 1909 art → phosphor-dithered cards) · spreads **Three Fates + Necropsy** with deal/flip animation and evidence scroll · reading via GitHub API · CRT web terminal (summon/explain/ritual/body/pr/destiny + buttons) · **Grimoire I py2→3** with E2B sandbox: baseline tests on 2.7 → migrate → tests on 3.12 · gates G1, G2, G3, G6 · Judge (deterministic) · patch download + **real PR on coven fork** · live ledger streaming · rate limits · deployed URL · Graveyard with 3 fixture repos | **Day 10 (Nov 12)** |
| **L1 — The Flesh** | Differential PBT (G4) · **Celtic Cross deep audit** · CLI `necro` · `necro-mcp` (stdio) · GitHub Action (read on PRs) · Grimoire II (pyproject, wheel-metadata verification) · LLM Judge review (downgrade-only) · ritual visual mode (ASCII sigil) | Day 17 (Nov 19) |
| **L2 — The Soul** | Mutation testing (G5) · Kiro Power packaging of necro-mcp · Kiro CLI headless workflow in CI · oracle voice (Polly + Web Speech fallback) · DEMO replay mode · Grimoire III (jQuery) **or** Travis→GHA fallback | Day 24 (Nov 26) |
| **L3 — The Afterlife (stretch)** | Self-evolving grimoires (Learned Incantations) · Kiro Crew app (separate repo) · Sign in with GitHub (fork to own account) · shareable reading cards (OG images) · stretch cards (Fool, Magician, High Priestess) | Day 26 (Nov 28), cut without regret |
| **Polish & submission** | Bug bash, a11y, video, write-up, blog, social post | Days 27–31 (Nov 29–Dec 3); Dec 4 = emergency buffer only |


### Mutant features: core vs stretch
| Mutant feature | Tier | Why there |
|---|---|---|
| Upright/reversed technical semantics, spreads, phosphor card art | **Core (L0)** | It is the product's identity and cheap once the deck engine exists |
| Live ritual ledger + Ritual Mode sigil bound to real events | **L1** (v1 on Day 12) | High demo value, moderate cost |
| Differential PBT across py2.7 and py3.12 | **L1** | The core innovation of "proven resurrection" |
| Mutation testing on changed lines (G5) | **L2** | Strong proof, but tool integration risk |
| Oracle voice (Polly + Web Speech fallback) | **L2** | Memorable in the video; low risk with fallback |
| Self-evolving grimoires (learned incantations) | **L3 stretch** | Most novel, most risky; only after L2 is green |
| Kiro Crew "Graveyard Watch" app | **L3 stretch** | Separate bonus; separate repo |

**Cut rules:** if L0 is not green on Day 12, freeze L2/L3 and spend two days hardening. If E2B blocks for > 1 day, switch the provider to the local Docker runner (the web app then shows recorded rituals for live-sandbox steps, labelled "replay"). Grimoire III is the first thing cut, then mutation testing becomes "report only", then self-evolution.

---

## 11. Risks & mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Python 2.7 environment hard to provision | Blocks baseline | Pre-built E2B template early (Day 4–5); fallback to a legacy `python:2.7` base image; characterization-test path when deps won't install |
| Original tests don't run at all on dead repos | Weak proof | Characterization tests + differential PBT; honest `UNDEAD` verdict; curated fixture repos that the author creates with real py2 tests |
| LLM migration hallucination / test tampering | False "revived" | Deterministic fixers first, read-only tests, G1 hashes, downgrade-only LLM judge |
| Serverless timeouts | Broken rituals | Inngest durable steps + background sandbox commands + polling |
| Cost overrun (LLM, sandboxes) | Demo dies during judging (Dec 16 – Jan 29!) | Budgets, global circuit breaker, DEMO replay mode, caching readings by SHA, keep E2B usage well under the $100 credit |
| Judging period lasts until Jan 29, 2027 | App must stay up | Free tiers, circuit breaker, replay fallback, monitoring (uptime check), no expiring trial dependencies |
| Spamming upstream maintainers | Reputation | PRs only on the coven fork |
| Scope creep (it's a mutant) | Nothing finished | Layered plan, cut rules, L0 by Day 10 |
| "Insufficient use of Kiro" | Disqualification | Specs per subsystem, hooks, steering, custom agents, MCP, PBT, CLI, Power — all committed under `/.kiro` and documented in `docs/KIRO_USAGE.md` |
| Copyrighted tarot art / music | Rule violation | Original ASCII/CRT card art drawn by the author; royalty-free or self-made audio |

---

## 12. Repository structure (target)
```
/.kiro/                     # committed, never in .gitignore
  steering/                 # product, tech, structure, oracle-voice, security, testing, grimoire-authoring, coven-contracts
  specs/                    # one folder per subsystem spec (see KIRO_SPEC_PROMPT.md)
  hooks/                    # *.json hook definitions
  agents/                   # custom Kiro agents
  settings/mcp.json         # workspace MCP servers (no secrets; ${ENV} refs)
/apps/web/                  # Next.js CRT terminal
/packages/oracle/           # deck, detectors, spreads, scoring (pure)
/packages/coven/            # agents, ledger, gates, runners
/packages/grimoires/        # py2to3/, pyproject/, jquery/, _template/
/packages/sandbox/          # E2B + Docker providers
/packages/github/           # Octokit wrappers, OSV, registries
/packages/llm/              # AI SDK providers + Mock
/packages/voice/            # Polly + Web Speech
/packages/mcp-server/       # necro-mcp
/packages/cli/              # necro CLI
/packages/action/           # GitHub Action (read on PRs)
/power/                     # Kiro Power packaging of necro-mcp
/infra/sandbox-templates/   # Dockerfiles for E2B templates
/fixtures/graveyard/        # purpose-built dead repos for demo & tests
/docs/                      # DESIGN.md, DECK.md, KIRO_USAGE.md, ARCHITECTURE.md
LICENSE (MIT)  README.md
```
