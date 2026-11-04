---
inclusion: always
---
# Project structure and conventions

```
/.kiro/            steering/, specs/, hooks/, agents/, settings/mcp.json   (always committed; never gitignored)
/apps/web/         Next.js app: app/ (routes), app/api/* (HTTP + SSE), app/api/inngest, components/ (screens only)
/packages/oracle/  deck registry, detectors/<card>.ts, spreads.ts, vitality.ts, snapshot/ (pure)
/packages/ui-crt/  CRT design system: Screen, Terminal, Card, Spread*, EvidenceScroll, SigilRitual
/packages/coven/   agents/<agent>.ts, ledger/, gates/, runners/{local,inngest}.ts, ports.ts
/packages/grimoires/<id>/  index.ts, fixers/, llm/, validate.ts, differential/, fixtures/<case>/{before,after}/, incantations/
/packages/grimoires/_template/  scaffold source for `necro grimoire new`
/packages/sandbox/ ports + providers/{e2b,docker}.ts, allowlist.ts
/packages/github/  intake.ts, snapshot.ts, osv.ts, registries.ts, delivery.ts
/packages/llm/     providers/{bedrock,anthropic,openai,mock}.ts, cache.ts, budget.ts
/packages/voice/   polly.ts, webspeech.ts
/packages/mcp-server/  necro-mcp
/packages/cli/     necro CLI (+ assets/ ascii cards)
/packages/action/  GitHub Action (action.yml + dist)
/packages/config/  env schema
/power/            Kiro Power packaging of necro-mcp
/infra/sandbox-templates/  Dockerfiles + build scripts
/fixtures/graveyard/       purpose-built dead repos (demo + tests)
/scripts/          card-forge/, check-kiro-dir.sh, record-ledger.ts
/docs/             DESIGN.md, COMPLIANCE.md, DECK.md, KIRO_USAGE.md, DISCLOSURES.md, ARCHITECTURE.md
```

## Naming
- Files: kebab-case (`dead-code.ts`). Types/interfaces: PascalCase. Functions/vars: camelCase. Constants: SCREAMING_SNAKE.
- Card ids: snake_case strings (`hanged_man`, `wheel`). Agent ids: lowercase (`hierophant`, `necromancer`).
- Packages are scoped `@necro/<name>`. Import across packages only through each package's `src/index.ts`.
- Tests live next to code: `*.test.ts` (examples), `*.pbt.test.ts` (fast-check properties), `*.e2e.ts` (Playwright).
- Each property test names its requirement: `describe("P3 (R2.1, R2.4): every draw has evidence", …)`.

## Dependency direction (never violate)
`oracle` ← `grimoires` ← `coven` ← (`web`, `cli`, `mcp-server`, `action`). Adapters (`sandbox`, `github`, `llm`, `voice`) are injected into `coven` through ports. `oracle` and grimoire fixers import NO adapters.

## Docs discipline
- When a card, grimoire, agent, gate or public API changes, update `docs/DECK.md` / `docs/ARCHITECTURE.md` in the same change.
- Append a dated entry to `docs/KIRO_USAGE.md` whenever a Kiro feature materially helped (spec, hook, steering, agent, MCP, PBT, CLI, Power).
