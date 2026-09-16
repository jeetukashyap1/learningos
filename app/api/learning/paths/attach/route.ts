/**
 * POST /api/learning/paths/attach
 *
 * Phase 2 of path creation: attaches videos to every lesson still
 * 'pending' on the learner's path by running the AI-written queries through
 * the EXISTING YouTube engine (searchEducationalVideos - the only YouTube
 * caller). Called right after /generate and again whenever the learner
 * retries (spec part 15).
 *
 * A hard YouTube engine failure NEVER fails this request: untouched
 * lessons stay 'pending' (the honest state) and the same endpoint can
 * retry them. 'unavailable' lessons are not retried - their queries were
 * all searched and the engine caches empty results.
 *
 * No request body. Requires an existing path (404 otherwise).
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";
import { attachPathResources } from "@/lib/learning-path/service";

export async function POST() {
  // 1. Authenticate (middleware only refreshes sessions on /api/*).
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to load your lesson resources." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Attach: run each pending lesson's queries through the engine.
  try {
    const result = await attachPathResources(supabase, data.user.id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isLearningPathError(error)) {
      console.error(`[learning-path] attach failed (${error.kind}):`, error.message);
      const statusByKind: Record<LearningPathErrorKind, number> = {
        onboarding_missing: 409,
        not_found: 404,
        persistence: 500,
        unexpected: 500,
      };
      return NextResponse.json(
        { error: error.safeMessage },
        { status: statusByKind[error.kind], headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[learning-path] Unexpected attach failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while loading your lesson resources. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
