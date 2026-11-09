// src/item-12-chrome.test.ts
//
// Item 12 (judge-ready-pass): browser-chrome polish -- a site favicon/icon, a
// phosphor-themed scrollbar, and a CSP that admits the icon.
//
// These are source/asset guards (the favicon is a Next App-Router metadata file
// on disk; the scrollbar is authored in crt.css; the CSP is a pure string the
// middleware builds), so they are checked without a browser.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { middleware } from "./middleware.js";

/** Resolve a repo-relative path from this test file (src/). */
function fromSrc(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}

describe("item 12: the app ships a favicon / site icon", () => {
  it("has a Next App-Router icon file on disk (icon.svg)", () => {
    // Next serves `src/app/icon.(svg|png|ico)` as the site favicon and injects
    // the <link> automatically. Without it every page request 404s /favicon.ico.
    const svg = fromSrc("app/icon.svg");
    expect(existsSync(svg), "src/app/icon.svg is missing (favicon 404)").toBe(true);
    const body = readFileSync(svg, "utf8");
    // A real SVG icon, not an empty placeholder.
    expect(body).toMatch(/<svg[\s>]/);
    expect(body.length).toBeGreaterThan(50);
  });
});

describe("item 12: the terminal scroll region has a phosphor-themed scrollbar", () => {
  const css = readFileSync(fromSrc("../../../packages/ui-crt/src/crt.css"), "utf8");

  it("styles the .crt-log scrollbar in the phosphor palette (standards + webkit)", () => {
    // Standards: scrollbar-color / scrollbar-width on the scroll container.
    expect(css).toMatch(/scrollbar-color\s*:/);
    expect(css).toMatch(/scrollbar-width\s*:/);
    // WebKit: a themed thumb/track.
    expect(css).toMatch(/::-webkit-scrollbar(-thumb|-track)?\s*\{/);
    // The themed scrollbar references the phosphor tokens, not a raw OS colour.
    const scrollbarBlock = css.slice(css.indexOf("scrollbar-color"));
    expect(scrollbarBlock).toMatch(/var\(--crt-/);
  });
});

describe("item 12: the CSP admits the site icon (img-src self)", () => {
  it("builds a policy whose img-src allows same-origin (the icon) and never *", () => {
    const res = middleware(
      new Request("https://necro.test/", { headers: {} }) as never,
    );
    const csp =
      res.headers.get("content-security-policy") ??
      res.headers.get("x-middleware-request-content-security-policy") ??
      "";
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain("img-src *");
    // default-src never widened to allow the icon from elsewhere.
    expect(csp).toContain("default-src 'self'");
  });
});