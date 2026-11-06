// Pure module: integer scale for @necro/ui-crt (Arcana_Visions, task 2.1).
//
// Validates: Requirements R1.2, R1.3, R1.4
//
// `integerScale` is a total, pure function: it reads no clock, DOM, network, or
// audio and never throws. It returns the largest whole-number factor by which a
// `logical` size fits inside an `available` region on both axes, so one integer
// factor applied to both width and height preserves the native aspect ratio
// with no distortion or cropping (R1.2). The factor is always an integer `>= 1`
// (R1.3); when the region is smaller than the logical size on either axis — or
// when any input is NaN or `<= 0` — the result clamps to `1`, and the card then
// scrolls/clips at native resolution (R1.4).

/** A two-dimensional size in logical device-independent pixels. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/**
 * The largest whole-number factor by which `logical` fits inside `available`
 * on both axes, clamped to `>= 1`. Never returns a fractional factor; when the
 * region is smaller than the logical size on either axis the result is `1`
 * (the card then scrolls/clips per R1.4). NaN/`<= 0` inputs clamp to `1`.
 */
export function integerScale(available: Size, logical: Size): number {
  const s = Math.floor(
    Math.min(available.w / logical.w, available.h / logical.h),
  );
  return Number.isFinite(s) && s >= 1 ? s : 1;
}
