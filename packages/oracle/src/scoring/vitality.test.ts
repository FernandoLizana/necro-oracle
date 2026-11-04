// src/scoring/vitality.test.ts
//
// Unit tests for vitality scoring (task 27.1 — TEST-FIRST).
//
// These tests are written against the design API before the real
// implementation lands in task 27.2. src/scoring/vitality.ts currently exports
// throwing stubs, so these tests are EXPECTED RED until 27.2 implements the
// pure computation. The suite still typechecks against the stub signatures.
//
// Formula (R18.2): Math.round(Math.max(0, 100 - Σ(card.weight × draw.severity)))
//   - empty / all-null draws → 100 (R18.5)
//   - penalty sum > 100 → clamped to 0 (R18.4)
//   - star / world carry weight 0, so they never reduce vitality (R18.3)
//   - computeVitalityDelta(before, after) === after - before (R18.6)
//
// _Requirements: R18.1, R18.2, R18.3, R18.4, R18.5, R18.6_
import { describe, expect, it } from "vitest";
import type { CardDraw, CardId, Severity } from "../registry/schema.js";
import { CARD_REGISTRY } from "../registry/cards.js";
import { computeVitality, computeVitalityDelta } from "./vitality.js";

/**
 * Build a minimal valid CardDraw for scoring. Orientation/evidence/summary are
 * irrelevant to the formula (only card weight × severity matters), so we keep
 * them trivial. Orientation follows the usual convention (severity 1 reversed,
 * otherwise upright) purely for realism; the score ignores it.
 */
function draw(card: CardId, severity: Severity): CardDraw {
  return {
    card,
    severity,
    orientation: severity === 1 ? "reversed" : "upright",
    evidence: [],
    summary: "",
    grimoires: [],
  };
}

/** The design/registry weight for a card, used to derive expected penalties. */
function weightOf(card: CardId): number {
  const def = CARD_REGISTRY.get(card);
  if (def === undefined) throw new Error(`no registry entry for ${card}`);
  return def.weight;
}

/** Expected score from the design formula, computed independently of the impl. */
function expectedVitality(draws: CardDraw[]): number {
  const penalty = draws.reduce(
    (sum, d) => sum + weightOf(d.card) * d.severity,
    0,
  );
  return Math.round(Math.max(0, 100 - penalty));
}

describe("R18.1, R18.5: empty and all-null-equivalent input", () => {
  it("returns 100 for an empty draw array", () => {
    expect(computeVitality([])).toBe(100);
  });

  it("returns an integer in [0, 100] for the empty case", () => {
    const v = computeVitality([]);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("returns 100 when every draw has severity 0 (not-drawn)", () => {
    // Severity 0 means the card was not drawn; Σ(weight × 0) = 0 → 100.
    const draws = [draw("judgement", 0), draw("tower", 0), draw("devil", 0)];
    expect(computeVitality(draws)).toBe(100);
  });
});

describe("R18.2, R18.3: single weighted card penalty", () => {
  it("subtracts weight × severity for one upright card", () => {
    // judgement weight 20 × severity 3 = 60 penalty → 100 - 60 = 40.
    const draws = [draw("judgement", 3)];
    expect(computeVitality(draws)).toBe(40);
    expect(computeVitality(draws)).toBe(expectedVitality(draws));
  });

  it("subtracts weight × severity for a reversed (severity 1) card", () => {
    // moon weight 9 × severity 1 = 9 penalty → 100 - 9 = 91.
    const draws = [draw("moon", 1)];
    expect(computeVitality(draws)).toBe(91);
    expect(computeVitality(draws)).toBe(expectedVitality(draws));
  });

  it.each<[CardId, Severity]>([
    ["tower", 2],
    ["devil", 2],
    ["death", 3],
    ["wheel", 2],
    ["hermit", 2],
    ["hanged_man", 2],
    ["temperance", 2],
    ["justice", 2],
  ])("matches the formula for a single %s at severity %i", (card, severity) => {
    const draws = [draw(card, severity)];
    expect(computeVitality(draws)).toBe(expectedVitality(draws));
  });
});

describe("R18.2: multiple cards sum their penalties", () => {
  it("sums weight × severity across several drawn cards", () => {
    // judgement 20×2=40, moon 9×1=9, justice 6×2=12 → Σ=61 → 100-61 = 39.
    const draws = [draw("judgement", 2), draw("moon", 1), draw("justice", 2)];
    expect(computeVitality(draws)).toBe(39);
    expect(computeVitality(draws)).toBe(expectedVitality(draws));
  });

  it("matches the formula for a larger mixed set", () => {
    const draws = [
      draw("tower", 1),
      draw("hermit", 2),
      draw("temperance", 1),
      draw("wheel", 2),
    ];
    expect(computeVitality(draws)).toBe(expectedVitality(draws));
  });
});

describe("R18.3: star and world never reduce vitality", () => {
  it("returns 100 when only star and world are drawn, even at max severity", () => {
    const draws = [
      draw("star", 2),
      draw("world", 2),
      draw("star", 3),
      draw("world", 1),
    ];
    expect(computeVitality(draws)).toBe(100);
  });

  it("ignores star/world when weighted cards are also present", () => {
    // Only judgement 20×2=40 contributes; star/world add 0 → 100-40 = 60.
    const weighted = [draw("judgement", 2)];
    const withStrength = [...weighted, draw("star", 3), draw("world", 2)];
    expect(computeVitality(withStrength)).toBe(computeVitality(weighted));
    expect(computeVitality(withStrength)).toBe(60);
  });
});

describe("R18.4: penalty sum exceeding 100 clamps to 0", () => {
  it("returns 0 when the penalty sum is well over 100", () => {
    // judgement 20×3=60, devil 18×3=54, tower 15×3=45 → Σ=159 > 100 → 0.
    const draws = [draw("judgement", 3), draw("devil", 3), draw("tower", 3)];
    expect(computeVitality(draws)).toBe(0);
  });

  it("returns 0 exactly at the clamp boundary (penalty === 100)", () => {
    // Construct a penalty of exactly 100: judgement 20×2=40 + wheel 12×... no.
    // judgement 20×5 is impossible (max severity 3). Use justice? Instead:
    // devil 18×3=54 + tower 15×2=30 + hermit 5×... build to exactly 100:
    // judgement 20×2=40, devil 18×2=36, justice 6×4 impossible. Use:
    // judgement 20×3=60 + hanged_man 8×5 impossible. Simplest exact-100:
    // tower 15×2=30 + devil 18×2=36 + death 10×2=20 + justice 6×... =14? no.
    // Use judgement 20×2=40 + devil 18×2=36 + hermit 5×... =24 → not integer*5.
    // Cleanest: justice 6×... Instead rely on the formula helper for exactness.
    // judgement 20×3=60 + moon 9×... Build 100 = 20*2 + 15*2 + 10*3 = 40+30+30.
    const draws = [draw("judgement", 2), draw("tower", 2), draw("death", 3)];
    // Σ = 40 + 30 + 30 = 100 → 100 - 100 = 0.
    expect(expectedVitality(draws)).toBe(0);
    expect(computeVitality(draws)).toBe(0);
  });

  it("never returns a negative number for overwhelming penalties", () => {
    const draws = [
      draw("judgement", 3),
      draw("devil", 3),
      draw("tower", 3),
      draw("wheel", 3),
      draw("moon", 3),
    ];
    const v = computeVitality(draws);
    expect(v).toBe(0);
    expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("R18.1: result is always an integer in [0, 100] (rounding)", () => {
  it("rounds the formula result to an integer", () => {
    // Weights are integers and severities are integers, so the penalty is an
    // integer and Math.round is a no-op here; assert integer-ness regardless.
    const draws = [draw("judgement", 2), draw("moon", 1)];
    const v = computeVitality(draws);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBe(expectedVitality(draws));
  });

  // Each row is wrapped in a single-element tuple so it.each passes the whole
  // CardDraw[] as one argument rather than spreading it into separate args.
  it.each<[CardDraw[]]>([
    [[]],
    [[draw("star", 3)]],
    [[draw("judgement", 1)]],
    [[draw("judgement", 3), draw("devil", 3), draw("tower", 3)]],
    [[draw("moon", 1), draw("hermit", 2), draw("justice", 2)]],
  ])("stays within [0, 100] for case %#", (draws) => {
    const v = computeVitality(draws);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});

describe("R18.6: computeVitalityDelta returns after - before", () => {
  it("is positive when vitality improved", () => {
    expect(computeVitalityDelta(40, 90)).toBe(50);
  });

  it("is negative when vitality worsened", () => {
    expect(computeVitalityDelta(90, 40)).toBe(-50);
  });

  it("is zero when vitality is unchanged", () => {
    expect(computeVitalityDelta(75, 75)).toBe(0);
  });

  it.each<[number, number]>([
    [0, 100],
    [100, 0],
    [0, 0],
    [100, 100],
    [33, 67],
  ])("equals after - before for (%i, %i)", (before, after) => {
    expect(computeVitalityDelta(before, after)).toBe(after - before);
  });
});
