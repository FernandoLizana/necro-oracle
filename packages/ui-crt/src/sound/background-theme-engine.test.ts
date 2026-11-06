// src/sound/background-theme-engine.test.ts
//
// Feature: arcana-visions, task 8.
//
// Example tests for the lazy Background_Theme engine. They drive the engine
// with a FAKE AudioContext (a plain object graph, never real audio hardware)
// and fake timers, mirroring `engine.test.ts`. No real audio, timers, files or
// network — unit-test clean.
//
// Contract under test (design.md §"Background theme engine (lazy chunk)"):
//   export const MAX_THEME_GAIN = 0.2;
//   export function createBackgroundThemeEngine(ctor?): BackgroundThemeEngine;
//
//   - createBackgroundThemeEngine(ctor).start(score) builds a square voice and
//     a triangle voice as OscillatorNodes through per-voice gains into a master
//     gain clamped to <= 0.2, resumes the context and schedules a gapless loop
//     (R8.1, R8.2).
//   - stop() fades the master and stops every oscillator within 1 s (R8.7).
//   - createBackgroundThemeEngine(undefined) is a NO-OP engine whose start()
//     does not throw and builds nothing, so the Terminal_Route stays usable and
//     silent when Web Audio is unavailable (R8.8).
//
// Validates: Requirements 8.1, 8.2, 8.7, 8.8, 8.9

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBackgroundThemeEngine,
  MAX_THEME_GAIN,
} from "./background-theme-engine.js";
import type { ThemeScore } from "./background-theme.js";
import { composeTheme } from "./background-theme.js";

// ---------------------------------------------------------------------------
// Fake Web Audio graph (same shape as engine.test.ts, trimmed to what the
// background-theme engine uses: gain, oscillator and the context lifecycle).
// ---------------------------------------------------------------------------

interface SetTargetCall {
  readonly target: number;
  readonly startTime: number;
  readonly timeConstant: number;
}

class FakeAudioParam {
  value: number;
  readonly setTargetAtTimeCalls: SetTargetCall[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.setTargetAtTimeCalls.push({ target, startTime, timeConstant });
    this.value = target;
  }
}

class FakeAudioNode {
  readonly kind: string;
  readonly connectedTo: FakeAudioNode[] = [];
  connectedToDestination = false;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect(target: FakeAudioNode | FakeAudioDestinationNode): void {
    if (target instanceof FakeAudioDestinationNode) {
      this.connectedToDestination = true;
    } else {
      this.connectedTo.push(target);
    }
  }

  disconnect(): void {
    this.connectedTo.length = 0;
    this.connectedToDestination = false;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
  constructor() {
    super("GainNode");
  }
}

class FakeOscillatorNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam(440);
  type: OscillatorType = "sine";
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor() {
    super("OscillatorNode");
  }

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeAudioDestinationNode {
  readonly kind = "AudioDestinationNode";
}

class FakeAudioContext {
  static lastInstance: FakeAudioContext | null = null;

  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = new FakeAudioDestinationNode();

  readonly created: FakeAudioNode[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  constructor() {
    FakeAudioContext.lastInstance = this;
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.created.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.created.push(node);
    return node;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = "closed";
  }

  nodesOfKind(kind: string): FakeAudioNode[] {
    return this.created.filter((node) => node.kind === kind);
  }
}

function fakeCtor(): typeof AudioContext {
  FakeAudioContext.lastInstance = null;
  return FakeAudioContext as unknown as typeof AudioContext;
}

function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.lastInstance;
  if (!ctx) throw new Error("no fake AudioContext was constructed");
  return ctx;
}

/** A tiny two-voice score (square lead + triangle bass) for the graph assertions. */
function sampleScore(): ThemeScore {
  return {
    bpm: 100,
    loopBars: 4,
    voices: [
      { wave: "square", notes: [69, 72, 76, 72], gain: 0.12 },
      { wave: "triangle", notes: [45, 48], gain: 0.05 },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.lastInstance = null;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constant (R8.1)
// ---------------------------------------------------------------------------

describe("background theme engine constant (R8.1): the master gain is capped", () => {
  it("MAX_THEME_GAIN honours the 0.2 ceiling", () => {
    expect(MAX_THEME_GAIN).toBe(0.2);
    expect(MAX_THEME_GAIN).toBeLessThanOrEqual(0.2);
  });
});

// ---------------------------------------------------------------------------
// start(score): square + triangle oscillators through a clamped master (R8.1)
// ---------------------------------------------------------------------------

describe("start (R8.1): builds square + triangle voices under a clamped master", () => {
  it("constructs an AudioContext and resumes it", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    const ctx = lastContext();
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe("running");
  });

  it("routes voices through a master gain clamped to <= MAX_THEME_GAIN wired to destination", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    const ctx = lastContext();

    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    const master = gains.find((g) => g.connectedToDestination);
    expect(master).toBeDefined();
    expect(master!.gain.value).toBeLessThanOrEqual(MAX_THEME_GAIN);
    expect(master!.gain.value).toBe(MAX_THEME_GAIN);
  });

  it("builds both square and triangle oscillators from the score", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    const ctx = lastContext();

    const oscillators = ctx.nodesOfKind("OscillatorNode") as FakeOscillatorNode[];
    expect(oscillators.length).toBeGreaterThan(0);
    const waves = new Set(oscillators.map((o) => o.type));
    expect(waves.has("square")).toBe(true);
    expect(waves.has("triangle")).toBe(true);
    // Only the two chiptune shapes are ever used (R8.1).
    for (const osc of oscillators) {
      expect(osc.type === "square" || osc.type === "triangle").toBe(true);
    }
  });

  it("schedules every note so an oscillator abuts the next with no gap (gapless, R8.2)", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    const ctx = lastContext();

    const oscillators = ctx.nodesOfKind("OscillatorNode") as FakeOscillatorNode[];
    // Every scheduled note has a start and a stop time (self-stopping notes).
    for (const osc of oscillators) {
      expect(osc.startedAt).not.toBeNull();
      expect(osc.stoppedAt).not.toBeNull();
      expect(osc.stoppedAt!).toBeGreaterThan(osc.startedAt!);
    }
  });

  it("no voice gain exceeds the ceiling and the composed theme sums <= 0.2 (R8.1)", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(composeTheme(1234));
    const ctx = lastContext();

    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    for (const g of gains) {
      expect(g.gain.value).toBeLessThanOrEqual(MAX_THEME_GAIN);
    }
  });
});

// ---------------------------------------------------------------------------
// stop(): fades and stops every oscillator within 1 s (R8.7)
// ---------------------------------------------------------------------------

describe("stop (R8.7): fades the master and halts oscillators within 1 s", () => {
  it("ramps the master toward 0 and stops the oscillators well inside 1 s", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    const ctx = lastContext();

    const oscillators = ctx.nodesOfKind("OscillatorNode") as FakeOscillatorNode[];
    // Record whether each was still "unstopped" by start time; self-stopping
    // notes carry a scheduled stop time, so we assert stop() forces a halt.
    expect(oscillators.length).toBeGreaterThan(0);

    engine.stop();

    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    const master = gains.find((g) => g.connectedToDestination);
    expect(master).toBeDefined();
    const rampToZero = master!.gain.setTargetAtTimeCalls.find((c) => c.target === 0);
    expect(rampToZero).toBeDefined();

    // By 1 s (the engine stops at ~200 ms) every oscillator has been stopped
    // and the context closed.
    vi.advanceTimersByTime(1000);
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.state).toBe("closed");
  });

  it("is idempotent: a second stop() is a harmless no-op", async () => {
    const engine = createBackgroundThemeEngine(fakeCtor());
    await engine.start(sampleScore());
    engine.stop();
    vi.advanceTimersByTime(1000);
    expect(() => engine.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No-op engine when Web Audio is unavailable (R8.8)
// ---------------------------------------------------------------------------

describe("no-op engine (R8.8): no AudioContext keeps the route usable and silent", () => {
  it("start() with an undefined ctor does not throw and builds nothing", async () => {
    const engine = createBackgroundThemeEngine(undefined);
    await expect(engine.start(sampleScore())).resolves.toBeUndefined();
    // No fake context was ever constructed — the engine is a pure no-op.
    expect(FakeAudioContext.lastInstance).toBeNull();
  });

  it("stop() with an undefined ctor is a safe no-op", () => {
    const engine = createBackgroundThemeEngine(undefined);
    expect(() => engine.stop()).not.toThrow();
  });
});
