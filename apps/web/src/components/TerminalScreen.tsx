"use client";

// apps/web/src/components/TerminalScreen.tsx
//
// Feature: 03-crt-terminal, task 27.2 — the client mount point for the CRT
// terminal (design.md §"React components and DOM structure", R18.8).
//
// This is the one client component the Terminal_Route mounts. It builds the
// browser `TerminalPorts` once (on mount) and renders the `@necro/ui-crt`
// `<Terminal>`, which owns the whole `<main class="crt">` shell, the live
// region, the command line and the `<noscript>` fallback. Building the ports
// here (not at module scope) keeps `window`/`document` access out of the
// import path, so the server render of this client component does not touch
// browser globals.
//
// After boot it best-effort prefetches the Demo_Bundle during an idle period so
// the first `demo <name>` is instant (R18.8). The prefetch is fire-and-forget:
// any failure is swallowed (the bundle loader clears its memo on failure, so a
// later `demo` retries). `requestIdleCallback` is used when available, with a
// `setTimeout` fallback for Safari, which does not implement it.
//
// Client boundary (R16.4): this file imports only `@necro/ui-crt` and the
// sibling browser-ports factory — never `@necro/github`, the oracle main entry,
// or `node:*`.
//
// _Requirements: R16.4, R18.8_

import { useEffect, useMemo } from "react";

import { Terminal } from "@necro/ui-crt";
import type { TerminalPorts } from "@necro/ui-crt";

import { createBrowserPorts } from "../terminal/browser-ports.js";

/** The idle-prefetch fallback delay for browsers without requestIdleCallback. */
const IDLE_FALLBACK_MS = 2000;

/** The live CRT terminal, constructed with the real browser ports. */
export default function TerminalScreen(): React.JSX.Element {
  // Build the ports exactly once for the life of the mount. `useMemo` with an
  // empty dep list runs the factory on the client after hydration, so the
  // browser globals it reads are live.
  const ports: TerminalPorts = useMemo(() => createBrowserPorts(), []);

  // Best-effort idle prefetch of the Demo_Bundle after boot (R18.8). A failure
  // is intentionally swallowed; the loader clears its memo so a later `demo`
  // command retries the load.
  useEffect(() => {
    const prefetch = (): void => {
      void ports.demo.load().catch(() => {
        // Ignore: prefetch is best-effort; `demo <name>` will retry.
      });
    };

    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(prefetch);
      return () => {
        cancelIdleCallback(handle);
      };
    }

    // Safari has no requestIdleCallback — fall back to a short timer.
    const timer = setTimeout(prefetch, IDLE_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [ports]);

  return <Terminal ports={ports} />;
}
