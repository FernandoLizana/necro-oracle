# Implementation Plan: Fix tree-sitter WASM tracing on Vercel

Production bug: `POST /api/readings` fails at READING with `PARSER_INIT_FAILED` on Vercel
because `tree-sitter-python.wasm` is not traced into the serverless function (fragile globs
emit non-existent hoisted paths and miss the real pnpm `.pnpm` path). `/api/resurrect` has the
same latent gap. Both handler catch blocks swallow the error (no server-side log).

## Tasks

- [x] 1. Log, trace, guard, and configure the Vercel WASM fix
  - Add `console.error` (message + stack + NecroError code only; NO secrets, no body/token/env)
    in the `readings.ts` runPipeline catch block and the `resurrect.ts` terminateError closure.
  - Rewrite `apps/web/next.config.ts` tracing: resolve the real `tree-sitter-python.wasm` and
    `web-tree-sitter.wasm` paths via createRequire at config time, include them (relative to
    outputFileTracingRoot) for BOTH `/api/readings` and `/api/resurrect`, keeping the globs as
    fallback. Export a pure includes map/helper so it is unit-testable.
  - Add `apps/web/scripts/check-wasm-trace.mjs` (fails if either route trace lacks a REAL
    existing web-tree-sitter.wasm or tree-sitter-python.wasm) + a `check:wasm-trace` script.
  - Add a vitest `apps/web/src/server/wasm-trace.config.test.ts` asserting both routes include
    both wasm references.
  - Add `apps/web/vercel.json` with the buildCommand.
  - Verify: oracle build, web build, the trace-check script (must pass for both routes),
    web typecheck/lint/test, oracle test.
  - _Requirements: production parity — the grammar wasm must be packaged into /api/readings
    and /api/resurrect lambdas; errors must be observable in Vercel logs._
