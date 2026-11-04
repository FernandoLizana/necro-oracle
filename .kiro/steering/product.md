---
inclusion: always
---
# Product: The Necro-Oracle

## One-liner
A multi-agent code-resurrection system disguised as a tarot reader: it reads tarot on a public GitHub repository (every card is a real, evidence-backed diagnosis), then a coven of AI agents resurrects legacy code inside an isolated sandbox and only declares it REVIVED when machine-checked verification passes. It delivers a real pull request and a destiny reading.

## Context
- Built solo by Fernando for **Kiroween 2026** (Devpost, AWS), category **Frankenstein**. Deadline Dec 4, 2026 2:00 pm PT. Everything public must be in **English**.
- Full design: `docs/DESIGN.md`. Compliance and judging: `docs/COMPLIANCE.md`. Read them when a task touches scope, UX or architecture.

## Target users
1. Developers and teams inheriting abandoned or legacy repositories.
2. Engineering leads who need a fast, shareable, evidence-based health assessment.
3. AI-agent users who want a verification harness around agentic migrations (via MCP, CLI, GitHub Action).

## Product principles (in priority order)
1. **The cards cannot lie.** Card draws come from deterministic detectors with evidence. LLMs interpret and narrate; they never decide whether a card is drawn.
2. **Revived means proven.** A resurrection is REVIVED only if the Judge's deterministic gates (G1–G6) pass. LLM review may only downgrade. Honest UNDEAD / STILL DEAD verdicts are features.
3. **The tarot is the interface.** Spreads, orientation (upright = active, reversed = latent/partial), and card faces are the information architecture, not decoration.
4. **Never harm real projects.** PRs only to our own fork; no user code executes outside the sandbox; no secrets in sandboxes.
5. **Always demoable.** Cached readings, DEMO replay (clearly labelled), budgets and circuit breakers keep the app alive through the judging period (until Jan 29, 2027).
6. **Same oracle, many surfaces.** Web CRT terminal, `necro` CLI, `necro-mcp` server, GitHub Action, Kiro Power share one core.

## Core vocabulary (use consistently in code, UI and docs)
- **Reading**: the result of divination on a commit. **Draw**: one card with severity 0–3 and orientation. **Spread**: fates (3), necropsy (5), celtic (10), destiny (3).
- **Coven**: the set of agents (Hierophant, Seers, Gravedigger, Necromancer, Alchemist, Judge, Scribe, Grimoire Smith).
- **Grimoire**: a migration plugin. **Ritual**: one execution of a grimoire. **Ledger**: event log of a ritual.
- **Revived body**: the patch/PR. **Destiny**: the post-ritual reading. **Vitality**: 0–100 health score.

## Scope layers
- L0 Bones (core, Day 10): deck engine, card forge, fates+necropsy spreads, web terminal, Grimoire I py2→3 in sandbox with gates G1/G2/G3/G6, real PR, live ledger, rate limits, deployed.
- L1 Flesh: differential PBT (G4), Celtic Cross, CLI, necro-mcp, GitHub Action, Grimoire II, LLM judge review, ritual mode.
- L2 Soul: mutation testing (G5), Kiro Power, Kiro CLI in CI, voice, DEMO replay, Grimoire III or fallback.
- L3 Afterlife (stretch): self-evolving grimoires, Crew app, GitHub sign-in, stretch cards.
When in doubt, protect L0 first.
