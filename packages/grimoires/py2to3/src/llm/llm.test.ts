// @necro/grimoires-py2to3 — LLM_Pass contract + retry/timeout/no-key paths.
//
// Task 5.4. This file tests the grimoire's declarative `LLM_STEP` contract
// (buildRequest / outputSchema / apply / mockFixture) TOGETHER WITH a small,
// test-local harness `runLlmPass` that mirrors the Coven_Runner's documented
// LLM_PASS semantics (design: "LLM_Pass"):
//
//   For each remaining residual construct the runner:
//     1. builds a request via `LlmStep.buildRequest`,
//     2. calls `ports.llm.complete(req)`,
//     3. parses the result text with `LlmStep.outputSchema` (R4.3); on a zod
//        failure it RETRIES ONCE, and a second failure records an
//        `llm_invalid_output` residual (R4.4),
//     4. a timeout/unavailable error from the port records an `llm_unavailable`
//        residual (R4.5),
//     5. with NO `LlmPort` injected the whole pass is skipped and every
//        incoming residual is RETAINED unchanged (R4.6, Degraded_Mode).
//
// The real runner (packages/coven/src/runners/local.ts) is being built
// concurrently in task 11.1 and its own integration unit tests live in task
// 11.2. Until it lands, `runLlmPass` below is a faithful, minimal local stand-in
// for ONLY the LLM_PASS step so this task can lock the grimoire contract and the
// Residual_List shape. It performs no network/LLM/sandbox work: the `LlmPort`
// is always a hand-written fake or the deterministic Mock provider.
//
// Property 8 (Residual_List completeness and well-formedness) is covered as an
// example and a fast-check property seed: the number of residuals equals the
// number of attempted-but-unconfirmed conversions, and zero residuals means the
// file is fully converted (R8.1, R8.2, R8.3).

import {
  covenError,
  type LlmConstructInput,
  type LlmPort,
  type LlmResult,
  type ResidualEntry,
} from "@necro/coven";
import { createMockLlmPort } from "@necro/llm";
import { NecroError } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LLM_STEP,
  OutputSchema,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
} from "./index.js";

// ---------------------------------------------------------------------------
// Test-local harness: mirrors the runner's LLM_PASS step (design: "LLM_Pass").
// ---------------------------------------------------------------------------

/** One construct the Pre_Pass left unconverted, with its source location. */
interface PendingConstruct extends LlmConstructInput {
  /** 1-based source line the Pre_Pass recorded for this construct (R8.1). */
  readonly line: number;
}

/** The outcome of the harness for one file's LLM_PASS. */
interface LlmPassResult {
  /** Converted source spans, in input order, for confirmed constructs. */
  readonly converted: string[];
  /** Residuals for constructs that could not be confirmed (R8.1–R8.3). */
  readonly residuals: ResidualEntry[];
}

/**
 * Drive the grimoire `LLM_STEP` over a list of pending constructs exactly as the
 * runner's LLM_PASS does. This is intentionally small and local to the test; the
 * real runner (task 11.1) owns the production implementation and is covered by
 * task 11.2. The harness encodes only the four documented behaviours:
 *
 *  - no `llm` port  => skip, retain every incoming construct as its residual
 *                      (`reason` carried from the Pre_Pass) unchanged (R4.6);
 *  - zod ok         => apply and count as converted;
 *  - zod fails once => retry once; still fails => `llm_invalid_output` (R4.4);
 *  - port throws    => `llm_unavailable` (R4.5).
 */
async function runLlmPass(
  llm: LlmPort | undefined,
  pending: readonly PendingConstruct[],
  // The residual reason the Pre_Pass attached to each pending construct; in
  // Degraded_Mode (no port) these are retained verbatim (R4.6).
  incomingReason: ResidualEntry["reason"] = "no_transform",
): Promise<LlmPassResult> {
  const converted: string[] = [];
  const residuals: ResidualEntry[] = [];

  // R4.6 Degraded_Mode: no port => skip the whole pass, retain every residual.
  if (!llm) {
    for (const c of pending) {
      residuals.push({
        path: c.path,
        line: c.line,
        construct: c.construct,
        reason: incomingReason,
      });
    }
    return { converted, residuals };
  }

  for (const c of pending) {
    const req = LLM_STEP.buildRequest(c);

    // Attempt + one retry on zod failure (R4.4); a thrown error short-circuits
    // to llm_unavailable (R4.5).
    try {
      const first = await llm.complete(req);
      const parsedFirst = OutputSchema.safeParse(safeJson(first.text));
      if (parsedFirst.success) {
        converted.push(LLM_STEP.apply(c.source, parsedFirst.data));
        continue;
      }
      // Retry exactly once with the same request.
      const second = await llm.complete(req);
      const parsedSecond = OutputSchema.safeParse(safeJson(second.text));
      if (parsedSecond.success) {
        converted.push(LLM_STEP.apply(c.source, parsedSecond.data));
        continue;
      }
      // Second zod failure => unconverted residual (R4.4).
      residuals.push({
        path: c.path,
        line: c.line,
        construct: c.construct,
        reason: "llm_invalid_output",
      });
    } catch {
      // Timeout / unavailable => unconverted residual (R4.5). The thrown value
      // is a typed NecroError; the runner maps it to a code without leaking it.
      residuals.push({
        path: c.path,
        line: c.line,
        construct: c.construct,
        reason: "llm_unavailable",
      });
    }
  }

  return { converted, residuals };
}

/** Parse JSON text defensively; non-JSON yields a value zod will reject. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Fake LlmPort stubs (no network, no real provider).
// ---------------------------------------------------------------------------

/** A port whose every completion returns the same fixed text. */
function fixedPort(text: string): LlmPort {
  return {
    providerId: "mock",
    complete(): Promise<LlmResult> {
      return Promise.resolve({ text, cached: false });
    },
  };
}

/** A port that always throws a typed timeout/unavailable NecroError (R4.5). */
function throwingPort(
  code: "NETWORK_TIMEOUT" | "UPSTREAM_UNAVAILABLE",
): LlmPort {
  return {
    providerId: "mock",
    complete(): Promise<LlmResult> {
      return Promise.reject(
        covenError(code, "The spirits did not answer in time."),
      );
    },
  };
}

/** A pending construct at a given 1-based line (defaults to a valid line). */
function pending(
  overrides: Partial<PendingConstruct> = {},
): PendingConstruct {
  return {
    path: overrides.path ?? "ghost.py",
    construct: overrides.construct ?? "print_statement",
    source: overrides.source ?? "x = 1",
    line: overrides.line ?? 1,
  };
}

// ---------------------------------------------------------------------------
// R4.4 — zod failure, retry once, then llm_invalid_output
// ---------------------------------------------------------------------------

describe("R4.4: zod failure is retried once, then recorded llm_invalid_output", () => {
  it("records a single llm_invalid_output residual after two zod failures", async () => {
    // Output missing the required `converted` field => fails OutputSchema twice.
    const port = fixedPort(JSON.stringify({ wrong: "shape" }));
    const result = await runLlmPass(port, [pending()]);

    expect(result.converted).toHaveLength(0);
    expect(result.residuals).toHaveLength(1);
    expect(result.residuals[0]?.reason).toBe("llm_invalid_output");
  });

  it("converts when the FIRST response is already schema-valid (no residual)", async () => {
    const port = fixedPort(JSON.stringify({ converted: "x = 1" }));
    const result = await runLlmPass(port, [pending({ source: "x = 1" })]);

    expect(result.residuals).toHaveLength(0);
    expect(result.converted).toEqual(["x = 1"]);
  });

  it("extra fields fail `.strict()` and still resolve to llm_invalid_output", async () => {
    // A drifting model that adds an extra key: `.strict()` rejects it twice.
    const port = fixedPort(JSON.stringify({ converted: "x = 1", note: "hi" }));
    const result = await runLlmPass(port, [pending()]);

    expect(result.residuals[0]?.reason).toBe("llm_invalid_output");
  });
});

// ---------------------------------------------------------------------------
// R4.5 — timeout / unavailable => llm_unavailable
// ---------------------------------------------------------------------------

describe("R4.5: a timeout/unavailable error yields an llm_unavailable residual", () => {
  it("maps a thrown NETWORK_TIMEOUT to llm_unavailable", async () => {
    const result = await runLlmPass(throwingPort("NETWORK_TIMEOUT"), [
      pending(),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.residuals).toHaveLength(1);
    expect(result.residuals[0]?.reason).toBe("llm_unavailable");
  });

  it("maps a thrown UPSTREAM_UNAVAILABLE to llm_unavailable", async () => {
    const result = await runLlmPass(throwingPort("UPSTREAM_UNAVAILABLE"), [
      pending(),
    ]);

    expect(result.residuals[0]?.reason).toBe("llm_unavailable");
  });

  it("the error the port raises is a typed NecroError with a non-empty code", async () => {
    // Guards the assumption the runner relies on when mapping errors (R4.5).
    const port = throwingPort("NETWORK_TIMEOUT");
    await expect(port.complete(LLM_STEP.buildRequest(pending()))).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof NecroError && typeof e.code === "string" && e.code.length > 0,
    );
  });
});

// ---------------------------------------------------------------------------
// R4.6 — no key / no LlmPort => skip, retain residuals unchanged
// ---------------------------------------------------------------------------

describe("R4.6: with no LlmPort the pass is skipped and residuals are retained", () => {
  it("retains every incoming construct as a residual with its Pre_Pass reason", async () => {
    const constructs = [
      pending({ path: "a.py", construct: "print_statement", line: 3 }),
      pending({ path: "b.py", construct: "except_comma", line: 12 }),
    ];
    const result = await runLlmPass(undefined, constructs, "no_transform");

    expect(result.converted).toHaveLength(0);
    expect(result.residuals).toHaveLength(constructs.length);
    expect(result.residuals.map((r) => r.reason)).toEqual([
      "no_transform",
      "no_transform",
    ]);
    // The path/line/construct are carried through UNCHANGED (R4.6).
    expect(result.residuals.map((r) => `${r.path}:${r.line}:${r.construct}`)).toEqual([
      "a.py:3:print_statement",
      "b.py:12:except_comma",
    ]);
  });

  it("an empty pending list with no port yields zero residuals (nothing to retain)", async () => {
    const result = await runLlmPass(undefined, []);
    expect(result.residuals).toHaveLength(0);
    expect(result.converted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Happy path via the deterministic Mock provider (R4.7, R4.8)
// ---------------------------------------------------------------------------

describe("Mock provider happy path: deterministic no-op conversion, no residuals", () => {
  it("drives LLM_STEP end-to-end through createMockLlmPort with zero residuals", async () => {
    // The grimoire's `mockFixture` returns {"converted": <original source>} for
    // the ORIGINAL (unmasked) construct — this is how the runner wires the Mock
    // provider (design: LLM_Pass). `buildRequest` masks the source before it
    // enters the prompt (R4.2), so the fixture cannot be recovered from the
    // prompt body; the runner supplies it from the construct directly, which we
    // mirror here with a per-construct Mock whose output is the pinned fixture.
    const c = pending({ source: "d.items()", construct: "dict_iter" });
    const port = createMockLlmPort({
      respond: () => LLM_STEP.mockFixture(c),
    });

    const result = await runLlmPass(port, [c]);

    // The deterministic no-op fixture returns the source verbatim, so the file
    // is fully converted with no residuals (R4.7, R4.8, R8.3).
    expect(result.residuals).toHaveLength(0);
    expect(result.converted).toEqual(["d.items()"]);
  });
});

/**
 * Pull the inner untrusted body from a buildRequest prompt — the span between
 * the `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE` markers, mirroring the Mock provider's
 * `defaultMockText`. The shared `py2to3.chunk` template now wraps the masked
 * source inside a `chunkId`/diagnostics preamble, so the body is located by the
 * markers (not by the first/last newline of the whole prompt).
 */
function extractBody(prompt: string): string {
  const openIdx = prompt.indexOf(UNTRUSTED_OPEN);
  if (openIdx === -1) return prompt;
  const bodyStart = prompt.indexOf("\n", openIdx);
  if (bodyStart === -1) return prompt;
  const closeIdx = prompt.indexOf(UNTRUSTED_CLOSE, bodyStart);
  const body =
    closeIdx === -1
      ? prompt.slice(bodyStart + 1)
      : prompt.slice(bodyStart + 1, closeIdx);
  return body.endsWith("\n") ? body.slice(0, -1) : body;
}

// ---------------------------------------------------------------------------
// R8.1 — Residual_List entries carry a valid path and non-negative line
// ---------------------------------------------------------------------------

describe("R8.1: every residual carries a valid path and a non-negative line", () => {
  it("residuals from each failure path have a non-empty path and line >= 0", async () => {
    const invalid = await runLlmPass(fixedPort("not json"), [
      pending({ path: "x.py", line: 7 }),
    ]);
    const unavailable = await runLlmPass(throwingPort("NETWORK_TIMEOUT"), [
      pending({ path: "y.py", line: 0 }),
    ]);
    const retained = await runLlmPass(undefined, [pending({ path: "z.py", line: 42 })]);

    for (const r of [...invalid.residuals, ...unavailable.residuals, ...retained.residuals]) {
      expect(r.path.length).toBeGreaterThan(0);
      expect(Number.isInteger(r.line)).toBe(true);
      expect(r.line).toBeGreaterThanOrEqual(0);
      expect(r.construct.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 8: Residual_List completeness and well-formedness (R8.1–R8.3)
//
// For any mix of pending constructs and a port that confirms some and fails
// others, the residual count equals the number of attempted-but-unconfirmed
// conversions, and zero residuals means the file is fully converted.
// ---------------------------------------------------------------------------

/** fully-converted, per R8.3: a file is fully converted iff it has no residuals. */
const fullyConverted = (r: LlmPassResult): boolean => r.residuals.length === 0;

describe("P8 (R8.1, R8.2, R8.3): Residual_List completeness and well-formedness", () => {
  // Example seed: three constructs, one convertible and two not, over a port
  // that only produces a valid conversion for the construct source "ok".
  it("example seed: residual count equals the attempted-but-unconfirmed count", async () => {
    // `buildRequest` masks the source (R4.2: first 4 chars + "****"), so the
    // port keys its decision on a prefix that survives masking: a body opening
    // with "OKAY" converts, anything else drifts and becomes a residual.
    const selective: LlmPort = {
      providerId: "mock",
      complete(req) {
        const ok = extractBody(req.prompt).startsWith("OKAY");
        return Promise.resolve({
          text: ok
            ? JSON.stringify({ converted: "OKAY" })
            : JSON.stringify({ drift: true }),
          cached: false,
        });
      },
    };

    const constructs = [
      pending({ path: "a.py", source: "OKAY value", line: 1 }),
      pending({ path: "b.py", source: "bad construct one", line: 2 }),
      pending({ path: "c.py", source: "bad construct two", line: 3 }),
    ];
    const result = await runLlmPass(selective, constructs);

    // Exactly one converts; the other two are attempted-but-unconfirmed.
    expect(result.converted).toHaveLength(1);
    const attemptedUnconfirmed = constructs.length - result.converted.length;
    expect(result.residuals).toHaveLength(attemptedUnconfirmed);
    // Not fully converted while residuals remain (R8.3).
    expect(fullyConverted(result)).toBe(false);
  });

  it("property: residuals == attempted-but-unconfirmed; zero residuals <=> fully converted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            // `confirm` decides whether the port returns a schema-valid output
            // for this construct, so the test controls exactly how many convert.
            confirm: fc.boolean(),
            path: fc
              .stringOf(fc.constantFrom(..."abcdefghij".split("")), {
                minLength: 1,
                maxLength: 5,
              })
              .map((s) => `${s}.py`),
            line: fc.integer({ min: 0, max: 9999 }),
            construct: fc.constantFrom(
              "print_statement",
              "except_comma",
              "long_literal",
            ),
          }),
          { minLength: 0, maxLength: 12 },
        ),
        async (specs) => {
          // Encode the per-construct confirm decision into the source so the
          // port can decide deterministically from the request body alone.
          const constructs: PendingConstruct[] = specs.map((s, i) => ({
            path: s.path,
            line: s.line,
            construct: s.construct,
            source: s.confirm ? `OK_${i}` : `DRIFT_${i}`,
          }));

          const port: LlmPort = {
            providerId: "mock",
            complete(req) {
              const body = extractBody(req.prompt);
              const ok = body.startsWith("OK_");
              return Promise.resolve({
                text: ok
                  ? JSON.stringify({ converted: body })
                  : "::not-valid-json::",
                cached: false,
              });
            },
          };

          const result = await runLlmPass(port, constructs);

          const expectedConverted = specs.filter((s) => s.confirm).length;
          const attemptedUnconfirmed = constructs.length - expectedConverted;

          // Completeness (R8.2): one residual per attempted-but-unconfirmed.
          expect(result.converted).toHaveLength(expectedConverted);
          expect(result.residuals).toHaveLength(attemptedUnconfirmed);

          // Well-formedness (R8.1): valid path + non-negative line + construct.
          for (const r of result.residuals) {
            expect(r.path.length).toBeGreaterThan(0);
            expect(r.line).toBeGreaterThanOrEqual(0);
            expect(r.construct.length).toBeGreaterThan(0);
            expect(r.reason).toBe("llm_invalid_output");
          }

          // R8.3: zero residuals iff fully converted.
          expect(fullyConverted(result)).toBe(attemptedUnconfirmed === 0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
