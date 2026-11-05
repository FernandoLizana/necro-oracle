// apps/web/src/app/page.tsx
//
// Feature: 03-crt-terminal, task 27.2 + Spec 03 fix — the Terminal_Route
// (design.md §"React components and DOM structure").
//
// A server component that mounts the client `<TerminalScreen>`. The
// authoritative no-JS fallback note (R1.5) is NOT rendered here: this route is
// wrapped by Next in a streaming Suspense boundary, and a `<noscript>` emitted
// inside that boundary is not reliably exposed as live DOM by a
// scripting-disabled browser. The note is therefore rendered by the root
// layout (`layout.tsx`), as a direct, non-streamed child of `<body>` ahead of
// this content. The `@necro/ui-crt` `<Terminal>` still renders its own inline
// `<noscript>` as a secondary, in-place fallback.
//
// _Requirements: R1.5_

import TerminalScreen from "../components/TerminalScreen.js";

export default function TerminalRoute(): React.JSX.Element {
  return <TerminalScreen />;
}
