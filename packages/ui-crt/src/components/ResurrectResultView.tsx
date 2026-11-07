"use client";

// packages/ui-crt/src/components/ResurrectResultView.tsx
//
// Feature: oracle-landing-polish, task 11.2 — the port-driven mount point for
// the resurrection result view (design.md §"Part B — resurrection chunk split"
// step 2; R9.2, R9.3, R9.4, R9.5, R18.1).
//
// This screen-only component is the one place `@necro/ui-crt` *uses* the
// `resurrectView` port. When a `resurrect` settles with a non-empty patch and a
// host wired the port (`createResurrectViewPort()` in `apps/web`), it lazily
// resolves the concrete `ResurrectionResult` component through the port and
// mounts it, so `load-resurrection-view.ts` is reachable from a LIVE render
// path — not merely referenced — and the literal-path dynamic import inside it
// (`import("../components/ResurrectionResult.js")`) genuinely fires, landing the
// heavy diff/vitality/patch renderer in its own lazily-loaded chunk. That is
// what makes `scripts/check-web-budget.mjs` locate a distinct, non-initial
// `ResurrectionResult` chunk WITHOUT loosening any budget (R9.3, R9.4, R9.5).
//
// Dependency direction (R9.8): `@necro/ui-crt` must NOT import the concrete
// `apps/web` `ResurrectionResult` component. The port is typed structurally as
// `() => Promise<unknown>`; the host (`apps/web`) supplies the concrete loader.
// Here the resolved value is narrowed back to a function component accepting the
// browser-safe props shape this package already owns (`ResurrectFileResult`,
// `patch`, `ritualId`) before it is rendered.
//
// The authoritative diff / Vitality_Delta text stays in the Output_Log (the
// Terminal renders it there, Spec behaviour preserved). To avoid duplicating
// that authoritative text, this view mounts `ResurrectionResult` with no file
// blocks (`files: []`) and only the Ritual's `patch` / `ritualId`, so the lazily
// loaded component contributes exactly its own patch-download control — which
// REPLACES the Terminal's former inline `DOWNLOAD PATCH` button — and nothing
// that is already in the log (R9.2). Mounting through the port is genuine use,
// not a dead reference, so the chunk is truly emitted and exercised.
//
// Graceful by construction: while the chunk loads (or if the host passed no
// port, or the load fails) the component renders the plain inline
// `DOWNLOAD PATCH` fallback the Terminal used before, so behaviour never
// regresses and the patch stays reachable (the authoritative diff/patch is also
// in the log). `?ritual=force` and every other resurrect behaviour are
// untouched — this view only governs how the download control is mounted.
//
// _Requirements: R9.2, R9.3, R9.4, R9.5, R18.1_

import { useEffect, useState } from "react";

import type { ResurrectViewPort } from "../ports.js";
import type { ResurrectFileResult } from "../protocol.js";

/**
 * The structural props shape the concrete `apps/web` `ResurrectionResult`
 * accepts. `@necro/ui-crt` knows every member from its own protocol types, so
 * it can describe the component it mounts without importing the app's concrete
 * component (dependency direction, R9.8).
 */
interface ResurrectionResultProps {
  readonly files: readonly ResurrectFileResult[];
  readonly patch?: string;
  readonly ritualId?: string;
}

/** The resolved component shape the port yields (narrowed from `unknown`). */
type ResurrectionResultComponent = (
  props: ResurrectionResultProps,
) => React.JSX.Element;

/** Props for the port-driven resurrection result view. */
export interface ResurrectResultViewProps {
  /**
   * The lazy resurrection-view port (`apps/web` `createResurrectViewPort()`).
   * OPTIONAL: when omitted, only the inline `DOWNLOAD PATCH` fallback renders,
   * so a port-less host (and every `@necro/ui-crt` unit test) behaves exactly as
   * before (R9.8).
   */
  readonly port?: ResurrectViewPort | undefined;
  /**
   * The settled Ritual's inline unified diff. Empty when nothing changed; a
   * non-empty patch is what makes a download control appear at all (R7.4).
   */
  readonly patch: string;
  /** The Ritual id, used only to name the downloaded `.patch` file. */
  readonly ritualId: string;
  /**
   * The inline-fallback download handler the Terminal already owns
   * (`downloadPatch`). Used until the lazy component resolves, or forever when
   * no port is wired, so the patch is always reachable.
   */
  readonly onDownload: () => void;
}

/**
 * Mount the resurrection patch-download control. With a wired port, lazily load
 * the concrete `ResurrectionResult` through it (keeping its own bundler chunk
 * live) and render it with no file blocks + the patch — so it contributes only
 * the download control, never re-rendering the authoritative log diff. Until it
 * resolves (and whenever no port is wired or the load fails) the plain inline
 * `DOWNLOAD PATCH` button is shown, so the control is always present.
 */
export function ResurrectResultView({
  port,
  patch,
  ritualId,
  onDownload,
}: ResurrectResultViewProps): React.JSX.Element | null {
  const [Component, setComponent] = useState<ResurrectionResultComponent | null>(
    null,
  );

  // Resolve the concrete component through the port once a port is present.
  // The literal-path dynamic import inside the port's loader fires here, so the
  // `ResurrectionResult` chunk is fetched the first time a resurrection result
  // is shown — never at page load (R9.3, R9.4). A failed load leaves the inline
  // fallback in place; the loader clears its own memo so a later mount retries.
  useEffect(() => {
    if (port === undefined) {
      setComponent(null);
      return;
    }
    let active = true;
    void port()
      .then((resolved) => {
        if (active) {
          // Narrow the structural `unknown` back to the concrete component
          // shape the host supplied (R9.8).
          setComponent(() => resolved as ResurrectionResultComponent);
        }
      })
      .catch(() => {
        // A failed chunk load keeps the inline fallback; the authoritative
        // diff/patch also lives in the log, so nothing is lost.
      });
    return () => {
      active = false;
    };
  }, [port]);

  const hasPatch = patch.length > 0;

  // Once the lazy component is resolved, mount it with NO file blocks + the
  // patch/ritualId, so it renders only its own patch-download control — the
  // piece not already in the authoritative log — and the chunk is genuinely
  // used (R9.2). An empty patch yields no control inside the component (R7.4).
  if (Component !== null) {
    return <Component files={[]} patch={patch} ritualId={ritualId} />;
  }

  // Inline fallback: the plain `DOWNLOAD PATCH` button, shown while the chunk
  // loads or when no port is wired. Absent for an empty patch (R7.4).
  if (!hasPatch) {
    return null;
  }
  return (
    <button type="button" className="crt-patch-download" onClick={onDownload}>
      DOWNLOAD PATCH
    </button>
  );
}

export default ResurrectResultView;
