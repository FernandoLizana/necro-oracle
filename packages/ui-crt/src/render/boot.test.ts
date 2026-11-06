// Feature: visual-necromancy — Boot_Frame_Renderer example tests (task 1.3).
//
// Example/unit assertions over `bootFrame` that the property tests (task 1.2)
// cannot pin down: the *specific* contents of the ready frame, and that the
// real authored ASCII logo stays inside the 72-column Terminal budget. The
// property tests already cover determinism and total/saturating indexing; here
// we check the concrete strings an operator actually reads when the machine
// finishes waking up.
//
// Pure: no network, LLM, sandbox, clock, DOM or unseeded randomness.
//
// Requirements: 1.1, 2.3

import { describe, expect, it } from "vitest";

import { blockText, lineText } from "./blocks.js";
import {
  BOOT_LOGO_TEXT_EQUIVALENT,
  BOOT_STEP_COUNT,
  bootFrame,
  bootFrameKind,
} from "./boot.js";
import { LINE_WIDTH } from "../text/wrap.js";

describe("bootFrame ready frame contents (R1.1, R2.3)", () => {
  const readyFrame = bootFrame(BOOT_STEP_COUNT - 1);
  const readyText = blockText({ kind: "boot", demo: false, lines: readyFrame.lines });

  it("declares the machine READY in the ready frame", () => {
    expect(readyText).toContain("READY.");
  });

  it("includes the system-nominal awakening line", () => {
    expect(readyText).toContain("SYSTEMS NOMINAL. The oracle is awake.");
  });

  it("includes the decorative logo's accessible text equivalent", () => {
    // The ASCII logo frame carries the `NECROMANTIC SYSTEMS 1986` wordmark, and
    // that same string is exported as the screen-reader equivalent (R10.4).
    expect(BOOT_LOGO_TEXT_EQUIVALENT).toBe("NECROMANTIC SYSTEMS 1986");
    expect(readyText).toContain(BOOT_LOGO_TEXT_EQUIVALENT);
  });

  it("keeps every line of the real ready frame at most 72 columns", () => {
    for (const line of readyFrame.lines) {
      expect([...lineText(line)].length).toBeLessThanOrEqual(LINE_WIDTH);
    }
  });
});

describe("bootFrameKind classifies the boot steps (R2.1)", () => {
  it("reaches a reachable, in-range logo frame between the memory and ready steps", () => {
    const kinds = Array.from({ length: BOOT_STEP_COUNT }, (_, step) =>
      bootFrameKind(step),
    );
    const logoStep = kinds.indexOf("logo");

    // The logo step exists, sits strictly between the first and last steps, and
    // is held for a real step (so it is painted, not skipped).
    expect(logoStep).toBeGreaterThan(0);
    expect(logoStep).toBeLessThan(BOOT_STEP_COUNT - 1);
    // Exactly one logo frame; the warm-up follows it; the final step is ready.
    expect(kinds.filter((k) => k === "logo")).toHaveLength(1);
    expect(kinds[logoStep + 1]).toBe("warmup");
    expect(kinds[BOOT_STEP_COUNT - 1]).toBe("ready");
    // The memory-check steps precede the logo.
    expect(kinds.slice(0, logoStep).every((k) => k === "memory")).toBe(true);

    // The logo frame's visible glyph rows carry the big ASCII wordmark.
    const logoText = bootFrame(logoStep)
      .lines.map((line) => lineText(line))
      .join("\n");
    expect(logoText).toContain(BOOT_LOGO_TEXT_EQUIVALENT);
  });

  it("is total and saturating, matching bootFrame's clamping", () => {
    // Any index at or beyond the last step is the ready frame.
    expect(bootFrameKind(BOOT_STEP_COUNT)).toBe("ready");
    expect(bootFrameKind(BOOT_STEP_COUNT + 1000)).toBe("ready");
    // Negative / fractional / NaN indices clamp to the first (memory) step.
    expect(bootFrameKind(-5)).toBe("memory");
    expect(bootFrameKind(Number.NaN)).toBe("memory");
    expect(bootFrameKind(0)).toBe("memory");
  });
});
