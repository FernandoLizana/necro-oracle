"use client";

// apps/web/src/terminal/soul-key-context.tsx
//
// Feature: lovers-binding, task 11.4 — the non-persistable in-memory container
// for the BYOK user key (design: D.3 Non-persistable state container; decision
// 5 "BYOK no-persist state design"; R26.2, R26.3, R26.4).
//
// The user's OpenRouter key lives ONLY in a `useRef<string | null>(null)` that
// belongs to a single browser tab. The context exposes OPERATIONS over that
// ref (`setKey`/`clearKey`/`getKeyForRequest`/`status`) and NEVER exposes the
// raw value as React state — so the key cannot land in a devtools state/props
// snapshot. The only thing mirrored into React state is a tiny, non-secret
// `{ keySet, last4 }` flag the HUD / `key status` line reads.
//
// Structural non-persistence (R26.2): this module imports NONE of
// `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `location`,
// `history`, or any analytics client. There is no persistence of any kind and
// no effect that writes the ref anywhere. A tab reload or close drops the ref,
// so the key is gone (R26.3) — that is the whole point.
//
// This task implements the container only. Wiring the provider into the shell
// is task 11.9; the structural import-ban guard test is task 14.1 and the
// runtime spy test is task 14.2.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The non-secret mirror of the key state. This is the ONLY key-derived value
 * that is ever held as React state (so it is all that can appear in a devtools
 * snapshot). It never contains the raw key — only whether one is set and the
 * last-four preview for the `key status` line / HUD.
 */
export interface SoulKeyStatus {
  readonly keySet: boolean;
  /** Last ≤4 chars of the key for the preview; "" when no key is set. */
  readonly last4: string;
}

/**
 * Operations over the in-memory key ref. The raw key is never returned as
 * state; `getKeyForRequest` reads it for a single fetch and the caller must
 * never log it.
 */
export interface SoulKeyApi {
  /** Stores the raw key into the in-memory ref and updates the status mirror. */
  setKey(key: string): void;
  /** Nulls the ref and resets the status mirror. */
  clearKey(): void;
  /** Returns the raw ref value for attaching the request header; never logged. */
  getKeyForRequest(): string | null;
  /** The non-secret `{ keySet, last4 }` mirror for the HUD / `key status`. */
  status(): SoulKeyStatus;
}

const EMPTY_STATUS: SoulKeyStatus = { keySet: false, last4: "" };

/**
 * Derive the last-four preview of a key. If the key is shorter than four
 * characters, show whatever exists (so a 3-char key previews 3 chars). Never
 * returns more than the final four characters, so the preview can never leak
 * the full key.
 */
export function deriveLast4(key: string): string {
  return key.slice(-4);
}

const SoulKeyContext = createContext<SoulKeyApi | null>(null);

export interface SoulKeyProviderProps {
  readonly children: ReactNode;
}

/**
 * Provides the non-persistable `SoulKeyApi`. The raw key lives in `keyRef`
 * (never state); only `status` is React state so the HUD re-renders when the
 * key is set or cleared.
 */
export function SoulKeyProvider({
  children,
}: SoulKeyProviderProps): ReactNode {
  // The raw key lives ONLY here. Never mirrored into React state.
  const keyRef = useRef<string | null>(null);
  // The non-secret mirror that the HUD / `key status` reads.
  const [status, setStatus] = useState<SoulKeyStatus>(EMPTY_STATUS);

  const setKey = useCallback((key: string): void => {
    keyRef.current = key;
    setStatus({ keySet: true, last4: deriveLast4(key) });
  }, []);

  const clearKey = useCallback((): void => {
    keyRef.current = null;
    setStatus(EMPTY_STATUS);
  }, []);

  const getKeyForRequest = useCallback((): string | null => keyRef.current, []);

  const api = useMemo<SoulKeyApi>(
    () => ({
      setKey,
      clearKey,
      getKeyForRequest,
      status: () => status,
    }),
    [setKey, clearKey, getKeyForRequest, status],
  );

  return (
    <SoulKeyContext.Provider value={api}>{children}</SoulKeyContext.Provider>
  );
}

/**
 * Consume the `SoulKeyApi`. Throws when used outside a `SoulKeyProvider` so a
 * missing provider fails loudly instead of silently dropping the key.
 */
export function useSoulKey(): SoulKeyApi {
  const api = useContext(SoulKeyContext);
  if (api === null) {
    throw new Error("useSoulKey must be used within a SoulKeyProvider");
  }
  return api;
}
