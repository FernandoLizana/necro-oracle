// src/detectors/world.test.ts
//
// Unit tests (test-first) for computeWorldDraw — XXI The World (Destiny After
// Resurrection). The implementation (world.ts, task 26.2) is a throwing stub,
// so these tests are EXPECTED RED until that task lands.
//
// Design API (design.md Components):
//   computeWorldDraw(verdict: Verdict, vitalityDelta: number): CardDraw | null
//
// Note: World is NOT a standard Detector. It takes a Verdict + vitalityDelta,
// not (snapshot, opts). The Verdict shape (from ../registry/schema.js):
//   { status: "REVIVED" | "UNDEAD" | "STILL_DEAD";
//     passedGates: GateId[]; failedGates: GateId[] }
// where GateId = "G1".."G6".
//
// Rules (R16):
//   - R16.2: status "REVIVED"    → world draw, severity 2, orientation upright.
//   - R16.3: status "UNDEAD"     → world draw, severity 1, orientation reversed.
//   - R16.4: status "STILL_DEAD" → null (the spread assembler inserts a tower
//            draw as the closing card; that is the caller's concern, not here).
//   - R16.5: non-null draws include the vitalityDelta value and the passed and
//            failed gate ids from the verdict as evidence.
//
// Covers: R16.1, R16.2, R16.3, R16.4, R16.5

import { describe, expect, it } from "vitest";

import type { CardDraw, Verdict } from "../registry/schema.js";
import { computeWorldDraw } from "./world.js";

// --- Helpers --------------------------------------------------------------

/** Concatenate every evidence item's searchable text (kind + detail). */
function evidenceText(draw: CardDraw): string {
  return draw.evidence.map((e) => `${e.kind} ${e.detail}`).join("\n");
}

// --- R16.2: REVIVED → severity 2 upright ----------------------------------

describe("computeWorldDraw (R16.1, R16.2): REVIVED → severity 2 upright", () => {
  it("returns a world draw with severity 2 and orientation upright", () => {
    const verdict: Verdict = {
      status: "REVIVED",
      passedGates: ["G1", "G2", "G3", "G4", "G5", "G6"],
      failedGates: [],
    };

    const draw = computeWorldDraw(verdict, 40);

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("world");
    expect(draw?.severity).toBe(2);
    expect(draw?.orientation).toBe("upright");
  });

  it("surfaces the vitalityDelta and every passed gate id as evidence (R16.5)", () => {
    const verdict: Verdict = {
      status: "REVIVED",
      passedGates: ["G1", "G2", "G3", "G4", "G5", "G6"],
      failedGates: [],
    };

    const draw = computeWorldDraw(verdict, 40);
    expect(draw).not.toBeNull();

    const text = evidenceText(draw as CardDraw);
    // The vitalityDelta value is surfaced.
    expect(text).toMatch(/40/);
    // Every passed gate id appears in the evidence.
    for (const gate of verdict.passedGates) {
      expect(text).toContain(gate);
    }
  });
});

// --- R16.3: UNDEAD → severity 1 reversed ----------------------------------

describe("computeWorldDraw (R16.1, R16.3): UNDEAD → severity 1 reversed", () => {
  it("returns a world draw with severity 1 and orientation reversed", () => {
    const verdict: Verdict = {
      status: "UNDEAD",
      passedGates: ["G1", "G2", "G3"],
      failedGates: ["G4", "G5", "G6"],
    };

    const draw = computeWorldDraw(verdict, 12);

    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("world");
    expect(draw?.severity).toBe(1);
    expect(draw?.orientation).toBe("reversed");
  });

  it("surfaces both the passed and failed gate ids as evidence (R16.5)", () => {
    const verdict: Verdict = {
      status: "UNDEAD",
      passedGates: ["G1", "G2", "G3"],
      failedGates: ["G4", "G5", "G6"],
    };

    const draw = computeWorldDraw(verdict, 12);
    expect(draw).not.toBeNull();

    const text = evidenceText(draw as CardDraw);
    for (const gate of verdict.passedGates) {
      expect(text).toContain(gate);
    }
    for (const gate of verdict.failedGates) {
      expect(text).toContain(gate);
    }
  });

  it("surfaces a negative vitalityDelta in the evidence detail (R16.5)", () => {
    const verdict: Verdict = {
      status: "UNDEAD",
      passedGates: ["G1"],
      failedGates: ["G2", "G3"],
    };

    const draw = computeWorldDraw(verdict, -25);
    expect(draw).not.toBeNull();

    const text = evidenceText(draw as CardDraw);
    expect(text).toMatch(/-25/);
  });
});

// --- R16.4: STILL_DEAD → null ---------------------------------------------

describe("computeWorldDraw (R16.4): STILL_DEAD → null", () => {
  it("returns null regardless of gate state or vitalityDelta", () => {
    const verdict: Verdict = {
      status: "STILL_DEAD",
      passedGates: ["G1"],
      failedGates: ["G2", "G3", "G4", "G5", "G6"],
    };

    expect(computeWorldDraw(verdict, -100)).toBeNull();
  });

  it("returns null even when no gates failed but the status is STILL_DEAD", () => {
    const verdict: Verdict = {
      status: "STILL_DEAD",
      passedGates: [],
      failedGates: [],
    };

    expect(computeWorldDraw(verdict, 0)).toBeNull();
  });
});

// --- R16.5: vitalityDelta surfaced in evidence detail ---------------------

describe("computeWorldDraw (R16.5): vitalityDelta surfaced in evidence", () => {
  it("includes a zero vitalityDelta in the evidence of a non-null draw", () => {
    const verdict: Verdict = {
      status: "REVIVED",
      passedGates: ["G1", "G2"],
      failedGates: [],
    };

    const draw = computeWorldDraw(verdict, 0);
    expect(draw).not.toBeNull();

    const text = evidenceText(draw as CardDraw);
    expect(text).toMatch(/\b0\b/);
  });

  it("carries the card id 'world' and a non-empty summary on non-null draws", () => {
    const verdict: Verdict = {
      status: "REVIVED",
      passedGates: ["G1", "G2", "G3"],
      failedGates: [],
    };

    const draw = computeWorldDraw(verdict, 30);
    expect(draw).not.toBeNull();
    expect(draw?.card).toBe("world");
    expect((draw as CardDraw).evidence.length).toBeGreaterThan(0);
    expect(typeof draw?.summary).toBe("string");
    expect((draw?.summary ?? "").length).toBeGreaterThan(0);
  });
});
