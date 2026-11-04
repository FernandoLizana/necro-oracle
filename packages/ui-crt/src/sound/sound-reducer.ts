// src/sound/sound-reducer.ts
//
// Feature: 03-crt-terminal, task 13.2.
//
// Pure state machine for CRT sound. It decides whether the ambient Hum and
// the keystroke Click may play, given the user's stored preference, whether a
// user gesture has occurred (browsers require one before audio can start) and
// whether the document is visible. This module performs NO audio, DOM or
// storage access — it only computes state transitions and activation.
//
// See design.md §"Sound reducer (sound/sound-reducer.ts)" and Property 26.
//
// Requirements: R19.1, R19.2, R19.7, R19.8, R19.13, R19.16

/**
 * The persisted sound setting. Mirrors the prefs module literal union
 * (design §"Motion and preferences"). Declared locally so this reducer stands
 * alone and does not depend on the prefs module path.
 */
export type SoundPreference = "on" | "off";

/** The full reducer state. */
export interface SoundState {
  /** Whether the user has sound turned on or off. */
  readonly preference: SoundPreference;
  /**
   * Whether a user gesture has occurred since `load`. Browsers block audio
   * until the first gesture, so no sound may play while this is false.
   */
  readonly gesture: boolean;
  /** Whether the document is currently visible. */
  readonly visible: boolean;
}

/** Every event the reducer understands. */
export type SoundEvent =
  | { readonly type: "load"; readonly preference: SoundPreference; readonly visible: boolean }
  | { readonly type: "sound_on" }
  | { readonly type: "sound_off" }
  | { readonly type: "gesture" }
  | { readonly type: "hidden" }
  | { readonly type: "visible" };

/**
 * Reduce one event into a new state.
 *
 * - `load` seeds from the stored preference and visibility but always resets
 *   `gesture` to false, so no sound plays at load even when the stored
 *   preference is `on`.
 * - `sound_on` / `sound_off` set the preference.
 * - `gesture` is the ONLY event that sets `gesture` to true.
 * - `hidden` / `visible` toggle visibility.
 */
export function soundReducer(state: SoundState, event: SoundEvent): SoundState {
  switch (event.type) {
    case "load":
      return { preference: event.preference, gesture: false, visible: event.visible };
    case "sound_on":
      return { ...state, preference: "on" };
    case "sound_off":
      return { ...state, preference: "off" };
    case "gesture":
      return { ...state, gesture: true };
    case "hidden":
      return { ...state, visible: false };
    case "visible":
      return { ...state, visible: true };
  }
}

/** Whether the Hum and the Click may play. */
export interface SoundActivity {
  readonly hum: boolean;
  readonly click: boolean;
}

/**
 * Compute activation. The Hum and the Click share the identical condition:
 * the preference is `on`, a gesture has occurred and the document is visible.
 */
export function soundActivity(state: SoundState): SoundActivity {
  const active = state.preference === "on" && state.gesture && state.visible;
  return { hum: active, click: active };
}
