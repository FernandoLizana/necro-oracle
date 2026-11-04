// Pure time helpers. No clock reads: callers inject the current time (ClockPort).
// Requirements: R4.3, R4.5, R9.2.

const DAY_MS = 86_400_000;

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/** Parse an ISO 8601 timestamp (with `Z` or numeric offset) to epoch ms; null when invalid. */
export function parseIsoMs(s: string): number | null {
  const m = ISO_RE.exec(s);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fraction = m[7] ?? "";
  const zone = m[8] as string;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMin = 0;
  if (zone !== "Z") {
    const oh = Number(zone.slice(1, 3));
    const om = Number(zone.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMin = (zone.startsWith("-") ? -1 : 1) * (oh * 60 + om);
  }

  // Build in UTC, then confirm the calendar date did not roll over (e.g. Feb 30).
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  const dayStart = probe.getTime();
  const millis = fraction === "" ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  const localMs = dayStart + ((hour * 60 + minute) * 60 + second) * 1000 + millis;
  const result = localMs - offsetMin * 60_000;
  return Number.isFinite(result) ? result : null;
}

/** Format epoch ms as a UTC ISO 8601 string ending in `Z`. */
export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** Whole days elapsed from `thenMs` to `nowMs`, floored and never below zero. */
export function daysBetween(thenMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / DAY_MS));
}
