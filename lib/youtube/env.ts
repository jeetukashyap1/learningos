/**
 * YouTube Data API v3 configuration.
 *
 * Unlike the Supabase environment (required for the app to work at all), the
 * YouTube key is OPTIONAL: when it is missing the rest of the app keeps working
 * and only the YouTube learning-resources feature is unavailable. That is why
 * this accessor returns null instead of throwing like getSupabaseEnv() does -
 * the search service turns a missing key into a controlled config error at the
 * point of use, so no unrelated page or route can ever crash over it.
 */

const YOUTUBE_API_KEY_NAME = "YOUTUBE_API_KEY";

/**
 * Returns the server-side YouTube Data API key, or null when it is not set.
 * The key is read here (server-only module graph) and never reaches the client.
 */
export function getYoutubeApiKey(): string | null {
  const apiKey = process.env[YOUTUBE_API_KEY_NAME];
  const trimmed = apiKey?.trim();
  return trimmed ? trimmed : null;
}
