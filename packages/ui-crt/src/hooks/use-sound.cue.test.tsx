// @vitest-environment jsdom
//
// src/hooks/use-sound.cue.test.tsx
//
// Feature: visual-necromancy, task 15.2.
//
// `useSound` cue-behavior tests. These complement the pure `sound-cue.test.ts`
// gate tests by exercising the hook's `cueRequest` path end-to-end against the
// recording fake engine. They drive `cueRequest` + `state` through a tiny host
// and assert on `engine.cues` / `engine.cueCount()`:
//   - sound on + loaded engine + new request => the cue plays exactly once (R8.1);
//   - sound off => no cue ever plays — silent while off (R8.2), off by default (R8.4);
//   - before the gesture => no cue, and a later `sound on`/gesture does NOT
//     retroactively fire the earlier (stale) request (R8.3);
//   - a cue fires with sound on regardless of motion — `useSound` has no motion
//     input, so the independence is structural (R8.5).
//
// Every effect flows through the fake `SoundLoaderPort` / `VisibilityPort`; no
// real Web Audio, clock, network or randomness is used.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5

import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeFakeSoundLoader,
  makeFakeVisibility,
} from "../testing/fake-ports.js";
import type { SoundState } from "../sound/sound-reducer.js";
import { useSound, type SoundCueRequest } from "./use-sound.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The one state in which cues may play: on + gesture + visible. */
const ON: SoundState = { preference: "on", gesture: true, visible: true };

/** A host that mounts `useSound` with the given state + cue request. */
function Host(props: {
  loader: ReturnType<typeof makeFakeSoundLoader>["loader"];
  visibility: ReturnType<typeof makeFakeVisibility>;
  state: SoundState;
  cueRequest: SoundCueRequest | null;
  dispatch: (event: { type: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useSound({
    loader: props.loader,
    visibility: props.visibility,
    state: props.state,
    dispatch: props.dispatch,
    rootRef,
    cueRequest: props.cueRequest,
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

describe("R8.1 (cue fires): a new request plays the cue once when sound is on", () => {
  it("calls engine.cue(name) exactly once for a fresh seq", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();

    const { rerender } = render(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={null}
        dispatch={dispatch}
      />,
    );
    // The activity effect loads + starts the engine when sound turns on.
    await settle();
    expect(engine.cueCount()).toBe(0);

    // A fresh request arrives: the cue plays once.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={{ seq: 1, name: "reveal" }}
        dispatch={dispatch}
      />,
    );
    await settle();

    expect(engine.cueCount()).toBe(1);
    expect(engine.cues).toEqual(["reveal"]);
  });

  it("does not replay the same seq on an unrelated rerender", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();

    // Mount with the engine turning on but no request yet, so the lazy engine
    // is live before the first cue request advances (its normal lifecycle).
    const { rerender } = render(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={null}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(0);

    // First real request: the cue plays once.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={{ seq: 7, name: "rebirth" }}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(1);

    // Same seq, a new object identity, unrelated rerender: still one play.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={{ seq: 7, name: "rebirth" }}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(1);
  });
});

describe("R8.2 / R8.4 (silent while off): sound off fires no cue", () => {
  it("plays nothing when the preference is off (off by default, silent while off)", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const off: SoundState = { preference: "off", gesture: true, visible: true };

    render(
      <Host
        loader={loader}
        visibility={visibility}
        state={off}
        cueRequest={{ seq: 1, name: "glitch" }}
        dispatch={dispatch}
      />,
    );
    await settle();

    expect(engine.cueCount()).toBe(0);
    expect(engine.cues).toEqual([]);
  });
});

describe("R8.3 (no autoplay / never before gesture): a pre-gesture request is swallowed", () => {
  it("fires no cue before the gesture and does NOT retroactively fire the stale request once sound turns on", async () => {
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();
    const noGesture: SoundState = {
      preference: "on",
      gesture: false,
      visible: true,
    };
    const staleRequest: SoundCueRequest = { seq: 3, name: "boot" };

    // Request arrives before any gesture: the hook swallows it (no cue).
    const { rerender } = render(
      <Host
        loader={loader}
        visibility={visibility}
        state={noGesture}
        cueRequest={staleRequest}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(0);

    // Sound later turns fully on, but the SAME (stale) seq must not replay.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={staleRequest}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(0);

    // A genuinely new request after the gesture does play, proving the engine
    // is live and only the stale seq was suppressed.
    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={{ seq: 4, name: "boot" }}
        dispatch={dispatch}
      />,
    );
    await settle();
    expect(engine.cueCount()).toBe(1);
    expect(engine.cues).toEqual(["boot"]);
  });
});

describe("R8.5 (sound/motion independence): a cue fires with sound on regardless of motion", () => {
  it("plays the cue when sound is on — useSound takes no motion input, so reduced vs full motion cannot block it", async () => {
    // `useSound` has no Motion_Mode parameter at all, so there is no reduced
    // path to exercise here: the independence is structural. We assert the cue
    // fires whenever sound is on, which is exactly the reduced-motion behavior.
    const { loader, engine } = makeFakeSoundLoader();
    const visibility = makeFakeVisibility(true);
    const dispatch = vi.fn();

    // Bring the lazy engine up first, then advance the cue request — the same
    // lifecycle the Terminal drives. Sound is on; there is no motion input.
    const { rerender } = render(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={null}
        dispatch={dispatch}
      />,
    );
    await settle();

    rerender(
      <Host
        loader={loader}
        visibility={visibility}
        state={ON}
        cueRequest={{ seq: 1, name: "glitch" }}
        dispatch={dispatch}
      />,
    );
    await settle();

    expect(engine.cueCount()).toBe(1);
    expect(engine.cues).toEqual(["glitch"]);
  });
});
