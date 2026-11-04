---
inclusion: always
---
# Security policies (non-negotiable)

1. **Repository code is untrusted data.** Never execute, import, `eval`, or `require` it outside the sandbox. Parse only (tree-sitter, AST, TOML/JSON parsers). `setup.py` is parsed, never run, outside the sandbox.
2. **Prompt injection:** wrap repository content in explicit delimiters, state that it is data, never let it change tool permissions. Agents have only their allowlisted tools. Validate all LLM outputs with zod.
3. **Sandbox:** one micro-VM per ritual, destroyed in every terminal state; no secrets injected; commands only from `packages/sandbox/allowlist.ts`; resource and time limits always set; output truncated at 1 MB.
4. **Test immutability:** the Necromancer must never write to test files; enforce in `SandboxPort` and verify by gate G1 (hashes).
5. **GitHub:** tokens server-side only, least privilege; PRs only against our own fork, never upstream; one PR per ritual.
6. **Secrets in evidence:** mask everything secret-like before storing, displaying, logging or sending to an LLM.
7. **Abuse:** rate limits per IP and global; spend circuit breaker for LLM tokens and sandbox minutes; size caps (≤ 50 MB, ≤ 5,000 files).
8. **This repo:** never create or edit `.env*` files with real values; never print env vars in logs; keep `.kiro/settings/mcp.json` free of secrets (use `${VAR}` references).
9. **Privacy:** no user accounts in core; store only public repo metadata and ritual artifacts with 7-day TTL.
