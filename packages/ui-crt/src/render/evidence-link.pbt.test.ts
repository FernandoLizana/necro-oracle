// Feature: 03-crt-terminal, Property 17: Evidence_Link construction
//
// TEST-FIRST (red). This file is written before `render/evidence-link.ts`
// (task 8.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the evidence-link module does not exist yet.
//
// Validates: Requirements R14.4, R14.5
//
// P17 states: for all valid `RepoRef` and `Evidence` values, the Evidence_Link
// target begins with `https://github.com/{owner}/{name}/blob/{sha}/`, every
// path segment is percent-encoded (contains no unencoded character outside the
// URL path-safe set), decodes back to the original segments, carries `#L{line}`
// only when `line` is defined, and is `null` when `path` is absent.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Evidence, RepoRef } from "@necro/oracle/client";

// Not yet implemented — task 8.2 adds this module.
import { buildEvidenceLink } from "./evidence-link.js";

const NUM_RUNS = 200;

// --- Arbitraries -------------------------------------------------------------

/** A 40-character lowercase hex commit sha, as GitHub uses. */
const arbSha: fc.Arbitrary<string> = fc.stringMatching(/^[0-9a-f]{40}$/);

/**
 * An owner/name token over GitHub's safe set. Non-empty so it satisfies the
 * `RepoRefSchema` `.min(1)` constraints; kept to the characters that never need
 * percent-encoding themselves so the prefix assertion is exact.
 */
const arbOwnerName: fc.Arbitrary<string> = fc.stringMatching(
  /^[A-Za-z0-9._-]{1,30}$/,
);

/** A `Pick<RepoRef, "owner" | "name" | "sha">` with a well-formed sha. */
const arbRef: fc.Arbitrary<Pick<RepoRef, "owner" | "name" | "sha">> = fc.record({
  owner: arbOwnerName,
  name: arbOwnerName,
  sha: arbSha,
});

/**
 * A single path segment exercising the full percent-encoding surface: spaces,
 * unicode (including surrogate pairs via `fc.fullUnicode`), and URL-reserved
 * special characters. A segment never contains `/` (that is the separator) and
 * is non-empty so `path.split("/")` round-trips cleanly.
 */
const arbPathSegment: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.fullUnicode() },
      { weight: 2, arbitrary: fc.constant(" ") },
      {
        weight: 3,
        arbitrary: fc.constantFrom(
          "?",
          "#",
          "%",
          "&",
          "=",
          "+",
          ":",
          "@",
          "[",
          "]",
          "(",
          ")",
          "!",
          "*",
          "'",
          ",",
          ";",
          "<",
          ">",
          '"',
          "\\",
          "{",
          "}",
          "|",
          "^",
          "`",
        ),
      },
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((chars) => chars.join(""))
  // Keep segments free of the separator so split/join round-trips exactly.
  .filter((s) => !s.includes("/"));

/** A path of one to five segments joined by `/`, e.g. `src/a b/MySQL-python`. */
const arbPath: fc.Arbitrary<string> = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join("/"));

/** A defined, nonnegative integer line number (Evidence.line allows 0). */
const arbLine: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100_000 });

/** An `Evidence`-shaped value with a present `path` and an optional `line`. */
const arbEvidenceWithPath: fc.Arbitrary<Pick<Evidence, "path" | "line">> = fc
  .tuple(arbPath, fc.option(arbLine, { nil: undefined }))
  .map(([path, line]) =>
    line === undefined ? { path } : { path, line },
  );

const GITHUB_PREFIX = "https://github.com/";

describe("P17 (R14.4, R14.5): evidence link", () => {
  it("returns null when the Evidence has no path", () => {
    fc.assert(
      fc.property(arbRef, fc.option(arbLine, { nil: undefined }), (ref, line) => {
        const evidence: Pick<Evidence, "path" | "line"> =
          line === undefined ? {} : { line };
        expect(buildEvidenceLink(ref, evidence)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("begins with the github blob prefix for the given ref", () => {
    fc.assert(
      fc.property(arbRef, arbEvidenceWithPath, (ref, evidence) => {
        const link = buildEvidenceLink(ref, evidence);
        expect(link).not.toBeNull();
        expect(link!.startsWith(
          `${GITHUB_PREFIX}${ref.owner}/${ref.name}/blob/${ref.sha}/`,
        )).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("percent-encodes every path segment and round-trips back to the original segments", () => {
    fc.assert(
      fc.property(arbRef, arbEvidenceWithPath, (ref, evidence) => {
        const link = buildEvidenceLink(ref, evidence);
        expect(link).not.toBeNull();

        const base = `${GITHUB_PREFIX}${ref.owner}/${ref.name}/blob/${ref.sha}/`;
        // Strip the prefix and any trailing #L fragment to get the encoded path.
        const afterPrefix = link!.slice(base.length);
        const hashIndex = afterPrefix.indexOf("#");
        const encodedPath =
          hashIndex === -1 ? afterPrefix : afterPrefix.slice(0, hashIndex);

        const originalSegments = evidence.path!.split("/");
        const encodedSegments = encodedPath.split("/");
        expect(encodedSegments).toHaveLength(originalSegments.length);

        // No segment contains a raw space (spaces must be percent-encoded).
        for (const seg of encodedSegments) {
          expect(seg.includes(" ")).toBe(false);
        }

        // Each encoded segment decodes back to the original segment.
        const decodedSegments = encodedSegments.map((seg) =>
          decodeURIComponent(seg),
        );
        expect(decodedSegments).toEqual(originalSegments);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("appends #L{line} exactly when line is defined", () => {
    fc.assert(
      fc.property(arbRef, arbPath, fc.option(arbLine, { nil: undefined }), (ref, path, line) => {
        const evidence: Pick<Evidence, "path" | "line"> =
          line === undefined ? { path } : { path, line };
        const link = buildEvidenceLink(ref, evidence)!;
        if (line === undefined) {
          expect(link.includes("#L")).toBe(false);
        } else {
          expect(link.endsWith(`#L${line}`)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
