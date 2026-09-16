/**
 * GET /api/ai-tutor/conversations
 *
 * Lists the caller's most recently updated tutor conversations (spec §10, §12)
 * so the UI can offer "continue a conversation". RLS scopes the rows to the
 * authenticated user; the explicit user_id filter is defence in depth.
 *
 * Returns { conversations: TutorConversationSummary[] }.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConversations } from "@/lib/ai-tutor/service";
import { errorResponse, jsonOk, unauthorized } from "@/lib/ai-tutor/http";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return unauthorized("Please sign in to open your AI Tutor.");
  }

  try {
    const conversations = await listConversations(supabase, data.user.id);
    return jsonOk({ conversations });
  } catch (error) {
    return errorResponse(error, "conversation list");
  }
}
