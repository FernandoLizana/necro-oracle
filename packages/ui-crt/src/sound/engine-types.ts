// src/sound/engine-types.ts
//
// Feature: 03-crt-terminal, task 16.2.
//
// Internal types shared by the lazy Web Audio engine chunk (`engine.ts`). The
// public `SoundEngine` and `SoundLoaderPort` interfaces live in `../ports.ts`
// and are NOT duplicated here. This module only names the small internal
// shapes the engine passes around.
//
// Requirements: R19.3, R19.4, R19.9, R19.10, R19.17

/**
 * The activity the engine reacts to, re-stated locally so the engine chunk
 * does not depend on the sound reducer. Mirrors `SoundEngine.apply`'s argument
 * and `SoundActivity` from `sound-reducer.ts`.
 */
export interface EngineActivity {
  /** Whether the ambient hum should be playing. */
  readonly hum: boolean;
  /** Whether keystroke clicks are allowed. */
  readonly click: boolean;
}

/**
 * The live Web Audio graph the engine builds inside `start()`. Held only while
 * the context is running; dropped on `release()`.
 */
export interface AudioGraph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly humGain: GainNode;
  readonly clickGain: GainNode;
  readonly oscillators: readonly OscillatorNode[];
  readonly clickBuffer: AudioBuffer;
}
