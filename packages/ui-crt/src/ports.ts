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
import type { SoundCue } from "./sound/sound-cue.js";
import type { BackgroundThemeLoaderPort } from "./sound/background-theme-engine.js";

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

/** The lazily loaded Web Audio engine: hum, click, cues, capped master gain. */
export interface SoundEngine {
  /** Create the AudioContext and resume it. */
  start(): Promise<void>;
  apply(activity: { hum: boolean; click: boolean }): void;
  click(): void;
  /**
   * Play one short Visual_Layer cue (boot, reveal, glitch, rebirth) as a
   * one-shot through the already-built graph, exactly like `click()`. The
   * caller gates this on `soundCueAllowed(state)`; the engine plays whatever it
   * is asked to and makes no Sound_State decision (R8.1).
   */
  cue(name: SoundCue): void;
  /**
   * Turn the ambient Resurrection_Animation hum on or off — a low continuous
   * drone layered additively under the base hum while the rot-then-rebirth
   * animation plays (visual-necromancy task 21.1). The caller gates this on
   * `ambientHumActive(...)`; the engine makes no Sound_State or Motion_Mode
   * decision and simply fades the drone to match (R13.1).
   */
  ambient(on: boolean): void;
  /** Stop the hum and close the context. */
  release(): void;
}

/** Loads the sound engine from a separate bundler chunk. */
export type SoundLoaderPort = () => Promise<SoundEngine>;

/**
 * Triggers a client-side download of a completed Ritual's unified Patch with no
 * server round-trip (R7.3). The implementation reaches the heavy `Blob`/`URL`
 * download helper through its own lazy chunk so the terminal initial route
 * stays within budget (R14.5); an empty `patch` is a no-op (R7.4). Resolves
 * once the download has been offered (or declined for an empty patch) and never
 * rejects.
 */
export type PatchDownloadPort = (
  patch: string,
  ritualId: string,
) => Promise<void>;

/**
 * Lazily yields the resurrection result-view component from its own bundler
 * chunk (oracle-landing-polish, Part B bug 2). This port exists so the heavy
 * `ResurrectionResult` view is reached only through a literal-path dynamic
 * import on first use and lands in its own lazily-loaded chunk, keeping the
 * terminal initial route within the <= 250 KB gzipped budget (R14.5, R9.1).
 *
 * The component type is deliberately `unknown` here: `@necro/ui-crt` must NOT
 * import the concrete `ResurrectionResult` component type, which lives in
 * `apps/web` — that would invert the dependency direction. `apps/web` supplies
 * the concrete port (`() => Promise<ResurrectionResultComponent>`), which is
 * assignable to this structural shape because `Promise<T>` is assignable to
 * `Promise<unknown>`. The resolved value is narrowed/cast back to the concrete
 * component by the apps/web host that mounts it (R9.8).
 */
export type ResurrectViewPort = () => Promise<unknown>;

/** The full set of ports the Terminal is constructed with. */
export interface TerminalPorts {
  readonly api: ApiPort;
  readonly demo: DemoPort;
  readonly storage: StoragePort;
  readonly media: MediaPort;
  readonly visibility: VisibilityPort;
  readonly frames: FramePort;
  readonly sound: SoundLoaderPort;
  readonly patchDownload: PatchDownloadPort;
  /**
   * Lazily loads the Web Audio Background_Theme engine chunk (Arcana_Visions).
   * OPTIONAL and default-absent: when omitted, the Background_Theme is never
   * loaded and never plays, so a host (and every `@necro/ui-crt` unit test)
   * that passes no `backgroundTheme` port behaves exactly as before and never
   * starts audio (R8.10). Production wires `loadBackgroundTheme`; the theme
   * still plays only once the pure `backgroundThemeActive` gate turns true
   * (sound on, after a gesture, visible, and not a test/CI run).
   */
  readonly backgroundTheme?: BackgroundThemeLoaderPort | undefined;
  /**
   * Whether the terminal is running under a test harness or CI (Arcana_Visions).
   * Forwarded straight into the pure `backgroundThemeActive(state, { isTest })`
   * gate so the Background_Theme NEVER starts in a test/CI run regardless of the
   * sound state (R8.10). OPTIONAL and default-`false`; production resolves it
   * from a `navigator.webdriver` / env signal in the browser adapters.
   */
  readonly isTest?: boolean | undefined;
  /**
   * Lazily loads the resurrection result-view component chunk
   * (oracle-landing-polish, Part B bug 2). OPTIONAL and default-absent: when
   * omitted, the resurrection view is simply never mounted through the port, so
   * a host (and every `@necro/ui-crt` unit test) that passes no `resurrectView`
   * port type-checks and behaves exactly as before (R9.8). Production wires
   * `createResurrectViewPort()`; the single reference keeps the loader in the
   * module graph so the bundler emits the `ResurrectionResult` as a distinct
   * chunk (R9.1). Typed structurally (`() => Promise<unknown>`) so this package
   * never depends on the concrete `apps/web` component type.
   */
  readonly resurrectView?: ResurrectViewPort | undefined;
}
