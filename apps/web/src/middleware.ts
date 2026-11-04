// apps/web/src/middleware.ts
//
// Feature: 03-crt-terminal, task 27.2 — the CSP middleware (design.md
// §"Middleware", D10, Q9; R6.11, R12.2, R14.9).
//
// On every matched request the middleware mints a fresh per-request nonce
// (base64 of 16 random bytes from Web Crypto), builds the Content-Security-
// Policy string, forwards the nonce to the render pass as `x-nonce` (and the
// CSP on the forwarded request headers so Next's own inline bootstrap scripts
// pick up the nonce), and sets the CSP on the response. The policy disallows
// inline script entirely: `script-src` carries only `'self'`, the per-request
// `'nonce-<n>'` and `'strict-dynamic'` — never `'unsafe-inline'` (R14.9, Q9).
// `'self'` is kept for old browsers that ignore `'strict-dynamic'`. In
// development `'unsafe-eval'` is added so Next's dev React refresh works; it is
// absent in production.
//
// The matcher excludes `/_next/static`, `/_next/image`, `/favicon.ico` and
// `/api` (the API routes send their own `no-store` + `nosniff` headers and
// serve no HTML, so no CSP nonce is needed there), and matches `/` (the
// Terminal_Route).
//
// No network / LLM / sandbox: this is a pure per-request header transform. Web
// Crypto (`crypto.getRandomValues`) is available on both the Edge runtime and
// Node 22.
//
// _Requirements: R6.11, R12.2, R14.9_

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Mint a fresh per-request nonce: base64 of 16 random bytes (Web Crypto). */
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // btoa over the raw byte string yields standard (non-URL-safe) base64.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the Content-Security-Policy string for a given nonce (design D10/Q9).
 * `'unsafe-eval'` is added to `script-src` ONLY in development (Next's dev
 * tooling evaluates code); production has no `eval` escape hatch.
 */
function buildCsp(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The CSP middleware. Mints a per-request nonce, forwards it (`x-nonce`) and
 * the CSP on the request headers so Next applies the nonce to its own scripts,
 * and sets the CSP on the response. Returns a `NextResponse` carrying both.
 */
export function middleware(req: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward the nonce and CSP on the request headers (the canonical Next
  // pattern): the render pass reads `x-nonce` and Next picks up the nonce from
  // the CSP header to stamp its own bootstrap scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

/**
 * Run the middleware on every HTML route, excluding Next's static assets, the
 * image optimiser, the favicon and the API routes. The negative lookahead
 * matches `/` but none of the excluded prefixes.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
