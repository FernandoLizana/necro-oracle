// Pure key-binding handler for the DMG Landing_State.
//
// Validates: Requirements R7.2, R7.3, R7.4, R7.5, R7.6, R7.7
//
// `landingKeyAction` maps a minimal key descriptor to a `LandingAction`. It is
// total and side-effect-free: it reads no DOM, clock, network or environment,
// never throws, and always returns exactly one action. Any key carrying an
// Alt/Ctrl/Meta modifier, or any key outside the binding set, returns `none`
// so the key falls through to the `NECRO>` input (browser shortcuts and the
// input's own editing keys are never stolen). Letter bindings are
// case-insensitive.

/** The minimal slice of a keyboard event the handler needs. */
export interface KeyDescriptor {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * A landing action produced from a key press:
 *  - `move`     — ▲▼ move the selection cursor up/down
 *  - `activate` — Enter or A: activate the selected row
 *  - `demo`     — B or D: run the demo
 *  - `help`     — H (START): show help
 *  - `none`     — not a landing binding; fall through to the NECRO> input
 */
export type LandingAction =
  | { readonly kind: "move"; readonly dir: "up" | "down" }
  | { readonly kind: "activate" }
  | { readonly kind: "demo" }
  | { readonly kind: "help" }
  | { readonly kind: "none" };

/**
 * Map a key descriptor to a `LandingAction`.
 *
 * Returns `none` for any key carrying an Alt/Ctrl/Meta modifier and for any
 * key outside the binding set. Letter keys are matched case-insensitively.
 *
 * @param ev - A well-formed key descriptor (`key` is non-null).
 * @returns Exactly one `LandingAction`.
 */
export function landingKeyAction(ev: KeyDescriptor): LandingAction {
  // Never steal a modified key: browser shortcuts and input editing win.
  if (ev.altKey || ev.ctrlKey || ev.metaKey) {
    return { kind: "none" };
  }

  switch (ev.key.toLowerCase()) {
    case "arrowup":
      return { kind: "move", dir: "up" };
    case "arrowdown":
      return { kind: "move", dir: "down" };
    case "enter":
    case "a":
      return { kind: "activate" };
    case "b":
    case "d":
      return { kind: "demo" };
    case "h":
      return { kind: "help" };
    default:
      return { kind: "none" };
  }
}
