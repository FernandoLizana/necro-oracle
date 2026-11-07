// @necro/grimoires-lovers-js — the three landing-repo golden fixtures (task 8.5).
//
// This test pins the DETERMINISTIC template path of the Lovers (VI) binding for
// the three landing repositories the oracle lands on — `tomaes/pytarl`,
// `ArmstrongJ/robotadventure`, and `neubig/test-repo` (R23.1, R37.2, design
// "Testing Strategy — lovers golden fixtures"). Each fixture is keyed by its
// `extractPlan` output, exactly as the design prescribes.
//
// LAYOUT (design "Repository layout", `src/fixtures/{case}/{before,after}/`,
// matching the grimoire-authoring steering `fixtures/<case>/before -> after`):
//
//   src/fixtures/<case>/before/resurrected.py   the RESURRECTED Python 3 input
//   src/fixtures/<case>/after/heart.py          pinned pythonHeart
//   src/fixtures/<case>/after/beloved.mjs       pinned jsBeloved
//   src/fixtures/<case>/after/contract.schema.json  pinned contractSchema
//   src/fixtures/<case>/after/test_heart.py     pinned pythonTests
//   src/fixtures/<case>/after/beloved.test.mjs  pinned jsTests
//
// GOLDEN CONVENTION. py2to3 ships no pinned goldens yet (its `fixtures/` holds
// only a `.gitkeep`), so this grimoire is the first to pin lovers goldens. We
// pin the five emitted artifacts as SEPARATE files (one per `LoversPair` field)
// rather than a single JSON snapshot, because each artifact is itself source
// text (`.py`, `.mjs`, `.json`) that stays human-reviewable in a diff — a
// reviewer sees exactly what the heart/beloved/contract/tests look like, and a
// fixer change that shifts a byte shows up as a readable source diff, not a
// re-escaped JSON blob. This mirrors the grimoire-authoring `before -> after`
// rule directly: `before/` is the input, `after/` is the pinned output.
//
// WHAT THIS PROVES. For each fixture the test runs `extractPlan(before)`
// (expecting `ok`), feeds the plan to `buildTemplatePair`, and asserts the
// emitted pair EQUALS the pinned `after/` files BYTE FOR BYTE. Because both
// `extractPlan` and `buildTemplatePair` are pure and deterministic, this both
// pins the goldens AND proves determinism (identical input -> identical output,
// every run).
//
// MAINTENANCE RULE (grimoire-authoring / testing steering). A future fixer
// change that alters any emitted artifact MUST update the corresponding
// `after/` golden in the SAME change, with a reason — an unexplained golden
// drift is a regression, not an update. To regenerate after an intended change,
// set `NECRO_UPDATE_GOLDENS=1` and run this test once; it rewrites the `after/`
// files from the current builders, then re-run WITHOUT the flag to confirm the
// new goldens are stable.
//
// Pure/offline: no network, no LLM, no sandbox — `extractPlan` +
// `buildTemplatePair` are pure and the fixtures are committed files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPlan, type LoversPair } from "@necro/coven";
import { initParser } from "@necro/oracle";
import { beforeAll, describe, expect, it } from "vitest";

import { buildTemplatePair } from "../index.js";

// `extractPlan` defaults to the oracle's synchronous `parsePython`, which must
// be armed once before use (mirrors `extract-plan.test.ts`). No network/LLM.
beforeAll(async () => {
  await initParser();
});

/** Absolute path to packages/grimoires/lovers-js/src/fixtures, from this file. */
const FIXTURES_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The three landing-repo fixture case directories (R23.1). */
const CASES = ["pytarl", "robotadventure", "test-repo"] as const;

/** When set, the test rewrites the `after/` goldens instead of asserting. */
const UPDATE = process.env.NECRO_UPDATE_GOLDENS === "1";

/** The pinned `after/` file name for each {@link LoversPair} artifact. */
const GOLDEN_FILES: Record<keyof LoversPair, string> = {
  pythonHeart: "heart.py",
  jsBeloved: "beloved.mjs",
  contractSchema: "contract.schema.json",
  pythonTests: "test_heart.py",
  jsTests: "beloved.test.mjs",
};

/** Read a fixture file as UTF-8 text with normalised (\n) line endings. */
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("R23.1, R37.2: the three landing-repo golden fixtures (deterministic template path)", () => {
  for (const name of CASES) {
    describe(name, () => {
      const beforePath = join(FIXTURES_DIR, name, "before", "resurrected.py");
      const afterDir = join(FIXTURES_DIR, name, "after");

      it("extractPlan(before) succeeds and buildTemplatePair matches the pinned after/ goldens byte-for-byte", () => {
        const source = readText(beforePath);

        const result = extractPlan(source);
        expect(result.ok, `extractPlan must succeed for ${name}`).toBe(true);
        if (!result.ok) return; // narrow for TS; the assertion above already failed.

        const pair = buildTemplatePair(result.plan);

        for (const key of Object.keys(GOLDEN_FILES) as (keyof LoversPair)[]) {
          const goldenPath = join(afterDir, GOLDEN_FILES[key]);
          const emitted = pair[key];

          if (UPDATE || !existsSync(goldenPath)) {
            mkdirSync(dirname(goldenPath), { recursive: true });
            writeFileSync(goldenPath, emitted, "utf8");
            continue;
          }

          expect(readText(goldenPath), `${name}/after/${GOLDEN_FILES[key]} is stale`).toBe(emitted);
        }
      });
    });
  }
});
