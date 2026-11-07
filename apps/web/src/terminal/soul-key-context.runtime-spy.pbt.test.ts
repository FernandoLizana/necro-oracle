// @vitest-environment jsdom
//
// apps/web/src/terminal/soul-key-context.runtime-spy.pbt.test.ts
//
// Feature: lovers-binding, task 14.2 — the RUNTIME-spy property tests for the
// BYOK Soul_Key container (design: D.3 Non-persistable state container;
// decision 5 "BYOK no-persist state design"; R26.1, R26.2, R26.3, R27.3,
// R29.1).
//
// Task 14.1 is the STATIC import-ban guard (grep): it proves the module names
// none of the persistence sinks. This file is the COMPLEMENTARY runtime proof:
// it installs live SPIES on every persistence/analytics sink inside jsdom —
// `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `history`,
// `navigator.sendBeacon` — AND on every console sink, then drives the real
// `SoulKeyProvider`/`useSoulKey` container through fast-check-generated
// key-lifecycle operations (`setKey` / `clearKey` / `getKeyForRequest` /
// `status`) with arbitrary secret-shaped keys.
//
// Over EVERY run it asserts:
//   • NO persistence sink is EVER written during any operation (Property 19 /
//     R26.1, R26.2 at runtime).
//   • NON-LEAKAGE (Property 20 / R27.3, R29.1): the raw key never reaches any
//     console sink; the `status()` mirror carries only `{ keySet, last4 }` with
//     `last4` ≤ 4 chars and never the whole key; and `getKeyForRequest()` is
//     the ONLY place the raw key is retrievable (it returns exactly the stored
//     key so the header path works).
//   • REMOUNT (R26.3): a fresh provider instance — a simulated tab reload —
//     starts `keySet: false` with `getKeyForRequest() === null`; the key never
//     survives remount.
//
// Pure / Mock only: no network, no LLM, no sandbox. `renderHook` + `act` from
// `@testing-library/react` drive the context (the same harness the rest of the
// web/ui-crt component suites use); a fresh `renderHook` call models one
// browser tab, so a new call after `unmount` models a reload.
//
// Validates: Requirements 26.1, 26.2, 27.3, 29.1

import { act, cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveLast4,
  SoulKeyProvider,
  useSoulKey,
  type SoulKeyApi,
} from "./soul-key-context.js";

const NUM_RUNS = 300;

/**
 * A recorded call into one persistence/analytics sink: the sink name plus the
 * stringified arguments it was handed, so a leak surfaces the offending value.
 */
interface SinkCall {
  readonly sink: string;
  readonly args: string;
}

/**
 * Every persistence + analytics + history + cookie sink, wrapped so a single
 * call is recorded and (crucially) the original is NOT invoked — the test must
 * never actually persist anything, only observe that the container tried.
 */
interface PersistenceSpies {
  readonly calls: SinkCall[];
  restore(): void;
}

/** The console sinks, so a key leak into any log channel is caught. */
interface ConsoleSpies {
  readonly lines: string[];
  restore(): void;
}

/**
 * Install spies on every persistence sink reachable from a browser tab. Each
 * spy records the attempt and swallows it — the real storage is never touched,
 * so a buggy container cannot actually persist a key during the test either.
 */
function installPersistenceSpies(): PersistenceSpies {
  const calls: SinkCall[] = [];
  const record = (sink: string, args: unknown[]): void => {
    calls.push({ sink, args: args.map((a) => String(a)).join(" | ") });
  };

  const restorers: Array<() => void> = [];

  // --- Storage: localStorage + sessionStorage (setItem / removeItem / clear).
  // jsdom here ships WITHOUT Web Storage (it warns that `--localstorage-file`
  // was not provided), so `window.localStorage` can be `undefined`. When a
  // storage global is missing we install a SYNTHETIC spy object in its place,
  // so a container that reached for storage would still be caught — absence of
  // the global must not become a blind spot.
  const spyStorage = (prop: "localStorage" | "sessionStorage"): void => {
    const win = window as unknown as Record<string, Storage | undefined>;
    const existing = win[prop];
    const makeSpy = (): Partial<Storage> => ({
      setItem: (k: string, v: string): void => {
        record(`${prop}.setItem`, [k, v]);
      },
      removeItem: (k: string): void => {
        record(`${prop}.removeItem`, [k]);
      },
      clear: (): void => {
        record(`${prop}.clear`, []);
      },
    });

    if (existing && typeof existing.setItem === "function") {
      const originals = {
        setItem: existing.setItem.bind(existing),
        removeItem: existing.removeItem.bind(existing),
        clear: existing.clear.bind(existing),
      };
      const spy = makeSpy();
      existing.setItem = spy.setItem as Storage["setItem"];
      existing.removeItem = spy.removeItem as Storage["removeItem"];
      existing.clear = spy.clear as Storage["clear"];
      restorers.push(() => {
        existing.setItem = originals.setItem;
        existing.removeItem = originals.removeItem;
        existing.clear = originals.clear;
      });
    } else {
      Object.defineProperty(window, prop, {
        configurable: true,
        value: makeSpy() as Storage,
      });
      restorers.push(() => {
        delete win[prop];
      });
    }
  };
  spyStorage("localStorage");
  spyStorage("sessionStorage");

  // --- document.cookie: spy the setter so any cookie write is recorded.
  const cookieProto =
    Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(document) as object,
      "cookie",
    );
  if (cookieProto) {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (value: string) => {
        record("document.cookie", [value]);
      },
    });
    restorers.push(() => {
      Object.defineProperty(document, "cookie", cookieProto);
    });
  }

  // --- indexedDB.open (jsdom may not implement indexedDB; spy or synthesize).
  const existingIdb = (window as unknown as { indexedDB?: IDBFactory })
    .indexedDB;
  if (existingIdb && typeof existingIdb.open === "function") {
    const originalOpen = existingIdb.open.bind(existingIdb);
    existingIdb.open = ((...args: unknown[]) => {
      record("indexedDB.open", args);
      return {} as IDBOpenDBRequest;
    }) as IDBFactory["open"];
    restorers.push(() => {
      existingIdb.open = originalOpen;
    });
  } else {
    const synthetic = {
      open: (...args: unknown[]) => {
        record("indexedDB.open", args);
        return {} as IDBOpenDBRequest;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: synthetic,
    });
    restorers.push(() => {
      // Drop the synthetic factory so later suites see a clean window.
      delete (window as unknown as { indexedDB?: unknown }).indexedDB;
    });
  }

  // --- history.pushState / replaceState (URL could smuggle a key).
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = ((...args: unknown[]) => {
    record("history.pushState", args);
  }) as History["pushState"];
  window.history.replaceState = ((...args: unknown[]) => {
    record("history.replaceState", args);
  }) as History["replaceState"];
  restorers.push(() => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
  });

  // --- navigator.sendBeacon (the classic analytics exfil path).
  const nav = window.navigator as Navigator & {
    sendBeacon?: (...args: unknown[]) => boolean;
  };
  const originalBeacon = nav.sendBeacon;
  Object.defineProperty(nav, "sendBeacon", {
    configurable: true,
    writable: true,
    value: (...args: unknown[]): boolean => {
      record("navigator.sendBeacon", args);
      return true;
    },
  });
  restorers.push(() => {
    if (originalBeacon) {
      Object.defineProperty(nav, "sendBeacon", {
        configurable: true,
        writable: true,
        value: originalBeacon,
      });
    } else {
      delete (nav as unknown as { sendBeacon?: unknown }).sendBeacon;
    }
  });

  return {
    calls,
    restore: () => {
      for (const r of restorers.reverse()) r();
    },
  };
}

/** Spy every console sink so a raw key leaking into a log line is caught. */
function installConsoleSpies(): ConsoleSpies {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => [m, console[m]] as const);
  for (const m of methods) {
    console[m] = (...args: unknown[]): void => {
      lines.push(args.map((a) => String(a)).join(" "));
    };
  }
  return {
    lines,
    restore: () => {
      for (const [m, fn] of originals) {
        console[m] = fn as typeof console.log;
      }
    },
  };
}

/** A mounted provider instance plus a handle to the container API it exposes. */
interface Harness {
  /** Read the live `SoulKeyApi` (re-read after each op — the memo identity may change). */
  api(): SoulKeyApi;
  unmount(): void;
}

/**
 * Mount a fresh `SoulKeyProvider` + `useSoulKey` with `renderHook`, which is
 * the convention the rest of the web/ui-crt suites use. A fresh `renderHook`
 * call models one browser tab, so unmount + a new call models a reload. The
 * API is read through `result.current` on each access because the provider's
 * `useMemo` returns a new object when `status` changes.
 */
function mountProvider(): Harness {
  const { result, unmount } = renderHook(() => useSoulKey(), {
    wrapper: SoulKeyProvider,
  });
  return {
    api: () => result.current,
    unmount,
  };
}

/** The lifecycle operations fast-check drives the container through. */
type Op =
  | { readonly kind: "set"; readonly key: string }
  | { readonly kind: "clear" }
  | { readonly kind: "get" }
  | { readonly kind: "status" };

/** Secret-shaped keys: OpenRouter-ish, plus short and unicode edge cases. */
const arbSecretKey = fc.oneof(
  fc
    .tuple(
      fc.constantFrom("sk-or-v1-", "sk-", "or-"),
      fc.hexaString({ minLength: 16, maxLength: 64 }),
    )
    .map(([prefix, body]) => prefix + body),
  fc.string({ minLength: 1, maxLength: 8 }), // short keys (last4 edge cases)
  fc.string({ minLength: 8, maxLength: 128 }),
);

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  arbSecretKey.map((key) => ({ kind: "set", key }) as const),
  fc.constant({ kind: "clear" } as const),
  fc.constant({ kind: "get" } as const),
  fc.constant({ kind: "status" } as const),
);

let persistence: PersistenceSpies | undefined;
let consoleSpies: ConsoleSpies | undefined;

beforeEach(() => {
  persistence = installPersistenceSpies();
  consoleSpies = installConsoleSpies();
});

afterEach(() => {
  cleanup();
  consoleSpies?.restore();
  persistence?.restore();
  document.body.innerHTML = "";
});

describe("Property 19 / Property 20 (R26.1, R26.2, R27.3, R29.1): runtime spies confirm the Soul_Key container never persists or leaks the key", () => {
  it("writes NO persistence sink across any key-lifecycle sequence", () => {
    const spies = persistence as PersistenceSpies;
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 24 }), (ops) => {
        const h = mountProvider();
        try {
          for (const op of ops) {
            act(() => {
              const api = h.api();
              switch (op.kind) {
                case "set":
                  api.setKey(op.key);
                  break;
                case "clear":
                  api.clearKey();
                  break;
                case "get":
                  api.getKeyForRequest();
                  break;
                case "status":
                  api.status();
                  break;
              }
            });
          }
          // No persistence/analytics/history/cookie sink was EVER written.
          expect(
            spies.calls,
            `persistence sinks were written: ${JSON.stringify(spies.calls)}`,
          ).toEqual([]);
        } finally {
          h.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never leaks the raw key into any console sink, the status mirror, or any sink arg; getKeyForRequest is the only place the key is retrievable", () => {
    const spies = persistence as PersistenceSpies;
    const logs = consoleSpies as ConsoleSpies;
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 24 }), (ops) => {
        const h = mountProvider();
        // Track what the container should currently hold, independently. A
        // single-element box (not a plain `let`) keeps the mutation out of the
        // TS control-flow narrowing that fires across the `act` closures.
        const expected: { key: string | null } = { key: null };
        const setKeys: string[] = [];
        try {
          for (const op of ops) {
            act(() => {
              const api = h.api();
              switch (op.kind) {
                case "set":
                  api.setKey(op.key);
                  expected.key = op.key;
                  setKeys.push(op.key);
                  break;
                case "clear":
                  api.clearKey();
                  expected.key = null;
                  break;
                case "get":
                  api.getKeyForRequest();
                  break;
                case "status":
                  api.status();
                  break;
              }
            });

            const liveKey = expected.key;

            // getKeyForRequest returns EXACTLY the stored key (header path).
            expect(h.api().getKeyForRequest()).toBe(liveKey);

            // The status mirror carries ONLY { keySet, last4 }; last4 ≤ 4 chars
            // and is never the whole key (unless the key itself is ≤ 4 chars).
            const status = h.api().status();
            expect(Object.keys(status).sort()).toEqual(["keySet", "last4"]);
            expect(status.keySet).toBe(liveKey !== null);
            expect(status.last4.length).toBeLessThanOrEqual(4);
            if (liveKey === null) {
              expect(status.last4).toBe("");
            } else {
              expect(status.last4).toBe(deriveLast4(liveKey));
              if (liveKey.length > 4) {
                expect(status.last4).not.toBe(liveKey);
              }
            }
          }

          // NON-LEAKAGE: no raw key value ever reached a console sink or a
          // persistence-sink argument. Check every key that was ever set.
          const haystacks = [
            ...logs.lines,
            ...spies.calls.map((c) => `${c.sink} ${c.args}`),
          ];
          for (const key of setKeys) {
            if (key.length === 0) continue;
            for (const line of haystacks) {
              expect(
                line.includes(key),
                `raw key leaked into a log/sink line: ${line}`,
              ).toBe(false);
            }
          }
        } finally {
          h.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("loses the key on remount: a fresh provider instance starts keySet:false with getKeyForRequest()===null (tab-reload simulation)", () => {
    fc.assert(
      fc.property(arbSecretKey, (key) => {
        // First tab: set a key and confirm it is live.
        const first = mountProvider();
        act(() => {
          first.api().setKey(key);
        });
        expect(first.api().getKeyForRequest()).toBe(key);
        expect(first.api().status().keySet).toBe(true);
        // Simulate the tab closing/reloading: the instance goes away.
        first.unmount();

        // Second tab (fresh provider instance) must start empty — the ref did
        // not survive the remount, so the key is gone.
        const second = mountProvider();
        try {
          expect(second.api().status().keySet).toBe(false);
          expect(second.api().status().last4).toBe("");
          expect(second.api().getKeyForRequest()).toBeNull();
        } finally {
          second.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
