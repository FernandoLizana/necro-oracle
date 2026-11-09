# Security Policy

The Necro-Oracle reads public GitHub repositories and resurrects legacy code
inside isolated sandboxes. It treats every repository as untrusted input and is
built so that untrusted code is never executed outside a sandbox and secrets
never cross a trust boundary. This document describes the security model and
how to report a vulnerability.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public issue
for a security problem.

- Use GitHub's **private vulnerability reporting** on this repository
  (Security tab -> "Report a vulnerability"), or
- open a **draft** security advisory.

Include: what you observed, how to reproduce it, the affected surface (web, CLI,
MCP server, or GitHub Action), and the impact you believe it has. We aim to
acknowledge a report within a few days. Because this is a solo, time-boxed
project, response times are best effort.

Please do not run intrusive tests against the hosted deployment (no load or
denial-of-service testing, no attempts to exfiltrate other users' data). A
local checkout is the right place to demonstrate most issues.

## Security model

These are invariants, not aspirations. They are enforced in code and covered by
tests.

### Repository code is untrusted data
Repository contents are parsed only (tree-sitter / AST / TOML / JSON). They are
never executed, imported, `eval`'d, or `require`'d outside a sandbox. `setup.py`
is parsed, never run, outside the sandbox. Content from a repository is wrapped
in explicit delimiters before it reaches an LLM and is labelled as data; it can
never change an agent's tool permissions, and every LLM output is validated with
a zod schema.

### Sandbox isolation
Code execution happens only inside a per-ritual isolated sandbox (E2B micro-VM,
or a local Docker provider for development), destroyed in every terminal state.
Sandboxes receive no secrets. Only allow-listed commands run, resource and time
limits are always set, and output is truncated. The Necromancer agent never
writes to test files; this is enforced at the sandbox boundary and verified by a
gate.

### Secrets never cross a boundary
- Server credentials (GitHub token, LLM keys) live only in server-side
  environment variables validated at startup. They are never printed, never
  returned in an error body, and never sent to an LLM.
- Bring-your-own-key (BYOK) OpenRouter keys travel per request in a single
  dedicated header, are used for exactly one request, are never persisted,
  logged, cached, or placed in a response, and are never used to build a cache
  key. The raw key never enters the shared client UI package.
- Every outgoing stream line and every logged error message/stack is run
  through a redaction pass that scrubs each in-scope secret. Server logs carry
  only an allow-listed machine error code plus a redacted message/stack — never
  tokens, request bodies, headers, a `cause`, or user-facing messages that echo
  input.
- A runtime leak **canary** is included in the redaction set and in the
  post-build client-bundle sweep, so an accidental leak is caught both at
  runtime and at build time.

### Transport, headers, and CSP
- The browser talks only to same-origin API routes; there is no CORS
  allow-origin reflection. Users supply no base URL — the upstream endpoint is a
  fixed constant.
- Every API response sets `Cache-Control: no-store`, `X-Content-Type-Options:
  nosniff`, and `Referrer-Policy: no-referrer`.
- A per-request nonce Content-Security-Policy is applied to HTML; inline script
  is disallowed (`script-src` carries `'self'`, the nonce, and
  `'strict-dynamic'`, never `'unsafe-inline'`). Untrusted content is always
  rendered as text, never as HTML (`dangerouslySetInnerHTML`, `eval`, and
  `new Function` are banned in client code and checked by a boundary test).

### Upstream failures
Upstream LLM failures map to distinct error codes (authentication vs. credit
vs. rate limit vs. outage). A transient `429`/`5xx` is retried at most once; an
authentication or credit failure is never retried and never silently falls back
to the server key.

### Abuse and spend limits
Per-IP and global rate limits, a configurable per-reading LLM call cap, and
daily spend ceilings bound resource use. Size caps limit repository intake. A
BYOK request never spends server credit.

### GitHub safety
GitHub tokens are server-side only and least-privilege. Pull requests are opened
only against the project's own fork, never upstream, one per ritual.

### Privacy
There are no user accounts in the core product. Only public repository metadata
and short-lived ritual artifacts are stored, with a 7-day TTL.

## Scope

This policy covers the code in this repository and its hosted deployment. It
does not cover third-party services the project integrates with (GitHub, E2B,
Inngest, Upstash, Vercel, Amazon Bedrock/Polly, OpenRouter), which have their
own security policies.
