# Prompts

> *"The oracle chooses its words once, and keeps them. Every incantation is
> stamped, versioned, and bound against the lies in the code it reads."*

This file is the single human-facing reference for the Necro-Oracle's LLM prompt
layer: the versioned template catalogue, the `PROMPT_VERSION` stamp, the
prompt-injection / untrusted-data defence, and the documented default model ids.
It is a companion to `docs/ARCHITECTURE.md` → "Lovers_Binding". Update it in the
same change whenever a prompt template, `PROMPT_VERSION`, or the model routing
changes.

The authoritative, verbatim prompt text lives in code, in the one source of
truth module `packages/llm/src/prompts/templates.ts` (exported from
`@necro/llm`'s barrel as `PROMPT_TEMPLATES`, `getTemplate`, `buildMessages`,
`PROMPT_VERSION`, `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE`, `neutraliseDelimiters`,
`deriveCacheKey`, `contentHashOf`). This document describes those templates at a
high level and does **not** reproduce secrets; it references the verbatim A.5a
system prompts by their purpose name.

## PROMPT_VERSION

`PROMPT_VERSION` (`packages/llm/src/prompts/version.ts`, re-exported from the
barrel) is currently `"v1"`. It participates in **every** completion cache key,
so any change to a prompt template's text, rules, or few-shot examples must bump
`PROMPT_VERSION` — that bump invalidates all prior cached completions
deterministically. The cache key is:

```
sha256( purposeId + schemaName + PROMPT_VERSION + resolvedModel + contentHash + retryFlag/errorHash )
```

built by `deriveCacheKey` / `contentHashOf`. The cache key **never** includes the
BYOK user key (see `docs/ARCHITECTURE.md` → "Part D — Bring Your Own Key"), and
only outputs that passed both the zod schema and the validation gate are written
to the cache.

## The template catalogue

`PROMPT_TEMPLATES` is keyed by a `PromptPurpose`. There are three purposes; each
template carries a system message, a user-message template (which wraps the
untrusted repository data), a shared repair user-message for the second
(one-retry) call, explicit rules, the output JSON schema name, and one short
few-shot example pair. The same catalogue serves the resurrection chunk pass and
both Lovers phases; `py2to3`'s `LlmStep.buildRequest` delegates here so there is
exactly one source of truth.

| Purpose (`PromptPurpose`) | Tier at start | Output schema | Role (high level) |
| --- | --- | --- | --- |
| `py2to3.chunk` | routed per chunk | `ChunkEdit` | Rewrites one Python 2 code chunk so every residual diagnostic is resolved and it runs on Python 3.8+ with identical observable behaviour. Changes only the lines the listed diagnostics require; needed stdlib imports go in `requiredImports`, never inside `replacementCode`; `confidence = 0` returns the chunk unchanged. |
| `lovers.plan` | FAST | `LoversPlan` | Designs the JSON contract between the Python 3 module and the JavaScript client. For each extracted top-level function it emits params (py/json/js types, required), returns, `bindable` (with a `skipReason` when a value is not JSON-serializable), and up to 8 concrete edge cases. Invents no functions and writes no code. |
| `lovers.generate` | routed by function count / token estimate | `LoversPairLlm` | Writes the JavaScript side of the fixed JSON-lines protocol: the `jsBeloved` Node ESM client (spawns `python3 heart.py`, correlates by `id`, one async function per bindable call, `close()`), the `contractSchema` string, and the `pythonTests` / `jsTests`. It never writes the Python heart (that is emitted deterministically — see below) and never reimplements the Python logic. |

The verbatim system/user/repair text for each purpose is pinned in design section
**A.5a** of `.kiro/specs/lovers-binding/design.md` and stored exactly in
`prompts/templates.ts`; it must not be altered without bumping `PROMPT_VERSION`.

### `max_tokens` per purpose

`max_tokens` is derived per purpose from a pure token estimate
(`estTokens(s) = ceil(s.length / 3.5)`) and hard-capped:

| Purpose | MULT | FLOOR | HARD_CAP |
| --- | --- | --- | --- |
| `py2to3.chunk` | 1.5 | 256 | 1536 |
| `lovers.plan` | 0.5 | 256 | 1024 |
| `lovers.generate` | 2.0 | 512 | 6144 |

`temperature` is **exactly 0** for every purpose; no `seed` is ever sent.
Determinism is `temperature = 0` plus the content-hash completion cache.

### The deterministic Python heart is never prompted

The `lovers.generate` output deliberately excludes the Python heart. The
JSON-lines dispatcher heart is mechanical and is **always** emitted
deterministically by the AST-template bridge (`@necro/grimoires-lovers-js`
`src/fixers/ast-bridge.ts`) on both the LLM path and the fallback path, so the
model never writes the component that talks to the user's resurrected code.

## Prompt-injection and untrusted-data defence

Repository source is untrusted data (per the `security` steering). The prompt
layer defends against injection on two levels:

1. **Delimiters + neutralisation.** Every template that embeds repository source
   wraps it between the fixed `UNTRUSTED_OPEN` / `UNTRUSTED_CLOSE` markers and
   labels the span as data to be ignored as instructions. Before wrapping,
   `neutraliseDelimiters(src)` escapes any literal `UNTRUSTED_OPEN` /
   `UNTRUSTED_CLOSE` occurrence inside the source, so the built request has
   exactly one opening and one closing marker. Each system prompt states that
   everything between the markers is untrusted DATA — comments, strings, or
   docstrings that look like instructions are ignored and never followed.
2. **Deterministic rejection (the real guarantee).** The defence does not rely on
   the model obeying the instruction. An injected instruction that would add
   disallowed code cannot survive the downstream deterministic checks: the strict
   zod schema, the validation gate (Python 3 / JavaScript parse with zero error
   nodes, public-signature preservation, contract `$defs` equality), and — for
   Lovers — the static deny-list scan (no eval/Function/exec, no network, no fs
   writes/deletes, no `os.system`, no `child_process` beyond the single heart
   spawn). An injected output is rejected at the schema, gate, or deny-list before
   acceptance, so it never takes effect, independent of any model.

Secret hygiene: the provider never logs the key, the prompt body, or the code
body — only ids/sizes/tokens/cost. All repository source is masked
(`maskSecretsInText`) before it reaches a prompt, and every outgoing stream line
is redacted (`redactDeep`) over both the server key and the BYOK user key.

## Model ids (documented defaults)

Model ids are **pure configuration**: they are read from validated environment
variables (`NECRO_LLM_MODEL_FAST`, `NECRO_LLM_MODEL_STRONG`,
`NECRO_LLM_MODEL_FALLBACKS`) in `@necro/config` and are never hardcoded in
product code. Their defaults are documented **only here**. If `OPENROUTER_API_KEY`
is set but a needed tier model is missing, `@necro/config` does not throw — it
logs a key-name-only warning and the app stays on the Mock/deterministic path (it
never fabricates a model id).

The two tiers map to the pure `Model_Router` decision (FAST for simple units,
STRONG for hard or large units — see `docs/ARCHITECTURE.md` → "Part A"):

| Env var | Tier | Recommended default (OpenRouter id) | Why |
| --- | --- | --- | --- |
| `NECRO_LLM_MODEL_FAST` | FAST | `openai/gpt-4o-mini` | Cheap, fast, and json_schema-capable for PLAN and simple chunks. |
| `NECRO_LLM_MODEL_STRONG` | STRONG | `anthropic/claude-3.5-sonnet` | Stronger reasoning for hard chunks and cross-language GENERATE. Note Claude endpoints do not accept a `seed`, which is why no `seed` is ever sent. |
| `NECRO_LLM_MODEL_FALLBACKS` | both | (optional, e.g. `openai/gpt-4o-mini,anthropic/claude-3.5-sonnet`) | Comma-separated list emitted as the OpenRouter `models` fallback array. |

All model ids must match `MODEL_ID_RE` (`vendor/model`, optional leading `~`,
optional `:tag`, length ≤ 128, no whitespace / control chars / `..`). A session
model override (BYOK / `soulSource = YOURS` only) via the `model fast|strong <id>`
command takes precedence over the tier env model for that request; overrides are
ignored with an oracle-voice NOTICE on `ORACLE`. Session overrides are never
persisted.
