"use client";

// src/hooks/use-motion.ts
//
// Feature: 03-crt-terminal, task 17.2.
//
// `useMotion` subscribes to the injected `MediaPort` and reports the live
// `prefers-reduced-motion` match, re-rendering whenever the system preference
// changes so the resolved Motion_Mode tracks the query without a reload
// (R10.6). It unsubscribes on unmount. This hook touches no `window` or
// `matchMedia` directly; every media access goes through the port, so the
// behaviour is fully observable with the fake `MediaPort` in tests.
//
// _Requirements: R10.3, R10.6, R10.7_

import { useEffect, useState } from "react";

import type { MediaPort } from "../ports.js";

/** The reduced-motion signal surfaced to the Terminal. */
export interface MotionSignal {
  /** Whether `prefers-reduced-motion: reduce` currently matches. */
  readonly prefersReduced: boolean;
}

/**
 * Track the `prefers-reduced-motion` media query through the injected port.
 * Returns the current match and updates it live on every system change.
 */
export function useMotion(media: MediaPort): MotionSignal {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() =>
    media.prefersReducedMotion(),
  );

  useEffect(() => {
    // Re-sync in case the query changed between the initial render and effect.
    setPrefersReduced(media.prefersReducedMotion());
    const unsubscribe = media.subscribe((matches) => {
      setPrefersReduced(matches);
    });
    return unsubscribe;
  }, [media]);

  return { prefersReduced };
}
