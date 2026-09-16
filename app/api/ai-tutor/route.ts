/**
 * POST /api/ai-tutor
 *
 * The single endpoint behind the AI Tutor (spec §7, §20): every natural
 * request - "explain this simply", "quiz me", "give me a hint", "explain in
 * Hinglish", "what should I learn next?" - travels through this one flow.
 * There is no per-phrase hardcoded route.
 *
 * Body: { conversationId?: string, lessonId?: string, message: string }
 *
 * Trust model (spec §1, §2): the client may name a conversation and a lesson,
 * but NEVER a path or a user. The server resolves the caller's active path
 * from the session, verifies any supplied lesson sits on that path, and
 * anchors the reply to server-derived context only. A conversation that is
 * not the caller's own is indistinguishable from one that does not exist.
 *
 * Persistence is best-effort by design: the tutor's answer is the product. If
 * the conversation tables are unavailable the reply still returns, flagged
 * with `persisted: false`, so the learner is never blocked by storage.
 */

import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerTutorMessage, MAX_MESSAGE_LENGTH } from "@/lib/ai-tutor/service";
import { badRequest, errorResponse, jsonOk, unauthorized, UUID_PATTERN } from "@/lib/ai-tutor/http";

const MAX_REQUEST_BYTES = 24_000;

export async function POST(request: NextRequest) {
  // 1. Authenticate.
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return unauthorized("Please sign in to ask your AI Tutor.");
  }

  // 2. Reject an obviously oversized body before parsing it.
  const rawBody = await request.text();
  if (rawBody.length > MAX_REQUEST_BYTES) {
    return badRequest("That message is too long. Please shorten it and try again.");
  }

  // 3. Parse and validate the body: message required, ids optional/uuid/in range.
  let parsed: unknown;
  try {
    parsed = rawBody.trim() === "" ? {} : JSON.parse(rawBody);
  } catch {
    return badRequest("Invalid request body: expected JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return badRequest("Invalid request body: expected a JSON object.");
  }

  const { message: rawMessage, conversationId, lessonId } = parsed as {
    message?: unknown;
    conversationId?: unknown;
    lessonId?: unknown;
  };

  if (typeof rawMessage !== "string") {
    return badRequest("Please type a message for your AI Tutor.");
  }
  const message = rawMessage.trim();
  if (message === "") {
    return badRequest("Please type a message for your AI Tutor.");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return badRequest("That message is too long. Please shorten it and try again.");
  }

  if (conversationId !== undefined && (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId))) {
    return badRequest("Invalid conversation reference.");
  }
  if (lessonId !== undefined && (typeof lessonId !== "string" || !UUID_PATTERN.test(lessonId))) {
    return badRequest("Invalid lesson reference.");
  }

  // 4. Answer: resolve trusted context, load bounded history, call the
  //    existing NVIDIA provider, persist both turns.
  try {
    const result = await answerTutorMessage(supabase, data.user.id, {
      conversationId: typeof conversationId === "string" ? conversationId : null,
      lessonId: typeof lessonId === "string" ? lessonId : null,
      message,
    });

    return jsonOk({
      conversationId: result.conversationId,
      createdConversation: result.createdConversation,
      persisted: true,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      context: result.context,
    });
  } catch (error) {
    console.error("[ai-tutor] answer failed:", error);
    return errorResponse(error, "answer");
  }
}
