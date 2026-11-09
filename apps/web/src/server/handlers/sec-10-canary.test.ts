//
// SEC-10 (runtime leak canary) — the redaction pipeline is wired end-to-end:
// the NECRO_CANARY sentinel, if it ever appears in an outgoing stream line OR
// a logged error message/stack, is scrubbed to [REDACTED]. This proves the
// runtime redaction path (not just the pure helper) actually runs on both the
// response body and the server logs.
//
// A throwing lovers runner smuggles the canary into the error message+stack;
// the test drains the NDJSON response and spies on console.error, asserting the
// canary survives in NEITHER.
//
// Pure: fully-fake deps; no network / LLM / sandbox.
import type { CovenRunner, LoversEmit, LoversResult } from "@necro/coven";
import { describe, expect, it, vi } from "vitest";

import { handleLovers } from "./lovers.js";
import { NECRO_CANARY } from "../canary.js";

import type { ClockPort, ParsedRepoRef, SummonResult } from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import type {
  LedgerPort,
  LoversRunner,
  RitualInput,
  RitualOutcome,
  RitualPorts,
  PhaseEmit,
} from "@necro/coven";
import type { GithubGateway, RouteEnvPort, SpendBreakers } from "../deps.js";
import type { LoversHandlerDeps } from "./lovers.js";

const SHA = "a".repeat(40);
const T0 = 1_700_000_000_000;

function makeClock(): ClockPort & { setTimer: (ms: number, cb: () => void) => { cancel(): void } } {
  return { nowMs: () => T0, setTimer: () => ({ cancel() {} }) };
}

function fakeEnv(): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: "ghp_faketoken_0000000000000000000000",
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    NECRO_LOVERS_DAILY_CEILING: 200,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

function makeSnapshot(): RepoSnapshot {
  return {
    ref: { owner: "octo", name: "legacy", sha: SHA, defaultBranch: "master" },
    files: [{ path: "src/app.py", size: 128, lang: "python", sha: "e".repeat(40) }],
    meta: {
      pushedAt: "2014-01-01T00:00:00Z",
      isArchived: false,
      openIssueCount: 3,
      openPRCount: 1,
      oldestOpenPRAgeDays: 400,
      latestReleaseAt: null,
      licenseKey: "mit",
    },
    manifests: [],
    oversizeFiles: [],
    truncated: false,
    createdAt: "2024-01-01T00:00:00Z",
    contents: new Map<string, string>([["src/app.py", "def add(a, b):\n    return a + b\n"]]),
  } as unknown as RepoSnapshot;
}

function fakeGithub(): GithubGateway {
  return {
    summon: vi.fn(async (_i: ParsedRepoRef) => ({
      snapshot: makeSnapshot(),
      extras: { stars: 1, defaultBranch: "master", hasWorkflowsDir: false, degradedFields: [] },
      cache: "miss",
    }) as unknown as SummonResult),
    externalData: vi.fn(async (_s: RepoSnapshot) => ({
      registryData: new Map(),
      osvData: [],
      skipped: [],
    })),
  } as unknown as GithubGateway;
}

function makeReading(snapshot: RepoSnapshot, readOpts: ReadingOpts): Reading {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: {
      owner: snapshot.ref.owner,
      name: snapshot.ref.name,
      sha: snapshot.ref.sha,
      defaultBranch: snapshot.ref.defaultBranch,
    },
    draws: [
      {
        // Item 26 (CORRECTED): THE LOVERS is signalled by the grimoire linkage
        // on a LEGAL diagnosis card, never an illegal "lovers" card id.
        card: "judgement",
        orientation: "upright",
        severity: 2,
        position: 1,
        evidence: [{ path: "src/app.py", line: 1, detail: "x" }],
        grimoires: ["lovers-js"],
      },
    ],
    spread: [{ position: 1, label: "The Corpse", draw: null, description: "nothing stirs" }],
    vitality: 42,
    createdAt: readOpts.now,
    engineVersion: "0.0.0",
    errors: [],
  } as unknown as Reading;
}

function fakeResurrectRunner(): CovenRunner {
  return {
    run: vi.fn(async (_i: RitualInput, _p: RitualPorts, _e: PhaseEmit) => {
      const outcome: RitualOutcome = {
        result: {
          ritualId: "123e4567-e89b-42d3-a456-426614174000",
          selectedCount: 1,
          files: [
            {
              path: "src/app.py",
              before: "def add(a, b):\n    return a + b\n",
              after: "def add(a, b):\n    return a + b\n",
              diff: [],
              residuals: [],
              fullyConverted: true,
              validated: true,
            },
          ],
          patch: "",
          beforeVitality: 42,
          afterVitality: 55,
          vitalityDelta: 13,
          changedCards: [],
          degraded: false,
          demo: false,
        },
        error: null,
      };
      return outcome;
    }),
  } as unknown as CovenRunner;
}

// A lovers runner that throws with the CANARY in the message (and stack).
function canaryThrowingLoversRunner(): LoversRunner {
  return {
    run: vi.fn(async (_i: unknown, _p: unknown, emit: LoversEmit): Promise<LoversResult> => {
      await emit.phase("PLAN");
      throw new Error(`the rite leaked ${NECRO_CANARY} into the void`);
    }),
  } as unknown as LoversRunner;
}

function makeDeps(): LoversHandlerDeps {
  const clock = makeClock();
  return {
    clock,
    env: fakeEnv(),
    fetch: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
    limiter: { check: vi.fn(async () => ({ allowed: true })) },
    github: fakeGithub(),
    runReading: ((s: RepoSnapshot, o: ReadingOpts) => Promise.resolve(makeReading(s, o))),
    loversRunner: canaryThrowingLoversRunner(),
    resurrectRunner: fakeResurrectRunner(),
    makeLedger: (() => ({ append: vi.fn(async () => undefined) }) as unknown as LedgerPort),
    breakers: { llmOpen: () => false, sandboxOpen: () => false } as SpendBreakers,
    loversDailyCeiling: 200,
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
  } as unknown as LoversHandlerDeps;
}

function loversRequest(): Request {
  return new Request("https://necro.test/api/lovers", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
    body: JSON.stringify({
      ref: `octo/legacy@${SHA}`,
      file: "src/app.py",
      targetLang: "javascript",
      spread: "fates",
    }),
  });
}

describe("SEC-10 (runtime canary): the leak canary never survives response or logs", () => {
  it("scrubs NECRO_CANARY out of both the NDJSON response and console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await handleLovers(loversRequest(), makeDeps());
      const body = await res.text();

      // The canary never appears in the streamed response body.
      expect(body).not.toContain(NECRO_CANARY);

      // ...nor in any logged argument.
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(NECRO_CANARY);
        }
      }
    } finally {
      spy.mockRestore();
    }
  });
});
