// src/landing/repos.test.ts
//
// LEGACY REPOS table — example tests.
//
// Validates: Requirements R4.1, R4.2, R4.3, R4.4, R6.5
//
// These examples pin the concrete, named facts of the DMG landing repo table:
// the three authored rows with exact ref/tag/file-count/label, the ORACLE SAYS
// lines, the row order (the three repos followed by the ENTER affordance as the
// final LANDING_ROWS entry), and the oracle-voice column/ASCII budget on every
// ORACLE SAYS line. Each row is also re-validated against LegacyRepoSchema so a
// drift in the authored data fails loudly here.

import { describe, expect, it } from "vitest";
import {
  ENTER_ANY_LABEL,
  LANDING_ROWS,
  LEGACY_REPOS,
  LegacyRepoSchema,
  type LandingRow,
  type LegacyRepo,
} from "./repos.js";

/** The three concrete rows in their authored order (R4.1–R4.3). */
const EXPECTED_REPOS: readonly LegacyRepo[] = [
  {
    ref: "tomaes/pytarl",
    label: "tomaes/pytarl",
    tag: "DUNGEON",
    files: "4 FILES",
    oracleSays: "A small dungeon of dead code waits below.",
  },
  {
    ref: "ArmstrongJ/robotadventure",
    label: "ArmstrongJ/robotadventure",
    tag: "NOIR MYSTERY",
    files: "21 FILES",
    oracleSays: "A noir mystery, its detective long since gone.",
  },
  {
    ref: "neubig/test-repo",
    label: "neubig/test-repo",
    tag: "PY2 SPECIMEN",
    files: "240 FILES",
    oracleSays: "A vast specimen, 240 corpses of Python 2.",
  },
];

describe("LEGACY_REPOS — the three concrete rows", () => {
  // R4.1, R4.2, R4.3: exactly the three authored repos, no more.
  it("contains exactly three repos in the authored order (R4.1, R4.2, R4.3)", () => {
    expect(LEGACY_REPOS).toStrictEqual(EXPECTED_REPOS);
  });

  // R4.1–R4.3: each row's ref / tag / file count / label are exact.
  it.each(EXPECTED_REPOS)(
    "pins the exact ref, tag, files and label for $ref (R4.1, R4.2, R4.3)",
    (expected) => {
      const row = LEGACY_REPOS.find((r) => r.ref === expected.ref);
      expect(row).toStrictEqual(expected);
    },
  );

  // R4.1–R4.3: the three ref/tag/"N FILES" triples, asserted literally.
  it("maps each ref to its DMG tag and file-count caption (R4.1, R4.2, R4.3)", () => {
    const triples = LEGACY_REPOS.map((r) => [r.ref, r.tag, r.files]);
    expect(triples).toStrictEqual([
      ["tomaes/pytarl", "DUNGEON", "4 FILES"],
      ["ArmstrongJ/robotadventure", "NOIR MYSTERY", "21 FILES"],
      ["neubig/test-repo", "PY2 SPECIMEN", "240 FILES"],
    ]);
  });
});

describe("LANDING_ROWS — order and the ENTER affordance", () => {
  // R4.4: the three repos first, in order, each wrapped as a "repo" row.
  it("lists the three repos first, in order (R4.4)", () => {
    const repoRows = LANDING_ROWS.slice(0, 3);
    expect(repoRows).toStrictEqual<LandingRow[]>(
      EXPECTED_REPOS.map((repo) => ({ kind: "repo", repo })),
    );
  });

  // R4.4: the ENTER row is the final entry, with the exact label.
  it("places the ENTER row last with the exact label (R4.4)", () => {
    expect(LANDING_ROWS).toHaveLength(LEGACY_REPOS.length + 1);
    expect(LANDING_ROWS.at(-1)).toStrictEqual<LandingRow>({
      kind: "enter",
      label: "> ENTER ANY REPO...",
    });
    expect(ENTER_ANY_LABEL).toBe("> ENTER ANY REPO...");
  });

  // R4.4: exactly one ENTER row, and it is the last one.
  it("has exactly one ENTER row and it is the only non-repo row (R4.4)", () => {
    const enterRows = LANDING_ROWS.filter((row) => row.kind === "enter");
    expect(enterRows).toHaveLength(1);
    const lastIndex = LANDING_ROWS.length - 1;
    LANDING_ROWS.forEach((row, index) => {
      expect(row.kind).toBe(index === lastIndex ? "enter" : "repo");
    });
  });
});

describe("ORACLE SAYS lines — oracle-voice column and ASCII budget", () => {
  // R6.5: every ORACLE SAYS line is <= 72 columns.
  it.each(LEGACY_REPOS)(
    "keeps the ORACLE SAYS line for $ref within 72 columns (R6.5)",
    (repo) => {
      expect(repo.oracleSays.length).toBeLessThanOrEqual(72);
    },
  );

  // R6.5: every ORACLE SAYS line is pure printable ASCII — no non-ASCII
  // bytes, no emoji, no control characters.
  it.each(LEGACY_REPOS)(
    "keeps the ORACLE SAYS line for $ref ASCII-only (R6.5)",
    (repo) => {
      // Printable ASCII range 0x20–0x7E only.
      expect(repo.oracleSays).toMatch(/^[\x20-\x7e]*$/);
      for (const ch of repo.oracleSays) {
        expect(ch.codePointAt(0)).toBeLessThanOrEqual(0x7e);
      }
    },
  );
});

describe("LegacyRepoSchema — every row validates", () => {
  // R4.1–R4.4: each authored row round-trips through the schema.
  it.each(LEGACY_REPOS)("validates row $ref against the schema", (repo) => {
    expect(() => LegacyRepoSchema.parse(repo)).not.toThrow();
    expect(LegacyRepoSchema.parse(repo)).toStrictEqual(repo);
  });

  // .strict() rejects unknown keys, so the schema is genuinely constraining.
  it("rejects a row carrying an unknown key (schema is .strict())", () => {
    const withExtra = { ...EXPECTED_REPOS[0], rogue: "x" };
    expect(() => LegacyRepoSchema.parse(withExtra)).toThrow();
  });

  // oracleSays over 72 columns is rejected by the schema's .max(72).
  it("rejects an ORACLE SAYS line longer than 72 columns", () => {
    const tooLong = { ...EXPECTED_REPOS[0], oracleSays: "x".repeat(73) };
    expect(() => LegacyRepoSchema.parse(tooLong)).toThrow();
  });
});
