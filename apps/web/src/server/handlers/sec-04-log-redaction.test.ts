//
// SEC-04 (server logs) — a handler's catch logs for observability, but a
// thrown error's `message`/`stack` can embed a secret (a token echoed from a
// failing fetch, a request body fragment, etc.). The ONLY unredacted thing a
// log line may carry is the allowlisted NecroError `code`; everything else
// (message, stack) MUST be run through `redactSecrets` with every in-scope
// secret. No `cause`, headers, body, or mapped `userMessage` is ever logged.
//
// Regression: before the fix, `terminateError` logged `err.message` and
// `err.stack` RAW, so a secret inside them leaked straight into the Vercel
// runtime logs.
//
// Pure: fully-fake deps; the only "network" is the fake runner throwing.
import type {
  CovenRunner,
  LoversEmit,
  LoversResult,
} from "@necro/coven";
import { describe, expect, it, vi } from "vitest";

import { handleLovers } from "./lovers.js";

// Re-use the shared harness pieces by importing the sibling test module's
// builders is not possible (they are not exported), so this file carries a
// minimal local harness tuned to the throw path.
import type {
  ClockPort,
  ParsedRepoRef,
  SummonResult,
} from "@necro/github";
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

const FAKE_TOKEN = "ghp_SECRETtoken_999999999999999999999";
const SHA = "a".repeat(40);
const T0 = 1_700_000_000_000;

function makeClock(): ClockPort & { setTimer: (ms: number, cb: () => void) => { cancel(): void } } {
  return {
    nowMs: () => T0,
    setTimer: (_ms: number, _cb: () => void) => ({ cancel() {} }),
  };
}

function fakeEnv(): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
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

// A lovers runner that throws AFTER the first phase, with the GitHub token
// smuggled into BOTH the error message and (via the Error) its stack.
function throwingLoversRunner(): LoversRunner {
  return {
    run: vi.fn(async (_i: unknown, _p: unknown, emit: LoversEmit): Promise<LoversResult> => {
      await emit.phase("PLAN");
      throw new Error(`upstream choked on token ${FAKE_TOKEN} mid-rite`);
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
    loversRunner: throwingLoversRunner(),
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

describe("SEC-04 (R19.4, R27.2): handler logs never leak a secret in message/stack", () => {
  it("redacts the GitHub token out of every console.error argument", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await handleLovers(loversRequest(), makeDeps());
      // Drain the stream so the throw path runs to completion.
      await res.text();

      expect(spy).toHaveBeenCalled();
      // No logged argument (across all calls) may contain the raw token.
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const text = String(arg);
          expect(text).not.toContain(FAKE_TOKEN);
        }
      }
      // The allowlisted tag is still present for observability.
      const flat = spy.mock.calls.map((c) => c.map((a) => String(a)).join(" ")).join("\n");
      expect(flat).toContain("[api/lovers] binding failed:");
    } finally {
      spy.mockRestore();
    }
  });
});
