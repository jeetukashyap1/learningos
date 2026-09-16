/**
 * GET    /api/ai-tutor/conversations/[conversationId]  - load a thread (§10)
 * DELETE /api/ai-tutor/conversations/[conversationId]  - clear a thread (§12)
 *
 * Ownership (spec §2): the service filters by user_id, so another learner's
 * conversation is reported as a plain 404 - the caller cannot tell "does not
 * exist" from "not yours". No title, path id, or turn from someone else's
 * thread is ever echoed back.
 */

import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LearningPathError } from "@/lib/learning-path/errors";
import { loadTutorContext } from "@/lib/ai-tutor/context";
import { deleteConversation, loadConversation } from "@/lib/ai-tutor/service";
import { errorResponse, jsonOk, unauthorized, UUID_PATTERN } from "@/lib/ai-tutor/http";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** A clean not-found response; identical whether the id is malformed or foreign. */
function notFound() {
  return errorResponse(
    new LearningPathError("not_found", "That conversation was not found.", "conversation not owned or absent"),
    "conversation lookup",
  );
}

async function authenticate() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await authenticate();
  if (!auth) return unauthorized("Please sign in to open your AI Tutor.");

  const { conversationId } = await context.params;
  if (!UUID_PATTERN.test(conversationId)) return notFound();

  try {
    const conversation = await loadConversation(auth.supabase, auth.userId, conversationId);
    if (!conversation) return notFound();
    // The context header is resolved fresh from the caller's OWN active path
    // (spec §2/§12) rather than trusting anything stored on the thread. The UI
    // therefore always reflects the learner's real current module/lesson, and a
    // stored lesson that has since left the active path simply falls back to
    // path-level context - the same graceful rule the answer flow uses.
    const context = await loadTutorContext(auth.supabase, auth.userId, conversation.lessonId);
    return jsonOk({ conversation, context });
  } catch (error) {
    return errorResponse(error, "conversation load");
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const auth = await authenticate();
  if (!auth) return unauthorized("Please sign in to open your AI Tutor.");

  const { conversationId } = await context.params;
  if (!UUID_PATTERN.test(conversationId)) return notFound();

  try {
    const deleted = await deleteConversation(auth.supabase, auth.userId, conversationId);
    if (!deleted) return notFound();
    return jsonOk({ deleted: true, conversationId });
  } catch (error) {
    return errorResponse(error, "conversation delete");
  }
}
