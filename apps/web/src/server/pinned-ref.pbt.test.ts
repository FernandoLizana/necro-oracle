// apps/web/src/server/pinned-ref.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 18: pinned-reference round-trip
//
// Property 18 (R5.3, R6.1, R6.4): for every valid RepoRef, formatting it into
// the canonical Pinned_Reference string and then re-parsing that string with
// the summoner's `parseRepoRef` recovers the same owner, name and sha.
//
// The server owns its own copy of `formatPinnedRef`
// (`apps/web/src/server/pinned-ref.ts`, NOT yet written — task 20.2). That
// server copy is the one proven here because only the server can import
// `@necro/github` (the client ui-crt copy cannot, see design "Module layout").
// A client-side copy with the same one-line body lives in
// `@necro/ui-crt`, but this round trip against `parseRepoRef` is the server's
// responsibility per the design.
//
// This test is written first and is EXPECTED TO FAIL for the "missing module
// ./pinned-ref.js" reason until task 20.2 implements the server helper (red,
// then green).
//
// `formatPinnedRef(ref)` returns `owner/name@sha`. `parseRepoRef` turns that
// shorthand into a `ParsedRepoRef` whose `owner`/`name` are the segments and
// whose `ref` is the 40-hex lowercase sha (shas are lowercased by the parser).
// The property asserts owner, name and the sha all survive the round trip.
//
// _Requirements: R5.3, R6.1, R6.4_

import { parseRepoRef } from "@necro/github";
import type { RepoRef } from "@necro/oracle/client";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatPinnedRef } from "./pinned-ref.js";

// --- arbitraries for a valid RepoRef ---------------------------------------
//
// A valid owner/name segment matches the summoner's `NAME_RE`
// (`[A-Za-z0-9_.-]+`) and is neither "." nor ".." (those are rejected by
// `validSegment`). A valid sha is 40 lowercase hex characters.

const SEGMENT_CHAR = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-";

const arbSegment: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(...SEGMENT_CHAR.split("")), { minLength: 1, maxLength: 40 })
  .filter((s) => s !== "." && s !== ".." && !s.endsWith(".git"));

const arbSha: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 40, maxLength: 40 });

const arbRepoRef: fc.Arbitrary<RepoRef> = fc.record({
  owner: arbSegment,
  name: arbSegment,
  sha: arbSha,
  defaultBranch: arbSegment,
});

describe("P18 (R5.3, R6.1, R6.4): pinned-reference round-trip", () => {
  it("parseRepoRef(formatPinnedRef(ref)) recovers owner, name and sha", () => {
    fc.assert(
      fc.property(arbRepoRef, (ref) => {
        const parsed = parseRepoRef(formatPinnedRef(ref));
        expect(parsed.owner).toBe(ref.owner);
        expect(parsed.name).toBe(ref.name);
        expect(parsed.ref).toBe(ref.sha);
      }),
      { numRuns: 200 },
    );
  });
});
