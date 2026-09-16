/**
 * Minimal YouTube Data API v3 client built on plain fetch (no SDK, no new
 * dependencies). Server-side only: every call requires the YOUTUBE_API_KEY and
 * must stay inside route handlers / server modules - never import this from a
 * client component.
 *
 * Two endpoints are used:
 * - search.list  (100 quota units) - finds video ids for a query
 * - videos.list  (1 quota unit)    - fetches title/duration/status details
 *
 * Quota note: because search.list is expensive, the service layer caches
 * results (memory + database) and only hits this client on cache misses.
 */

import { YoutubeError } from "./errors";

/** Canonical YouTube Data API v3 base URL. */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Request budget: a YouTube lookup must never hang a learning search. */
const REQUEST_TIMEOUT_MS = 10_000;

/** YouTube video ids are exactly 11 characters from a fixed alphabet. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** videos.list accepts at most 50 ids per call. */
const MAX_IDS_PER_LOOKUP = 50;

/** error.errors[0].reason values that mean the project quota is exhausted. */
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

/** error.errors[0].reason values that mean the API key itself is unusable. */
const KEY_REASONS = new Set(["ipRefererBlocked", "refererBlocked", "forbidden"]);

/** Normalized, validated video used by the scoring and service layers. */
export interface YoutubeVideo {
  externalId: string;
  title: string;
  description: string;
  channelName: string;
  thumbnailUrl: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  isPublic: boolean;
  isEmbeddable: boolean;
}

export function isValidYoutubeVideoId(videoId: string): boolean {
  return VIDEO_ID_PATTERN.test(videoId);
}

/**
 * Parses ISO 8601 durations (PT1H2M3S, PT45M, P1DT2H) into seconds.
 * Returns null for missing, malformed, or zero-length (live) durations.
 */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

/** Runs search.list and returns valid video ids in YouTube's relevance order. */
export async function searchVideoIds(
  apiKey: string,
  search: { query: string; maxResults: number; videoDuration?: "short" | "medium" | "long"; relevanceLanguage?: string },
): Promise<string[]> {
  const params: Record<string, string> = {
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    maxResults: String(Math.min(Math.max(search.maxResults, 1), 50)),
    q: search.query,
  };
  if (search.videoDuration) params.videoDuration = search.videoDuration;
  if (search.relevanceLanguage) params.relevanceLanguage = search.relevanceLanguage;

  const body = (await requestYoutube("/search", params, apiKey)) as { items?: Array<{ id?: { videoId?: string } }> };

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of body.items ?? []) {
    const videoId = item.id?.videoId ?? "";
    if (!isValidYoutubeVideoId(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    ids.push(videoId);
  }
  return ids;
}

/** Runs videos.list for the given ids and returns normalized, validated videos. */
export async function fetchVideoDetails(apiKey: string, videoIds: string[]): Promise<YoutubeVideo[]> {
  const ids = videoIds.filter(isValidYoutubeVideoId).slice(0, MAX_IDS_PER_LOOKUP);
  if (ids.length === 0) return [];

  const body = (await requestYoutube("/videos", { part: "snippet,contentDetails,status", id: ids.join(",") }, apiKey)) as {
    items?: Array<RawVideoItem>;
  };

  const videos: YoutubeVideo[] = [];
  const seen = new Set<string>();
  for (const item of body.items ?? []) {
    const externalId = item.id ?? "";
    if (!isValidYoutubeVideoId(externalId) || seen.has(externalId)) continue;
    const snippet = item.snippet ?? {};
    const thumbnailUrl = pickThumbnail(snippet.thumbnails);
    if (!snippet.title || !snippet.channelTitle || !thumbnailUrl) continue;
    seen.add(externalId);
    videos.push({
      externalId,
      title: snippet.title,
      description: snippet.description ?? "",
      channelName: snippet.channelTitle,
      thumbnailUrl,
      publishedAt: snippet.publishedAt ?? null,
      durationSeconds: parseIsoDuration(item.contentDetails?.duration),
      isPublic: item.status?.privacyStatus === "public",
      isEmbeddable: item.status?.embeddable ?? false,
    });
  }
  return videos;
}

interface RawVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  contentDetails?: { duration?: string };
  status?: { privacyStatus?: string; embeddable?: boolean };
}

const THUMBNAIL_PREFERENCES = ["high", "medium", "default"] as const;

function pickThumbnail(thumbnails?: Record<string, { url?: string } | undefined>): string | null {
  if (!thumbnails) return null;
  for (const preference of THUMBNAIL_PREFERENCES) {
    const url = thumbnails[preference]?.url;
    if (url) return url;
  }
  const fallback = Object.values(thumbnails).find((thumbnail) => thumbnail?.url);
  return fallback?.url ?? null;
}

/** Performs a GET against the Data API and maps failures to YoutubeError. */
async function requestYoutube(pathname: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  // NB: new URL(path, base) keeps only the base's origin — the /youtube/v3
  // path must be concatenated explicitly.
  const url = new URL(`${YOUTUBE_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network failure, DNS error, or timeout. No upstream detail is exposed.
    throw new YoutubeError("api", "YouTube is currently unavailable. Please try again later.", `Request to ${pathname} failed`);
  }

  if (!response.ok) {
    throw await translateHttpError(response, pathname);
  }

  try {
    return await response.json();
  } catch {
    throw new YoutubeError("api", "YouTube returned an unreadable response. Please try again later.", `${pathname} returned a non-JSON body`);
  }
}

async function translateHttpError(response: Response, pathname: string): Promise<YoutubeError> {
  let reason = "";
  let message = "";
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { message?: string; errors?: Array<{ reason?: string }> } }).error;
      message = error?.message ?? "";
      reason = error?.errors?.[0]?.reason ?? "";
    }
  } catch {
    // Unreadable error body: fall through to the generic mapping below.
  }
  const detail = `${pathname} failed with HTTP ${response.status}${reason ? ` (${reason})` : ""}${message ? `: ${message}` : ""}`;

  if (response.status === 403 && QUOTA_REASONS.has(reason)) {
    return new YoutubeError("quota", "YouTube search is temporarily unavailable because the API quota is exhausted. Please try again later.", detail);
  }
  if (response.status === 400 && reason === "keyInvalid") {
    return new YoutubeError("config", "YouTube search is misconfigured: the API key is not valid. Contact the site operator.", detail);
  }
  if (response.status === 403 && KEY_REASONS.has(reason)) {
    return new YoutubeError("config", "YouTube search is misconfigured and has been blocked by the API provider. Contact the site operator.", detail);
  }
  return new YoutubeError("api", "YouTube is currently unavailable. Please try again later.", detail);
}
