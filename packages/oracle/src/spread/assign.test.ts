// src/spread/assign.test.ts
//
// Unit tests for the spread engine (task 28.1, test-first). These tests are
// EXPECTED TO FAIL (RED) until task 28.2 implements the real `assignSpread`;
// the current `src/spread/assign.ts` is a throwing stub. They pin the design
// contract from design.md "Spread Assignment Algorithm" and requirements
// R17.1–R17.8.
//
// Draws are constructed directly (no detector run, no network, no WASM). Card
// weights come from CARD_REGISTRY so the `severity × weight` ordering the tests
// assert matches the real registry the implementation will read.
//
// _Requirements: R17.1, R17.2, R17.3, R17.4, R17.5, R17.6, R17.7, R17.8_
import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "../registry/cards.js";
import type { CardDraw, CardId, Severity } from "../registry/schema.js";
import { assignSpread, type SpreadKind } from "./assign.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal, schema-valid CardDraw for a card id. Orientation follows the
 * detector convention (severity 1 → reversed, 2/3 → upright) but the spread
 * engine never inspects it, so the tests do not depend on that mapping.
 */
function draw(card: CardId, severity: Severity): CardDraw {
  return {
    card,
    severity,
    orientation: severity === 1 ? "reversed" : "upright",
    evidence: [],
    summary: `${card} @ severity ${severity}`,
    grimoires: [...(CARD_REGISTRY.get(card)?.linkedGrimoireIds ?? [])],
  };
}

/** The `severity × weight` product the engine ranks by. */
function product(d: CardDraw): number {
  return d.severity * (CARD_REGISTRY.get(d.card)?.weight ?? 0);
}

/** Non-null card ids across all filled positions, in position order. */
function filledCards(positions: ReturnType<typeof assignSpread>): CardId[] {
  return positions
    .filter((p) => p.draw !== null)
    .map((p) => p.draw!.card);
}

const SHA = "a".repeat(40);

const FATES_LABELS = ["Past", "Present", "Future"];
const NECROPSY_LABELS = [
  "The Corpse",
  "The Wound",
  "The Shadow",
  "The Hope",
  "The Call",
];
const CELTIC_LABELS = [
  "Present",
  "Crossing",
  "Foundation",
  "Recent Past",
  "Crown",
  "Near Future",
  "Self",
  "Environment",
  "Hopes and Fears",
  "Outcome",
];

const COUNTS: Record<SpreadKind, number> = {
  fates: 3,
  necropsy: 5,
  celtic: 10,
};

const LABELS: Record<SpreadKind, string[]> = {
  fates: FATES_LABELS,
  necropsy: NECROPSY_LABELS,
  celtic: CELTIC_LABELS,
};

// ---------------------------------------------------------------------------
// R17.1 — exported pure function
// ---------------------------------------------------------------------------

describe("R17.1: assignSpread is an exported function", () => {
  it("is callable with (draws, kind, sha)", () => {
    expect(typeof assignSpread).toBe("function");
    expect(assignSpread.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// R17.2, R17.3, R17.4 — exact counts and labels per kind
// ---------------------------------------------------------------------------

describe("R17.2, R17.3, R17.4: exact position counts and labels", () => {
  const sampleDraws: CardDraw[] = [
    draw("judgement", 3),
    draw("tower", 2),
    draw("devil", 2),
    draw("death", 2),
    draw("wheel", 1),
    draw("hermit", 2),
  ];

  for (const kind of ["fates", "necropsy", "celtic"] as const) {
    it(`${kind}: returns exactly ${COUNTS[kind]} positions with 1-based indices`, () => {
      const positions = assignSpread(sampleDraws, kind, SHA);
      expect(positions).toHaveLength(COUNTS[kind]);
      expect(positions.map((p) => p.position)).toEqual(
        Array.from({ length: COUNTS[kind] }, (_, i) => i + 1),
      );
    });

    it(`${kind}: labels appear in the required order`, () => {
      const positions = assignSpread(sampleDraws, kind, SHA);
      expect(positions.map((p) => p.label)).toEqual(LABELS[kind]);
    });
  }
});

// ---------------------------------------------------------------------------
// R17.3 — necropsy selection rules
// ---------------------------------------------------------------------------

describe("R17.3: necropsy selection rules", () => {
  it("The Corpse holds the highest severity × weight; The Wound the second highest", () => {
    // judgement weight 20 → 3×20=60 (corpse); tower 15 → 2×15=30 (wound);
    // hermit 5 → 2×5=10.
    const draws = [draw("hermit", 2), draw("judgement", 3), draw("tower", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);

    const corpse = positions[0]!;
    const wound = positions[1]!;
    expect(corpse.label).toBe("The Corpse");
    expect(corpse.draw?.card).toBe("judgement");
    expect(wound.label).toBe("The Wound");
    expect(wound.draw?.card).toBe("tower");
    expect(product(corpse.draw!)).toBeGreaterThanOrEqual(product(wound.draw!));
  });

  it("The Shadow holds the devil draw when devil is present (even if not third by score)", () => {
    // devil present but low product (1×18=18) vs death (2×10=20) and others;
    // devil must still land in The Shadow.
    const draws = [
      draw("judgement", 3),
      draw("tower", 2),
      draw("death", 2),
      draw("devil", 1),
    ];
    const positions = assignSpread(draws, "necropsy", SHA);
    const shadow = positions[2]!;
    expect(shadow.label).toBe("The Shadow");
    expect(shadow.draw?.card).toBe("devil");
  });

  it("The Shadow falls back to the third highest severity × weight when devil is absent", () => {
    // corpse=judgement(60), wound=tower(30), shadow=death(20) with no devil.
    const draws = [draw("judgement", 3), draw("tower", 2), draw("death", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);
    const shadow = positions[2]!;
    expect(shadow.label).toBe("The Shadow");
    expect(shadow.draw?.card).toBe("death");
  });

  it("The Hope holds the star draw when star is present", () => {
    const draws = [draw("judgement", 3), draw("star", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);
    const hope = positions[3]!;
    expect(hope.label).toBe("The Hope");
    expect(hope.draw?.card).toBe("star");
  });

  it("The Hope is a void position when star is absent", () => {
    const draws = [draw("judgement", 3), draw("tower", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);
    const hope = positions[3]!;
    expect(hope.label).toBe("The Hope");
    expect(hope.draw).toBeNull();
    expect(hope.description).toBe(
      "This position holds no card — the void is a sign.",
    );
  });

  it("The Call holds judgement when judgement is drawn and has linked grimoires", () => {
    // judgement has linkedGrimoireIds ["py2to3","pyproject"] in the registry.
    expect(
      (CARD_REGISTRY.get("judgement")?.linkedGrimoireIds.length ?? 0),
    ).toBeGreaterThan(0);
    const draws = [draw("judgement", 3), draw("tower", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);
    const call = positions[4]!;
    expect(call.label).toBe("The Call");
    expect(call.draw?.card).toBe("judgement");
  });

  it('The Call is void with "no ritual can be performed" when judgement is absent', () => {
    const draws = [draw("tower", 2), draw("death", 2)];
    const positions = assignSpread(draws, "necropsy", SHA);
    const call = positions[4]!;
    expect(call.label).toBe("The Call");
    expect(call.draw).toBeNull();
    expect(call.description).toContain("no ritual can be performed");
  });
});

// ---------------------------------------------------------------------------
// R17.6 — void sentinel fill for too-few draws
// ---------------------------------------------------------------------------

describe("R17.6: void sentinel fills positions with no candidate draw", () => {
  it("fills every position when there are zero draws", () => {
    const positions = assignSpread([], "necropsy", SHA);
    expect(positions).toHaveLength(5);
    for (const p of positions) {
      expect(p.draw).toBeNull();
      expect(typeof p.description).toBe("string");
      expect(p.description!.length).toBeGreaterThan(0);
    }
    // The Call's void description is the ritual-specific override.
    expect(positions[4]!.description).toContain("no ritual can be performed");
    // Other void positions use the generic sign description.
    expect(positions[0]!.description).toBe(
      "This position holds no card — the void is a sign.",
    );
  });

  it("fills trailing positions with the void sentinel when draws are fewer than positions (celtic)", () => {
    const draws = [draw("judgement", 3), draw("tower", 2)];
    const positions = assignSpread(draws, "celtic", SHA);
    expect(positions).toHaveLength(10);
    const filled = positions.filter((p) => p.draw !== null);
    const voided = positions.filter((p) => p.draw === null);
    expect(filled).toHaveLength(2);
    expect(voided).toHaveLength(8);
    for (const p of voided) {
      expect(p.description).toBe(
        "This position holds no card — the void is a sign.",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// R17.7 — no duplicate CardId
// ---------------------------------------------------------------------------

describe("R17.7: no CardId appears more than once in a spread", () => {
  it("places each drawn card in at most one position (necropsy)", () => {
    const draws = [
      draw("judgement", 3),
      draw("devil", 2),
      draw("star", 2),
      draw("tower", 2),
      draw("death", 2),
    ];
    const positions = assignSpread(draws, "necropsy", SHA);
    const cards = filledCards(positions);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("never repeats a card across the ten celtic positions", () => {
    const draws = [
      draw("judgement", 3),
      draw("tower", 2),
      draw("devil", 2),
      draw("death", 2),
      draw("moon", 2),
      draw("wheel", 1),
    ];
    const positions = assignSpread(draws, "celtic", SHA);
    const cards = filledCards(positions);
    expect(new Set(cards).size).toBe(cards.length);
  });
});

// ---------------------------------------------------------------------------
// R17.8 — determinism
// ---------------------------------------------------------------------------

describe("R17.8: identical result for the same (draws, kind, sha)", () => {
  const draws = [
    draw("judgement", 3),
    draw("tower", 2),
    draw("devil", 2),
    draw("death", 2),
    draw("star", 2),
    draw("moon", 1),
  ];

  for (const kind of ["fates", "necropsy", "celtic"] as const) {
    it(`${kind}: two calls return deeply-equal arrays`, () => {
      const first = assignSpread(draws, kind, SHA);
      const second = assignSpread(draws, kind, SHA);
      expect(second).toEqual(first);
    });
  }
});

// ---------------------------------------------------------------------------
// R17.5 — djb2 SHA-seeded tiebreak determinism
// ---------------------------------------------------------------------------

describe("R17.5: SHA-seeded djb2 tiebreak is stable", () => {
  // Three cards with identical severity × weight products so the only ordering
  // signal is the SHA-seeded tiebreak. justice 6×2=12, (pick cards whose
  // products collide): tower 15, devil 18, moon 9 — instead use equal products
  // via severities: devil 18×1=18, moon 9×2=18, hanged_man ... keep it exact.
  // devil 18×1 = 18; moon 9×2 = 18. Two equal-product cards suffice for a tie.
  const tie = [draw("devil", 1), draw("moon", 2)];

  it("equal severity × weight draws are ordered identically on repeated calls with the same sha", () => {
    expect(product(tie[0]!)).toBe(product(tie[1]!));
    const a = assignSpread(tie, "necropsy", SHA);
    const b = assignSpread(tie, "necropsy", SHA);
    expect(filledCards(b)).toEqual(filledCards(a));
  });

  it("tiebreak order is insensitive to input draw ordering (depends only on sha)", () => {
    const forward = assignSpread([tie[0]!, tie[1]!], "necropsy", SHA);
    const reversed = assignSpread([tie[1]!, tie[0]!], "necropsy", SHA);
    expect(filledCards(reversed)).toEqual(filledCards(forward));
  });

  it("different shas may reorder ties but each sha is internally stable", () => {
    const shaX = "0".repeat(40);
    const shaY = "f".repeat(40);
    const x1 = filledCards(assignSpread(tie, "necropsy", shaX));
    const x2 = filledCards(assignSpread(tie, "necropsy", shaX));
    const y1 = filledCards(assignSpread(tie, "necropsy", shaY));
    expect(x1).toEqual(x2); // internally stable for shaX
    // Both orderings must still contain exactly the two tied cards.
    expect(new Set(x1)).toEqual(new Set(["devil", "moon"]));
    expect(new Set(y1)).toEqual(new Set(["devil", "moon"]));
  });
});
