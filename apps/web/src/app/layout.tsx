// apps/web/src/app/layout.tsx
//
// Feature: 03-crt-terminal, task 27.2 + Spec 03 fix — the root layout
// (design.md §"React components and DOM structure", D10) and the authoritative
// no-JS fallback note (R1.5).
//
// The `<html lang="en">` / `<body>` shell. It reads the per-request headers
// (`await headers()`), which forces dynamic rendering (D10) so the CSP
// middleware's per-request nonce is in effect for this page; Next 15 reads the
// nonce from the `Content-Security-Policy` header the middleware set and stamps
// it onto its own inline bootstrap scripts automatically, so no inline script
// escapes the policy (R14.9).
//
// The no-JS note (R1.5) is emitted HERE, from the root layout, as the first
// direct child of `<body>` — BEFORE `{children}`. The page (`page.tsx`) is
// wrapped by Next in a streaming Suspense boundary (the `<!--$--><!--/$-->`
// markers), and a `<noscript>` rendered inside that boundary is not reliably
// exposed as live DOM by a scripting-disabled browser. Rendering it in the
// layout, outside and ahead of that boundary, guarantees the static no-JS
// document carries the boot phrase and the requires-JavaScript statement as a
// plain, non-streamed body child. The content is a single static text node, so
// it needs no inline script or style and is unaffected by the per-request CSP
// (R14.9). `BOOT_PHRASE` is imported from the lightweight
// `@necro/ui-crt/phrases` subpath (pure Oracle_Voice copy, no React or CSS),
// keeping a single source of truth with the live boot banner.
//
// _Requirements: R1.5, R14.9_

import type { Metadata } from "next";
import { headers } from "next/headers";

import { BOOT_PHRASE } from "@necro/ui-crt/phrases";

export const metadata: Metadata = {
  title: "Necro-Oracle terminal",
  description:
    "Read tarot on a dead GitHub repository: every card is an evidence-backed diagnosis, then a coven of agents resurrects the code and proves it REVIVED.",
};

/** The static, CSP-safe no-JS fallback note (boot phrase + requires-JS line). */
const NOSCRIPT_NOTE = `${BOOT_PHRASE} — The terminal requires JavaScript.`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading the request headers opts this layout into dynamic rendering (D10),
  // so the middleware's per-request CSP nonce applies to every render. The
  // value itself is not needed here — Next picks the nonce up from the CSP
  // header — but the read is what forces the page to be dynamic.
  await headers();

  return (
    <html lang="en">
      <body>
        {/*
          Authoritative no-JS note (R1.5): a direct, non-streamed child of
          `<body>`, emitted before the Suspense-wrapped page content so a
          scripting-disabled browser renders it as live DOM.
        */}
        <noscript>{NOSCRIPT_NOTE}</noscript>
        {children}
      </body>
    </html>
  );
}
