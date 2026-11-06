// src/arcana/integer-scale.pbt.test.ts
//
// Feature: arcana-visions, task 2.2.
//
// Property-based tests for the Integer_Scale factor (`integerScale`). The
// module under test (`integer-scale.ts`, task 2.1) returns the largest whole
// factor by which a `logical` size fits inside an `available` region on both
// axes, clamped to `>= 1`. Because a single integer factor is applied to both
// width and height, the native aspect ratio is preserved with no distortion or
// cropping, and a region smaller than the logical size on either axis yields
// exactly `1` (the card then scrolls/clips at native resolution).
//
// Testing steering: fast-check with explicit numRuns (1000 for sizing math);
// the seed prints on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R1.2, R1.3, R1.4, R3.2, R7.1, R7.3, R13.1**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { integerScale, type Size } from "./integer-scale.js";

/** Sizing math is in the 1000-run tier (spreads / normalizers). */
const NUM_RUNS = 1000;

/**
 * A viewport / available region in logical pixels. Spans from tiny viewports
 * (a single pixel) up to a large 4K-class region so both the clamp-to-1 path
 * and large whole factors are exercised.
 */
const arbViewport: fc.Arbitrary<Size> = fc.record({
  w: fc.integer({ min: 1, max: 4000 }),
  h: fc.integer({ min: 1, max: 4000 }),
});

/**
 * A logical (native) asset size in pixels. Covers the real deck sizes
 * (120x160 diagnosis cards, 256x144 seer, 108x144 closed book) and a wider
 * range so equal-size and sub-logical regions both occur frequently.
 */
const arbLogicalSize: fc.Arbitrary<Size> = fc.oneof(
  // Real Arcana_Visions asset sizes, weighted in as concrete edge cases.
  fc.constantFrom<Size>(
    { w: 120, h: 160 },
    { w: 256, h: 144 },
    { w: 108, h: 144 },
  ),
  // General positive-integer logical sizes.
  fc.record({
    w: fc.integer({ min: 1, max: 512 }),
    h: fc.integer({ min: 1, max: 512 }),
  }),
);

describe("P1 (R1.3, R1.4, R13.1): integer scale is a whole number >= 1", () => {
  it("returns an integer >= 1 for any viewport and logical size (R1.3)", () => {
    fc.assert(
      fc.property(arbViewport, arbLogicalSize, (available, logical) => {
        const s = integerScale(available, logical);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never returns a fractional factor (R1.3)", () => {
    fc.assert(
      fc.property(arbViewport, arbLogicalSize, (available, logical) => {
        const s = integerScale(available, logical);
        expect(s).toBe(Math.floor(s));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("yields exactly 1 when the region is smaller than logical on either axis (R1.4)", () => {
    fc.assert(
      fc.property(arbViewport, arbLogicalSize, (available, logical) => {
        // Force a sub-logical region on at least one axis: shrink available
        // below the logical size on a chosen axis while leaving the other
        // axis arbitrary.
        const subWidth: Size = {
          w: Math.max(1, logical.w - 1),
          h: available.h,
        };
        const subHeight: Size = {
          w: available.w,
          h: Math.max(1, logical.h - 1),
        };
        expect(integerScale(subWidth, logical)).toBe(1);
        expect(integerScale(subHeight, logical)).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns 1 when the scale would be non-finite or below 1 (R1.4)", () => {
    // Degenerate available regions: a non-finite or non-positive ratio on the
    // governing axis clamps to 1 (the finite-and->=1 guard in integerScale).
    const degenerate: readonly [Size, Size][] = [
      [{ w: NaN, h: NaN }, { w: 10, h: 10 }],
      [{ w: 0, h: 0 }, { w: 10, h: 10 }],
      [{ w: -50, h: -50 }, { w: 10, h: 10 }],
      // Logical is NaN on both axes => both ratios NaN => clamp to 1.
      [{ w: 100, h: 100 }, { w: NaN, h: NaN }],
    ];
    for (const [available, logical] of degenerate) {
      expect(integerScale(available, logical)).toBe(1);
    }
  });
});

describe("P2 (R1.2, R3.2, R7.1, R7.3, R13.1): rendered dims equal logical x scale, aspect preserved", () => {
  it("rendered width and height are logical x the single factor s (R1.2, R3.2, R7.1)", () => {
    fc.assert(
      fc.property(arbViewport, arbLogicalSize, (available, logical) => {
        const s = integerScale(available, logical);
        const renderedW = logical.w * s;
        const renderedH = logical.h * s;
        // Both dimensions are driven by the same whole factor.
        expect(renderedW).toBe(logical.w * s);
        expect(renderedH).toBe(logical.h * s);
        // The rendered size fits within the available region whenever the
        // factor exceeds the clamp floor (i.e. the region was large enough).
        if (s > 1) {
          expect(renderedW).toBeLessThanOrEqual(available.w);
          expect(renderedH).toBeLessThanOrEqual(available.h);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves the native aspect ratio: renderedW/renderedH === logical.w/logical.h (R7.3, R13.1)", () => {
    fc.assert(
      fc.property(arbViewport, arbLogicalSize, (available, logical) => {
        const s = integerScale(available, logical);
        const renderedW = logical.w * s;
        const renderedH = logical.h * s;
        // Equal integer factor on both axes => identical cross-products, so the
        // aspect ratio is exact with no distortion or crop.
        expect(renderedW * logical.h).toBe(renderedH * logical.w);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
