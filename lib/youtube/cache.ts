/**
 * In-memory result cache and single-flight coalescing for quota protection.
 *
 * - Keys are built from a NORMALIZED query (case, punctuation, stopword and
 *   order insensitive) plus the search options, so "Async/Await!" and
 *   "async await" share one cache entry and one YouTube API call.
 * - The cache lives per server instance (no Redis, no new infrastructure).
 *   The database-level cache in ./persist.ts covers sharing across instances.
 * - Single-flight collapses identical in-flight requests into one API call.
 */

import type { LearningDurationFilter, LearningLevel } from "@/lib/types";
import { tokenize } from "./text";

const MEMORY_CACHE_TTL_MS = 30 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = 100;

interface MemoryCacheEntry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, MemoryCacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Options after server-side normalization; the canonical input for cache keys. */
export interface NormalizedYoutubeQuery {
  query: string;
  topic: string | null;
  skill: string | null;
  level: LearningLevel;
  language: string | null;
  duration: LearningDurationFilter;
  limit: number;
}

/** Builds a deterministic cache key: token-sorted query + canonical options. */
export function buildCacheKey(options: NormalizedYoutubeQuery): string {
  const canonicalQuery = Array.from(new Set(tokenize(options.query))).sort().join(" ") || options.query.toLowerCase();
  return JSON.stringify({
    q: canonicalQuery,
    t: options.topic ? Array.from(new Set(tokenize(options.topic))).sort().join(" ") : null,
    s: options.skill ? Array.from(new Set(tokenize(options.skill))).sort().join(" ") : null,
    level: options.level,
    lang: options.language ? options.language.toLowerCase() : null,
    duration: options.duration,
    limit: options.limit,
  });
}

/** Returns a cached value, or null when missing/expired. Refreshes recency on hit. */
export function memoryCacheGet<T>(key: string): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.value as T;
}

/** Stores a value with a TTL, evicting the oldest entry when full. */
export function memoryCacheSet<T>(key: string, value: T, ttlMs: number = MEMORY_CACHE_TTL_MS): void {
  if (entries.has(key)) entries.delete(key);
  while (entries.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    entries.delete(oldestKey);
  }
  entries.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Coalesces concurrent calls with the same key into a single loader run. */
export async function withSingleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = loader().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
