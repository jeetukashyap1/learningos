/**
 * GET /api/ai-tutor/lesson/[lessonId]
 *
 * Returns the SERVER-derived tutor context for one lesson (spec §4, §11, §12)
 * so the tutor can show "Currently learning: ... / Module: ... / Lesson: ..."
 * before the first message is sent.
 *
 * The lesson id is the only client input, and it is resolved against the
 * caller's OWN active path - a lesson from another learner or an inactive
 * path yields a safe 404, never another learner's curriculum. No path id or
 * user id is ever accepted from the client.
 */

import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LearningPathError } from "@/lib/learning-path/errors";
import { loadTutorContext } from "@/lib/ai-tutor/context";
import { errorResponse, jsonOk, unauthorized, UUID_PATTERN } from "@/lib/ai-tutor/http";

type RouteContext = { params: Promise<{ lessonId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return unauthorized("Please sign in to open your AI Tutor.");
  }

  const { lessonId } = await context.params;
  if (!UUID_PATTERN.test(lessonId)) {
    return errorResponse(new LearningPathError("not_found", "Lesson not found.", "malformed lesson id"), "lesson context");
  }

  try {
    const tutorContext = await loadTutorContext(supabase, data.user.id, lessonId);

    // A lesson that is not on the caller's active path is a safe 404, exactly
    // like a lesson that does not exist (spec §2).
    if (!tutorContext.lesson) {
      return errorResponse(
        new LearningPathError("not_found", "We could not find that lesson on your current path.", "lesson not on active path"),
        "lesson context",
      );
    }

    return jsonOk({ context: tutorContext });
  } catch (error) {
    return errorResponse(error, "lesson context");
  }
}
