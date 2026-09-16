/**
 * POST /api/learning/lessons/[lessonId]/complete
 *
 * Marks one lesson of the learner's path complete (or, with
 * { "completed": false }, not complete). completed_at is the SINGLE
 * progress signal consumed by the existing Journey/Learn/Progress pages -
 * there is deliberately no second progress system (spec parts 13-14).
 *
 * Body (optional): { "completed": boolean } - defaults to true.
 *
 * Ownership: the lesson must sit on the caller's own path. RLS already
 * enforces this; the service checks it again explicitly (defense in depth).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";
import { setLessonCompletion } from "@/lib/learning-path/service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ lessonId: string }> },
) {
  // 1. Authenticate (middleware only refreshes sessions on /api/*).
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to update your lesson progress." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Validate the path parameter.
  const { lessonId } = await context.params;
  if (!UUID_PATTERN.test(lessonId)) {
    return NextResponse.json(
      { error: "Lesson not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 3. Validate the optional body: { completed?: boolean }, default true.
  let completed = true;
  const rawBody = await request.text();
  if (rawBody.trim() !== "") {
    try {
      const body: unknown = JSON.parse(rawBody);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return badRequest("Invalid request body: expected a JSON object.");
      }
      const { completed: requested } = body as { completed?: unknown };
      if (requested !== undefined && typeof requested !== "boolean") {
        return badRequest('Invalid request body: "completed" must be a boolean.');
      }
      completed = requested ?? true;
    } catch {
      return badRequest("Invalid request body: expected JSON.");
    }
  }

  // 4. Persist the completion on the caller's own lesson.
  try {
    const lesson = await setLessonCompletion(supabase, data.user.id, lessonId, completed);
    return NextResponse.json(
      { lessonId: lesson.id, completedAt: lesson.completed_at },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isLearningPathError(error)) {
      console.error(`[learning-path] completion update failed (${error.kind}):`, error.message);
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
    console.error("[learning-path] Unexpected completion failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while saving your progress. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
