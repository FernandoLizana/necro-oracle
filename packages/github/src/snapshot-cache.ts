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
}

export class SnapshotCache<V extends object> {
  readonly configuredTtlMs: number;
  private readonly maxEntries: number;
  /** Map insertion order = recency order, least recently used first. */
  private readonly entries = new Map<string, Entry<V>>();

  constructor(
    private readonly clock: ClockPort,
    opts: { ttlMs?: number; maxEntries?: number } = {},
  ) {
    this.configuredTtlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.clock.nowMs() - entry.createdAt >= entry.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.value };
  }

  set(key: string, value: V, opts?: { ttlMs?: number }): void {
    const now = this.clock.nowMs();
    this.entries.delete(key);
    for (const [k, e] of this.entries) {
      if (now - e.createdAt >= e.ttlMs) this.entries.delete(k);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    const ttlMs = Math.min(opts?.ttlMs ?? this.configuredTtlMs, this.configuredTtlMs);
    this.entries.set(key, { value, createdAt: now, ttlMs });
  }
}
