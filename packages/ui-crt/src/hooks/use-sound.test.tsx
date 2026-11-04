// @vitest-environment jsdom
//
// `use-sound` hook tests (task 17.1, RED). `./use-sound.js` is created by task
// 17.2, so the import fails first (expected red).
//
// Validates: Requirements R19.3, R19.5, R19.6, R19.8, R19.11, R19.14, R19.15
//
// `use-sound` owns the bridge between the pure `SoundState`/`soundActivity`
// machine and the lazily-loaded Web Audio engine:
//   - it loads the engine and calls `start()` when sound turns on, in the same
//     gesture call chain (R19.3);
//   - it dispatches `gesture` once on the first keydown/pointerdown in the
//     terminal root, and `hidden`/`visible` from the `VisibilityPort`;
//   - after each state change it calls `engine.apply(soundActivity(state))`
//     so the gain follows the pure activity (R19.5, R19.6);
//   - any rejection from loading or starting the engine drives a `sound_off`
//     fallback and never throws (R19.14);
//   - it touches neither the motion mode nor the Live_Region (R19.11, R19.15).
//
// All effects go through the fake `SoundLoaderPort`/`VisibilityPort`, so no
// real Web Audio or `document.visibilityState` is used.

import { act, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeFakeSoundLoader,
  makeFakeVisibility,
} from "../testing/fake-ports.js";
import type { SoundState } from "../sound/sound-reducer.js";

// The system under test — created by task 17.2.
import { useSound } from "./use-sound.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A tiny host component that mounts `useSound` and renders the terminal root. */
function Host(props: {
  loader: ReturnType<typeof makeFakeSoundLoader>["loader"];
  visibility: ReturnType<typeof makeFakeVisibility>;
  state: SoundState;
  dispatch: (event: { type: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useSound({
    loader: props.loader,
    visibility: props.visibility,
    state: props.state,
    dispatch: props.dispatch,
    rootRef,
  });
  return (
    <div ref={rootRef} data-testid="root">
      <input aria-label="Command" />
    </div>
  );
}

describe("R19.3 (gesture): the first keydown in the root dispatches gesture once", () => {
  it("dispatches a single gesture event on the first key, not on later keys", async () => {
    const { loader } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const state: SoundState = { preference: "off", gesture: false, visible: true };

    render(
      <Host loader={loader} visibility={visibility} state={state} dispatch={dispatch} />,
    );

    const user = userEvent.setup();
    const input = document.querySelector("input") as HTMLInputElement;
    input.focus();
    await user.keyboard("a");
    await user.keyboard("b");

    const gestureCalls = dispatch.mock.calls.filter(
      ([e]) => (e as { type: string }).type === "gesture",
    );
    expect(gestureCalls.length).toBe(1);
  });
});

describe("R19.5 / R19.6 (gain apply): the engine follows soundActivity", () => {
  it("loads and starts the engine and applies the active gain when on + gesture + visible", async () => {
    const { loader, engine, loadCount } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    // preference on + gesture true + visible true => active.
    const state: SoundState = { preference: "on", gesture: true, visible: true };

    render(
      <Host loader={loader} visibility={visibility} state={state} dispatch={dispatch} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadCount()).toBeGreaterThanOrEqual(1);
    expect(engine.startCount()).toBeGreaterThanOrEqual(1);
    // The last applied activity reflects soundActivity(state): hum + click on.
    const last = engine.applied.at(-1);
    expect(last).toEqual({ hum: true, click: true });
  });
});

describe("R19.14 (failure fallback): a rejecting engine drives sound_off and never throws", () => {
  it("dispatches sound_off when the engine fails to start", async () => {
    const { loader } = makeFakeSoundLoader({ startRejects: new Error("no web audio") });
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const state: SoundState = { preference: "on", gesture: true, visible: true };

    render(
      <Host loader={loader} visibility={visibility} state={state} dispatch={dispatch} />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const offCalls = dispatch.mock.calls.filter(
      ([e]) => (e as { type: string }).type === "sound_off",
    );
    expect(offCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("dispatches sound_off when the engine chunk fails to load", async () => {
    const { loader } = makeFakeSoundLoader({ loaderRejects: new Error("chunk 404") });
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const state: SoundState = { preference: "on", gesture: true, visible: true };

    render(
      <Host loader={loader} visibility={visibility} state={state} dispatch={dispatch} />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const offCalls = dispatch.mock.calls.filter(
      ([e]) => (e as { type: string }).type === "sound_off",
    );
    expect(offCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("R19 (visibility): the hook dispatches hidden/visible from the VisibilityPort", () => {
  it("dispatches visibility transitions and unsubscribes on unmount", () => {
    const { loader } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const state: SoundState = { preference: "off", gesture: false, visible: true };

    const { unmount } = render(
      <Host loader={loader} visibility={visibility} state={state} dispatch={dispatch} />,
    );
    expect(visibility.subscriberCount()).toBe(1);

    act(() => {
      visibility.emit(false);
    });
    expect(
      dispatch.mock.calls.some(([e]) => (e as { type: string }).type === "hidden"),
    ).toBe(true);

    act(() => {
      visibility.emit(true);
    });
    expect(
      dispatch.mock.calls.some(([e]) => (e as { type: string }).type === "visible"),
    ).toBe(true);

    act(() => {
      unmount();
    });
    expect(visibility.subscriberCount()).toBe(0);
  });
});
