# Models, environment, and OpenRouter

> *"The oracle will speak through any throat you give it, or through none at
> all. Name the voice, or it keeps its own counsel."*

The single operator-facing reference for configuring the Necro-Oracle's LLM
layer: the OpenRouter provider, the model-tier environment variables, the
Bring-Your-Own-Key (BYOK) flow, the daily spend ceilings, and the offline
smoke test. It is a companion to `docs/ARCHITECTURE.md` -> "Lovers_Binding"
(the design) and `docs/PROMPTS.md` (the prompt catalogue + model-default
policy). The env schema is defined and validated in `packages/config`
(`loadEnv` / `EnvSchema`); this doc describes it operationally.

Content was rephrased for compliance with licensing restrictions.

## The default is offline and deterministic

With NO configuration the app runs on the **Mock provider**: deterministic,
network-free, no key. Readings still render (the deterministic detectors are
the source of truth), resurrection runs the deterministic pass, and the tarot
reading text uses its deterministic offline fallback. You only need the
variables below to turn on *real* LLM narration/resurrection.

Secrets are read ONLY at the server composition root, validated at startup, and
never sent to the client, logged, or echoed. Never commit a `.env*` file with a
real value.

## Environment variables

### Credentials (server-only, optional)

| Variable | Purpose | Absent/blank behaviour |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | The server OpenRouter credential. | Stay on Mock/deterministic. |
| `NECRO_LLM_API_KEY` | Legacy server LLM credential. | Degraded_Mode. |
| `GITHUB_TOKEN` | Higher GitHub REST rate limits for intake. | Unauthenticated limits. |

A present credential must contain no whitespace or control characters. When a
key is present but the matching model id (below) is missing, startup does NOT
fail: `@necro/config` logs a key-NAME-only warning and the app stays on the
Mock/deterministic path (it never guesses a model id).

### Model ids (pure configuration)

| Variable | Purpose |
| --- | --- |
| `NECRO_LLM_MODEL_FAST` | The FAST tier model id (diagnostics, tarot text). |
| `NECRO_LLM_MODEL_STRONG` | The STRONG tier model id (hard resurrection units). |
| `NECRO_LLM_MODEL_FALLBACKS` | Comma-separated fallback model ids (trimmed list). |

Model ids are an OpenRouter `vendor/model[:tag]` string (e.g.
`anthropic/claude-3.5-sonnet`, `openai/gpt-4o-mini`). The tier the router
chooses (`FAST` vs `STRONG`) maps to the corresponding env model via the pure
`resolveModel(tier, env, override?)` with a fixed precedence: a YOURS/BYOK
session override first, then the tier env model. The documented default ids
live only in `docs/PROMPTS.md`, never hardcoded in the schema.

### Spend ceilings (server key, per UTC day)

| Variable | Unit | Default |
| --- | --- | --- |
| `NECRO_LLM_DAILY_CEILING` | server LLM token/request budget per day | 1000 |
| `NECRO_LOVERS_DAILY_CEILING` | Lovers-ritual completions per day | 200 |
| `NECRO_TAROT_DAILY_CEILING` | tarot reading completions per day | 300 |
| `NECRO_LLM_MAX_CALLS_PER_READING` | LLM calls within one reading | 12 |
| `NECRO_DAILY_REQUEST_CEILING` | overall request ceiling per day | 1000 |

Each ceiling is a positive integer in canonical decimal. The tarot ceiling has
its OWN counter, independent of the general and Lovers ceilings: once the day's
tarot budget is spent on the server key, further tarot readings fall back to the
deterministic offline text -- never an error.

### Transport / deployment

| Variable | Purpose |
| --- | --- |
| `NECRO_PUBLIC_URL` | Public URL sent as the OpenRouter `HTTP-Referer` header. |
| `NECRO_CLIENT_IP_HEADER` | Header carrying the client IP (default `x-real-ip`). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis (ledger, cache, rate limits). |

There is no `NECRO_LLM_SEED`: determinism comes from temperature 0 plus the
completion cache, not a seed.

## The OpenRouter provider

`createOpenRouterLlmPort` (`packages/llm/src/providers/openrouter.ts`,
`providerId: "openrouter"`) implements the `LlmPort` over the OpenAI-compatible
`POST /chat/completions` at `OPENROUTER_URL`, through an injectable `fetchImpl`.
It sends the routed `model`, the bounded `max_tokens`, `temperature: 0`, a
strict `response_format.json_schema`, and (when set) the `NECRO_PUBLIC_URL`
`HTTP-Referer`. It never logs the key, the prompt body, or the code body.

Upstream status mapping (SEC-09): `401` -> `AUTH_INVALID`, `402` (out of
credit) -> `UPSTREAM_UNAVAILABLE`, `429` -> `RATE_LIMITED`, `5xx`/network ->
`UPSTREAM_UNAVAILABLE`, timeout/abort -> `NETWORK_TIMEOUT`. Retries are bounded
(at most one, transient only); there is no unbounded retry loop.

## Bring Your Own Key (BYOK)

A visitor may supply their OWN OpenRouter key for the current browser tab only
(the `key set` command opens a masked input). It is transported per request in
the `X-Necro-User-Key` header, used for that request's calls, then dropped --
never stored, logged, cached, echoed, or included in the completion cache key.
A YOURS-key `401`/`402` is surfaced as a typed oracle-voice error; it is NEVER
silently served from the server key. See `docs/ARCHITECTURE.md` -> "Part D".

## Offline smoke test

Run the LLM plumbing without touching the network:

```
pnpm smoke:llm
```

By default this exercises the Mock provider and the tarot reading service
(parse + deterministic fallback) with NO network and NO spend. It performs a
single LIVE OpenRouter call ONLY when you set BOTH an explicit opt-in and a key:

```
NECRO_SMOKE_LIVE=1 OPENROUTER_API_KEY=... NECRO_LLM_MODEL_FAST=... pnpm smoke:llm
```

Without the opt-in (or without a key) it stays entirely offline, so neither CI
nor a careless invocation ever reaches the wire or spends a token.