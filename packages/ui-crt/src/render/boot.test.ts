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
