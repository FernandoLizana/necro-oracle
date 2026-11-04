// apps/web/src/app/layout.tsx
//
// Feature: 03-crt-terminal, task 27.2 — the root layout (design.md §"React
// components and DOM structure", D10).
//
// The `<html lang="en">` / `<body>` shell. It reads the per-request headers
// (`await headers()`), which forces dynamic rendering (D10) so the CSP
// middleware's per-request nonce is in effect for this page; Next 15 reads the
// nonce from the `Content-Security-Policy` header the middleware set and stamps
// it onto its own inline bootstrap scripts automatically, so no inline script
// escapes the policy (R14.9).
//
// _Requirements: R14.9_

import type { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Necro-Oracle terminal",
  description:
    "Read tarot on a dead GitHub repository: every card is an evidence-backed diagnosis, then a coven of agents resurrects the code and proves it REVIVED.",
};

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
      <body>{children}</body>
    </html>
  );
}
