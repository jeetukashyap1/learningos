/**
 * POST /api/learning/paths/create-new
 *
 * Explicitly creates a NEW learning path (spec part 17). Unlike
 * POST /api/learning/paths/generate (idempotent: same answers -> same path),
 * this route always generates a fresh curriculum from the user's CURRENT
 * onboarding answers, deactivates the previous active path, and inserts the
 * new path as the active one. The old path stays fully intact in the
 * library and can be switched back to at any time.
 *
 * Middleware refreshes sessions on /api/* but does not protect them, so this
 * route authenticates itself via createSupabaseServerClient().auth.getUser().
 * Responses carry only safe messages: no keys, raw upstream errors, or
 * internal details are ever exposed to the browser.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNewLearningPath } from "@/lib/learning-path/service";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";
import { isAiError, type AiErrorKind } from "@/lib/ai/errors";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to create a new learning path." },
      { status: 401 },
    );
  }

  try {
    const result = await createNewLearningPath(supabase, data.user.id);
    return NextResponse.json(
      {
        pathId: result.pathId,
        title: result.title,
        lessonCount: result.lessonCount,
        resourcesFound: result.resourcesFound,
        resourcesPending: result.resourcesPending,
        resourcesUnavailable: result.resourcesUnavailable,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isAiError(error)) {
      console.error(`[learning-paths] create-new AI failure (${error.kind}):`, error.message);
      return NextResponse.json(
        { error: error.safeMessage },
        { status: aiStatusByKind(error.kind), headers: { "Cache-Control": "no-store" } },
      );
    }
    if (isLearningPathError(error)) {
      console.error(`[learning-paths] create-new failed (${error.kind}):`, error.message);
      return NextResponse.json(
        { error: error.safeMessage },
        { status: pathStatusByKind(error.kind), headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[learning-paths] Unexpected create-new failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while creating your new learning path. Please try again." },
      { status: 500 },
    );
  }
}

function aiStatusByKind(kind: AiErrorKind): number {
  switch (kind) {
    case "config":
    case "rate_limit":
      return 503;
    default:
      // timeout, network, api, invalid_output
      return 502;
  }
}

function pathStatusByKind(kind: LearningPathErrorKind): number {
  switch (kind) {
    case "not_found":
      return 404;
    case "onboarding_missing":
      return 409;
    default:
      return 500;
  }
}
