//
// SEC-08 (XSS / CSP) - the strict `style-src 'self' 'nonce-<n>'` (no
// 'unsafe-inline') means a STATIC inline `style=` attribute is both blocked by
// CSP and redundant when a CSS class already carries the rule. The redundant
// `style={{ imageRendering: "pixelated" }}` on every pixel <img> duplicates the
// `image-rendering: pixelated` already set by its class (arcana.css /
// landing.css), so it is removed. The only remaining inline styles set DYNAMIC
// CSS custom properties (--arcana-scale, --glitch-*, --zone-*, --ritual-phase-ms,
// --lov-rise-delay) whose values are computed at runtime.
//
// This guard scans the component sources and fails if a static
// `imageRendering` inline style reappears. The untrusted-as-HTML half of
// SEC-08 (no dangerouslySetInnerHTML / eval / Function) is already enforced by
// boundary.guard.test.ts in both apps/web and ui-crt.
//
// Pure: reads files; no network.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

const COMPONENTS = [
  "PixelCard.tsx",
  "SeerPortrait.tsx",
  "PreviewWindow.tsx",
  "NecronomiconRitual.tsx",
];

describe("SEC-08 (R14.9): no static imageRendering inline style (CSP style-src is nonce-only)", () => {
  for (const file of COMPONENTS) {
    it(`${file} does not set imageRendering via an inline style attribute`, () => {
      const src = readFileSync(join(HERE, file), "utf8");
      // The redundant static inline style; the CSS class owns this rule.
      expect(src).not.toMatch(/imageRendering:\s*["']pixelated["']/);
    });
  }
});

// ---------------------------------------------------------------------------
// SEC-08 refactor: NO component sets an inline `style=` attribute at all. Every
// dynamic CSS custom property is applied through the CSSOM (`useCssVars`), so
// the strict nonce-only `style-src` CSP holds with no 'unsafe-inline'. This
// guard scans the whole ui-crt component directory and fails if any `style={`
// attribute reappears.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";

describe("SEC-08 (R14.9): no ui-crt component uses an inline style attribute", () => {
  const dir = HERE;
  const tsx = readdirSync(dir).filter(
    (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
  );

  for (const file of tsx) {
    it(`${file} sets no inline style={...} attribute`, () => {
      const src = readFileSync(join(dir, file), "utf8");
      // JSX inline style attribute. A nonce cannot apply to a style attribute,
      // so under the nonce-only style-src it would be CSP-blocked.
      expect(src).not.toMatch(/\bstyle=\{/);
    });
  }
});
