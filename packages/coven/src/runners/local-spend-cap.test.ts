//
// Item 20 (P0.5): spend-ceiling coverage — the per-reading LLM call cap.
//
// NECRO_LLM_MAX_CALLS_PER_READING bounds the TOTAL number of model calls across
// the WHOLE reading (every chunk of every file), not per-chunk. Once the cap is
// reached, every remaining chunk keeps its deterministic result with reason
// `cap_reached` and makes NO further model call (R36.1/R36.2). This was wired
// (SEC-06) but had no runner-level test; this drives the real LocalCovenRunner
// chunk path with a recording LlmPort and asserts the hard bound.
//
// Offline: a hand-built chunk-capable stub grimoire + a fake router + a
// recording in-memory LlmPort. The real oracle parser is armed once (the
// chunker + gate parse locally); no network / LLM / sandbox.
import {
  buildSnapshotFromFileMap,
  initParser,
  type CardDraw,
  type Evidence,
  type Reading,
  type RepoMeta,
  type RepoRef,
  type RepoSnapshot,
} from "@necro/oracle";
import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";

import { LocalCovenRunner, type PhaseEmit } from "./local.js";
import { LanguagePairRegistry } from "../registry.js";
import { LanguagePairIdSchema, type RitualInput } from "../models.js";
import type {
  ChunkRequestInput,
  ClockPort,
  Grimoire,
  LedgerPort,
  LlmPort,
  ModelRouterPort,
  RitualPorts,
} from "../ports.js";

const REF: RepoRef = { owner: "g", name: "d", sha: "0".repeat(40), defaultBranch: "main" };
const META: RepoMeta = {
  pushedAt: null, isArchived: false, openIssueCount: 0, openPRCount: 0,
  oldestOpenPRAgeDays: null, latestReleaseAt: null, licenseKey: null,
};
const NOW = "2024-01-01T00:00:00.000Z";
const PAIR_ID = LanguagePairIdSchema.parse("python2->python3");

// A source with TWO top-level defs, each holding a py2 print on a known line,
// so groupResiduals yields TWO chunks (one per enclosing unit).
const SOURCE = [
  "def a():",            // 1
  "    print 'a'",       // 2  <- residual in unit a
  "",                    // 3
  "def b():",            // 4
  "    print 'b'",       // 5  <- residual in unit b
  "",                    // 6
].join("\n");

function py2Evidence(path: string, line: number): Evidence {
  return { kind: "print_statement", path, line, detail: "legacy print", source: "static" };
}
function judgementDraw(path: string): CardDraw {
  return {
    card: "judgement" as CardDraw["card"],
    severity: 2,
    orientation: "reversed",
    evidence: [py2Evidence(path, 2), py2Evidence(path, 5)],
    summary: "legacy py2",
    grimoires: [],
  };
}
function reading(): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repo: REF, draws: [judgementDraw("legacy.py")], spread: [], vitality: 50,
    createdAt: NOW, engineVersion: "0.0.0", errors: [],
  };
}
function snapshot(): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, { "legacy.py": SOURCE }, { meta: META, createdAt: NOW });
}
function ritualInput(): RitualInput {
  return {
    pairId: PAIR_ID, snapshot: snapshot(), reading: reading(),
    target: { kind: "bare" }, spread: "necropsy", now: NOW, demo: false,
  };
}

/** A chunk-capable stub grimoire: a fixer that leaves one residual per def, and
 *  a chunk step whose gate ALWAYS rejects (so every chunk would burn its full
 *  2-call retry budget if the per-reading cap did not stop it first). */
function chunkGrimoire(): Grimoire {
  const editSchema = z.object({ chunkId: z.string(), confidence: z.number() });
  return {
    id: "stub",
    pair: { from: "python2", to: "python3" } as unknown as Grimoire["pair"],
    inputSchema: z.object({ path: z.string(), before: z.string() }) as unknown as Grimoire["inputSchema"],
    outputSchema: z.object({
      path: z.string(), before: z.string(), after: z.string(),
      diff: z.array(z.unknown()), residuals: z.array(z.unknown()),
      fullyConverted: z.boolean(), validated: z.boolean(),
    }) as unknown as Grimoire["outputSchema"],
    // Leave the source unchanged but report a residual inside each def.
    fixers: [
      (source, ctx) => ({
        after: source,
        residuals: [
          { path: ctx.path, line: 2, construct: "print_statement", reason: "no_transform" as const },
          { path: ctx.path, line: 5, construct: "print_statement", reason: "no_transform" as const },
        ],
      }),
    ],
    // Legacy single-tier LLM step (unused on the chunk path but required by the type).
    llm: {
      outputSchema: z.object({ converted: z.boolean() }) as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: () => ({ system: "s", prompt: "p", maxTokens: 16, timeoutMs: 1000, cacheKey: "legacy" }),
      apply: (source) => source,
      mockFixture: () => "{}",
    },
    // The chunked Part B step: build a request (distinct cache key per chunk),
    // and a gate that ALWAYS rejects so retries would be attempted.
    chunk: {
      outputSchema: editSchema as unknown as NonNullable<Grimoire["chunk"]>["outputSchema"],
      buildRequest: (input: ChunkRequestInput) => ({
        system: "chunk",
        prompt: `fix ${input.chunkId}`,
        maxTokens: 16,
        timeoutMs: 1000,
        cacheKey: `chunk:${input.chunkId}`,
      }),
      accept: () => ({ status: "reject", reason: "still legacy" }),
      mockFixture: () => '{"chunkId":"x","confidence":0.9}',
    } as unknown as NonNullable<Grimoire["chunk"]>,
    validate: () => ({ valid: true, errorNodeCount: 0 }),
    divergenceAllowlist: [],
  };
}

function registryWith(g: Grimoire): LanguagePairRegistry {
  const r = new LanguagePairRegistry();
  r.register(PAIR_ID, g);
  return r;
}

/** A frozen clock (budgets never trip from time, so the CAP is the only limit). */
const clock: ClockPort = { nowMs: () => 1_000_000 };
const ledger: LedgerPort = { append: async () => undefined };
const router: ModelRouterPort = {
  route: () => "FAST",
  resolveModel: (tier) => (tier === "STRONG" ? "vendor/strong" : "vendor/fast"),
};
function makeEmit(): PhaseEmit {
  return { phase: () => {}, skipNote: () => {} };
}

beforeAll(async () => {
  await initParser();
});

describe("Item 20 (R36.1/R36.2): the per-reading LLM call cap bounds TOTAL model calls", () => {
  it("never calls llm.complete more than maxLlmCallsPerReading across all chunks", async () => {
    // A recording LlmPort that always returns a parseable (but gate-rejected)
    // edit, so each attempted chunk would retry (2 calls) absent the cap.
    const calls: string[] = [];
    const llm: LlmPort = {
      providerId: "mock",
      async complete(req) {
        calls.push(req.cacheKey);
        return { text: '{"chunkId":"x","confidence":0.9}', cached: false };
      },
    };

    // Cap = 2. There are TWO chunks, each of which would make 2 calls (initial
    // + retry) = 4 without the cap. With the cap, chunk 1 burns both calls and
    // chunk 2 is kept deterministically (`cap_reached`) with ZERO calls.
    const runner = new LocalCovenRunner(registryWith(chunkGrimoire()), {
      maxLlmCallsPerReading: 2,
    });
    const ports: RitualPorts = { clock, ledger, llm, router };

    const outcome = await runner.run(ritualInput(), ports, makeEmit());

    expect(outcome.error).toBeNull();
    // The hard bound: TOTAL calls across both chunks is at most the cap.
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.length).toBe(2);
  });

  it("a generous cap lets BOTH chunks attempt their full retry budget (2 each = 4)", async () => {
    const calls: string[] = [];
    const llm: LlmPort = {
      providerId: "mock",
      async complete(req) {
        calls.push(req.cacheKey);
        return { text: '{"chunkId":"x","confidence":0.9}', cached: false };
      },
    };
    const runner = new LocalCovenRunner(registryWith(chunkGrimoire()), {
      maxLlmCallsPerReading: 100,
    });
    const ports: RitualPorts = { clock, ledger, llm, router };

    const outcome = await runner.run(ritualInput(), ports, makeEmit());
    expect(outcome.error).toBeNull();
    // Two chunks x (initial + one retry) = 4 calls when the cap is not binding.
    expect(calls.length).toBe(4);
  });
});
