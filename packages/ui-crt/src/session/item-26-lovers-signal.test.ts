// src/session/item-26-lovers-signal.test.ts
//
// Item 26 (CORRECTED): the Lovers (VI) bindability precondition is signalled by
// the DRAW'S GRIMOIRE LINKAGE on a LEGAL diagnosis card -- a draw whose
// `grimoires` includes "lovers-js" -- NOT by an illegal `card: "lovers"` id
// (the oracle `CardId` enum is the 12 diagnosis cards; a reading carrying
// `card: "lovers"` fails `CardDrawSchema` and the client/server reject the
// whole reading, which is the exact baseline lovers-e2e failure item 26 fixes).
//
// This pins BOTH halves: (1) a reading carrying the grimoire-linked draw on a
// legal card is schema-VALID (an illegal "lovers" card id is NOT); (2) the pure
// `loversEligible` selector lights on that signal + a resurrectable file.
//
// Offline, pure. No network / LLM / sandbox.

import { CardDrawSchema, ReadingSchema } from "@necro/oracle/client";
import { describe, expect, it } from "vitest";

import { initialState } from "./state.js";
import type { SessionState } from "./state.js";
import { loversEligible } from "./visual-reading.js";
import {
  mockReading,
  mockReadingResponse,
  mockRef,
} from "../testing/mock-reading.js";
import type { ReadingResponse, RitualResponse } from "../protocol.js";

/** A minimal resurrectable ritual: one converted file in scope. */
const RITUAL: RitualResponse = {
  ritualId: "123e4567-e89b-42d3-a456-426614174000",
  selectedCount: 1,
  files: [
    {
      path: "src/greet.py",
      before: 'print "hi"\n',
      after: 'print("hi")\n',
      diff: [{ kind: "context", text: "" }],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch: "--- a/src/greet.py\n+++ b/src/greet.py\n",
  beforeVitality: 40,
  afterVitality: 55,
  vitalityDelta: 15,
  changedCards: [],
  degraded: false,
} as unknown as RitualResponse;

/** A reading whose JUDGEMENT draw carries the Lovers grimoire linkage. */
function readingWithLoversSignal(): ReadingResponse {
  const ref = mockRef();
  const base = mockReading(ref);
  // Clone and add "lovers-js" to the FIRST draw's grimoires (a legal card).
  const reading = structuredClone(base) as {
    draws: { grimoires: string[] }[];
    spread: { draw: { grimoires: string[] } | null }[];
  };
  for (const draw of reading.draws) draw.grimoires = ["lovers-js"];
  const firstDrawn = reading.spread.find((p) => p.draw !== null);
  if (firstDrawn && firstDrawn.draw) firstDrawn.draw.grimoires = ["lovers-js"];
  return { summary: mockReadingResponse().summary, reading: reading as never };
}

function stateWith(reading: ReadingResponse, ritual: RitualResponse | null): SessionState {
  return {
    ...initialState(),
    summary: reading.summary,
    readings: { necropsy: reading },
    lastSpread: "necropsy",
    lastRitual: ritual,
  };
}

describe("item 26: the Lovers signal is a grimoire linkage, not an illegal card id", () => {
  it("a draw carrying grimoires:['lovers-js'] on a LEGAL card is schema-valid", () => {
    const draw = {
      card: "judgement",
      severity: 2,
      orientation: "upright",
      evidence: [{ kind: "static", detail: "x", source: "static" }],
      summary: "s",
      grimoires: ["lovers-js"],
    };
    expect(() => CardDrawSchema.parse(draw)).not.toThrow();
  });

  it("an illegal card id 'lovers' is REJECTED by the schema (why item 26 exists)", () => {
    const illegal = {
      card: "lovers",
      severity: 2,
      orientation: "upright",
      evidence: [],
      summary: "s",
      grimoires: ["lovers-js"],
    };
    expect(() => CardDrawSchema.parse(illegal)).toThrow();
  });

  it("the whole reading with the grimoire-linked draw validates against ReadingSchema", () => {
    const { reading } = readingWithLoversSignal();
    expect(() => ReadingSchema.parse(reading)).not.toThrow();
  });

  it("loversEligible lights on the grimoire signal + a resurrectable file", () => {
    const result = loversEligible(stateWith(readingWithLoversSignal(), RITUAL));
    expect(result).not.toBeNull();
    expect(result?.file).toBe("src/greet.py");
  });

  it("loversEligible is null when NO draw carries the Lovers grimoire linkage", () => {
    // A plain reading (mockReading grimoires are []) must NOT light the chip.
    const plain = mockReadingResponse();
    expect(loversEligible(stateWith(plain, RITUAL))).toBeNull();
  });

  it("loversEligible is null when the signal is present but no file is resurrectable", () => {
    expect(loversEligible(stateWith(readingWithLoversSignal(), null))).toBeNull();
  });
});