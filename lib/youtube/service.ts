/**
 * YouTube learning-resource search service.
 *
 * searchEducationalVideos() is the single entry point used by
 * GET /api/learning/youtube/search. Flow:
 *
 *   validate -> normalize -> memory cache -> db cache -> YouTube Data API
 *            -> filter (public + embeddable) -> dedupe -> score -> sort
 *            -> limit -> persist (best effort) -> memory cache
 *
 * Quota protection: memory cache (per instance) + database cache (shared)
 * + single-flight coalescing + bounded result windows. The 100-unit
 * search.list call only happens on a full cache miss.
 */

import type {
  LearningDurationFilter,
  LearningLevel,
  LearningResource,
  ScoredLearningResource,
  YoutubeSearchOptions,
} from "@/lib/types";
import { fetchVideoDetails, searchVideoIds, type YoutubeVideo } from "./client";
import { buildCacheKey, memoryCacheGet, memoryCacheSet, withSingleFlight, type NormalizedYoutubeQuery } from "./cache";
import { YoutubeError } from "./errors";
import { getYoutubeApiKey } from "./env";
import {
  findFreshSearchCache,
  loadResourcesByExternalIds,
  saveSearchCache,
  upsertLearningResources,
} from "./persist";
import { compareByRelevance, scoreResource, type ResourceScore, type ScoringContext } from "./scoring";
import { tokenize } from "./text";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface YoutubeSearchResult {
  /** The normalized query actually searched. */
  query: string;
  topic: string | null;
  skill: string | null;
  level: LearningLevel;
  duration: LearningDurationFilter;
  /** Ranked resources, best first. */
  results: ScoredLearningResource[];
  /** True when the answer came from a cache (no YouTube quota spent). */
  cached: boolean;
}

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 120;
const MAX_TOPIC_LENGTH = 80;
const DEFAULT_LIMIT = 6;
const MIN_LIMIT = 1;
const MAX_LIMIT = 12;
/** How many ids to request from search.list (limit x 3 gives the ranker room to filter). */
const MAX_SEARCH_RESULTS = 25;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
/**
 * Product-supported language preferences that are not BCP-47 codes (spec
 * part 6). "hinglish" cannot be sent as relevanceLanguage, so it is handled
 * through language-aware query composition and ranking instead.
 */
const SPECIAL_LANGUAGES: ReadonlySet<string> = new Set(["hinglish"]);

const LEVELS: ReadonlySet<string> = new Set(["beginner", "intermediate", "advanced"]);
const DURATIONS: ReadonlySet<string> = new Set(["any", "short", "medium", "long"]);

/** Maps our duration filter onto YouTube's videoDuration values. */
const YOUTUBE_DURATION_PARAM: Record<Exclude<LearningDurationFilter, "any">, "short" | "medium" | "long"> = {
  short: "short",
  medium: "medium",
  long: "long",
};

/**
 * Searches YouTube for educational videos matching the given options.
 * Throws YoutubeError for validation / config / quota / upstream problems.
 */
export async function searchEducationalVideos(
  supabase: SupabaseClient,
  options: YoutubeSearchOptions,
): Promise<YoutubeSearchResult> {
  // Validate client input BEFORE checking server configuration: a malformed
  // request is invalid regardless of whether the server has a key, so it
  // must surface as a 400 rather than masking the (503) config error.
  const normalized = normalizeOptions(options);
  const cacheKey = buildCacheKey(normalized);

  const apiKey = getYoutubeApiKey();
  if (!apiKey) {
    throw new YoutubeError(
      "config",
      "YouTube search is not configured on this server. Add a YOUTUBE_API_KEY environment variable to enable it.",
    );
  }

  const cachedResult = memoryCacheGet<YoutubeSearchResult>(cacheKey);
  if (cachedResult) return { ...cachedResult, cached: true };

  return withSingleFlight(cacheKey, async () => {
    // Database cache (shared across server instances).
    const cachedSearch = await findFreshSearchCache(supabase, cacheKey);
    if (cachedSearch) {
      if (cachedSearch.resultExternalIds.length === 0) {
        const empty = toResult(normalized, [], true);
        memoryCacheSet(cacheKey, empty);
        return empty;
      }
      const resourceById = await loadResourcesByExternalIds(supabase, cachedSearch.resultExternalIds);
      if (resourceById.size > 0) {
        // The cache row stores the full usable set (not limit-sliced), so the
        // same slice as the fresh path keeps responses consistent in size.
        const scored = rankResources([...resourceById.values()], normalized).slice(0, normalized.limit);
        const result = toResult(normalized, scored, true);
        memoryCacheSet(cacheKey, result);
        return result;
      }
      // Cached ids but no rows (e.g. an earlier persist failed): fall through to the API.
    }

    // YouTube Data API v3 (quota is only spent on this path).
    const searchQuery = composeSearchQuery(normalized);
    const videoIds = await searchVideoIds(apiKey, {
      query: searchQuery,
      maxResults: Math.min(MAX_SEARCH_RESULTS, Math.max(normalized.limit * 3, MIN_LIMIT * 3)),
      videoDuration: normalized.duration === "any" ? undefined : YOUTUBE_DURATION_PARAM[normalized.duration],
      // "hinglish" is not a BCP-47 code: bias the query text instead (composeSearchQuery).
      relevanceLanguage:
        normalized.language && !SPECIAL_LANGUAGES.has(normalized.language) ? normalized.language : undefined,
    });

    if (videoIds.length === 0) {
      const empty = toResult(normalized, [], false);
      // Cache empty results too, so repeated no-result queries do not burn quota.
      await saveSearchCache(supabase, cacheKey, optionsFromNormalized(normalized), []);
      memoryCacheSet(cacheKey, empty);
      return empty;
    }

    const videos = await fetchVideoDetails(apiKey, videoIds);
    const usable = dedupeVideos(videos).filter((video) => video.isPublic && video.isEmbeddable);
    const scored = rankVideos(usable, normalized).slice(0, normalized.limit);

    // Best-effort persistence: failures degrade caching, never the response.
    const persistedIds = await upsertLearningResources(supabase, scored.map((item) => item.resource));
    const results: ScoredLearningResource[] = scored.map((item) => {
      const databaseId = persistedIds.get(item.resource.externalId) ?? null;
      return { ...item, resource: { ...item.resource, id: databaseId } };
    });
    await saveSearchCache(
      supabase,
      cacheKey,
      optionsFromNormalized(normalized),
      usable.map((video) => video.externalId),
    );

    const result = toResult(normalized, results, false);
    memoryCacheSet(cacheKey, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeOptions(options: YoutubeSearchOptions): NormalizedYoutubeQuery {
  const query = options.query?.trim() ?? "";
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    throw new YoutubeError("validation", `Search query must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters.`);
  }

  const level = options.level ?? "intermediate";
  if (!LEVELS.has(level)) {
    throw new YoutubeError("validation", "Invalid learning level. Use beginner, intermediate, or advanced.");
  }

  const duration = options.duration ?? "any";
  if (!DURATIONS.has(duration)) {
    throw new YoutubeError("validation", "Invalid duration filter. Use any, short, medium, or long.");
  }

  const rawLanguage = options.language?.trim().toLowerCase() ?? "";
  // "any" expresses no preference (spec part 6) and is normalized away.
  const language = rawLanguage === "" || rawLanguage === "any" ? null : rawLanguage;
  if (language && !SPECIAL_LANGUAGES.has(language) && !LANGUAGE_PATTERN.test(language)) {
    throw new YoutubeError(
      "validation",
      'Invalid language. Use a BCP-47 style code such as en or hi, "hinglish", or "any".',
    );
  }

  return {
    query,
    topic: clampOptionalText(options.topic, MAX_TOPIC_LENGTH),
    skill: clampOptionalText(options.skill, MAX_TOPIC_LENGTH),
    level: level as LearningLevel,
    language,
    duration: duration as LearningDurationFilter,
    limit: clampLimit(options.limit),
  };
}

function clampOptionalText(value: string | undefined, maxLength: number): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function clampLimit(value: number | undefined): number {
  const limit = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
}

function optionsFromNormalized(normalized: NormalizedYoutubeQuery): YoutubeSearchOptions {
  return {
    query: normalized.query,
    topic: normalized.topic ?? undefined,
    skill: normalized.skill ?? undefined,
    level: normalized.level,
    language: normalized.language ?? undefined,
    duration: normalized.duration,
    limit: normalized.limit,
  };
}

/**
 * Topic + skill + query combined into one YouTube search string, without
 * duplicates. For "hinglish" (not a BCP-47 code, so no relevanceLanguage is
 * sent), a "hindi" term biases YouTube toward Hindi/Hinglish teaching
 * content, which is what the learner asked for.
 */
function composeSearchQuery(normalized: NormalizedYoutubeQuery): string {
  const parts = [normalized.topic, normalized.skill, normalized.query]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, all) => all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index);
  if (normalized.language === "hinglish" && !parts.some((part) => /\bhindi\b/i.test(part))) {
    parts.push("hindi");
  }
  return parts.join(" ").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function scoringContext(normalized: NormalizedYoutubeQuery): ScoringContext {
  const topicSource = normalized.topic ?? normalized.skill ?? normalized.query;
  return {
    queryTokens: tokenize(normalized.query),
    topicTokens: tokenize(topicSource),
    level: normalized.level,
    language: normalized.language,
  };
}

function rankVideos(videos: YoutubeVideo[], normalized: NormalizedYoutubeQuery): ScoredLearningResource[] {
  const context = scoringContext(normalized);
  return videos
    .map((video) => {
      const resource = videoToResource(video);
      return { resource, score: scoreResource(resource, context) };
    })
    .sort((a, b) => compareByRelevance(toComparable(a), toComparable(b)))
    .map((item) => ({ resource: item.resource, relevanceScore: item.score.total, scoreBreakdown: item.score.breakdown }));
}

function rankResources(resources: LearningResource[], normalized: NormalizedYoutubeQuery): ScoredLearningResource[] {
  const context = scoringContext(normalized);
  return resources
    .map((resource) => ({ resource, score: scoreResource(resource, context) }))
    .sort((a, b) => compareByRelevance(toComparable(a), toComparable(b)))
    .map((item) => ({ resource: item.resource, relevanceScore: item.score.total, scoreBreakdown: item.score.breakdown }));
}

function toComparable(item: { resource: LearningResource; score: ResourceScore }): {
  score: ResourceScore;
  externalId: string;
  publishedAt: string | null;
} {
  return { score: item.score, externalId: item.resource.externalId, publishedAt: item.resource.publishedAt };
}

function videoToResource(video: YoutubeVideo): LearningResource {
  return {
    id: null,
    type: "video",
    provider: "youtube",
    externalId: video.externalId,
    title: video.title,
    description: video.description,
    url: `https://www.youtube.com/watch?v=${video.externalId}`,
    thumbnailUrl: video.thumbnailUrl,
    channelName: video.channelName,
    durationSeconds: video.durationSeconds,
    publishedAt: video.publishedAt,
    status: video.isPublic && video.isEmbeddable ? "public" : "unavailable",
  };
}

/** Removes duplicate videos by external id, keeping the first occurrence. */
function dedupeVideos(videos: YoutubeVideo[]): YoutubeVideo[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (seen.has(video.externalId)) return false;
    seen.add(video.externalId);
    return true;
  });
}

function toResult(normalized: NormalizedYoutubeQuery, results: ScoredLearningResource[], cached: boolean): YoutubeSearchResult {
  return {
    query: normalized.query,
    topic: normalized.topic,
    skill: normalized.skill,
    level: normalized.level,
    duration: normalized.duration,
    results,
    cached,
  };
}
