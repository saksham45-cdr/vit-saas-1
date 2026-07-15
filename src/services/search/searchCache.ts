/**
 * services/search/searchCache.ts
 * ─────────────────────────────────────────────────────────────────
 * Tiny TTL + LRU cache for the full search response, keyed on the
 * normalized user query. Skips BOTH the LLM call and the DB query for
 * repeated searches ("Family hotels in Barcelona" suggestion chips are
 * a prime example).
 *
 * Serverless caveat (deliberate trade-off): this cache is per warm
 * instance. That's fine — it's a latency optimization, not a
 * correctness mechanism. If cross-instance caching is ever needed,
 * swap this module for Upstash Redis behind the same interface.
 */
import { getEnv } from "../../config/env.js";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlLruCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(private readonly maxEntries = 200) {}

  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/\s+/g, " ").trim();
  }

  get(key: string): T | null {
    const k = this.normalizeKey(key);
    const entry = this.map.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(k);
      return null;
    }
    // LRU bump
    this.map.delete(k);
    this.map.set(k, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const k = this.normalizeKey(key);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, {
      value,
      expiresAt: Date.now() + (ttlMs ?? getEnv().SEARCH_CACHE_TTL_MS),
    });
  }
}
