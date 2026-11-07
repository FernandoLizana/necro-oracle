// apps/web/src/terminal/soul-key-no-persist.guard.test.ts
//
// Feature: lovers-binding, task 14.1 — the structural import-ban guard for the
// BYOK key container (design: D.3 Non-persistable state container; R26.1,
// R26.2).
//
// Property 19 (R26.1, R26.2): the user key is structurally impossible to
// persist. This is the static-source-scan companion to the runtime-spy suite
// (task 14.2). It reads `soul-key-context.tsx` — the whole browser key
// container module set (`SoulKeyProvider` / `useSoulKey` / `SoulKeyApi`, whose
// raw key lives ONLY in a `useRef`) — straight off disk and asserts, by pure
// static text analysis (no import, no execution — offline, no network / LLM /
// sandbox), that:
//
//   1. the module references NONE of the browser persistence / exfiltration
//      APIs — `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`
//      / `.cookie`, `window.location`, `location.assign` / `location.replace`,
//      `history.pushState` / `history.replaceState`, `navigator.sendBeacon`,
//      an analytics client, or any other storage sink — so no code path could
//      ever write the key out (R26.2); and
//   2. the raw key is NEVER exposed as React state: the ONLY `useState` in the
//      module is the non-secret `{ keySet, last4 }` status mirror, so the raw
//      value can never land in a devtools state/props snapshot (R26.1).
//
// The server module `apps/web/src/server/user-key.ts` is deliberately NOT in
// scope: it lives behind the client boundary (it is never bundled into the
// browser), it legitimately parses + redacts the header value, and it is not
// part of the in-memory browser key container.
//
// Comments and string/template literals are stripped before scanning so the
// explanatory prose (which names these APIs on purpose, e.g. "never written to
// localStorage") never trips the guard — only real code references count. A
// found persistence API is a REAL BUG, not a test to loosen.
//
// Validates: Requirements 26.1, 26.2

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The browser key container module set. The raw key lives only inside these
 * modules' `useRef`; nothing else in the browser bundle holds it. Paths are
 * resolved relative to THIS test file (co-located in `terminal/`).
 */
const CONTAINER_FILES: readonly string[] = ["soul-key-context.tsx"];

/**
 * Persistence / exfiltration APIs the container must never reference. A match
 * on any of these in real (comment- and string-stripped) code is a real bug:
 * the key could escape the single-tab `useRef` and be persisted or sent out.
 */
const FORBIDDEN_APIS: readonly string[] = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document.cookie",
  ".cookie",
  "window.location",
  "location.assign",
  "location.replace",
  "history.pushState",
  "history.replaceState",
  "navigator.sendBeacon",
  // Common analytics / telemetry clients that could exfiltrate the key.
  "analytics",
  "gtag",
  "dataLayer",
  "mixpanel",
  "amplitude",
  "posthog",
  "segment",
];

/**
 * Strip line/block comments and string/template literals, replacing them with
 * same-length blanks (newlines preserved) so a forbidden-API name that appears
 * only inside a comment or a quoted string never trips the guard — only real
 * code references count. This mirrors the `apps/web` boundary guard.
 */
function stripCommentsAndStrings(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        const cj = text[j] as string;
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/** Read a container module's source, resolved relative to this test file. */
function readContainer(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("P19 (R26.1, R26.2): the user key is structurally impossible to persist", () => {
  // -------------------------------------------------------------------------
  // (1) No persistence / exfiltration API is referenced in real code. The key
  //     lives only in an in-memory `useRef`, so a reload/close drops it and
  //     there is no sink it could ever be written to.
  // -------------------------------------------------------------------------

  it.each(CONTAINER_FILES)(
    "references no persistence or exfiltration API in %s",
    (rel) => {
      const code = stripCommentsAndStrings(readContainer(rel));

      const found = FORBIDDEN_APIS.filter((api) => code.includes(api));

      expect(
        found,
        `the key container "${rel}" references forbidden persistence/exfiltration API(s): ${found.join(
          ", ",
        )}. A match here is a real no-persistence bug — do not weaken this guard.`,
      ).toEqual([]);
    },
  );

  // -------------------------------------------------------------------------
  // (2) The raw key is never React state. The ONLY `useState` in the container
  //     is the non-secret `{ keySet, last4 }` status mirror — so the raw value
  //     can never appear in a devtools state/props snapshot. We assert this
  //     structurally: exactly one `useState` call, and it is the status mirror.
  // -------------------------------------------------------------------------

  it("exposes the raw key only through a ref — the single useState is the non-secret status mirror", () => {
    const text = readContainer("soul-key-context.tsx");
    const code = stripCommentsAndStrings(text);

    // There must be exactly ONE useState call in the whole container.
    const useStateCount = (code.match(/\buseState\s*[<(]/g) ?? []).length;
    expect(
      useStateCount,
      `expected exactly one useState in the key container (the non-secret status mirror); found ${useStateCount}`,
    ).toBe(1);

    // That one useState must be typed as the SoulKeyStatus mirror, not the raw
    // key: it is declared `useState<SoulKeyStatus>(...)`. If the raw key were
    // ever moved into state it would not carry this non-secret mirror type.
    expect(
      /\buseState\s*<\s*SoulKeyStatus\s*>/.test(code),
      "the single useState must hold the non-secret SoulKeyStatus mirror ({ keySet, last4 }), never the raw key",
    ).toBe(true);

    // The raw key must live in a ref, never in state. Assert the ref exists and
    // is typed to hold the key (string | null) — this is the only place the raw
    // value is stored.
    expect(
      /\buseRef\s*<\s*string\s*\|\s*null\s*>/.test(code),
      "the raw key must be stored in a useRef<string | null>, never React state",
    ).toBe(true);

    // Defensive: the status mirror type is non-secret by shape — it carries
    // only keySet + last4, never the full key.
    expect(/keySet\s*:\s*boolean/.test(code)).toBe(true);
    expect(/last4\s*:\s*string/.test(code)).toBe(true);
  });
});
