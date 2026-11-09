"use client";

// packages/ui-crt/src/hooks/use-css-vars.ts
//
// SEC-08: apply dynamic CSS custom properties to an element WITHOUT a
// CSP-blocked inline `style=` attribute.
//
// The CRT visuals drive per-element, runtime-computed values (integer scale,
// glitch offsets, motion-zone rects, ritual phase duration, Lovers rise delay)
// as CSS custom properties that the stylesheets multiply out. Setting them via
// a React `style={{ "--x": v }}` prop emits an inline `style=` ATTRIBUTE, which
// the strict nonce-only `style-src` CSP blocks (a nonce cannot apply to an
// attribute). Applying the same properties through the CSSOM
// (`element.style.setProperty`) is script-driven DOM mutation, governed by
// `script-src` (which already trusts our nonce'd / strict-dynamic bundle), so
// the values take effect while `style-src` stays locked with NO 'unsafe-inline'.
//
// The hook is a no-op until the element mounts, re-applies when the record
// changes (by identity of its serialized entries), and REMOVES any custom
// property that drops out of the record so a stale value never lingers. It
// only ever touches custom properties (keys starting with `--`); it never sets
// a static style property.

import { useLayoutEffect, type RefObject } from "react";

/** A map of CSS custom-property names (`--x`) to their string values. */
export type CssVars = Readonly<Record<string, string>>;

/**
 * Apply {@link vars} to `ref.current` as CSS custom properties via the CSSOM.
 *
 * Runs in a layout effect so the properties are set before paint (no flash of
 * unstyled scale). On each change it sets every current property and removes
 * any property present on the previous pass but absent now. Keys that do not
 * start with `--` are ignored (this hook is only for custom properties).
 */
export function useCssVars(
  ref: RefObject<HTMLElement | null>,
  vars: CssVars,
): void {
  // Serialize the record so the effect re-runs only when a name or value
  // actually changes, not on every render that passes a fresh object literal.
  const serialized = JSON.stringify(vars);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const next = JSON.parse(serialized) as Record<string, string>;
    const applied: string[] = [];
    for (const [name, value] of Object.entries(next)) {
      if (!name.startsWith("--")) continue;
      el.style.setProperty(name, value);
      applied.push(name);
    }

    // On cleanup (or before the next apply) remove exactly what we set, so a
    // custom property that drops out of the record does not linger.
    return () => {
      for (const name of applied) el.style.removeProperty(name);
    };
    // `serialized` captures the full record; `ref` is stable.
  }, [ref, serialized]);
}
