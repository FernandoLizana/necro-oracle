// Time helpers (task 9.1). Requirements: R4.3, R4.5, R9.2.
// Contract assumed for 9.2:
//   parseIsoMs(s: string): number | null   (null for anything that is not valid ISO 8601)
//   isoFromMs(ms: number): string          (UTC, via new Date(ms).toISOString())
//   daysBetween(thenMs: number, nowMs: number): number  (max(0, floor((now - then) / 86_400_000)))
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { daysBetween, isoFromMs, parseIsoMs } from "./time.js";

const DAY = 86_400_000;

describe("parseIsoMs (R4.3)", () => {
  it("parses Z timestamps", () => {
    expect(parseIsoMs("2024-01-02T03:04:05Z")).toBe(Date.UTC(2024, 0, 2, 3, 4, 5));
  });

  it("parses fractional seconds", () => {
    expect(parseIsoMs("2024-01-02T03:04:05.250Z")).toBe(Date.UTC(2024, 0, 2, 3, 4, 5, 250));
  });

  it("applies positive and negative offsets", () => {
    const base = Date.UTC(2024, 0, 2, 3, 4, 5);
    expect(parseIsoMs("2024-01-02T05:04:05+02:00")).toBe(base);
    expect(parseIsoMs("2024-01-01T22:04:05-05:00")).toBe(base);
  });

  it.each(["", "not a date", "2024-13-45T00:00:00Z", "2024-02-30T00:00:00Z", "yesterday", "12345"])(
    "rejects invalid string %j",
    (s) => {
      expect(parseIsoMs(s)).toBeNull();
    },
  );
});

describe("isoFromMs (R4.3, R9.2)", () => {
  it("formats epoch as UTC ISO ending in Z", () => {
    expect(isoFromMs(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("round-trips with parseIsoMs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        const iso = isoFromMs(ms);
        expect(iso.endsWith("Z")).toBe(true);
        expect(parseIsoMs(iso)).toBe(ms);
      }),
      { numRuns: 200 },
    );
  });

  it("normalizes an offset timestamp to UTC", () => {
    const ms = parseIsoMs("2024-01-02T05:04:05+02:00");
    expect(ms).not.toBeNull();
    expect(isoFromMs(ms as number)).toBe("2024-01-02T03:04:05.000Z");
  });
});

describe("daysBetween (R4.5)", () => {
  it("floors partial days", () => {
    expect(daysBetween(0, DAY - 1)).toBe(0);
    expect(daysBetween(0, DAY)).toBe(1);
    expect(daysBetween(0, 3 * DAY + DAY / 2)).toBe(3);
  });

  it("never returns below zero when then is after now", () => {
    expect(daysBetween(5 * DAY, 0)).toBe(0);
  });

  it("P: result is a non-negative integer matching the formula", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (a, b) => {
          const d = daysBetween(a, b);
          expect(Number.isInteger(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBe(Math.max(0, Math.floor((b - a) / DAY)));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("no clock read (R9.2)", () => {
  it("time.ts never calls Date.now() or zero-argument new Date()", () => {
    const src = readFileSync(new URL("./time.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\s*\.\s*now\s*\(/);
    expect(src).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });
});
