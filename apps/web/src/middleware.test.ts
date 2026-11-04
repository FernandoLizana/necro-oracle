// apps/web/src/middleware.test.ts
//
// Feature: 03-crt-terminal, task 27.1 (TEST-FIRST).
//
// Example tests for the CSP middleware (`src/middleware.ts`; design.md
// §"Middleware", D10, Q9; R14.9). TEST-FIRST (red): this file is written
// BEFORE task 27.2 creates `./middleware.ts`, so the import below fails to
// resolve and the suite is red for the expected reason (missing module).
//
// The exported surface this file pins (recorded for task 27.2):
//   middleware.ts  →  export function middleware(req: NextRequest): NextResponse
//                     (or a Response carrying the headers asserted below)
//   middleware.ts  →  export const config: { matcher: string | string[] }
//
// What these examples assert (design.md §"Middleware", D10, Q9):
//   - A `Content-Security-Policy` response header is set.
//   - Its `script-src` lists `'self'`, a per-request `'nonce-<base64>'`, and
//     `'strict-dynamic'`, and does NOT contain `'unsafe-inline'` (inline
//     script disallowed — R14.9, Q9). `'self'` is kept for old browsers that
//     ignore `'strict-dynamic'`.
//   - `object-src 'none'`, `base-uri 'none'`, and `frame-ancestors 'none'`.
//   - The nonce is per-request: two calls yield different nonces, each a
//     base64 string decoding to 16 bytes (Web Crypto `getRandomValues`).
//   - `x-nonce` is forwarded (the canonical Next CSP pattern sets it on the
//     forwarded request headers and/or the response); the forwarded value
//     equals the nonce embedded in the CSP.
//   - `config.matcher` excludes `/_next/static`, `/_next/image`,
//     `/favicon.ico`, and `/api`, but matches `/`.
//
// Web Crypto: under the node test env (Node 22) `globalThis.crypto` is present,
// so the middleware's `crypto.getRandomValues` works without a polyfill.
//
// No network / LLM / sandbox: the middleware is a pure per-request header
// transform.
//
// _Requirements: R6.11, R12.2, R14.9_
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 27.2 adds this module. The import is what makes
// this suite red until then.
import { config, middleware } from "./middleware.js";

// --- helpers ---------------------------------------------------------------

/** Build a NextRequest for the given path on the test origin. */
function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://necro.test"));
}

/**
 * Read the Content-Security-Policy header the middleware set, trying both the
 * canonical response header and (for implementations that only set it on the
 * forwarded request) the `x-middleware-request-content-security-policy` header
 * that `NextResponse.next({ request: { headers } })` surfaces.
 */
function cspOf(res: Response): string {
  return (
    res.headers.get("content-security-policy") ??
    res.headers.get("x-middleware-request-content-security-policy") ??
    ""
  );
}

/**
 * Read the forwarded `x-nonce`, trying the response header first and the Next
 * forwarded-request header second (`NextResponse.next({ request: { headers }})`
 * surfaces forwarded request headers as `x-middleware-request-<name>`). This
 * keeps the test robust to whichever mechanism task 27.2 picks.
 */
function forwardedNonceOf(res: Response): string | null {
  return (
    res.headers.get("x-nonce") ??
    res.headers.get("x-middleware-request-x-nonce")
  );
}

/** Extract the `script-src` directive value from a CSP string. */
function scriptSrcOf(csp: string): string {
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src"));
  return directive ?? "";
}

/** The single `'nonce-...'` token's inner base64 payload from a script-src. */
function nonceFromScriptSrc(scriptSrc: string): string {
  const match = /'nonce-([^']+)'/.exec(scriptSrc);
  return match?.[1] ?? "";
}

/** Is `s` a well-formed base64 string (the standard, non-URL-safe alphabet)? */
function isBase64(s: string): boolean {
  return s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/** Decode a base64 string to raw bytes (Node Buffer is available in node env). */
function base64ByteLength(s: string): number {
  return Buffer.from(s, "base64").length;
}

// --- CSP directive contents (R14.9, Q9, D10) -------------------------------

describe("CSP middleware — header contents (R14.9, Q9, D10)", () => {
  it("sets a Content-Security-Policy header", () => {
    const res = middleware(requestFor("/"));
    expect(cspOf(res).length).toBeGreaterThan(0);
  });

  it("script-src lists 'self', a nonce, and 'strict-dynamic' (R14.9, Q9)", () => {
    const res = middleware(requestFor("/"));
    const scriptSrc = scriptSrcOf(cspOf(res));

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/]+={0,2}'/);
  });

  it("script-src does NOT allow inline script ('unsafe-inline' absent — R14.9)", () => {
    const res = middleware(requestFor("/"));
    const scriptSrc = scriptSrcOf(cspOf(res));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("locks object-src, base-uri and frame-ancestors to 'none' (D10)", () => {
    const res = middleware(requestFor("/"));
    const csp = cspOf(res);

    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/base-uri\s+'none'/);
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
  });
});

// --- per-request Web Crypto nonce ------------------------------------------

describe("CSP middleware — per-request nonce (D10, Web Crypto)", () => {
  it("the nonce is base64 decoding to 16 bytes", () => {
    const res = middleware(requestFor("/"));
    const nonce = nonceFromScriptSrc(scriptSrcOf(cspOf(res)));

    expect(isBase64(nonce)).toBe(true);
    expect(base64ByteLength(nonce)).toBe(16);
  });

  it("two requests yield different nonces (per-request, not fixed)", () => {
    const first = nonceFromScriptSrc(scriptSrcOf(cspOf(middleware(requestFor("/")))));
    const second = nonceFromScriptSrc(scriptSrcOf(cspOf(middleware(requestFor("/")))));

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });

  it("forwards x-nonce, matching the nonce embedded in the CSP", () => {
    const res = middleware(requestFor("/"));
    const cspNonce = nonceFromScriptSrc(scriptSrcOf(cspOf(res)));
    const forwarded = forwardedNonceOf(res);

    expect(forwarded).not.toBeNull();
    expect(forwarded).toBe(cspNonce);
  });
});

// --- matcher scope ---------------------------------------------------------

describe("CSP middleware — config.matcher scope (D10)", () => {
  /** Normalise the matcher (string or array) to an array of pattern strings. */
  const patterns: readonly string[] = Array.isArray(config.matcher)
    ? config.matcher
    : [config.matcher];

  it("exports a matcher", () => {
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) expect(typeof p).toBe("string");
  });

  it("textually excludes /_next/static, /_next/image, /favicon.ico and /api", () => {
    // The canonical pattern is a single negative-lookahead source string that
    // names each excluded prefix. Assert each exclusion appears in the matcher.
    const joined = patterns.join("\n");
    expect(joined).toContain("_next/static");
    expect(joined).toContain("_next/image");
    expect(joined).toContain("favicon.ico");
    expect(joined).toContain("api");
  });

  it("the matcher, as a RegExp, matches / but not the excluded paths", () => {
    // Next matchers are path-to-regexp-ish negative lookaheads. When a pattern
    // is a lookahead source (starts with `/(` and contains `?!`), build a
    // RegExp from it and assert match / no-match. Patterns that are not
    // RegExp-constructible (plain path strings) are skipped here; the textual
    // check above still pins the exclusions.
    const regexable = patterns.filter((p) => p.includes("(?!"));
    expect(regexable.length).toBeGreaterThan(0);

    for (const source of regexable) {
      const re = new RegExp(`^${source}$`);
      expect(re.test("/")).toBe(true);
      expect(re.test("/api/summon")).toBe(false);
      expect(re.test("/_next/static/chunks/main.js")).toBe(false);
      expect(re.test("/_next/image")).toBe(false);
      expect(re.test("/favicon.ico")).toBe(false);
    }
  });
});
