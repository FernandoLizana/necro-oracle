// Pinned-reference helper — example tests (TEST-FIRST).
//
// Feature: 03-crt-terminal
// Validates: Requirements R5.3, R6.1
//
// `formatPinnedRef` builds the canonical Pinned_Reference string
// `owner/name@<sha>` from a RepoRef (R5.3). The sha is the 40-hex lowercase
// commit id already pinned by the summon step; the helper simply joins the
// three fields and never consults `defaultBranch`. The same one-line function
// lives server-side (`apps/web/src/server/pinned-ref.ts`), where its round
// trip through `parseRepoRef` is proved by Property 18 in task 20 — this file
// only fixes the client-side build direction (R6.1).
//
// TEST-FIRST (task 14.1): written before the `session/pinned-ref` helper
// (task 14.2) exists. EXPECTED TO FAIL now — the import of `./pinned-ref.js`
// cannot resolve. That is the correct red.

import { describe, expect, it } from "vitest";

import type { RepoRef } from "@necro/oracle/client";

import { formatPinnedRef } from "./pinned-ref.js";

/** A representative 40-hex lowercase commit sha. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A fully-populated RepoRef the summon step would hand back. */
const REF: RepoRef = {
  owner: "graveyard",
  name: "lich-py2",
  sha: SHA,
  defaultBranch: "master",
};

describe("R5.3, R6.1: formatPinnedRef builds owner/name@<sha>", () => {
  it("joins owner, name and the 40-hex sha into a Pinned_Reference", () => {
    expect(formatPinnedRef(REF)).toBe(`graveyard/lich-py2@${SHA}`);
  });

  it("uses exactly one `/` and one `@` separator", () => {
    const pinned = formatPinnedRef(REF);
    expect(pinned.split("/")).toHaveLength(2);
    expect(pinned.split("@")).toHaveLength(2);
  });

  it("carries the 40-hex sha through verbatim (lowercase, length 40)", () => {
    const pinned = formatPinnedRef(REF);
    const sha = pinned.slice(pinned.indexOf("@") + 1);
    expect(sha).toBe(SHA);
    expect(sha).toHaveLength(40);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("ignores defaultBranch — only owner, name and sha appear", () => {
    const withOtherBranch: RepoRef = { ...REF, defaultBranch: "trunk" };
    expect(formatPinnedRef(withOtherBranch)).toBe(formatPinnedRef(REF));
  });

  it("preserves owner and name verbatim, including hyphens and digits", () => {
    const ref: RepoRef = {
      owner: "necro-labs",
      name: "mixed-ruins-2",
      sha: "abcabcabcabcabcabcabcabcabcabcabcabcabca",
      defaultBranch: "main",
    };
    expect(formatPinnedRef(ref)).toBe(
      "necro-labs/mixed-ruins-2@abcabcabcabcabcabcabcabcabcabcabcabcabca",
    );
  });
});
