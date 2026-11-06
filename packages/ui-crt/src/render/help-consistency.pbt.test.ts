// src/render/help-consistency.pbt.test.ts
//
// Feature: arcana-visions, task 10.2.
//
// Property-based test pinning the Help/spread consistency invariant: the set of
// `read` spread names advertised by `renderHelp()` must equal exactly the set
// of spreads `parseCommand` accepts for the `read` command. Task 10.1 changed
// the help line to `read <fates|necropsy|celtic>` so the two sources of truth
// agree; this test keeps them agreeing.
//
// Two sources are derived independently:
//
//   - The advertised set comes from the *rendered* help block: we flatten
//     `renderHelp()` to text, find the `read <...>` line, and split the
//     pipe-separated tokens inside the angle brackets. This reads the real
//     output a user sees, not an internal constant.
//   - The accepted set comes from driving `parseCommand("read <token>")` and
//     observing which tokens yield a `{ kind: "read", spread }` command whose
//     `spread` echoes the token.
//
// The example asserts exact set equality (`fates`, `necropsy`, `celtic`). The
// fast-check property fuzzes arbitrary lowercase tokens and asserts the
// biconditional: a token is listed in help IFF `parseCommand` treats
// `read <token>` as a valid read naming that spread.
//
// Testing steering: fast-check with explicit numRuns; the seed prints on
// failure. No network / LLM / sandbox — pure computation over two pure
// functions.
//
// **Validates: Requirements R9.2, R9.4**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseCommand } from "../command/parse.js";
import { blockText } from "./blocks.js";
import { renderHelp } from "./help.js";

/** Token fuzzing is in the 200-run default tier. */
const NUM_RUNS = 200;

/** The spreads task 10.1 fixed as the accepted/advertised set. */
const EXPECTED_SPREADS = ["fates", "necropsy", "celtic"] as const;

/**
 * Extract the spread names advertised by the rendered help block. Finds the
 * `read <...>` command line in `renderHelp()`'s flattened text and splits the
 * pipe-separated tokens inside the first `<...>` group. Throws if the line or
 * the bracket group is missing, so a help change that drops the form fails
 * loudly rather than silently yielding an empty set.
 */
function advertisedReadSpreads(): string[] {
  const text = blockText(renderHelp());
  const readLine = text
    .split("\n")
    .find((line) => /^read\s+</.test(line.trim()));
  if (readLine === undefined) {
    throw new Error("renderHelp() has no `read <...>` command line");
  }
  const match = /<([^>]*)>/.exec(readLine);
  if (match === null) {
    throw new Error(`read help line has no <...> group: ${readLine}`);
  }
  return match[1]!.split("|").map((token) => token.trim());
}

/**
 * The spread `parseCommand` assigns to `read <token>`, or `null` when the token
 * is not accepted as a read spread. Case-insensitivity in the parser means we
 * compare the lowercased token against the echoed `spread`.
 */
function acceptedReadSpread(token: string): string | null {
  const command = parseCommand(`read ${token}`);
  return command !== null && command.kind === "read" ? command.spread : null;
}

describe("P16 (R9.2, R9.4): help spread list equals the accepted spread set", () => {
  it("advertises exactly fates, necropsy, celtic (R9.2, R9.4)", () => {
    const advertised = advertisedReadSpreads();
    expect(new Set(advertised)).toEqual(new Set(EXPECTED_SPREADS));
    // No token repeated inside the <...> group.
    expect(advertised).toHaveLength(EXPECTED_SPREADS.length);
  });

  it("accepts exactly the advertised spreads for `read` (R9.2, R9.4)", () => {
    const advertised = advertisedReadSpreads();
    // Every advertised spread is accepted and round-trips to itself.
    for (const spread of advertised) {
      expect(acceptedReadSpread(spread)).toBe(spread);
    }
    // The accepted set, probed over the advertised candidates, equals it.
    const accepted = advertised.filter(
      (token) => acceptedReadSpread(token) === token,
    );
    expect(new Set(accepted)).toEqual(new Set(advertised));
  });

  it("lists a lowercase token IFF `parseCommand` reads it as that spread (R9.2, R9.4)", () => {
    const advertised = new Set(advertisedReadSpreads());
    // Fuzz lowercase tokens, mixing arbitrary strings with the known spreads so
    // the accepted branch is exercised, not only rejections.
    const arbToken = fc.oneof(
      fc.constantFrom(...EXPECTED_SPREADS),
      fc
        .string({ minLength: 1, maxLength: 12 })
        .map((s) => s.toLowerCase())
        .filter((s) => s.length > 0 && !/\s/u.test(s)),
    );
    fc.assert(
      fc.property(arbToken, (token) => {
        const listed = advertised.has(token);
        const accepted = acceptedReadSpread(token) === token;
        // Biconditional: advertised exactly when accepted as that spread.
        expect(accepted).toBe(listed);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
