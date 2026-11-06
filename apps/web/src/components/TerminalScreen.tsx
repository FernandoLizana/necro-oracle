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
// It also reads a `?boot=skip` query flag from the browser URL and threads the
// result into the Terminal's `bootSignal` prop (visual-necromancy task 16.2).
// The Playwright runner sets `?boot=skip` to land straight on the ready
// terminal (skipping the ~deterministic Boot_Sequence animation), while a
// normal or DEMO load without the flag plays the full boot (R12.5, R10.7,
// R10.4). The read is guarded for SSR (`typeof window`), so the server render
// of this client component touches no browser global and defaults to `false`.
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

/** The query flag (and its skip value) the external runner sets to skip boot. */
const BOOT_FLAG = "boot";
const BOOT_SKIP_VALUE = "skip";

/**
 * Read the `?boot=skip` flag from the current browser URL. Guarded for SSR:
 * during the server render of this client component there is no `window`, so it
 * resolves to `false` and the full deterministic boot plays (R12.5). Only the
 * exact `boot=skip` value skips the boot; any other value plays it.
 */
function readBootSkip(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get(BOOT_FLAG) ===
    BOOT_SKIP_VALUE
  );
}

/** The live CRT terminal, constructed with the real browser ports. */
export default function TerminalScreen(): React.JSX.Element {
  // Build the ports exactly once for the life of the mount. `useMemo` with an
  // empty dep list runs the factory on the client after hydration, so the
  // browser globals it reads are live.
  const ports: TerminalPorts = useMemo(() => createBrowserPorts(), []);

  // Read the external `?boot=skip` flag once per mount. The Playwright runner
  // sets it to land on the ready terminal without waiting out the boot; a
  // normal / DEMO load without it plays the full deterministic boot (R12.5).
  const bootSignal: boolean = useMemo(() => readBootSkip(), []);

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

  return <Terminal ports={ports} bootSignal={bootSignal} />;
}
