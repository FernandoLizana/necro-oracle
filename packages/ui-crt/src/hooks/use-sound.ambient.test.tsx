// @vitest-environment jsdom
//
// src/hooks/use-sound.ambient.test.tsx
//
// Feature: visual-necromancy, task 21.1 (OPTIONAL polish, Requirement 13).
//
// `useSound` ambient-hum tests. They complement the pure `ambient-hum.test.ts`
// gate tests by exercising the hook's `ambient` flag end-to-end against the
// recording fake engine, asserting on `engine.ambients` (every `ambient(on)`
// call, in order):
//   - sound on + loaded engine + ambient flag true => the drone turns on once,
//     and off once when the flag drops (stops at rebirth / reduced / off) (R13.1);
//   - ambient true before any engine is live (sound off) => nothing plays, and a
//     later `sound on` does not retroactively start a stale drone (R13.1);
//   - a redundant unchanged flag does not re-call the engine.
//
// Every effect flows through the fake `SoundLoaderPort` / `VisibilityPort`; no
// real Web Audio, clock, network or randomness is used.
//
// Validates: Requirements 13.1, 13.4

import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeFakeSoundLoader, makeFakeVisibility } from "../testing/fake-ports.js";
import type { SoundState } from "../sound/sound-reducer.js";
import { useSound } from "./use-sound.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Sound fully on: preference on + gesture + visible (the engine can be live). */
const ON: SoundState = { preference: "on", gesture: true, visible: true };

/** A host that mounts `useSound` with the given state + ambient flag. */
function Host(props: {
  loader: ReturnType<typeof makeFakeSoundLoader>["loader"];
  visibility: ReturnType<typeof makeFakeVisibility>;
  state: SoundState;
  ambient: boolean;
  dispatch: (event: { type: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useSound({
    loader: props.loader,
    visibility: props.visibility,
    state: props.state,
    dispatch: props.dispatch,
    rootRef,
    ambient: props.ambient,
  });
  return (
    <div ref={rootRef} data-testid="root">
      <input aria-label="Command" />
    </div>
  );
}

/** Let the engine's lazy load + start promises settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("R13.1 (ambient plays with sound on): the drone turns on then off once", () => {
  it("calls engine.ambient(true) when the flag rises and ambient(false) when it drops", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();

    // Bring the lazy engine up first (sound on), no ambient yet.
    const { rerender } = render(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        ambient={false}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.ambients).toEqual([]);

    // The resurrection animation starts: the drone turns on exactly once.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        ambient={true}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.ambients).toEqual([true]);

    // Rebirth / reduced / off: the flag drops and the drone fades out once.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        ambient={false}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.ambients).toEqual([true, false]);
  });

  it("does not re-call the engine for an unchanged flag on an unrelated rerender", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();

    const { rerender } = render(
      <Host loader={loader} visibility={visibility} state={ON} ambient={false} dispatch={dispatch} />,
    );
    await settle();

    rerender(
      <Host loader={loader} visibility={visibility} state={ON} ambient={true} dispatch={dispatch} />,
    );
    await settle();
    expect(engine.ambients).toEqual([true]);

    // Same flag, unrelated rerender: still a single on-call.
    rerender(
      <Host loader={loader} visibility={visibility} state={ON} ambient={true} dispatch={dispatch} />,
    );
    await settle();
    expect(engine.ambients).toEqual([true]);
  });
});

describe("R13.1 (default-off / gesture-gated): no engine => no drone", () => {
  it("plays nothing while sound is off, even with the ambient flag true (silent while off)", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const off: SoundState = { preference: "off", gesture: true, visible: true };

    render(
      <Host loader={loader} visibility={visibility} state={off} ambient={true} dispatch={dispatch} />,
    );
    await settle();

    // No engine was ever loaded, so no drone and no load.
    expect(engine.ambients).toEqual([]);
    expect(engine.startCount()).toBe(0);
  });

  it("does not retroactively start a stale drone when sound later turns on", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const noGesture: SoundState = { preference: "on", gesture: false, visible: true };

    // Ambient flag true before any gesture: no engine, no drone.
    const { rerender } = render(
      <Host loader={loader} visibility={visibility} state={noGesture} ambient={true} dispatch={dispatch} />,
    );
    await settle();
    expect(engine.ambients).toEqual([]);

    // Sound turns fully on (gesture happened). The Terminal re-derives the gate
    // each render; here the flag is still true, so once the engine is live the
    // drone starts cleanly — it was never a retroactive stale start, because
    // nothing was buffered while the engine was absent.
    rerender(
      <Host loader={loader} visibility={visibility} state={ON} ambient={true} dispatch={dispatch} />,
    );
    await settle();
    // The engine came up for sound-on, and the live flag turned the drone on.
    expect(engine.startCount()).toBe(1);
    expect(engine.ambients).toEqual([true]);
  });
});
