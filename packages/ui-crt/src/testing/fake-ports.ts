// Shared in-memory fake ports for the @necro/ui-crt component and hook tests.
//
// Feature: 03-crt-terminal, task 17.1 (TEST-FIRST, red phase).
//
// Every side effect the Terminal reaches through `TerminalPorts` is faked here
// with a deterministic, inspectable stand-in: an in-memory `StoragePort`, a
// controllable `MediaPort`/`VisibilityPort`, a manually-pumped `FramePort`, a
// scripted `ApiPort`/`DemoPort`, and a `SoundLoaderPort` whose engine records
// every call (and can be made to reject to exercise the failure fallback).
//
// These fakes make NO network, clock, DOM, audio or storage side effect. Tests
// drive them explicitly — advancing frames, flipping the media query, emitting
// progress events — so the Terminal's behaviour is fully observable without a
// real browser API. The production adapters (task 17.2) implement the same
// ports over `window`, `matchMedia`, `requestAnimationFrame`, `fetch` and Web
// Audio; nothing here is used outside tests.

import type {
  ApiPort,
  DemoBundle,
  DemoPort,
  PlayableSpread,
  ProgressEvent,
  ReadProgress,
  ReadingResponse,
  ResurrectProgress,
  ResurrectProgressEvent,
  RitualResponse,
  SummonSummary,
} from "../protocol.js";
import type { ResurrectTarget } from "../command/types.js";
import type {
  FramePort,
  MediaPort,
  SoundEngine,
  SoundLoaderPort,
  StoragePort,
  TerminalPorts,
  VisibilityPort,
} from "../ports.js";

// ---------------------------------------------------------------------------
// StoragePort
// ---------------------------------------------------------------------------

/** A `StoragePort` backed by a `Map`. `set` writes are recorded in order. */
export interface FakeStorage extends StoragePort {
  /** The live backing map (also mutate directly to seed stored prefs). */
  readonly map: Map<string, string>;
  /** Every `set(key, value)` call, in order. */
  readonly writes: { key: string; value: string }[];
}

/** Build a fresh in-memory storage, optionally seeded with initial entries. */
export function makeFakeStorage(
  initial: Readonly<Record<string, string>> = {},
): FakeStorage {
  const map = new Map<string, string>(Object.entries(initial));
  const writes: { key: string; value: string }[] = [];
  return {
    map,
    writes,
    get(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    set(key, value) {
      map.set(key, value);
      writes.push({ key, value });
    },
  };
}

// ---------------------------------------------------------------------------
// MediaPort
// ---------------------------------------------------------------------------

/** A `MediaPort` whose `prefers-reduced-motion` state is flipped by tests. */
export interface FakeMedia extends MediaPort {
  /** Flip the reduced-motion match and notify every subscriber. */
  emit(matches: boolean): void;
  /** How many live subscribers are attached (0 after every unsubscribe). */
  subscriberCount(): number;
}

/** Build a fake media port with an initial reduced-motion value. */
export function makeFakeMedia(initial = false): FakeMedia {
  let matches = initial;
  const subs = new Set<(m: boolean) => void>();
  return {
    prefersReducedMotion() {
      return matches;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    emit(next) {
      matches = next;
      for (const cb of subs) cb(next);
    },
    subscriberCount() {
      return subs.size;
    },
  };
}

// ---------------------------------------------------------------------------
// VisibilityPort
// ---------------------------------------------------------------------------

/** A `VisibilityPort` whose page-visibility state is flipped by tests. */
export interface FakeVisibility extends VisibilityPort {
  /** Flip page visibility and notify every subscriber. */
  emit(visible: boolean): void;
  subscriberCount(): number;
}

/** Build a fake visibility port with an initial visible value. */
export function makeFakeVisibility(initial = true): FakeVisibility {
  let isVisible = initial;
  const subs = new Set<(v: boolean) => void>();
  return {
    visible() {
      return isVisible;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    emit(next) {
      isVisible = next;
      for (const cb of subs) cb(next);
    },
    subscriberCount() {
      return subs.size;
    },
  };
}

// ---------------------------------------------------------------------------
// FramePort
// ---------------------------------------------------------------------------

/**
 * A `FramePort` with a manual clock and a manual frame queue. Tests advance
 * time with `advance(ms)`, which runs every frame callback requested so far
 * with the new `now()`. `flush()` runs pending callbacks without advancing the
 * clock. `pending()` exposes how many callbacks are queued, so a test can
 * assert that NO animation frame is scheduled while idle in reduced mode
 * (R16.9).
 */
export interface FakeFrames extends FramePort {
  /** Advance the clock by `ms` and run every queued frame callback. */
  advance(ms: number): void;
  /** Run queued callbacks at the current time without advancing the clock. */
  flush(): void;
  /** Number of frame callbacks currently queued. */
  pending(): number;
  /** Total number of `request(...)` calls ever made. */
  requestCount(): number;
}

/** Build a fake frame port starting at `t = 0`. */
export function makeFakeFrames(): FakeFrames {
  let t = 0;
  let nextHandle = 1;
  let requests = 0;
  const queue = new Map<number, (nowMs: number) => void>();

  function run(): void {
    const callbacks = [...queue.entries()];
    queue.clear();
    for (const [, cb] of callbacks) cb(t);
  }

  return {
    now() {
      return t;
    },
    request(cb) {
      requests += 1;
      const handle = nextHandle++;
      queue.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    advance(ms) {
      t += ms;
      run();
    },
    flush() {
      run();
    },
    pending() {
      return queue.size;
    },
    requestCount() {
      return requests;
    },
  };
}

// ---------------------------------------------------------------------------
// ApiPort
// ---------------------------------------------------------------------------

/** A scripted `ApiPort`. Each call records its arguments and awaits a deferral. */
export interface FakeApi extends ApiPort {
  /** Every `summon` call, with a resolver/rejecter the test drives. */
  readonly summons: {
    repo: string;
    signal: AbortSignal;
    resolve: (summary: SummonSummary) => void;
    reject: (error: unknown) => void;
  }[];
  /**
   * Every `read` call. `emit(event)` pushes one decoded Progress_Event to the
   * live `onProgress` callback; `resolve`/`reject` settle the final result.
   */
  readonly reads: {
    pinned: string;
    spread: PlayableSpread;
    signal: AbortSignal;
    emit: (event: ProgressEvent) => void;
    resolve: (response: ReadingResponse) => void;
    reject: (error: unknown) => void;
  }[];
  /**
   * Every `resurrect` call. `emit(event)` pushes one decoded resurrection
   * Progress_Event to the live `onProgress` callback; `resolve`/`reject` settle
   * the final `RitualResult`.
   */
  readonly resurrects: {
    pinned: string;
    target: ResurrectTarget;
    spread: PlayableSpread;
    signal: AbortSignal;
    emit: (event: ResurrectProgressEvent) => void;
    resolve: (response: RitualResponse) => void;
    reject: (error: unknown) => void;
  }[];
}

/** Build a fake readings API whose every call is resolved manually by the test. */
export function makeFakeApi(): FakeApi {
  const summons: FakeApi["summons"] = [];
  const reads: FakeApi["reads"] = [];
  const resurrects: FakeApi["resurrects"] = [];
  return {
    summons,
    reads,
    resurrects,
    summon(repo, signal) {
      return new Promise<SummonSummary>((resolve, reject) => {
        summons.push({ repo, signal, resolve, reject });
      });
    },
    read(pinned, spread, signal, onProgress: ReadProgress) {
      return new Promise<ReadingResponse>((resolve, reject) => {
        reads.push({
          pinned,
          spread,
          signal,
          emit: (event) => onProgress(event),
          resolve,
          reject,
        });
      });
    },
    resurrect(pinned, target, spread, signal, onProgress: ResurrectProgress) {
      return new Promise<RitualResponse>((resolve, reject) => {
        resurrects.push({
          pinned,
          target,
          spread,
          signal,
          emit: (event) => onProgress(event),
          resolve,
          reject,
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// DemoPort
// ---------------------------------------------------------------------------

/** A `DemoPort` that resolves (or rejects) the given bundle. */
export function makeFakeDemo(
  bundle: DemoBundle | null,
  options: { readonly reject?: unknown } = {},
): DemoPort {
  return {
    load() {
      if ("reject" in options) return Promise.reject(options.reject);
      if (bundle === null) return Promise.reject(new Error("no demo bundle"));
      return Promise.resolve(bundle);
    },
  };
}

// ---------------------------------------------------------------------------
// SoundLoaderPort / SoundEngine
// ---------------------------------------------------------------------------

/** A `SoundEngine` that records every call instead of touching Web Audio. */
export interface FakeSoundEngine extends SoundEngine {
  readonly calls: string[];
  readonly applied: { hum: boolean; click: boolean }[];
  readonly startCount: () => number;
  readonly releaseCount: () => number;
  readonly clickCount: () => number;
}

/**
 * Build a recording sound engine. When `startRejects` is set, `start()` rejects
 * so the `use-sound` failure fallback can be exercised (R19.14).
 */
export function makeFakeSoundEngine(
  options: { readonly startRejects?: unknown } = {},
): FakeSoundEngine {
  const calls: string[] = [];
  const applied: { hum: boolean; click: boolean }[] = [];
  let starts = 0;
  let releases = 0;
  let clicks = 0;
  return {
    calls,
    applied,
    startCount: () => starts,
    releaseCount: () => releases,
    clickCount: () => clicks,
    start() {
      starts += 1;
      calls.push("start");
      if ("startRejects" in options) return Promise.reject(options.startRejects);
      return Promise.resolve();
    },
    apply(activity) {
      calls.push(`apply:${activity.hum ? 1 : 0}:${activity.click ? 1 : 0}`);
      applied.push({ ...activity });
    },
    click() {
      clicks += 1;
      calls.push("click");
    },
    release() {
      releases += 1;
      calls.push("release");
    },
  };
}

/** A `SoundLoaderPort` wrapper that records how many times the engine loaded. */
export interface FakeSoundLoader {
  readonly loader: SoundLoaderPort;
  readonly engine: FakeSoundEngine;
  loadCount(): number;
}

/**
 * Build a sound loader that resolves to a recording engine. When
 * `loaderRejects` is set, the loader itself rejects (the chunk failed to load),
 * which must also drive the `sound_off` fallback (R19.14).
 */
export function makeFakeSoundLoader(
  options: {
    readonly startRejects?: unknown;
    readonly loaderRejects?: unknown;
  } = {},
): FakeSoundLoader {
  const engine = makeFakeSoundEngine(
    "startRejects" in options ? { startRejects: options.startRejects } : {},
  );
  let loads = 0;
  const loader: SoundLoaderPort = () => {
    loads += 1;
    if ("loaderRejects" in options) return Promise.reject(options.loaderRejects);
    return Promise.resolve(engine);
  };
  return { loader, engine, loadCount: () => loads };
}

// ---------------------------------------------------------------------------
// TerminalPorts
// ---------------------------------------------------------------------------

/** The full bundle of fakes, with each concrete fake exposed for assertions. */
export interface FakeTerminalPorts {
  readonly ports: TerminalPorts;
  readonly storage: FakeStorage;
  readonly media: FakeMedia;
  readonly visibility: FakeVisibility;
  readonly frames: FakeFrames;
  readonly api: FakeApi;
  readonly demo: DemoPort;
  readonly sound: FakeSoundLoader;
}

/** Options for assembling a full set of fake terminal ports. */
export interface FakePortsOptions {
  readonly storage?: Readonly<Record<string, string>>;
  readonly prefersReducedMotion?: boolean;
  readonly visible?: boolean;
  readonly demoBundle?: DemoBundle | null;
  readonly demoRejects?: unknown;
  readonly soundStartRejects?: unknown;
  readonly soundLoaderRejects?: unknown;
}

/**
 * Assemble a complete, deterministic `TerminalPorts` from fakes, returning both
 * the `ports` object the Terminal is constructed with and the individual fakes
 * so a test can drive and inspect them.
 */
export function makeFakePorts(
  options: FakePortsOptions = {},
): FakeTerminalPorts {
  const storage = makeFakeStorage(options.storage ?? {});
  const media = makeFakeMedia(options.prefersReducedMotion ?? false);
  const visibility = makeFakeVisibility(options.visible ?? true);
  const frames = makeFakeFrames();
  const api = makeFakeApi();
  const demo = makeFakeDemo(
    options.demoBundle ?? null,
    "demoRejects" in options ? { reject: options.demoRejects } : {},
  );
  const sound = makeFakeSoundLoader({
    ...("soundStartRejects" in options
      ? { startRejects: options.soundStartRejects }
      : {}),
    ...("soundLoaderRejects" in options
      ? { loaderRejects: options.soundLoaderRejects }
      : {}),
  });

  const ports: TerminalPorts = {
    api,
    demo,
    storage,
    media,
    visibility,
    frames,
    sound: sound.loader,
  };

  return { ports, storage, media, visibility, frames, api, demo, sound };
}
