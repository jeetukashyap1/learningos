/**
 * GET /api/learning/youtube/search
 *
 * Server-side YouTube learning-resource search for the LearningOS skill ->
 * topic -> ranked resources flow. The YOUTUBE_API_KEY is read inside the
 * service layer (server-only) and never reaches the client.
 *
 * Query params:
 *   query    (required)  free-text search, 2-120 chars
 *   topic    (optional)  topic context, e.g. a concept from a lesson
 *   skill    (optional)  skill context, e.g. from the concept map
 *   level    (optional)  beginner | intermediate | advanced (default: intermediate)
 *   language (optional)  BCP-47-ish code (en, hi), "hinglish", or "any" (no preference)
 *   duration (optional)  any | short | medium | long (default: any)
 *   limit    (optional)  1-12 (default: 6)
 *
 * Middleware refreshes sessions on /api/* but does not protect them, so this
 * route authenticates itself via createSupabaseServerClient().auth.getUser().
 * Responses carry only safe messages: no keys, raw upstream errors, or
 * internal details are ever exposed to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isYoutubeError, YoutubeError, type YoutubeErrorKind } from "@/lib/youtube/errors";
import { searchEducationalVideos } from "@/lib/youtube/service";
import type { YoutubeSearchOptions } from "@/lib/types";

const SINGLE_VALUE_PARAMS = ["query", "topic", "skill", "level", "language", "duration", "limit"] as const;

export async function GET(request: NextRequest) {
  // 1. Authenticate (middleware only refreshes sessions on /api/*).
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to search YouTube learning resources." },
      { status: 401 },
    );
  }

  // 2. Validate query params.
  const searchParams = request.nextUrl.searchParams;
  for (const name of SINGLE_VALUE_PARAMS) {
    if (searchParams.getAll(name).length > 1) {
      return NextResponse.json(
        { error: `Invalid request: the "${name}" parameter must appear at most once.` },
        { status: 400 },
      );
    }
  }

  const query = searchParams.get("query")?.trim() ?? "";
  if (query.length === 0) {
    return NextResponse.json(
      { error: "A search query is required. Provide a topic such as \"REST APIs\"." },
      { status: 400 },
    );
  }

  // 3. Search (validate -> cache -> YouTube -> rank -> persist).
  // parseEnum/parseLimit throw YoutubeError("validation"), handled below as 400.
  try {
    const options: YoutubeSearchOptions = {
      query,
      topic: searchParams.get("topic") ?? undefined,
      skill: searchParams.get("skill") ?? undefined,
      level: parseEnum(searchParams.get("level"), ["beginner", "intermediate", "advanced"]),
      language: searchParams.get("language") ?? undefined,
      duration: parseEnum(searchParams.get("duration"), ["any", "short", "medium", "long"]),
      limit: parseLimit(searchParams.get("limit")),
    };

    const result = await searchEducationalVideos(supabase, options);
    return NextResponse.json(
      {
        query: result.query,
        topic: result.topic,
        skill: result.skill,
        level: result.level,
        duration: result.duration,
        cached: result.cached,
        results: result.results.map((item) => ({
          ...item.resource,
          relevanceScore: item.relevanceScore,
          scoreBreakdown: item.scoreBreakdown,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isYoutubeError(error)) {
      // Server-side detail only: safeMessage is what the browser ever sees.
      console.error(`[youtube] search failed (${error.kind}):`, error.message);
      return errorResponse(error);
    }
    console.error("[youtube] Unexpected search failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while searching YouTube. Please try again." },
      { status: 500 },
    );
  }
}

/** Reads an optional enum param and throws a validation error on bad values. */
function parseEnum<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value === null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (!allowed.includes(trimmed as T)) {
    throw new YoutubeError("validation", `Invalid value for parameter. Allowed: ${allowed.join(", ")}.`);
  }
  return trimmed as T;
}

/** Reads an optional integer limit param. */
function parseLimit(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new YoutubeError("validation", "Invalid limit. Provide an integer between 1 and 12.");
  }
  return parsed;
}

function errorResponse(error: YoutubeError): NextResponse {
  const statusByKind: Record<YoutubeErrorKind, number> = {
    validation: 400,
    config: 503,
    quota: 503,
    api: 502,
  };
  return NextResponse.json(
    { error: error.safeMessage },
    { status: statusByKind[error.kind], headers: { "Cache-Control": "no-store" } },
  );
}
