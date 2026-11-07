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
// direct child of `<body>` — BEFORE `{children}` — and crucially as a PLAIN,
// VISIBLE element (`<p id="no-js-note" class="crt-no-js">`), not only inside a
// `<noscript>`. A scripting-disabled browser does not surface `<noscript>`
// contents to text queries (Playwright `toContainText` reads rendered text),
// so relying on `<noscript>` promotion was fragile. The visible element is
// present and readable in the static document with no JavaScript at all. Once
// the client terminal mounts it sets `document.documentElement.dataset.js =
// "ready"`; the `html[data-js="ready"] .crt-no-js { display: none }` rule in
// `crt.css` then hides the note for JS users so it never pollutes the live UI.
// The element is a single static text node — no inline script or style — so it
// is unaffected by the per-request CSP (R14.9); the toggle is a plain DOM
// property write inside a React effect, also CSP-safe. A secondary `<noscript>`
// carrying the same note is kept as an in-place fallback. `BOOT_PHRASE` is
// imported from the lightweight `@necro/ui-crt/phrases` subpath (pure
// Oracle_Voice copy, no React or CSS), keeping one source of truth with the
// live boot banner.
//
// _Requirements: R1.5, R14.9_

import type { Metadata } from "next";
import { headers } from "next/headers";
import { VT323 } from "next/font/google";

import { BOOT_PHRASE } from "@necro/ui-crt/phrases";

// Bitmap pixel display font (oracle-landing-polish, defect 4 / R25). VT323 is an
// SIL-OFL bitmap pixel font; `next/font/google` fetches it at BUILD time and
// self-hosts the `.woff2` from the app bundle (no runtime request to Google, no
// committed binary), so the DMG surfaces render in the real bitmap face rather
// than silently falling back to a system monospace. The font is exposed as the
// stable `--font-vt323` CSS variable (not a hashed family name), which `crt.css`
// and `@necro/ui-crt`'s `--dmg-font` reference first so `"VT323"` resolves to
// the bundled face. `display: "swap"` keeps text visible during load; the
// monospace stack stays as the final fallback. License recorded in
// docs/COMPLIANCE.md (R25.3).
const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-vt323",
});

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
    // The VT323 variable class is applied to <html> so the `--font-vt323`
    // custom property is in scope for the whole document, including the
    // terminal root and every DMG landing surface (R25.1, R25.2).
    <html lang="en" className={vt323.variable}>
      <body>
        {/*
          Authoritative no-JS note (R1.5): a static, visible-by-default element
          rendered as the first direct, non-streamed child of `<body>`, before
          the Suspense-wrapped page content. It is plain server-rendered text —
          present and visible in the static document WITHOUT JavaScript, with no
          reliance on `<noscript>` content being promoted to live DOM (which
          Chromium does not surface to text queries). Once the client terminal
          mounts it sets `document.documentElement.dataset.js = "ready"`, and
          the `.crt-no-js` rule in `crt.css` hides this note for JS users. The
          `<noscript>` below is kept as a secondary, in-place fallback.
        */}
        <p id="no-js-note" className="crt-no-js" role="note">
          {NOSCRIPT_NOTE}
        </p>
        <noscript>{NOSCRIPT_NOTE}</noscript>
        {children}
      </body>
    </html>
  );
}
