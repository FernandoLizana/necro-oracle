// @necro/oracle — Item 3 (judge-ready-pass): the Necropsy "The Call" position
// must give a DISTINCT, nonempty reason for every blocked condition, and name
// the runnable command when a ritual is allowed. Never the bare heading.
//
// Before the fix every void Call used one dangling string
// ("no ritual can be performed — here is why"), and a filled Call printed no
// command. This regression pins: (a) judgement not drawn => a "not drawn"
// reason; (b) judgement drawn but ranked into an earlier seat => a "higher
// position" reason; (c) the two blocked reasons DIFFER; (d) an allowed Call
// (judgement holds the seat) carries a description that names `resurrect`.

import { describe, expect, it } from "vitest";

import { assignSpread } from "./assign.js";
import type { CardDraw, CardId, Severity } from "../registry/schema.js";

const SHA = "0".repeat(40);

function draw(card: CardId, severity: Severity): CardDraw {
  return {
    card,
    severity,
    orientation: "upright",
    evidence: [{ kind: "static", detail: "d", source: "static" }],
    summary: `${card} summary`,
    grimoires: [],
  };
}

function callOf(draws: CardDraw[]) {
  const positions = assignSpread(draws, "necropsy", SHA);
  const call = positions[4]!;
  expect(call.label).toBe("The Call");
  return call;
}

describe("Item 3: The Call void reasons are distinct, specific, and nonempty", () => {
  it("judgement not drawn => a specific 'not drawn' reason, not the bare heading", () => {
    const call = callOf([draw("tower", 2), draw("death", 2)]);
    expect(call.draw).toBeNull();
    const d = (call.description ?? "").trim();
    expect(d.length).toBeGreaterThan(0);
    expect(d).not.toBe("The Call");
    expect(d.toLowerCase()).toContain("no ritual can be performed");
    expect(d).toContain("not drawn");
  });

  it("judgement drawn but consumed by The Corpse => a distinct 'higher position' reason", () => {
    // High-product judgement is the global top draw and lands in The Corpse, so
    // The Call is void for a DIFFERENT reason than "not drawn".
    const call = callOf([draw("judgement", 3), draw("tower", 2)]);
    expect(call.draw).toBeNull();
    const d = (call.description ?? "").trim();
    expect(d.length).toBeGreaterThan(0);
    expect(d).toContain("higher position");
  });

  it("the not-drawn and already-placed reasons are different strings", () => {
    const notDrawn = callOf([draw("tower", 2), draw("death", 2)]).description;
    const alreadyPlaced = callOf([draw("judgement", 3), draw("tower", 2)]).description;
    expect(notDrawn).not.toBe(alreadyPlaced);
  });
});

describe("Item 3: an allowed ritual names the command to run", () => {
  it("a filled Call (judgement survives to position 5) names `resurrect`", () => {
    // Low-severity judgement is NOT top-3, so Corpse/Wound/Shadow take the
    // higher draws and judgement survives to fill The Call.
    const draws = [
      draw("tower", 3),
      draw("death", 3),
      draw("devil", 3),
      draw("judgement", 1),
    ];
    const call = callOf(draws);
    // If this fixture ever stops filling the Call, this guard makes the failure
    // obvious rather than silently testing a void Call.
    expect(call.draw?.card).toBe("judgement");
    const d = (call.description ?? "").trim();
    expect(d.length).toBeGreaterThan(0);
    expect(d.toLowerCase()).toContain("resurrect");
  });
});
