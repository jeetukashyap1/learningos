/**
 * POST /api/learning/paths/generate
 *
 * Phase 1 of path creation: generates (or idempotently returns) the
 * signed-in learner's personalized path from their REAL onboarding answers
 * -> NVIDIA curriculum -> persisted path and ordered lessons, every lesson
 * starting 'pending'. No request body: the saved onboarding answers are
 * the only personalization input (spec part 3). No YouTube call happens
 * here, so no quota is spent by this route.
 *
 * Phase 2 is POST /api/learning/paths/attach, which the client calls next
 * so the UI can show each real stage as it happens (spec part 11).
 *
 * Failure semantics (spec part 15):
 * - AI failure (AiError): nothing was persisted; the onboarding answers stay
 *   saved. Mapped to 502/503 with safe messages.
 * - Database failure (LearningPathError 'persistence'): 500, safe message.
 * - Onboarding missing (409): the learner must complete onboarding first.
 *
 * Middleware refreshes sessions on /api/* but does not protect them, so this
 * route authenticates itself via createSupabaseServerClient().auth.getUser().
 * Responses carry only safe messages: no keys, upstream errors, model
 * internals, or stack traces ever reach the browser.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAiError, type AiErrorKind } from "@/lib/ai/errors";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";
import { generateLearningPath } from "@/lib/learning-path/service";

export async function POST() {
  // 1. Authenticate (middleware only refreshes sessions on /api/*).
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to create your learning path." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Generate: onboarding answers -> AI curriculum -> persist (phase 1).
  try {
    const result = await generateLearningPath(supabase, data.user.id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isAiError(error)) {
      // Server-side detail only; safeMessage is what the browser ever sees.
      console.error(`[learning-path] curriculum generation failed (${error.kind}):`, error.message);
      return NextResponse.json(
        { error: error.safeMessage },
        { status: aiStatusByKind(error.kind), headers: { "Cache-Control": "no-store" } },
      );
    }
    if (isLearningPathError(error)) {
      console.error(`[learning-path] generation failed (${error.kind}):`, error.message);
      return NextResponse.json(
        { error: error.safeMessage },
        { status: pathStatusByKind(error.kind), headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[learning-path] Unexpected generation failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while creating your learning path. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function aiStatusByKind(kind: AiErrorKind): number {
  const statusByKind: Record<AiErrorKind, number> = {
    config: 503,
    rate_limit: 503,
    timeout: 502,
    network: 502,
    api: 502,
    invalid_output: 502,
  };
  return statusByKind[kind];
}

function pathStatusByKind(kind: LearningPathErrorKind): number {
  const statusByKind: Record<LearningPathErrorKind, number> = {
    onboarding_missing: 409,
    not_found: 404,
    persistence: 500,
    unexpected: 500,
  };
  return statusByKind[kind];
}
