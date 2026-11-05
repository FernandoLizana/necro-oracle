// apps/web/src/app/page.tsx
//
// Feature: 03-crt-terminal, task 27.2 + Spec 03 fix — the Terminal_Route
// (design.md §"React components and DOM structure", the "No JS (R1.5)" note).
//
// A server component that mounts the client `<TerminalScreen>` AND renders an
// authoritative `<noscript>` fallback itself. The `@necro/ui-crt` `<Terminal>`
// also renders a `<noscript>`, but that one lives inside a client component;
// with scripting disabled the client subtree's server-rendered markup is not a
// reliable carrier of the fallback copy in the final static document. Emitting
// the `<noscript>` here, from a server component at the top of the route,
// guarantees the static no-JS document always carries the boot phrase and the
// statement that the terminal requires JavaScript (R1.5).
//
// The content is a single static text node — the canonical `BOOT_PHRASE` plus
// the requires-JavaScript sentence — so it needs no inline script or style and
// is unaffected by the per-request CSP (R14.9). `BOOT_PHRASE` is imported from
// the lightweight `@necro/ui-crt/phrases` subpath (pure Oracle_Voice copy, no
// React or CSS), keeping a single source of truth with the live boot banner.
//
// _Requirements: R1.5, R14.9_

import { BOOT_PHRASE } from "@necro/ui-crt/phrases";

import TerminalScreen from "../components/TerminalScreen.js";

/** The static, CSP-safe no-JS fallback note (boot phrase + requires-JS line). */
const NOSCRIPT_NOTE = `${BOOT_PHRASE} — The terminal requires JavaScript.`;

export default function TerminalRoute(): React.JSX.Element {
  return (
    <>
      <TerminalScreen />
      <noscript>{NOSCRIPT_NOTE}</noscript>
    </>
  );
}
