// In-memory snapshot cache: TTL + LRU, time from the injected ClockPort only (design D5; R8.x).
import { DEFAULT_MAX_CACHE_ENTRIES, DEFAULT_TTL_MS, DEGRADED_TTL_MS } from "./constants.js";
import type { ClockPort } from "./ports.js";

/** Cache key: `owner/name@sha`, exact case (R8.1). */
export function cacheKey(ref: { readonly owner: string; readonly name: string; readonly sha: string }): string {
  return `${ref.owner}/${ref.name}@${ref.sha}`;
}

/** A snapshot with degraded fields lives at most DEGRADED_TTL_MS (R8.11, R8.12). */
export function effectiveTtlMs(configuredTtlMs: number, degradedFields: readonly unknown[]): number {
  return degradedFields.length > 0 ? Math.min(configuredTtlMs, DEGRADED_TTL_MS) : configuredTtlMs;
}

interface Entry<V> {
  readonly value: V;
  readonly createdAt: number;
  readonly ttlMs: number;
  /** Item 23: measured byte size of `value` (0 when no `measure` is wired). */
  readonly bytes: number;
}

export class SnapshotCache<V extends object> {
  readonly configuredTtlMs: number;
  private readonly maxEntries: number;
  /** Item 23: optional total-byte budget; `Infinity` disables the byte bound. */
  private readonly maxBytes: number;
  /** Item 23: optional per-value byte measurer; `() => 0` disables it. */
  private readonly measure: (value: V) => number;
  /** Running sum of every entry's measured bytes. */
  private totalBytes = 0;
  /** Map insertion order = recency order, least recently used first. */
  private readonly entries = new Map<string, Entry<V>>();

  constructor(
    private readonly clock: ClockPort,
    opts: {
      ttlMs?: number;
      maxEntries?: number;
      maxBytes?: number;
      measure?: (value: V) => number;
    } = {},
  ) {
    this.configuredTtlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
    this.measure = opts.measure ?? (() => 0);
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.clock.nowMs() - entry.createdAt >= entry.ttlMs) {
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.value };
  }

  set(key: string, value: V, opts?: { ttlMs?: number }): void {
    const now = this.clock.nowMs();
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.entries.delete(key);
      this.totalBytes -= existing.bytes;
    }
    // Purge expired entries, keeping the byte total in step.
    for (const [k, e] of this.entries) {
      if (now - e.createdAt >= e.ttlMs) {
        this.entries.delete(k);
        this.totalBytes -= e.bytes;
      }
    }
    const bytes = this.measure(value);
    // Evict LRU until BOTH the entry-count cap and the byte budget are met.
    // Item 23: the byte budget keeps a few huge snapshots from pinning GBs.
    // (The new entry is not yet inserted, so leave room for it.)
    while (
      this.entries.size >= this.maxEntries ||
      (this.entries.size > 0 && this.totalBytes + bytes > this.maxBytes)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted !== undefined) this.totalBytes -= evicted.bytes;
    }
    const ttlMs = Math.min(opts?.ttlMs ?? this.configuredTtlMs, this.configuredTtlMs);
    this.entries.set(key, { value, createdAt: now, ttlMs, bytes });
    this.totalBytes += bytes;
  }
}
