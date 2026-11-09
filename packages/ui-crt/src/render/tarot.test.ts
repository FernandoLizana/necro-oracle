// src/render/tarot.test.ts
//
// Pure tarot render helper (judge-ready-pass items 31-33).

import {
  drawTarot,
  fallbackReading,
  seededRandomFn,
} from "@necro/oracle/client";
import { describe, expect, it } from "vitest";

import {
  renderTarotReading,
  tarotCardLines,
  tarotRevealBlocks,
} from "./tarot.js";

describe("items 31-33: tarot render helper", () => {
  it("tarotCardLines yields one labelled line per position with NAME + orientation", () => {
    const draw = drawTarot(seededRandomFn(5));
    const lines = tarotCardLines(draw);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Past - /);
    expect(lines[1]).toMatch(/^Present - /);
    expect(lines[2]).toMatch(/^Future - /);
    // Each line names the card in UPPERCASE and its orientation.
    for (const line of lines) {
      expect(line).toMatch(/\((upright|reversed)\):/);
    }
  });

  it("renderTarotReading composes header, cards, paragraphs, and a VERDICT line", () => {
    const draw = drawTarot(seededRandomFn(6));
    const reading = fallbackReading(draw);
    const text = renderTarotReading(draw, reading);
    expect(text).toContain("The cards are cut. Past, Present, Future.");
    expect(text).toContain("Past - ");
    expect(text).toContain("Present - ");
    expect(text).toContain("Future - ");
    for (const p of reading.paragraphs) expect(text).toContain(p);
    expect(text).toContain(`VERDICT: ${reading.verdict}`);
  });

  it("is deterministic for a given draw + reading", () => {
    const draw = drawTarot(seededRandomFn(8));
    const reading = fallbackReading(draw);
    expect(renderTarotReading(draw, reading)).toBe(renderTarotReading(draw, reading));
  });
});

describe("item 31: tarotRevealBlocks is the ceremonial staged sequence", () => {
  it("opens with shuffle/cut, then one flip block per card, then paragraphs + verdict", () => {
    const draw = drawTarot(seededRandomFn(31));
    const reading = fallbackReading(draw);
    const blocks = tarotRevealBlocks(draw, reading);
    // 1 opener + 3 cards + 3 paragraphs + 1 verdict = 8 blocks.
    expect(blocks.length).toBe(1 + 3 + reading.paragraphs.length + 1);
    expect(blocks[0]).toContain("Shuffle. Cut.");
    expect(blocks[blocks.length - 1]).toBe("VERDICT: " + reading.verdict);
  });

  it("each per-card flip block carries the dealt line AND one Seer line (<=16 words)", () => {
    const draw = drawTarot(seededRandomFn(42));
    const reading = fallbackReading(draw);
    const blocks = tarotRevealBlocks(draw, reading);
    const cardBlocks = blocks.slice(1, 1 + draw.cards.length);
    cardBlocks.forEach((b) => {
      const lines = b.split("\n");
      expect(lines).toHaveLength(2); // dealt line + Seer line
      expect(lines[0]).toMatch(/^(Past|Present|Future) - /);
      // The Seer line is the card's mystical meaning, <= 16 words.
      const words = (lines[1] ?? "").trim().split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(16);
    });
  });

  it("is deterministic for a given draw + reading", () => {
    const draw = drawTarot(seededRandomFn(7));
    const reading = fallbackReading(draw);
    expect(tarotRevealBlocks(draw, reading)).toEqual(tarotRevealBlocks(draw, reading));
  });
});
