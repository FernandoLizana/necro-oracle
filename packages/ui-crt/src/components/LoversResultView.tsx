"use client";

// packages/ui-crt/src/components/LoversResultView.tsx
//
// Feature: lovers-binding, task 14.4 — the port-driven mount point for the DMG
// Lovers split view (design §C.6; R22.1, R31.1). This is the lovers twin of
// `ResurrectResultView`: the one place `@necro/ui-crt` *uses* the `loversView`
// port.
//
// When a `lovers` binding settles (`state.lastLovers !== null`) and a host
// wired the port (`createLoversViewPort()` in `apps/web`), it lazily resolves
// the concrete `LoversView` component through the port and mounts it with the
// settled `LoversResponse`, so `load-lovers-view.ts` is reachable from a LIVE
// render path — not merely referenced — and the literal-path dynamic import
// inside it (`import("../components/LoversView.js")`) genuinely fires, landing
// the heavy DMG split view in its own lazily-loaded `lovers-view` chunk. That
// is what keeps the terminal initial route within the <= 250 KB gzipped budget
// while still rendering the full split view on a resolved result (R31.1, R31.2).
//
// Dependency direction: `@necro/ui-crt` must NOT import the concrete `apps/web`
// `LoversView` component. The port is typed structurally as
// `() => Promise<unknown>`; the host supplies the concrete loader. Here the
// resolved value is narrowed back to a function component accepting the
// browser-safe `LoversResponse` this package already owns before it is rendered.
//
// The authoritative result summary (functions bound, path, souls spent) stays
// in the Output_Log (the reducer renders it there); this view contributes ONLY
// the DMG pixel split view the log cannot show. When no port is wired, or while
// the chunk loads, or if the load fails, it renders `null` — the log summary
// is always present, so nothing is lost and a port-less host (and every unit
// test) behaves exactly as before.
//
// _Requirements: R22.1, R31.1_

import { useEffect, useState } from "react";

import type { LoversViewPort } from "../ports.js";
import type { LoversResponse } from "../protocol.js";

/**
 * The structural props shape the concrete `apps/web` `LoversView` accepts.
 * `@necro/ui-crt` knows every member from its own protocol types, so it can
 * describe the component it mounts without importing the app's concrete
 * component (dependency direction).
 */
interface LoversViewComponentProps {
  readonly result: LoversResponse;
}

/** The resolved component shape the port yields (narrowed from `unknown`). */
type LoversViewComponent = (
  props: LoversViewComponentProps,
) => React.JSX.Element;

/** Props for the port-driven Lovers result view. */
export interface LoversResultViewProps {
  /**
   * The lazy lovers-view port (`apps/web` `createLoversViewPort()`). OPTIONAL:
   * when omitted, nothing is mounted (the log summary stands alone), so a
   * port-less host (and every `@necro/ui-crt` unit test) behaves exactly as
   * before.
   */
  readonly port?: LoversViewPort | undefined;
  /** The settled Lovers binding result the DMG split view renders. */
  readonly result: LoversResponse;
}

/**
 * Mount the DMG Lovers split view. With a wired port, lazily load the concrete
 * `LoversView` through it (keeping its own bundler chunk live) and render it
 * with the settled result. Until it resolves (and whenever no port is wired or
 * the load fails) nothing is rendered — the authoritative summary already lives
 * in the Output_Log.
 */
export function LoversResultView({
  port,
  result,
}: LoversResultViewProps): React.JSX.Element | null {
  const [Component, setComponent] = useState<LoversViewComponent | null>(null);

  // Resolve the concrete component through the port once a port is present.
  // The literal-path dynamic import inside the port's loader fires here, so the
  // `lovers-view` chunk is fetched the first time a binding result is shown —
  // never at page load. A failed load leaves nothing mounted; the loader clears
  // its own memo so a later binding retries.
  useEffect(() => {
    if (port === undefined) {
      setComponent(null);
      return;
    }
    let active = true;
    void port()
      .then((resolved) => {
        if (active) {
          setComponent(() => resolved as LoversViewComponent);
        }
      })
      .catch(() => {
        // A failed chunk load mounts nothing; the authoritative summary is in
        // the log, so nothing is lost.
      });
    return () => {
      active = false;
    };
  }, [port]);

  if (Component !== null) {
    return <Component result={result} />;
  }
  return null;
}

export default LoversResultView;
