// src/session/model-override-session-only.test.ts
//
// Feature: lovers-binding, task 10.5 — session model overrides never persist.
//
// Property 24 (R25.8): a `model fast|strong <id>` override lives in the
// in-memory session reducer state ONLY. It is recorded on
// `SessionState.sessionModelOverrides` for the current session, is never
// written to any browser storage (localStorage / sessionStorage /
// document.cookie / indexedDB), and a fresh session (a reload) starts with no
// overrides — so an override cannot survive a reload.
//
// This mirrors the SoulKey in-memory-only approach (apps/web
// `boundary.guard.test.ts` + `soul-key-context.tsx` structural
// non-persistence): we assert both (a) the reducer is a pure function that
// returns new state with the override set for the right tier and emits NO
// persistence effect, (b) no persistence side effect occurs — the storage
// globals are spied and never touched while the override is reduced, and the
// `session/state.ts` + `session/reducer.ts` modules import NONE of the
// persistence APIs, and (c) a fresh `initialState()` carries no overrides.
//
// Offline, pure. No network / LLM / sandbox.
//
// Validates: Requirements 25.8

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialState } from "./state.js";
import type { Action, Effect, SessionState } from "./state.js";
import { step } from "./reducer.js";

// ---------------------------------------------------------------------------
// Helpers — boot a session and submit a raw command line, exactly as the other
// reducer suites do (the `model` command is only reachable through `submit`).
// ---------------------------------------------------------------------------

const BOOT: Action = {
  type: "boot",
  motionPreference: "on",
  soundPreference: "off",
  prefersReduced: false,
  visible: true,
  bootSignal: false,
};

function bootState(): SessionState {
  return step(initialState(), BOOT).state;
}

function submit(
  state: SessionState,
  raw: string,
): { state: SessionState; effects: readonly Effect[] } {
  return step(state, { type: "submit", raw, source: "enter" });
}

/**
 * Representative `model fast|strong <id>` sequences. The ids are already
 * `MODEL_ID_RE`-valid (the parser rejects invalid ids to `unknown`); these
 * exercise `vendor/model`, a leading `~`, and a `:tag` suffix per R25.7.
 */
const MODEL_SEQUENCES: readonly (readonly string[])[] = [
  ["model fast openai/gpt-4o-mini"],
  ["model strong anthropic/claude-3-5-sonnet"],
  ["model fast openai/gpt-4o-mini", "model strong anthropic/claude-3-5-sonnet"],
  ["model fast openai/gpt-4o-mini", "model fast meta-llama/llama-3.1-8b"],
  ["model strong ~vendor/model:latest", "model fast vendor/other:v2"],
];

/** Fold a sequence of raw entries through the reducer from a booted session. */
function reduceSequence(entries: readonly string[]): {
  state: SessionState;
  effects: Effect[];
} {
  let state = bootState();
  const effects: Effect[] = [];
  for (const raw of entries) {
    const res = submit(state, raw);
    state = res.state;
    effects.push(...res.effects);
  }
  return { state, effects };
}

// ---------------------------------------------------------------------------
// Storage sink spies. The pure suite runs in the `node` environment, where the
// browser storage globals are not provided. We install our own fully-spyable
// stand-ins on `globalThis` so that ANY write the reducer attempted — to
// localStorage, sessionStorage, or document.cookie — would be observed. The
// reducer touches none of them, so every spy must stay uncalled.
// ---------------------------------------------------------------------------

interface SinkSpies {
  readonly writes: ReturnType<typeof vi.fn>;
  readonly localLength: () => number;
  readonly sessionLength: () => number;
}

const SAVED = Symbol("saved-globals");

interface SavedGlobals {
  [SAVED]?: {
    localStorage: PropertyDescriptor | undefined;
    sessionStorage: PropertyDescriptor | undefined;
    document: PropertyDescriptor | undefined;
  };
}

function makeStore(writes: ReturnType<typeof vi.fn>): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      writes(`clear`);
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      writes(`removeItem:${key}`);
    },
    setItem(key: string, value: string) {
      writes(`setItem:${key}=${value}`);
    },
  } as Storage;
}

function installSinks(): SinkSpies {
  const writes = vi.fn();
  const local = makeStore(writes);
  const session = makeStore(writes);

  const g = globalThis as typeof globalThis & SavedGlobals;
  g[SAVED] = {
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: local,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: session,
  });
  // A minimal `document` whose only observable surface is the cookie setter.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        writes(`cookie=${value}`);
      },
    },
  });

  return {
    writes,
    localLength: () => local.length,
    sessionLength: () => session.length,
  };
}

function restoreSinks(): void {
  const g = globalThis as typeof globalThis & SavedGlobals;
  const saved = g[SAVED];
  const restore = (name: "localStorage" | "sessionStorage" | "document"): void => {
    const descriptor = saved?.[name];
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  };
  restore("localStorage");
  restore("sessionStorage");
  restore("document");
  delete g[SAVED];
}

let sinks: SinkSpies;

beforeEach(() => {
  sinks = installSinks();
});

afterEach(() => {
  restoreSinks();
  vi.restoreAllMocks();
});

describe("P24 (R25.8): session model overrides never persist", () => {
  // -------------------------------------------------------------------------
  // (a) The reducer is a pure function returning new state with the override
  //     set for the right tier — and no persistence effect is described.
  // -------------------------------------------------------------------------

  it("records a `model fast <id>` override on session state only, for the right tier", () => {
    const { state, effects } = reduceSequence(["model fast openai/gpt-4o-mini"]);

    expect(state.sessionModelOverrides).toEqual({ fast: "openai/gpt-4o-mini" });
    // The reducer describes no persistence effect for a model override: the
    // only effect a typed command emits here is the input re-focus (R15.4).
    expect(effects.some((e) => e.type === "prefs.save")).toBe(false);
    expect(effects.every((e) => e.type === "focus")).toBe(true);
  });

  it("records a `model strong <id>` override under the strong tier", () => {
    const { state } = reduceSequence(["model strong anthropic/claude-3-5-sonnet"]);
    expect(state.sessionModelOverrides).toEqual({
      strong: "anthropic/claude-3-5-sonnet",
    });
  });

  it("keeps each tier independent and lets a later override replace an earlier one", () => {
    const { state } = reduceSequence([
      "model fast openai/gpt-4o-mini",
      "model strong anthropic/claude-3-5-sonnet",
      "model fast meta-llama/llama-3.1-8b",
    ]);
    expect(state.sessionModelOverrides).toEqual({
      fast: "meta-llama/llama-3.1-8b",
      strong: "anthropic/claude-3-5-sonnet",
    });
  });

  it("is a pure transition: the prior state object is not mutated", () => {
    const before = bootState();
    const snapshot = before.sessionModelOverrides;
    const after = submit(before, "model fast openai/gpt-4o-mini").state;

    // The prior slice is untouched (new object returned), proving purity.
    expect(before.sessionModelOverrides).toBe(snapshot);
    expect(before.sessionModelOverrides).toEqual({});
    expect(after.sessionModelOverrides).not.toBe(snapshot);
  });

  // -------------------------------------------------------------------------
  // (b) No persistence side effect occurs — spy on every browser storage sink
  //     and assert nothing is written while the override is reduced. Across
  //     ALL representative sequences and across the whole lifecycle.
  // -------------------------------------------------------------------------

  it.each(MODEL_SEQUENCES.map((seq) => [seq.join(" ; "), seq] as const))(
    "writes to no storage sink while reducing: %s",
    (_label, entries) => {
      const { state } = reduceSequence(entries);

      // Sanity: at least one override was actually recorded by the run, so the
      // "no write" assertion below is exercised against a real override.
      expect(Object.keys(state.sessionModelOverrides).length).toBeGreaterThan(0);

      // The reducer wrote to NO storage sink: not localStorage, not
      // sessionStorage, not document.cookie. A single shared spy observes every
      // write method across all three; it must never have fired.
      expect(sinks.writes).not.toHaveBeenCalled();

      // No storage key for the override was left behind, either.
      expect(sinks.localLength()).toBe(0);
      expect(sinks.sessionLength()).toBe(0);
    },
  );

  // -------------------------------------------------------------------------
  // (c) A fresh session starts with no overrides — proving an override does
  //     NOT survive a reload. There is no re-hydration path: the only source
  //     of truth is `initialState()`, which seeds an empty map, and the live
  //     `boot` action never reads an override back from anywhere.
  // -------------------------------------------------------------------------

  it("starts a fresh session (reload) with no overrides", () => {
    // Set overrides in one session...
    const { state: live } = reduceSequence([
      "model fast openai/gpt-4o-mini",
      "model strong anthropic/claude-3-5-sonnet",
    ]);
    expect(live.sessionModelOverrides).toEqual({
      fast: "openai/gpt-4o-mini",
      strong: "anthropic/claude-3-5-sonnet",
    });

    // ...then simulate a reload: a brand-new session from scratch. It can only
    // start from `initialState()` + `boot`; neither reads back an override.
    const reloaded = bootState();
    expect(reloaded.sessionModelOverrides).toEqual({});
    expect(initialState().sessionModelOverrides).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Structural non-persistence: the pure session modules import NONE of the
  // persistence APIs, so no code path could ever write an override out. This
  // mirrors the SoulKey container's structural guarantee by static analysis.
  // -------------------------------------------------------------------------

  it("the session state + reducer modules reference no persistence API", () => {
    // Anchor the two pure session modules to THIS test file's directory (they
    // are its siblings), so the structural scan works whether the suite runs
    // from the package root or from the monorepo root under `vitest run`.
    const stateSrc = readFileSync(
      fileURLToPath(new URL("./state.ts", import.meta.url)),
      "utf8",
    );
    const reducerSrc = readFileSync(
      fileURLToPath(new URL("./reducer.ts", import.meta.url)),
      "utf8",
    );

    const FORBIDDEN = [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      ".cookie",
      "window.location",
      "history.pushState",
      "history.replaceState",
    ];

    for (const src of [stateSrc, reducerSrc]) {
      // Strip line comments so the explanatory prose (which names these APIs on
      // purpose) never trips the guard — only real code references count.
      const code = src.replace(/\/\/[^\n]*/g, "");
      for (const api of FORBIDDEN) {
        expect(code.includes(api), `found "${api}" in pure session module`).toBe(
          false,
        );
      }
    }
  });
});
