/**
 * Database persistence for YouTube learning resources (non-fatal by design).
 *
 * Persistence serves three purposes:
 * 1. Dedup: resources are unique per (provider, external_id), so the same
 *    video found by different searches is stored exactly once.
 * 2. Cross-instance cache: learning_resource_searches stores recent search
 *    results so quota is spent once per query, not once per server instance.
 * 3. Future progress: learning_resources rows carry stable ids that a future
 *    watch-progress feature can reference without a second progress system.
 *
 * Every function here swallows database errors (after logging them) and
 * returns null/empty instead of throwing: a Supabase outage must degrade the
 * search to "no caching, no ids" - never a 500 for the learner.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningResource, YoutubeSearchOptions } from "@/lib/types";

/** How long a stored search stays fresh (quota resets daily; 6h balances freshness vs spend). */
export const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const RESOURCES_TABLE = "learning_resources";
const SEARCHES_TABLE = "learning_resource_searches";

interface LearningResourceRow {
  id: string;
  external_id: string;
  title: string;
  description: string;
  url: string;
  thumbnail_url: string;
  channel_name: string;
  duration_seconds: number | null;
  published_at: string | null;
  metadata: { status?: string } | null;
}

/** A fresh (not expired) cached search. */
export interface CachedSearch {
  resultExternalIds: string[];
}

/** Loads a non-expired cached search by cache key, or null on miss/failure. */
export async function findFreshSearchCache(supabase: SupabaseClient, cacheKey: string): Promise<CachedSearch | null> {
  try {
    const { data, error } = await supabase
      .from(SEARCHES_TABLE)
      .select("result_external_ids, expires_at")
      .eq("cache_key", cacheKey)
      .limit(1);
    if (error) throw error;
    const row = (data?.[0] ?? null) as { result_external_ids: string[] | null; expires_at: string | null } | null;
    if (!row || !row.expires_at) return null;
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { resultExternalIds: row.result_external_ids ?? [] };
  } catch (error) {
    console.error("[youtube] Failed to read search cache:", describe(error));
    return null;
  }
}

/** Loads persisted resources by external id. Returns externalId -> resource. */
export async function loadResourcesByExternalIds(
  supabase: SupabaseClient,
  externalIds: string[],
): Promise<Map<string, LearningResource>> {
  const results = new Map<string, LearningResource>();
  if (externalIds.length === 0) return results;
  try {
    const { data, error } = await supabase
      .from(RESOURCES_TABLE)
      .select("id, external_id, title, description, url, thumbnail_url, channel_name, duration_seconds, published_at, metadata")
      .eq("provider", "youtube")
      .in("external_id", externalIds);
    if (error) throw error;
    for (const row of (data ?? []) as LearningResourceRow[]) {
      results.set(row.external_id, rowToResource(row));
    }
  } catch (error) {
    console.error("[youtube] Failed to load cached resources:", describe(error));
  }
  return results;
}

/**
 * Upserts resources, deduped by (provider, external_id).
 * Returns externalId -> database id, or an empty map when persistence failed.
 */
export async function upsertLearningResources(
  supabase: SupabaseClient,
  resources: LearningResource[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (resources.length === 0) return ids;
  try {
    const rows = resources.map((resource) => ({
      type: resource.type,
      provider: resource.provider,
      external_id: resource.externalId,
      title: resource.title,
      description: resource.description,
      url: resource.url,
      thumbnail_url: resource.thumbnailUrl,
      channel_name: resource.channelName,
      duration_seconds: resource.durationSeconds,
      published_at: resource.publishedAt ? new Date(resource.publishedAt).toISOString() : null,
      metadata: { status: resource.status },
    }));
    const { data, error } = await supabase
      .from(RESOURCES_TABLE)
      .upsert(rows, { onConflict: "provider,external_id" })
      .select("id, external_id");
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; external_id: string }>) {
      ids.set(row.external_id, row.id);
    }
  } catch (error) {
    console.error("[youtube] Failed to persist resources:", describe(error));
  }
  return ids;
}

/** Saves (or refreshes) a search-cache entry. Non-fatal. */
export async function saveSearchCache(
  supabase: SupabaseClient,
  cacheKey: string,
  options: YoutubeSearchOptions,
  resultExternalIds: string[],
): Promise<void> {
  try {
    const now = new Date();
    const row = {
      cache_key: cacheKey,
      normalized_query: options.query.trim().toLowerCase(),
      options: {
        topic: options.topic ?? null,
        skill: options.skill ?? null,
        level: options.level ?? null,
        language: options.language ?? null,
        duration: options.duration ?? null,
        limit: options.limit ?? null,
      },
      result_external_ids: resultExternalIds,
      result_count: resultExternalIds.length,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SEARCH_CACHE_TTL_MS).toISOString(),
    };
    const { error } = await supabase.from(SEARCHES_TABLE).upsert(row, { onConflict: "cache_key" });
    if (error) throw error;
  } catch (error) {
    console.error("[youtube] Failed to save search cache:", describe(error));
  }
}

function rowToResource(row: LearningResourceRow): LearningResource {
  return {
    id: row.id,
    type: "video",
    provider: "youtube",
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    channelName: row.channel_name,
    durationSeconds: row.duration_seconds,
    publishedAt: row.published_at,
    status: row.metadata?.status === "unavailable" ? "unavailable" : "public",
  };
}

/**
 * Renders an error for server-side logging. Supabase returns PostgrestError
 * objects (plain objects with message/code/details/hint), so plain-object
 * errors are stringified instead of collapsing to "[object Object]".
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const { message, code, details, hint } = error as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [message, code, details, hint].filter((part) => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(error);
}
