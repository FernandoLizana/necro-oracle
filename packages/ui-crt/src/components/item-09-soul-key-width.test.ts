//
// Item 9 (judge-ready-pass): the masked Soul_Key input must NOT stretch to
// fill the whole Command_Line row.
//
// Drift: the BYOK `SoulKeyInput` (`apps/web/.../SoulKeyInput.tsx`) renders a
// `<form className="crt-input">` holding a single masked `<input
// id="crt-soul-key">`. With no rule of its own, that input inherits the
// greedy `.crt-input input { flex: 1 1 12rem }` growth rule from `crt.css`,
// so the masked key field expands to the full width of the row -- a tiny
// secret token rendered as a full-width bar. The key field should be a
// narrow, bounded field instead.
//
// This is a SOURCE-SCAN guard (same strategy as `crt-tokens.test.ts` and
// `terminal-palette-guard.test.ts`): the web vitest project applies no CSS,
// jsdom `getComputedStyle` does not resolve external stylesheets, and the
// rule lives in the ui-crt `crt.css` shell. So the authoritative oracle is
// the stylesheet text: `crt.css` must author a `#crt-soul-key` rule that
// pins a bounded width (a `max-width` or a non-`flex`-grow `width`/`flex`
// shorthand) so the field can no longer grow to fill the row.
//
// Validates: judge-ready-pass item 9.
//
// Fails first: no `#crt-soul-key` rule exists in `crt.css` yet, so the field
// inherits the greedy grow. Adding the bounded-width rule turns this green.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Resolve `crt.css` regardless of the vitest working directory. */
function resolveCrtCss(): string {
  const candidates = [
    resolve(process.cwd(), "src/crt.css"),
    resolve(process.cwd(), "packages/ui-crt/src/crt.css"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`crt.css not found. Checked:\n  ${candidates.join("\n  ")}`);
}

/** Strip comment blocks so prose never satisfies the scan. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = stripComments(readFileSync(resolveCrtCss(), "utf8"));

/**
 * Extract the body of the first `#crt-soul-key { ... }` rule (declarations
 * only, comment-stripped). Returns `null` when no such rule exists.
 */
function soulKeyRuleBody(): string | null {
  const match = /#crt-soul-key\s*\{([^}]*)\}/.exec(CSS);
  return match?.[1] ?? null;
}

describe("item 9 (judge-ready-pass): the masked Soul_Key field is narrow", () => {
  it("crt.css authors a dedicated #crt-soul-key rule", () => {
    expect(
      soulKeyRuleBody(),
      "crt.css has no `#crt-soul-key { ... }` rule, so the masked key input " +
        "inherits `.crt-input input { flex: 1 1 12rem }` and grows full-width",
    ).not.toBeNull();
  });

  it("pins a bounded width so the key field cannot grow to fill the row", () => {
    const body = soulKeyRuleBody();
    expect(body).not.toBeNull();
    const decls = (body as string).toLowerCase();

    // The field is bounded iff it either caps its width (`max-width`) or opts
    // out of the inherited grow by declaring a non-growing `flex`/`width`.
    const hasMaxWidth = /max-width\s*:/.test(decls);
    const hasExplicitWidth = /(^|[;{]\s*)width\s*:/.test(decls);
    // A `flex` that does not grow: either `flex: 0 ...` (grow 0) or a bare
    // `flex: none`. We reject a grow factor >= 1.
    const flexMatch = /flex\s*:\s*([^;]+);/.exec(decls);
    const flexValue = flexMatch?.[1]?.trim() ?? "";
    const flexDoesNotGrow =
      flexValue === "none" || /^0(\s|$)/.test(flexValue);

    expect(
      hasMaxWidth || hasExplicitWidth || flexDoesNotGrow,
      "`#crt-soul-key` must cap its width (max-width / width) or stop growing " +
        `(flex grow 0); authored declarations were: "${(body as string).trim()}"`,
    ).toBe(true);

    // And it must NOT re-introduce the greedy grow on this very rule.
    expect(
      /flex\s*:\s*[1-9]/.test(decls),
      "`#crt-soul-key` must not declare a `flex` grow factor >= 1",
    ).toBe(false);
  });
});