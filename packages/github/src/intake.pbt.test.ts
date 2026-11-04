import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbForeignHostUrl, arbGithubUrl, arbMalformedRef } from "../test/arbitraries.js";
import { SummonerError } from "./errors.js";
import { parseRepoRef } from "./intake.js";

// Feature: 02-github-summoner, Property 1: Reference parse round-trip
// Validates: Requirements R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R10.2
// fast-check prints the shrunk counterexample and seed on failure by default.
describe("P1 (R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R10.2): reference parse round-trip", () => {
  it("returns normalized host, original-case owner/name and the ref (or null) for every accepted form", () => {
    fc.assert(
      fc.property(arbGithubUrl, ({ input, expected }) => {
        const parsed = parseRepoRef(input);
        expect(parsed.host).toBe(expected.host);
        expect(parsed.owner).toBe(expected.owner);
        expect(parsed.name).toBe(expected.name);
        expect(parsed.ref).toBe(expected.ref);
      }),
      { numRuns: 1000 },
    );
  });
});

// Feature: 02-github-summoner, Property 2: Foreign hosts are rejected
// Validates: Requirements R1.7, R7.2
describe("P2 (R1.7, R7.2): foreign hosts are rejected", () => {
  it("throws INVALID_REPO_URL for every URL whose host is not github.com / www.github.com", () => {
    fc.assert(
      fc.property(arbForeignHostUrl, ({ input }) => {
        let thrown: unknown;
        try {
          parseRepoRef(input);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(SummonerError);
        expect((thrown as SummonerError).code).toBe("INVALID_REPO_URL");
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: 02-github-summoner, Property 3: Malformed references are rejected
// Validates: Requirements R1.8, R1.9, R7.2
describe("P3 (R1.8, R1.9, R7.2): malformed references are rejected", () => {
  it("throws INVALID_REPO_URL for empty, ownerless, nameless, bad-character and dot-segment references", () => {
    fc.assert(
      fc.property(arbMalformedRef, (input) => {
        let thrown: unknown;
        try {
          parseRepoRef(input);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(SummonerError);
        expect((thrown as SummonerError).code).toBe("INVALID_REPO_URL");
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: 02-github-summoner, Property 4: Parsing is idempotent
// Validates: Requirements R1.11
describe("P4 (R1.11): parsing is idempotent", () => {
  it("parsing twice is deeply equal, and re-formatting as owner/name[#ref] parses to the same reference", () => {
    fc.assert(
      fc.property(arbGithubUrl, ({ input }) => {
        const first = parseRepoRef(input);
        const second = parseRepoRef(input);
        expect(second).toEqual(first);

        const formatted = `${first.owner}/${first.name}${first.ref === null ? "" : `#${first.ref}`}`;
        expect(parseRepoRef(formatted)).toEqual(first);
      }),
      { numRuns: 1000 },
    );
  });
});
