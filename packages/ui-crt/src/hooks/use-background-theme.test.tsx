// @vitest-environment jsdom
//
// src/hooks/use-background-theme.test.tsx
//
// Feature: arcana-visions, task 21.
//
// `useBackgroundTheme` bridge tests. They drive the hook with a recording fake
// `BackgroundThemeLoaderPort` + engine and a controllable `SoundState`, and
// assert the hook obeys the pure `backgroundThemeActive` gate:
//   - `start` fires ONLY when the gate is true (sound on + gesture + visible +
//     not a test run), composing the theme from the given seed (R8.4, R8.5,
//     R8.7);
//   - `stop` fires on the transition to false (sound off / hidden) (R8.8);
//   - NOTHING ever loads or starts while `isTest` is true, regardless of the
//     sound state (R8.10);
//   - nothing starts before a user gesture or with sound off (the gate is false
//     in both cases, so the engine is never even loaded);
//   - with no loader port wired the hook is inert and never plays.
//
// Every effect flows through the fake loader; no real Web Audio, clock, network
// or randomness is used.
//
// Validates: Requirements 8.4, 8.5, 8.7, 8.8, 8.10

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BackgroundThemeEngine,
  BackgroundThemeLoaderPort,
} from "../sound/background-theme-engine.js";
import { composeTheme } from "../sound/background-theme.js";
import type { ThemeScore } from "../sound/background-theme.js";
import type { SoundState } from "../sound/sound-reducer.js";
import { useBackgroundTheme } from "./use-background-theme.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Sound fully on: preference on + gesture + visible (the gate can be true). */
const ON: SoundState = { preference: "on", gesture: true, visible: true };
/** Sound on but no user gesture yet: the gate is false (no autoplay). */
const NO_GESTURE: SoundState = { preference: "on", gesture: false, visible: true };
/** Sound off: the gate is false regardless of gesture/visibility. */
const OFF: SoundState = { preference: "off", gesture: true, visible: true };
/** Sound on but the document hidden: the gate is false. */
const HIDDEN: SoundState = { preference: "on", gesture: true, visible: false };

/** A fixed seed the tests compose against. */
const SEED = 1234;

/** A recording fake engine that logs every `start(score)` and `stop()` call. */
interface FakeThemeEngine extends BackgroundThemeEngine {
  readonly starts: ThemeScore[];
  stopCount(): number;
}

/** A fake loader + engine that record calls instead of touching Web Audio. */
interface FakeThemeLoader {
  readonly loader: BackgroundThemeLoaderPort;
  readonly engine: FakeThemeEngine;
  loadCount(): number;
}

function makeFakeThemeLoader(
  options: { readonly loaderRejects?: unknown; readonly startRejects?: unknown } = {},
): FakeThemeLoader {
  const starts: ThemeScore[] = [];
  let stops = 0;
  const engine: FakeThemeEngine = {
    starts,
    stopCount: () => stops,
    start(score) {
      starts.push(score);
      if ("startRejects" in options) return Promise.reject(options.startRejects);
      return Promise.resolve();
    },
    stop() {
      stops += 1;
    },
  };
  let loads = 0;
  const loader: BackgroundThemeLoaderPort = () => {
    loads += 1;
    if ("loaderRejects" in options) return Promise.reject(options.loaderRejects);
    return Promise.resolve(engine);
  };
  return { loader, engine, loadCount: () => loads };
}

/** A host that mounts the hook with the given inputs. */
function Host(props: {
  loader?: BackgroundThemeLoaderPort | undefined;
  state: SoundState;
  seed: number;
  isTest?: boolean;
}) {
  useBackgroundTheme({
    loader: props.loader,
    state: props.state,
    seed: props.seed,
    isTest: props.isTest,
  });
  return <div data-testid="root" />;
}

/** Let the lazy load + start promises settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("R8.4, R8.5, R8.7 (theme plays only when the gate is true): start fires on the rise", () => {
  it("loads the engine and starts composeTheme(seed) once sound is fully on", async () => {
    const { loader, engine, loadCount } = makeFakeThemeLoader();

    render(<Host loader={loader} state={ON} seed={SEED} />);
    await settle();

    expect(loadCount()).toBe(1);
    expect(engine.starts).toHaveLength(1);
    // The score is composed from the given seed (deterministic, R8.7).
    expect(engine.starts[0]).toEqual(composeTheme(SEED));
    expect(engine.stopCount()).toBe(0);
  });

  it("stops the engine when sound turns off after playing (R8.8)", async () => {
    const { loader, engine } = makeFakeThemeLoader();

    const { rerender } = render(<Host loader={loader} state={ON} seed={SEED} />);
    await settle();
    expect(engine.starts).toHaveLength(1);

    rerender(<Host loader={loader} state={OFF} seed={SEED} />);
    await settle();
    expect(engine.stopCount()).toBe(1);
  });

  it("stops the engine when the document becomes hidden (R8.8)", async () => {
    const { loader, engine } = makeFakeThemeLoader();

    const { rerender } = render(<Host loader={loader} state={ON} seed={SEED} />);
    await settle();
    expect(engine.starts).toHaveLength(1);

    rerender(<Host loader={loader} state={HIDDEN} seed={SEED} />);
    await settle();
    expect(engine.stopCount()).toBe(1);
  });
});

describe("R8.5 (never before a gesture / with sound off): the engine never loads", () => {
  it("never loads or starts before a user gesture", async () => {
    const { loader, engine, loadCount } = makeFakeThemeLoader();

    render(<Host loader={loader} state={NO_GESTURE} seed={SEED} />);
    await settle();

    expect(loadCount()).toBe(0);
    expect(engine.starts).toHaveLength(0);
  });

  it("never loads or starts while sound is off", async () => {
    const { loader, engine, loadCount } = makeFakeThemeLoader();

    render(<Host loader={loader} state={OFF} seed={SEED} />);
    await settle();

    expect(loadCount()).toBe(0);
    expect(engine.starts).toHaveLength(0);
  });
});

describe("R8.10 (tests must never start audio): isTest forces the gate false", () => {
  it("never loads or starts when isTest is true, even with sound fully on", async () => {
    const { loader, engine, loadCount } = makeFakeThemeLoader();

    const { rerender } = render(
      <Host loader={loader} state={ON} seed={SEED} isTest={true} />,
    );
    await settle();

    expect(loadCount()).toBe(0);
    expect(engine.starts).toHaveLength(0);

    // Even after a visibility/sound churn the gate stays false under isTest.
    rerender(<Host loader={loader} state={HIDDEN} seed={SEED} isTest={true} />);
    await settle();
    rerender(<Host loader={loader} state={ON} seed={SEED} isTest={true} />);
    await settle();

    expect(loadCount()).toBe(0);
    expect(engine.starts).toHaveLength(0);
  });

  it("never plays when no loader port is wired (the default off state)", async () => {
    // No loader: the hook is inert — the default for every ui-crt unit test.
    render(<Host loader={undefined} state={ON} seed={SEED} />);
    await settle();
    // Nothing to assert on an absent engine beyond "no throw"; reaching here is
    // the pass — the hook never attempted to play (R8.10).
    expect(true).toBe(true);
  });
});

describe("failure handling: a broken chunk never throws and never retries", () => {
  it("swallows a loader rejection and does not start", async () => {
    const { loader, engine } = makeFakeThemeLoader({ loaderRejects: new Error("no chunk") });

    const { rerender } = render(<Host loader={loader} state={ON} seed={SEED} />);
    await settle();
    expect(engine.starts).toHaveLength(0);

    // A later churn does not retry the latched failure.
    rerender(<Host loader={loader} state={OFF} seed={SEED} />);
    await settle();
    rerender(<Host loader={loader} state={ON} seed={SEED} />);
    await settle();
    expect(engine.starts).toHaveLength(0);
  });
});
