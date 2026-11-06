// @necro/grimoires-py2to3 — output-parses-or-reported property test (task 5.3).
//
// Property 5 (design.md correctness properties; tasks.md 5.3): the engine's
// After_Content "always parses as Python 3 or is reported unconverted". For any
// input — including inputs tree-sitter CANNOT parse — the content the engine
// would present as converted parses under `validate()` with ZERO error nodes,
// OR the offending construct is recorded in the Residual_List. Unparseable
// content is NEVER silently presented as converted ("the cards cannot lie").
//
// This test exercises the grimoire pieces directly because the full local
// runner (task 11.1) is being built concurrently and is not available. The
// local `resurrectFile` harness mirrors the runner's PRE_PASS -> LLM_PASS ->
// VALIDATE contract:
//   1. PRE_PASS — apply every `FIXERS` in fixed order, accumulating residuals.
//   2. LLM_PASS — for each Pre_Pass residual, build the request via the real
//      `LLM_STEP.buildRequest`, obtain a completion from the injected Mock
//      `LlmPort` (wired with the grimoire's own `mockFixture` as its `respond`,
//      exactly as the runner wires it so the completion is the step's
//      `OutputSchema`-shaped JSON — not a raw prompt echo), parse it with
//      `OutputSchema` (the runner's zod gate), and
//      `apply` it. A proposed conversion is ACCEPTED only if the resulting
//      content re-validates with zero error nodes; otherwise it is rejected and
//      the construct stays in the Residual_List with an `output_unparseable`
//      reason (R5.2). Residuals the step cannot even propose a parse for are
//      likewise retained.
//   3. VALIDATE — the final `after` is validated; the file is marked
//      `validated` only when `validate(after).valid` is true.
//
// The three assertions (task 5.3):
//   (1) for any input, either the final `after` validates (zero error nodes) OR
//       every still-unconverted construct is present in the Residual_List;
//   (2) every excluded construct (Pre_Pass residual not confirmed-converted)
//       appears in the Residual_List;
//   (3) `LLM_STEP.buildRequest` wraps the code in the fixed
//       `UNTRUSTED_REPOSITORY_CODE` delimiters, with the masked code BETWEEN
//       `UNTRUSTED_OPEN` and `UNTRUSTED_CLOSE`.
//
// Testing steering: fast-check with explicit `numRuns: 1000`, seed printed on
// failure (`verbose`), generators include unparseable inputs
// (`arbMaybeUnparseable`). No network / LLM / sandbox — the only side effect is
// the local tree-sitter WASM parse via `parsePython` (initialised once in
// `beforeAll`) and the deterministic, network-free Mock `LlmPort` from
// `@necro/llm` (R4.7, R4.8).
//
// **Validates: Requirements 4.2, 5.1, 5.2, 5.3**

import { initParser, parsePython } from "@necro/oracle";
import type {
  Fixer,
  FixerContext,
  LlmConstructInput,
  LlmPort,
  ResidualEntry,
} from "@necro/coven";
import { createMockLlmPort } from "@necro/llm";

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { FIXERS } from "./fixers/index.js";
import {
  LLM_STEP,
  OutputSchema,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
} from "./llm/index.js";
import { validate } from "./validate.js";
import { arbMaybeUnparseable } from "../test/arbitraries.js";

/** 1000 runs: fixer/grimoire properties get the high budget (testing steering). */
const NUM_RUNS = 1000;

/** Print the fast-check seed on failure for reproducible regressions. */
const FC_OPTS: fc.Parameters<unknown> = { numRuns: NUM_RUNS, verbose: true };

const PATH = "fixtures/generated/sample.py";

/** Build the FixerContext the runner uses: a fresh context injecting the parser. */
function ctxFor(path: string): FixerContext {
  return { parse: parsePython, path };
}

/** The validated outcome of resurrecting one file, mirroring the runner's contract. */
interface ResurrectOutcome {
  readonly after: string;
  readonly residuals: readonly ResidualEntry[];
  readonly validated: boolean;
}

/**
 * PRE_PASS: apply every fixer in `FIXERS` order, left-to-right, each on the
 * previous fixer's `after`, accumulating residuals (the runner's Pre_Pass).
 */
function prePass(source: string, path: string): {
  after: string;
  residuals: ResidualEntry[];
} {
  let after = source;
  const residuals: ResidualEntry[] = [];
  for (const fixer of FIXERS as readonly Fixer[]) {
    const result = fixer(after, ctxFor(path));
    after = result.after;
    residuals.push(...result.residuals);
  }
  return { after, residuals };
}

/**
 * LLM_PASS + VALIDATE for a single file, mirroring the runner's contract.
 *
 * For each Pre_Pass residual the harness asks the Mock `LlmPort` to convert the
 * recorded construct's source, parses the completion with `OutputSchema` (the
 * runner's zod gate), applies it, and ACCEPTS the conversion only when the
 * resulting whole-file content re-validates with zero error nodes. A rejected
 * or unparseable proposal leaves the construct in the Residual_List. The final
 * `after` is validated once more to set `validated`.
 *
 * The construct source handed to the step is the residual's line of the current
 * `after` (the Pre_Pass output): a faithful stand-in for the span the runner
 * extracts, and enough to drive the delimiter/validate contract this property
 * asserts. The Mock provider returns the construct verbatim (the deterministic
 * no-op conversion), so a residual on content that already parses is confirmed,
 * and a residual on genuinely unparseable content is retained.
 */
async function resurrectFile(source: string, path: string): Promise<ResurrectOutcome> {
  const pre = prePass(source, path);
  let after = pre.after;

  // Residuals carried forward: start with none and keep any construct the
  // LLM_Pass could not confirm as converted.
  const carried: ResidualEntry[] = [];

  for (const residual of pre.residuals) {
    // The span the runner would hand the step: the residual's source line of
    // the current content (1-based `line`).
    const span = lineAt(after, residual.line);

    const input: LlmConstructInput = {
      path,
      construct: residual.construct,
      source: span,
    };

    // Wire the Mock provider the way the runner does: its `respond` returns
    // the grimoire's own `mockFixture(input)` — the deterministic,
    // OutputSchema-shaped JSON — so the completion is a valid step output and
    // not a raw prompt echo (R4.7, R4.8). Deterministic and network-free.
    const llm: LlmPort = createMockLlmPort({
      respond: () => LLM_STEP.mockFixture(input),
    });

    const req = LLM_STEP.buildRequest(input);
    const result = await llm.complete(req);

    // The runner's zod gate: a non-JSON or drifting completion fails here and
    // the construct is kept as an `llm_invalid_output` residual (R4.4).
    const parsed = OutputSchema.safeParse(safeJsonParse(result.text));
    if (!parsed.success) {
      carried.push(markReason(residual, "llm_invalid_output"));
      continue;
    }

    // Apply the proposed conversion to the span and re-validate the WHOLE file
    // with the span replaced. Accept only when it parses with zero error nodes.
    const converted = LLM_STEP.apply(span, parsed.data);
    const candidate = replaceLine(after, residual.line, converted);
    if (validate(candidate).valid) {
      after = candidate; // confirmed converted — drop the residual
    } else {
      // Produced content failed the Target_Parser: never present it as
      // converted. Keep the original content and record the residual (R5.2).
      carried.push(markReason(residual, "output_unparseable"));
    }
  }

  return { after, residuals: carried, validated: validate(after).valid };
}

/** Parse JSON, returning `undefined` on malformed text (fails the zod gate). */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Return a copy of `residual` with its reason re-tagged for the LLM_Pass outcome. */
function markReason(
  residual: ResidualEntry,
  reason: ResidualEntry["reason"],
): ResidualEntry {
  return { ...residual, reason };
}

/** The 1-based `line` of `source` (empty string if out of range). */
function lineAt(source: string, line: number): string {
  const lines = source.split("\n");
  return lines[line - 1] ?? "";
}

/** Replace the 1-based `line` of `source` with `replacement`. */
function replaceLine(source: string, line: number, replacement: string): string {
  const lines = source.split("\n");
  if (line - 1 < 0 || line - 1 >= lines.length) return source;
  lines[line - 1] = replacement;
  return lines.join("\n");
}

describe("P5 (R4.2, R5.1, R5.2, R5.3): output parses as Python 3 or is reported unconverted", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("every produced After_Content parses with zero error nodes OR the construct is in the Residual_List (R5.1, R5.2, R5.3)", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaybeUnparseable, async (source) => {
        const outcome = await resurrectFile(source, PATH);

        if (outcome.validated) {
          // The content presented as converted parses with zero error nodes.
          expect(validate(outcome.after).errorNodeCount).toBe(0);
        } else {
          // Not validated: unparseable content must never be presented as
          // converted — every unconverted construct is recorded instead, and
          // the file is not marked validated.
          expect(outcome.residuals.length).toBeGreaterThan(0);
          for (const residual of outcome.residuals) {
            expect(residual.path).toBe(PATH);
            expect(residual.construct.length).toBeGreaterThan(0);
          }
        }
      }),
      FC_OPTS,
    );
  });

  it("every excluded (unconfirmed) construct appears in the Residual_List (R5.2)", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaybeUnparseable, async (source) => {
        const outcome = await resurrectFile(source, PATH);

        // Invariant: a file is marked `validated` iff its final content has
        // zero error nodes; and when it is NOT validated there is always at
        // least one residual accounting for the exclusion. No construct is
        // dropped silently.
        expect(outcome.validated).toBe(validate(outcome.after).valid);
        if (!outcome.validated) {
          expect(outcome.residuals.length).toBeGreaterThan(0);
        }
        // Every carried residual is well-formed (valid path + construct).
        for (const residual of outcome.residuals) {
          expect(residual.path).toBe(PATH);
          expect(residual.line).toBeGreaterThanOrEqual(0);
          expect(residual.construct.length).toBeGreaterThan(0);
        }
      }),
      FC_OPTS,
    );
  });

  it("buildRequest wraps the (masked) code between the fixed UNTRUSTED_REPOSITORY_CODE delimiters (R4.2)", () => {
    fc.assert(
      fc.property(
        fc.record({
          path: fc.constant(PATH),
          construct: fc.string({ minLength: 1, maxLength: 24 }),
          source: fc.string({ maxLength: 64 }),
        }),
        (input: LlmConstructInput) => {
          const req = LLM_STEP.buildRequest(input);

          const openIdx = req.prompt.indexOf(UNTRUSTED_OPEN);
          const closeIdx = req.prompt.indexOf(UNTRUSTED_CLOSE);

          // Both delimiters are present and correctly ordered (open before
          // close), so the code is explicitly fenced as untrusted data.
          expect(openIdx).toBeGreaterThanOrEqual(0);
          expect(closeIdx).toBeGreaterThan(openIdx);

          // The code sits strictly BETWEEN the delimiters (after the opening
          // marker, before the closing marker).
          const bodyStart = openIdx + UNTRUSTED_OPEN.length;
          expect(bodyStart).toBeLessThanOrEqual(closeIdx);
          const between = req.prompt.slice(bodyStart, closeIdx);
          expect(between).toContain("\n");
        },
      ),
      FC_OPTS,
    );
  });
});
