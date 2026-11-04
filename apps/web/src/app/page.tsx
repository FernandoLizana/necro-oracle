// apps/web/src/app/page.tsx
//
// Feature: 03-crt-terminal, task 27.2 — the Terminal_Route (design.md §"React
// components and DOM structure", the "No JS (R1.5)" note).
//
// A server component that mounts the client `<TerminalScreen>`. Because
// `TerminalScreen` (and the `@necro/ui-crt` `<Terminal>` it renders) is a
// client component, Next server-renders it to static HTML on first load: the
// static document therefore carries the full `<main class="crt">` shell with an
// empty Output_Log plus the `<noscript>` block — which states the boot phrase
// `NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP` and that the
// terminal requires JavaScript — even with scripting disabled (R1.5). The boot
// banner is appended to the live log on mount (client), and a reduced-motion
// visitor sees it without a reveal.
//
// _Requirements: R1.5_

import TerminalScreen from "../components/TerminalScreen.js";

export default function TerminalRoute(): React.JSX.Element {
  return <TerminalScreen />;
}
