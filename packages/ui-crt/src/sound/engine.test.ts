// src/sound/engine.test.ts
//
// Feature: 03-crt-terminal
//
// Example tests for the lazy Web Audio sound engine (task 16.1, TEST-FIRST).
// These are written before `sound/engine.ts` exists (task 16.2), so they are
// EXPECTED to fail now for the single reason that `./engine.js` cannot be
// resolved. That is the correct red state for a test-first task.
//
// Contract under test (design.md §"Sound engine (lazy chunk)"):
//   export const MASTER_GAIN = 0.15;                 // <= MAX_MASTER_GAIN
//   export const MAX_MASTER_GAIN = 0.2;
//   export function createEngine(ctor?: typeof AudioContext): SoundEngine;
//
//   - Graph: master (gain 0.15) -> destination. Hum = two sine oscillators
//     (50 Hz, 100 Hz) through a low-pass at 200 Hz into humGain (0.5) ->
//     master. Click = a 12 ms mono noise AudioBuffer through a band-pass at
//     2 kHz into clickGain -> master. Web Audio nodes only, no <audio> element
//     and no file URL (R19.9).
//   - start(): creates the context in the gesture call chain, calls resume(),
//     and rejects if the ctor is missing, the state stays "suspended"/"closed",
//     or any node constructor throws. A rejection is what drives `sound_off`
//     and the in-world "speakers are silent" message in use-sound (R19.14).
//   - apply({ hum: false }): ramps humGain to 0 with setTargetAtTime(0, now,
//     0.03) and stops the oscillators after 100 ms, well inside the 200 ms
//     limit (R19.4).
//   - release(): applies hum:false then ctx.close() after 150 ms.
//
// No real audio hardware, timers or files: a fake AudioContext constructor is
// injected into createEngine(ctor) and vi.useFakeTimers drives the 100/150 ms
// schedules deterministically.
//
// References: R19.3, R19.4, R19.9, R19.10, R19.14.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine, MASTER_GAIN, MAX_MASTER_GAIN } from "./engine.js";
import type { SoundEngine } from "../ports.js";

// ---------------------------------------------------------------------------
// Fake Web Audio graph
//
// The fakes record just enough to assert the graph shape, gain values,
// setTargetAtTime ramps, oscillator stop() timings and ctx.close(). They are
// plain objects, never the browser's real Web Audio implementation, so the
// tests stay in the node environment with no audio hardware.
// ---------------------------------------------------------------------------

/** One recorded call to AudioParam.setTargetAtTime. */
interface SetTargetCall {
  readonly target: number;
  readonly startTime: number;
  readonly timeConstant: number;
}

/** A fake AudioParam that records its final value and ramp calls. */
class FakeAudioParam {
  value: number;
  readonly setTargetAtTimeCalls: SetTargetCall[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.setTargetAtTimeCalls.push({ target, startTime, timeConstant });
    // Record the scheduled target as the latest value so assertions can read
    // the engine's intent without simulating the audio-thread ramp.
    this.value = target;
  }

  setValueAtTime(value: number): void {
    this.value = value;
  }
}

/** Base fake node: records connect() targets so the graph can be walked. */
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

class FakeBiquadFilterNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
  type: BiquadFilterType = "lowpass";

  constructor() {
    super("BiquadFilterNode");
  }
}

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor() {
    super("AudioBufferSourceNode");
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

/** Options controlling how the fake AudioContext behaves for a given test. */
interface FakeContextOptions {
  /** The state resume() settles into. Default "running". */
  readonly resumeState?: AudioContextState;
  /** The state the context reports before resume(). Default "suspended". */
  readonly initialState?: AudioContextState;
  /** When set, the named node constructor throws, exercising the reject path. */
  readonly throwOnNode?: string;
}

/**
 * A fake AudioContext that records every node it creates and its lifecycle
 * calls. Shaped to match the subset of the Web Audio API the engine uses.
 */
class FakeAudioContext {
  static lastInstance: FakeAudioContext | null = null;
  static options: FakeContextOptions = {};

  state: AudioContextState;
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = new FakeAudioDestinationNode();

  readonly created: FakeAudioNode[] = [];
  readonly createdBuffers: FakeAudioBuffer[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  private readonly throwOnNode: string | undefined;
  private readonly resumeState: AudioContextState;

  constructor() {
    const opts = FakeAudioContext.options;
    this.state = opts.initialState ?? "suspended";
    this.resumeState = opts.resumeState ?? "running";
    this.throwOnNode = opts.throwOnNode;
    FakeAudioContext.lastInstance = this;
  }

  private guard(kind: string): void {
    if (this.throwOnNode === kind) {
      throw new Error(`fake: ${kind} construction failed`);
    }
  }

  createGain(): FakeGainNode {
    this.guard("GainNode");
    const node = new FakeGainNode();
    this.created.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    this.guard("OscillatorNode");
    const node = new FakeOscillatorNode();
    this.created.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    this.guard("BiquadFilterNode");
    const node = new FakeBiquadFilterNode();
    this.created.push(node);
    return node;
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    this.guard("AudioBufferSourceNode");
    const node = new FakeAudioBufferSourceNode();
    this.created.push(node);
    return node;
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeAudioBuffer {
    this.guard("AudioBuffer");
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.createdBuffers.push(buffer);
    return buffer;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = this.resumeState;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = "closed";
  }

  nodesOfKind(kind: string): FakeAudioNode[] {
    return this.created.filter((node) => node.kind === kind);
  }
}

/** Build a fake ctor for a test, resetting recorded state first. */
function fakeCtor(options: FakeContextOptions = {}): typeof AudioContext {
  FakeAudioContext.options = options;
  FakeAudioContext.lastInstance = null;
  // The engine only needs `new ctor()`; the structural cast keeps strict TS
  // happy without pulling in the full lib.dom AudioContext surface.
  return FakeAudioContext as unknown as typeof AudioContext;
}

/** The context the most recent `new ctor()` produced. */
function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.lastInstance;
  if (!ctx) throw new Error("no fake AudioContext was constructed");
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.options = {};
  FakeAudioContext.lastInstance = null;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constants (R19.10)
// ---------------------------------------------------------------------------

describe("engine constants (R19.10): master gain is capped", () => {
  it("MASTER_GAIN is 0.15 and MAX_MASTER_GAIN is 0.2", () => {
    expect(MASTER_GAIN).toBe(0.15);
    expect(MAX_MASTER_GAIN).toBe(0.2);
  });

  it("MASTER_GAIN never exceeds MAX_MASTER_GAIN", () => {
    expect(MASTER_GAIN).toBeLessThanOrEqual(MAX_MASTER_GAIN);
  });

  it("MAX_MASTER_GAIN honours the linear 0.2 cap of R19.10", () => {
    expect(MAX_MASTER_GAIN).toBeLessThanOrEqual(0.2);
  });
});

// ---------------------------------------------------------------------------
// start() happy path and graph (R19.3, R19.9, R19.10)
// ---------------------------------------------------------------------------

describe("createEngine(ctor).start() (R19.3): builds and resumes the graph", () => {
  it("constructs an AudioContext and resumes it", async () => {
    const engine: SoundEngine = createEngine(fakeCtor());
    await engine.start();
    const ctx = lastContext();
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe("running");
  });

  it("sets the master gain node to MASTER_GAIN and wires it to destination (R19.10)", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    const ctx = lastContext();
    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    // The master is the one gain node wired straight to the destination.
    const master = gains.find((g) => g.connectedToDestination);
    expect(master).toBeDefined();
    expect(master!.gain.value).toBe(MASTER_GAIN);
    expect(master!.gain.value).toBeLessThanOrEqual(MAX_MASTER_GAIN);
  });

  it("builds the hum graph: two sine oscillators at 50/100 Hz through a 200 Hz low-pass", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    const ctx = lastContext();

    const oscillators = ctx.nodesOfKind("OscillatorNode") as FakeOscillatorNode[];
    expect(oscillators.length).toBe(2);
    for (const osc of oscillators) {
      expect(osc.type).toBe("sine");
    }
    const frequencies = oscillators.map((o) => o.frequency.value).sort((a, b) => a - b);
    expect(frequencies).toEqual([50, 100]);

    const filters = ctx.nodesOfKind("BiquadFilterNode") as FakeBiquadFilterNode[];
    const lowPass = filters.find((f) => f.type === "lowpass");
    expect(lowPass).toBeDefined();
    expect(lowPass!.frequency.value).toBe(200);
  });

  it("builds the click graph: a 12 ms mono noise buffer through a 2 kHz band-pass", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    const ctx = lastContext();

    // A 12 ms mono buffer at the context sample rate.
    const buffer = ctx.createdBuffers.at(-1);
    expect(buffer).toBeDefined();
    expect(buffer!.numberOfChannels).toBe(1);
    const expectedLength = Math.round(0.012 * ctx.sampleRate);
    expect(buffer!.length).toBe(expectedLength);

    const filters = ctx.nodesOfKind("BiquadFilterNode") as FakeBiquadFilterNode[];
    const bandPass = filters.find((f) => f.type === "bandpass");
    expect(bandPass).toBeDefined();
    expect(bandPass!.frequency.value).toBe(2000);
  });

  it("uses Web Audio nodes only — no <audio> element or file URL (R19.9)", async () => {
    const createElement = vi.fn();
    const originalDocument = (globalThis as { document?: unknown }).document;
    // Expose a document whose createElement is spied on; the engine must never
    // reach for an <audio> element, only the injected AudioContext.
    (globalThis as { document?: unknown }).document = { createElement };

    const fetchSpy = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;

    try {
      const engine = createEngine(fakeCtor());
      await engine.start();
      engine.apply({ hum: true, click: true });
      engine.click();
      expect(createElement).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDocument;
      }
      if (originalFetch === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as { fetch?: unknown }).fetch = originalFetch;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// apply({ hum: false }) stops the hum within 200 ms (R19.4)
// ---------------------------------------------------------------------------

describe("apply (R19.4): the hum stops within 200 ms", () => {
  it("ramps humGain toward 0 with setTargetAtTime(0, now, 0.03)", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    engine.apply({ hum: true, click: false });
    engine.apply({ hum: false, click: false });

    const ctx = lastContext();
    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    // The hum gain is the gain node that received a ramp to 0.
    const ramped = gains.find((g) =>
      g.gain.setTargetAtTimeCalls.some((c) => c.target === 0),
    );
    expect(ramped).toBeDefined();
    const rampToZero = ramped!.gain.setTargetAtTimeCalls.find((c) => c.target === 0);
    expect(rampToZero).toBeDefined();
    expect(rampToZero!.target).toBe(0);
    expect(rampToZero!.timeConstant).toBeCloseTo(0.03, 5);
  });

  it("stops the oscillators after 100 ms — inside the 200 ms limit", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    engine.apply({ hum: true, click: false });

    const ctx = lastContext();
    const oscillators = ctx.nodesOfKind("OscillatorNode") as FakeOscillatorNode[];
    expect(oscillators.length).toBe(2);

    engine.apply({ hum: false, click: false });

    // Before the scheduled delay the oscillators keep running.
    vi.advanceTimersByTime(99);
    for (const osc of oscillators) {
      expect(osc.stoppedAt).toBeNull();
    }

    // By 100 ms (and well before the 200 ms R19.4 limit) they are stopped.
    vi.advanceTimersByTime(1);
    for (const osc of oscillators) {
      expect(osc.stoppedAt).not.toBeNull();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// release() stops the hum then closes the context after 150 ms
// ---------------------------------------------------------------------------

describe("release: stops the hum then closes the context after 150 ms", () => {
  it("ramps the hum to 0 immediately and calls ctx.close() at 150 ms", async () => {
    const engine = createEngine(fakeCtor());
    await engine.start();
    engine.apply({ hum: true, click: false });

    const ctx = lastContext();
    engine.release();

    const gains = ctx.nodesOfKind("GainNode") as FakeGainNode[];
    const humGain = gains.find((g) =>
      g.gain.setTargetAtTimeCalls.some((c) => c.target === 0),
    );
    expect(humGain).toBeDefined();

    // close() is deferred until 150 ms after release().
    vi.advanceTimersByTime(149);
    expect(ctx.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.state).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// start() rejection paths — the source of the sound_off fallback (R19.14)
// ---------------------------------------------------------------------------

describe("start() (R19.14): rejects when Web Audio is missing or cannot start", () => {
  it("rejects when no constructor is provided (no Web Audio API)", async () => {
    const engine = createEngine(undefined);
    await expect(engine.start()).rejects.toThrow();
  });

  it("rejects when the context stays suspended after resume()", async () => {
    const engine = createEngine(
      fakeCtor({ initialState: "suspended", resumeState: "suspended" }),
    );
    await expect(engine.start()).rejects.toThrow();
  });

  it("rejects when the context is closed", async () => {
    const engine = createEngine(
      fakeCtor({ initialState: "closed", resumeState: "closed" }),
    );
    await expect(engine.start()).rejects.toThrow();
  });

  it("rejects when a node constructor throws", async () => {
    const engine = createEngine(fakeCtor({ throwOnNode: "GainNode" }));
    await expect(engine.start()).rejects.toThrow();
  });

  it("rejects when oscillator construction throws", async () => {
    const engine = createEngine(fakeCtor({ throwOnNode: "OscillatorNode" }));
    await expect(engine.start()).rejects.toThrow();
  });
});
