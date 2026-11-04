---
inclusion: fileMatch
fileMatchPattern: ["packages/grimoires/**/*"]
---
# Grimoire authoring rules

- A grimoire implements the `Grimoire` interface in `docs/DESIGN.md` §5.1. Start from `packages/grimoires/_template` (or `necro grimoire new <id>`).
- **Deterministic fixers first, LLM last.** Fixers are pure `(source: string, ctx) => FixResult`, idempotent, and must not change string literal contents or comments.
- Each fixer has: a doc comment with before/after example, golden fixtures, and a fast-check idempotence + preservation property.
- `validate()` must prove the target runtime accepts the file (tree-sitter + compile in sandbox) and that no legacy construct remains.
- Every intended behavior change must be declared in `divergenceAllowlist` with an id, description, and a minimal example; undocumented divergences fail gate G4.
- Test commands come only from the sandbox allowlist. Never add `curl | sh` or arbitrary shell.
- Learned incantations (`incantations/*.json`) use the DSL only (query + template + guard); never executable code. New ones start `quarantined`.
- Update `docs/DECK.md` (card ↔ grimoire links) when a grimoire is added.
