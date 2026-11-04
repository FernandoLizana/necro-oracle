// @necro/ui-crt — ports used by the Terminal (types only).
//
// Every side effect the terminal needs (browser storage, media queries, page
// visibility, animation frames, the readings API, the demo bundle and the lazy
// sound engine) is reached through one of these injected ports. The pure
// reducer and renderers never touch the DOM, network, clock or `window`
// directly; only the adapters behind these ports do.
//
// `prefs.save` goes through a wrapper that accepts only the two allowed
// preference keys, so the Output_Log, a Repo_Reference_String or a
// Reading_Response can never reach storage (R1.6).
//
// _Requirements: R16.3, R16.7_

import type { ApiPort, DemoPort } from "./protocol.js";

/** Synchronous key/value storage. Never throws. */
export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Observes the reduced-motion media query. */
export interface MediaPort {
  prefersReducedMotion(): boolean;
  subscribe(cb: (matches: boolean) => void): () => void;
}

/** Observes page visibility. */
export interface VisibilityPort {
  visible(): boolean;
  subscribe(cb: (visible: boolean) => void): () => void;
}

/** Animation-frame scheduler and clock. */
export interface FramePort {
  now(): number;
  request(cb: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

/** The lazily loaded Web Audio engine: hum and click, capped master gain. */
export interface SoundEngine {
  /** Create the AudioContext and resume it. */
  start(): Promise<void>;
  apply(activity: { hum: boolean; click: boolean }): void;
  click(): void;
  /** Stop the hum and close the context. */
  release(): void;
}

/** Loads the sound engine from a separate bundler chunk. */
export type SoundLoaderPort = () => Promise<SoundEngine>;

/** The full set of ports the Terminal is constructed with. */
export interface TerminalPorts {
  readonly api: ApiPort;
  readonly demo: DemoPort;
  readonly storage: StoragePort;
  readonly media: MediaPort;
  readonly visibility: VisibilityPort;
  readonly frames: FramePort;
  readonly sound: SoundLoaderPort;
}
