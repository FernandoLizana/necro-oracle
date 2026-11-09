//
// Item 24 (P0.5): the per-request BYOK model override on RitualInput must be
// threaded to ModelRouterPort.resolveModel(tier, override) by the chunked
// LLM_Pass. Previously the runner called resolveModel(tier) with NO override,
// so a user-supplied `model fast|strong <id>` (carried on RitualInput.
// modelOverride when soulSource = YOURS) was silently dropped on the resurrect
// path.
//
// Offline: a chunk-capable stub grimoire + a router whose resolveModel records
// the (tier, override) it receives + a trivial LlmPort. Real oracle parser.
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
  ModelTier,
  RitualPorts,
} from "../ports.js";

const REF: RepoRef = { owner: "g", name: "d", sha: "0".repeat(40), defaultBranch: "main" };
const META: RepoMeta = {
  pushedAt: null, isArchived: false, openIssueCount: 0, openPRCount: 0,
  oldestOpenPRAgeDays: null, latestReleaseAt: null, licenseKey: null,
};
const NOW = "2024-01-01T00:00:00.000Z";
const PAIR_ID = LanguagePairIdSchema.parse("python2->python3");
const SOURCE = "def a():\n    print 'a'\n";

function evidence(path: string): Evidence {
  return { kind: "print_statement", path, line: 2, detail: "legacy print", source: "static" };
}
function draw(path: string): CardDraw {
  return {
    card: "judgement" as CardDraw["card"], severity: 2, orientation: "reversed",
    evidence: [evidence(path)], summary: "legacy", grimoires: [],
  };
}
function reading(): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111", repo: REF, draws: [draw("legacy.py")],
    spread: [], vitality: 50, createdAt: NOW, engineVersion: "0.0.0", errors: [],
  };
}
function snapshot(): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, { "legacy.py": SOURCE }, { meta: META, createdAt: NOW });
}
function baseInput(): RitualInput {
  return {
    pairId: PAIR_ID, snapshot: snapshot(), reading: reading(),
    target: { kind: "bare" }, spread: "necropsy", now: NOW, demo: false,
  };
}

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
    fixers: [
      (source, ctx) => ({
        after: source,
        residuals: [{ path: ctx.path, line: 2, construct: "print_statement", reason: "no_transform" as const }],
      }),
    ],
    llm: {
      outputSchema: z.object({ converted: z.boolean() }) as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: () => ({ system: "s", prompt: "p", maxTokens: 16, timeoutMs: 1000, cacheKey: "legacy" }),
      apply: (s) => s,
      mockFixture: () => "{}",
    },
    chunk: {
      outputSchema: editSchema as unknown as NonNullable<Grimoire["chunk"]>["outputSchema"],
      buildRequest: (input: ChunkRequestInput) => ({
        system: "chunk", prompt: `fix ${input.chunkId}`, maxTokens: 16, timeoutMs: 1000,
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

const clock: ClockPort = { nowMs: () => 1_000_000 };
const ledger: LedgerPort = { append: async () => undefined };
const llm: LlmPort = {
  providerId: "mock",
  async complete() {
    return { text: '{"chunkId":"x","confidence":0.9}', cached: false };
  },
};
function makeEmit(): PhaseEmit {
  return { phase: () => {}, skipNote: () => {} };
}

/** A router whose resolveModel records every (tier, override) it is called with. */
function recordingRouter(): {
  router: ModelRouterPort;
  overrides: Array<{ fast?: string; strong?: string } | undefined>;
} {
  const overrides: Array<{ fast?: string; strong?: string } | undefined> = [];
  return {
    overrides,
    router: {
      route: () => "FAST" as ModelTier,
      resolveModel: (_tier, override) => {
        overrides.push(override);
        return "vendor/resolved";
      },
    },
  };
}

beforeAll(async () => {
  await initParser();
});

describe("Item 24 (R40): RitualInput.modelOverride reaches ModelRouterPort.resolveModel", () => {
  it("passes the override to resolveModel when present (YOURS path)", async () => {
    const { router, overrides } = recordingRouter();
    const runner = new LocalCovenRunner(registryWith(chunkGrimoire()), { maxLlmCallsPerReading: 10 });
    const ports: RitualPorts = { clock, ledger, llm, router };

    const input: RitualInput = { ...baseInput(), modelOverride: { strong: "vendor/my-strong" } };
    const outcome = await runner.run(input, ports, makeEmit());

    expect(outcome.error).toBeNull();
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    // EVERY resolveModel call carried the user's override.
    for (const o of overrides) {
      expect(o).toEqual({ strong: "vendor/my-strong" });
    }
  });

  it("passes undefined to resolveModel when there is no override (ORACLE path)", async () => {
    const { router, overrides } = recordingRouter();
    const runner = new LocalCovenRunner(registryWith(chunkGrimoire()), { maxLlmCallsPerReading: 10 });
    const ports: RitualPorts = { clock, ledger, llm, router };

    const outcome = await runner.run(baseInput(), ports, makeEmit());
    expect(outcome.error).toBeNull();
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    for (const o of overrides) {
      expect(o).toBeUndefined();
    }
  });
});
