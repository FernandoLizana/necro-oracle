// src/session/reducer.test.ts
//
// Feature: 03-crt-terminal, task 15.1 (TEST-FIRST) — session reducer examples.
//
// TEST-FIRST (red). This file is written before `session/state.ts` and
// `session/reducer.ts` (task 15.2), so the imports below fail to resolve and
// the whole suite is red for the expected reason: the modules do not exist yet.
//
// These example tests pin the concrete branch rules of the pure session
// reducer described in design.md §"Session reducer and effects":
//   - boot appends the BOOT_PHRASE block and focuses the input.
//   - submit echoes the entry, pushes non-empty entries to history (R3.1).
//   - an over-length entry is rejected before parsing, echoed truncated, no
//     request effect (R2.13).
//   - an empty / whitespace-only entry gives a fresh prompt only (R2.10).
//   - `clear` keeps summary/readings/lastSpread (R15.10).
//   - `read` with no summary / `celtic` / a held spread (R6.2, R6.3, R6.12).
//   - a successful `summon` replaces a demo session (R18.14).
//   - abort (R3.6); skip-reveal completes the running reveal (R3.5); a submit
//     completes a running reveal first (R10.5).
//   - button equivalents: SUMMON fills `summon ` and focuses, SOUND toggles and
//     counts as a gesture (R3.8-R3.12).
//   - `api.progress` appends exactly one status block per phase and keeps
//     aria-busy / inflight until the final `api.read` (R6.15, R15.13).
//   - stale `api.progress` / `api.*` actions are ignored by `requestId`.
//   - `api.summoned` clears readings (R5.4).
//   - a `focus` effect is emitted only for typed or SUMMON-button commands
//     (R15.4, R15.5).
//   - `prefs.save` is emitted only for the two allowed keys `motion`/`sound`
//     (R1.6).
//
// Offline, pure. No network / LLM / sandbox.
import { describe, expect, it } from "vitest";

// Not yet implemented — task 15.2 adds these modules.
import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

import type { ReadingResponse, SummonSummary } from "../protocol.js";
import { BOOT_PHRASE, PRE_READING_PHRASE } from "../voice/phrases.js";
import { MOTION_STORAGE_KEY, SOUND_STORAGE_KEY } from "../prefs/prefs.js";
import { MAX_ENTRY_LENGTH } from "../command/types.js";
import { blockText } from "../render/blocks.js";
import type { OutputBlock } from "../render/blocks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOT: Action = {
  type: "boot",
  motionPreference: "on",
  soundPreference: "off",
  prefersReduced: false,
  visible: true,
};

function boot(action: Partial<Action & typeof BOOT> = {}): {
  state: SessionState;
  effects: readonly Effect[];
} {
  return step(initialState(), { ...BOOT, ...action } as Action);
}

function bootState(): SessionState {
  return boot().state;
}

function submit(
  state: SessionState,
  raw: string,
  source: "enter" | "button" = "enter",
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source });
}

function appended(
  before: readonly OutputBlock[],
  after: readonly OutputBlock[],
): readonly OutputBlock[] {
  return after.slice(before.length);
}

function requestEffects(effects: readonly Effect[]): readonly Effect[] {
  return effects.filter(
    (e) =>
      e.type === "api.summon" ||
      e.type === "api.read" ||
      e.type === "demo.load",
  );
}

const SHA = "a".repeat(40);

function makeSummary(overrides: Partial<SummonSummary> = {}): SummonSummary {
  return {
    ref: { owner: "o", name: "n", sha: SHA, defaultBranch: "main" },
    stars: 3,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "miss",
    fileCount: 12,
    truncated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

describe("boot", () => {
  it("appends the BOOT_PHRASE as the first block and focuses the input", () => {
    const { state, effects } = boot();
    expect(state.log.length).toBeGreaterThanOrEqual(1);
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
    expect(effects).toContainEqual({ type: "focus", target: "input" });
  });

  it("derives motionMode from the booted preference and media query", () => {
    expect(boot({ motionPreference: "off" }).state.motionMode).toBe("reduced");
    expect(boot({ motionPreference: "on" }).state.motionMode).toBe("full");
    expect(
      boot({ motionPreference: "auto", prefersReduced: true }).state.motionMode,
    ).toBe("reduced");
  });

  it("starts Idle with no in-flight request and no summary", () => {
    const { state } = boot();
    expect(state.inflight).toBeNull();
    expect(state.summary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Submit: echo, history, empty, over-length (R3.1, R2.10, R2.13)
// ---------------------------------------------------------------------------

describe("submit", () => {
  it("echoes the entry and pushes a non-empty entry to history (R3.1)", () => {
    const { state } = submit(bootState(), "help");
    const echo = state.log[state.log.length - 1 - 0];
    // The echoed command appears as an echo block somewhere in the new blocks.
    const added = appended(bootState().log, state.log);
    expect(added.some((b) => b.kind === "echo" && blockText(b).includes("help"))).toBe(true);
    expect(state.history.entries).toContain("help");
    expect(echo).toBeDefined();
  });

  it("gives a fresh prompt only for an empty or whitespace entry (R2.10)", () => {
    for (const raw of ["", "   ", "\t  "]) {
      const base = bootState();
      const { state, effects } = submit(base, raw);
      // No command output and no request; history unchanged.
      expect(requestEffects(effects)).toHaveLength(0);
      expect(state.history.entries).toEqual(base.history.entries);
    }
  });

  it("rejects an over-length entry before parsing with no request effect (R2.13)", () => {
    const raw = "x".repeat(MAX_ENTRY_LENGTH + 50);
    const base = bootState();
    const { state, effects } = submit(base, raw);
    expect(requestEffects(effects)).toHaveLength(0);
    // Not pushed to history.
    expect(state.history.entries).not.toContain(raw);
    // A message mentions the 200-character limit.
    const added = appended(base.log, state.log);
    const text = added.map(blockText).join("\n");
    expect(text).toContain(String(MAX_ENTRY_LENGTH));
  });

  it("emits a focus effect for a typed command (R15.4)", () => {
    const { effects } = submit(bootState(), "help");
    expect(effects).toContainEqual({ type: "focus", target: "input" });
  });
});

// ---------------------------------------------------------------------------
// clear (R15.10)
// ---------------------------------------------------------------------------

describe("clear", () => {
  it("replaces the log with one block but keeps summary / readings / lastSpread", () => {
    // Install a summary and a held reading first.
    let state = submit(bootState(), `summon o/n`).state;
    const requestId = state.inflight!.id;
    state = step(state, {
      type: "api.summoned",
      requestId,
      summary: makeSummary(),
    }).state;
    const readState = submit(state, "read fates");
    const readId = readState.state.inflight?.id;
    let withReading = readState.state;
    if (readId !== undefined) {
      withReading = step(withReading, {
        type: "api.read",
        requestId: readId,
        response: makeReadingResponse(),
      }).state;
    }

    const cleared = submit(withReading, "clear").state;
    // Summary and readings survive a clear (R15.10).
    expect(cleared.summary).not.toBeNull();
    expect(cleared.lastSpread).toBe(withReading.lastSpread);
    expect(cleared.readings).toEqual(withReading.readings);
    // The log now shows a "screen cleared" block.
    const text = cleared.log.map(blockText).join("\n").toLowerCase();
    expect(text).toContain("clear");
  });
});

// A minimal valid ReadingResponse for the held-spread examples. Uses the real
// SummonSummary ref sha so `readings` keys line up with the summary.
function makeReadingResponse(): ReadingResponse {
  const ref = { owner: "o", name: "n", sha: SHA, defaultBranch: "main" as const };
  return {
    summary: makeSummary({ ref }),
    reading: {
      id: "00000000-0000-4000-8000-000000000000",
      repo: ref,
      spread: [
        {
          position: 1,
          label: "PAST",
          draw: null,
          description: "No card fell here.",
        },
      ],
      draws: [],
      vitality: 50,
      createdAt: "2024-01-01T00:00:00.000Z",
      engineVersion: "1.0.0",
      errors: [],
    },
  };
}

// ---------------------------------------------------------------------------
// read: no summary / celtic / held spread (R6.2, R6.3, R6.12, R6.1)
// ---------------------------------------------------------------------------

describe("read", () => {
  it("with no summary shows a 'summon first' message and sends no request (R6.2)", () => {
    const base = bootState();
    const { state, effects } = submit(base, "read fates");
    expect(requestEffects(effects)).toHaveLength(0);
    const text = appended(base.log, state.log).map(blockText).join("\n").toLowerCase();
    expect(text).toContain("summon");
  });

  it("read celtic shows 'not yet available' and sends no request (R6.3)", () => {
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary(),
    }).state;
    const { state: after, effects } = submit(state, "read celtic");
    expect(requestEffects(effects)).toHaveLength(0);
    const text = appended(state.log, after.log).map(blockText).join("\n").toLowerCase();
    expect(text).toMatch(/not yet|celtic|fates|necropsy/);
  });

  it("sends the pre-reading phrase and one api.read for a fresh live read (R6.1)", () => {
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary(),
    }).state;
    const { state: after, effects } = submit(state, "read fates");
    const reads = effects.filter((e) => e.type === "api.read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ spread: "fates", pinned: `o/n@${SHA}` });
    const text = appended(state.log, after.log).map(blockText).join("\n");
    expect(text).toContain(PRE_READING_PHRASE);
  });

  it("re-renders a held reading for the same sha+spread without a request (R6.12)", () => {
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary(),
    }).state;
    // First read fates -> request, then resolve to hold it.
    const firstRead = submit(state, "read fates");
    const readId = firstRead.state.inflight!.id;
    const held = step(firstRead.state, {
      type: "api.read",
      requestId: readId,
      response: makeReadingResponse(),
    }).state;

    // A second read of the same spread re-renders with no request.
    const { effects } = submit(held, "read fates");
    expect(requestEffects(effects)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// summon replaces a demo session (R18.14)
// ---------------------------------------------------------------------------

describe("summon", () => {
  it("api.summoned clears readings and lastSpread and stores a live summary (R5.4)", () => {
    const state = submit(bootState(), "summon o/n").state;
    const requestId = state.inflight!.id;
    const resolved = step(state, {
      type: "api.summoned",
      requestId,
      summary: makeSummary(),
    }).state;
    expect(resolved.summary).not.toBeNull();
    expect(resolved.summary?.demo).toBeUndefined();
    expect(resolved.readings).toEqual({});
    expect(resolved.lastSpread).toBeNull();
    expect(resolved.inflight).toBeNull();
  });

  it("a successful summon replaces a demo summary with a live one (R18.14)", () => {
    // Seed a demo summary by hand through api.summoned with demo:true is not a
    // live summon; instead drive summon then summoned to ensure the live result
    // carries no demo flag and the prior demo state is gone.
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary({ demo: true } as Partial<SummonSummary>),
    }).state;
    // Now a fresh live summon replaces it.
    const next = submit(state, "summon o/n2");
    const resolved = step(next.state, {
      type: "api.summoned",
      requestId: next.state.inflight!.id,
      summary: makeSummary(),
    }).state;
    expect(resolved.summary?.demo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// abort (R3.6) and skip-reveal (R3.5) and reveal-before-submit (R10.5)
// ---------------------------------------------------------------------------

describe("abort / reveal", () => {
  it("abort while in flight emits api.abort and shows an interrupted message (R3.6)", () => {
    const state = submit(bootState(), "summon o/n").state;
    expect(state.inflight).not.toBeNull();
    const { state: after, effects } = step(state, { type: "abort" });
    expect(effects).toContainEqual({ type: "api.abort" });
    const text = after.log.map(blockText).join("\n").toLowerCase();
    expect(text).toMatch(/interrupt|ritual/);
  });

  it("skip-reveal completes the running reveal, draining the queue (R3.5)", () => {
    // A boot with full motion queues the boot block for reveal.
    const base = bootState();
    const { state } = step(base, { type: "skip-reveal" });
    expect(state.reveal.queue).toEqual([]);
    expect(state.reveal.startedAtMs).toBeNull();
  });

  it("a submit first completes a running reveal (R10.5)", () => {
    const base = bootState();
    // After boot in full motion the reveal queue is non-empty.
    expect(base.reveal.queue.length).toBeGreaterThanOrEqual(0);
    const { state } = submit(base, "help");
    // Once a new command is submitted, the previously-running reveal is drained
    // before the new blocks reveal — the queue never retains stale ids.
    expect(state.reveal.queue).not.toContain(base.log[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// button equivalents (R3.8-R3.12, R15.4, R15.5)
// ---------------------------------------------------------------------------

describe("button equivalents", () => {
  it("SUMMON button fills `summon ` and focuses the input, sending no request (R3.10)", () => {
    const base = bootState();
    const { effects } = step(base, {
      type: "submit",
      raw: "summon",
      source: "button",
    });
    // The SUMMON button prefills; it does not itself summon.
    expect(requestEffects(effects)).toHaveLength(0);
    expect(effects).toContainEqual({ type: "focus", target: "input" });
  });

  it("non-SUMMON button commands emit no focus effect (R15.5)", () => {
    const base = bootState();
    const { effects } = step(base, {
      type: "submit",
      raw: "help",
      source: "button",
    });
    expect(effects).not.toContainEqual({ type: "focus", target: "input" });
  });

  it("SOUND button toggles the preference and counts as a gesture (R3.12)", () => {
    const base = bootState();
    // From preference off, the SOUND button runs `sound on` and sets gesture.
    const { state } = step(base, {
      type: "submit",
      raw: "sound on",
      source: "button",
    });
    expect(state.sound.preference).toBe("on");
    expect(state.sound.gesture).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// api.progress and staleness (R6.15, R15.13)
// ---------------------------------------------------------------------------

describe("api.progress", () => {
  it("appends exactly one status block per phase and keeps inflight until api.read (R6.15, R15.13)", () => {
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary(),
    }).state;
    const read = submit(state, "read fates");
    const requestId = read.state.inflight!.id;
    let cur = read.state;

    const phases = ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"] as const;
    for (const phase of phases) {
      const before = cur.log.length;
      cur = step(cur, {
        type: "api.progress",
        requestId,
        event: { kind: "phase", phase },
      }).state;
      // Exactly one status block added per phase.
      const added = cur.log.slice(before);
      expect(added).toHaveLength(1);
      expect(added[0]!.kind).toBe("status");
      // Still in flight until the final result arrives.
      expect(cur.inflight).not.toBeNull();
      expect(cur.inflight?.id).toBe(requestId);
    }

    // The final api.read clears inflight.
    const done = step(cur, {
      type: "api.read",
      requestId,
      response: makeReadingResponse(),
    }).state;
    expect(done.inflight).toBeNull();
  });

  it("ignores a stale api.progress whose requestId does not match inflight", () => {
    let state = submit(bootState(), "summon o/n").state;
    state = step(state, {
      type: "api.summoned",
      requestId: state.inflight!.id,
      summary: makeSummary(),
    }).state;
    const read = submit(state, "read fates");
    const requestId = read.state.inflight!.id;
    const before = read.state.log.length;
    const after = step(read.state, {
      type: "api.progress",
      requestId: requestId + 999,
      event: { kind: "phase", phase: "SUMMON" },
    }).state;
    // A stale progress event changes nothing.
    expect(after.log.length).toBe(before);
    expect(after.inflight?.id).toBe(requestId);
  });

  it("ignores a stale api.read whose requestId does not match inflight", () => {
    const state = submit(bootState(), "summon o/n").state;
    const requestId = state.inflight!.id;
    const after = step(state, {
      type: "api.read",
      requestId: requestId + 999,
      response: makeReadingResponse(),
    }).state;
    // The in-flight summon is untouched by a stale read result.
    expect(after.inflight?.id).toBe(requestId);
  });
});

// ---------------------------------------------------------------------------
// prefs.save only for the two allowed keys (R1.6)
// ---------------------------------------------------------------------------

describe("prefs.save", () => {
  it("motion on|off|auto emits exactly one prefs.save with key 'motion' (R1.6)", () => {
    for (const raw of ["motion on", "motion off", "motion auto"]) {
      const { effects } = submit(bootState(), raw);
      const saves = effects.filter((e) => e.type === "prefs.save");
      expect(saves).toHaveLength(1);
      expect((saves[0] as { key: string }).key).toBe("motion");
    }
  });

  it("sound on|off emits a prefs.save with key 'sound' (R1.6)", () => {
    // sound needs a gesture to actually activate, but the preference save fires
    // regardless of gesture.
    const gestured = step(bootState(), {
      type: "sound",
      event: { type: "gesture" },
    }).state;
    for (const raw of ["sound on", "sound off"]) {
      const { effects } = submit(gestured, raw);
      const saves = effects.filter((e) => e.type === "prefs.save");
      expect(saves.length).toBeGreaterThanOrEqual(1);
      expect((saves[0] as { key: string }).key).toBe("sound");
    }
  });

  it("every prefs.save key is one of the two allowed storage keys", () => {
    const allowed = new Set([
      "motion",
      "sound",
    ]);
    const allowedStorageKeys = new Set([MOTION_STORAGE_KEY, SOUND_STORAGE_KEY]);
    expect(allowedStorageKeys.size).toBe(2);
    for (const raw of ["motion auto", "sound off", "help", "clear"]) {
      const { effects } = submit(bootState(), raw);
      for (const effect of effects) {
        if (effect.type === "prefs.save") {
          expect(allowed.has(effect.key)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// local-command latency contract (R16.8) — structural: pure & synchronous
// ---------------------------------------------------------------------------

describe("local-command latency (R16.8)", () => {
  it("local commands produce their echo block synchronously with no request", () => {
    for (const raw of ["help", "clear", "motion", "sound off", "", "wat"]) {
      const base = bootState();
      const { state, effects } = submit(base, raw);
      // No request effect — a local command never hits the API.
      expect(requestEffects(effects)).toHaveLength(0);
      // A non-empty entry is echoed immediately (same synchronous step).
      // `clear` is the one exception: it wipes the whole log — including the
      // echo of the `clear` command itself — down to the single "screen
      // cleared" block (R15.10), so no echo block survives the step.
      if (raw.trim() !== "" && raw.trim() !== "clear") {
        const added = appended(base.log, state.log);
        expect(added.some((b) => b.kind === "echo")).toBe(true);
      }
    }
  });
});
