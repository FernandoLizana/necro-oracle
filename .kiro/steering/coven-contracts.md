---
inclusion: fileMatch
fileMatchPattern: ["packages/coven/**/*", "packages/llm/**/*", "apps/web/app/api/inngest/**/*"]
---
# Coven (multi-agent) contracts

- Each agent exports `{ id, inputSchema, outputSchema, tools, budget, run(ctx) }`. `ctx` exposes only ports: `llm`, `sandbox`, `github`, `ledger`, `clock`. No direct imports of adapters.
- Agents emit ledger events for: start, every tool call (name + sanitized args), evidence, a `Rationale` (≤ 280 chars, structured: decision, because, alternatives) for each decision, artifacts, and failure. Never log raw chain-of-thought or secrets.
- Ledger events are append-only with strictly increasing `seq`; state is always derivable by folding events (`foldRitual`).
- Every LLM call: zod output schema, explicit token budget, timeout, cache key, Mock fixture. On schema failure: retry once with the validation error, then `AgentFailed`.
- The Judge's gates are pure code in `packages/coven/gates/`; the LLM review may only downgrade (`assertNotUpgraded`).
- Inngest: one `step.run` per agent phase; long sandbox commands start in background and are polled with `step.sleep("…", "20s")`; steps must be idempotent (use ritualId + phase as idempotency keys).
- Budgets per ritual: tokens, wall clock (default 20 min), sandbox minutes. Exceeding any → terminal `STILL_DEAD (budget)` with partial evidence.
