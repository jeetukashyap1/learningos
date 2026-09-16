/**
 * AI Tutor 2.0 - conversation service (spec §9, §10, §14, §20, §21, §22).
 *
 * The orchestration layer between the API route and the two lower modules:
 *   - lib/ai-tutor/context.ts derives the TRUSTED learner context from the DB
 *   - lib/ai-tutor/prompt.ts  turns that context + bounded history + the new
 *                             message into the message list sent to NVIDIA
 *
 * Responsibilities here:
 *   - persist conversations and turns in ai_tutor_conversations /
 *     ai_tutor_messages (the schema created by
 *     20260912000000_create_ai_tutor_conversations.sql)
 *   - keep the conversation anchored to the caller's real path/lesson, set
 *     from server-derived context, NEVER from client input
 *   - apply a bounded history window so follow-ups stay coherent without
 *     sending an unlimited transcript (spec §10/§22)
 *   - reuse the existing NVIDIA provider (spec §14: no second AI client)
 *
 * Ownership is enforced twice: RLS at the database, and explicit ownership
 * resolution here. A conversation that is not the caller's own is treated as
 * not found - the two are indistinguishable to an attacker.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { nvidiaChatCompletion } from "@/lib/ai/client";
import { LearningPathError } from "@/lib/learning-path/errors";
import { loadTutorContext, tutorConversationTitle, type TutorContext } from "./context";
import { buildTutorMessages, MAX_HISTORY_TURNS, type TutorHistoryTurn } from "./prompt";

/** One stored turn, as returned to the UI. */
export interface TutorMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/** A conversation with its ordered turns. */
export interface TutorConversation {
  id: string;
  title: string;
  pathId: string | null;
  lessonId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TutorMessageRow[];
}

/** A conversation summary for the recent-conversations list. */
export interface TutorConversationSummary {
  id: string;
  title: string;
  lessonId: string | null;
  updatedAt: string;
}

const SAVE_FAILED_MESSAGE = "We could not save your conversation. Please try again.";
const LOAD_FAILED_MESSAGE = "We could not load this conversation. Please try again.";

const MAX_TITLE_LENGTH = 200;
/** The learner message bound (mirrors the ai_tutor_messages.content check). */
export const MAX_MESSAGE_LENGTH = 8000;
/** How many recent conversations the tutor page lists. */
const MAX_CONVERSATION_LIST = 20;

// ---------------------------------------------------------------------------
// Row shapes (column names as returned by PostgREST)
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  user_id: string;
  path_id: string | null;
  lesson_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Loads one of the caller's conversations with its ordered turns. Returns
 * null when the conversation does not exist OR belongs to another user (the
 * two cases are deliberately indistinguishable). Throws LearningPathError
 * only when the database itself fails.
 */
export async function loadConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<TutorConversation | null> {
  const { data: conversationData, error: conversationError } = await supabase
    .from("ai_tutor_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (conversationError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "ai_tutor_conversations read failed", conversationError);
  }
  const conversation = (conversationData as ConversationRow | null) ?? null;
  if (!conversation) return null;

  const { data: messageData, error: messageError } = await supabase
    .from("ai_tutor_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });

  if (messageError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "ai_tutor_messages read failed", messageError);
  }

  return {
    id: conversation.id,
    title: conversation.title,
    pathId: conversation.path_id,
    lessonId: conversation.lesson_id,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    messages: ((messageData as MessageRow[] | null) ?? []).map(toMessageRow),
  };
}

/** Lists the caller's most recently updated conversations (newest first). */
export async function listConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<TutorConversationSummary[]> {
  const { data, error } = await supabase
    .from("ai_tutor_conversations")
    .select("id, title, lesson_id, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_CONVERSATION_LIST);

  if (error) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "ai_tutor_conversations list failed", error);
  }

  return ((data as Pick<ConversationRow, "id" | "title" | "lesson_id" | "updated_at">[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      title: row.title,
      lessonId: row.lesson_id,
      updatedAt: row.updated_at,
    }),
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Creates a new conversation anchored to the SERVER-derived context. The
 * title, path_id, and lesson_id all come from trusted state (spec §9), so a
 * client can never point the thread at another learner's rows.
 */
export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  context: TutorContext,
): Promise<TutorConversation> {
  const { data, error } = await supabase
    .from("ai_tutor_conversations")
    .insert({
      user_id: userId,
      path_id: context.path?.id ?? null,
      lesson_id: context.lesson?.id ?? null,
      title: tutorConversationTitle(context).slice(0, MAX_TITLE_LENGTH),
    })
    .select()
    .single();

  if (error || !data) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "ai_tutor_conversations insert failed", error);
  }

  const row = data as ConversationRow;
  return {
    id: row.id,
    title: row.title,
    pathId: row.path_id,
    lessonId: row.lesson_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
  };
}

/** Deletes one of the caller's conversations (and its turns via cascade). */
export async function deleteConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_tutor_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "ai_tutor_conversations delete failed", error);
  }
  return Array.isArray(data) && data.length > 0;
}

/** Persists one user or assistant turn. */
async function insertMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<TutorMessageRow> {
  const { data, error } = await supabase
    .from("ai_tutor_messages")
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single();

  if (error || !data) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "ai_tutor_messages insert failed", error);
  }
  return toMessageRow(data as MessageRow);
}

/** Bumps a conversation's updated_at so the list orders by real activity. */
async function touchConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_tutor_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) {
    // Non-fatal: the turn itself is what matters; a stale ordering timestamp
    // must never fail the learner's reply.
    console.error("[ai-tutor] conversation touch failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export interface TutorReplyResult {
  conversationId: string;
  /** The persisted user turn. */
  userMessage: TutorMessageRow;
  /** The persisted assistant turn. */
  assistantMessage: TutorMessageRow;
  /** True when this turn created the conversation. */
  createdConversation: boolean;
  /** The trusted context the reply was grounded in (for the UI header). */
  context: TutorContext;
}

/**
 * Answers one learner message end to end: resolve the trusted context,
 * resolve or create the conversation (verifying ownership), load a BOUNDED
 * history window, call the existing NVIDIA provider, then persist both turns.
 *
 * The AI call happens BEFORE either turn is written, so a provider failure
 * leaves the conversation exactly as it was - the learner can simply retry
 * without duplicated or half-written history.
 */
export async function answerTutorMessage(
  supabase: SupabaseClient,
  userId: string,
  input: { conversationId?: string | null; lessonId?: string | null; message: string },
): Promise<TutorReplyResult> {
  const message = input.message.trim();

  // Resolve the caller's trusted context first. When a conversation is
  // supplied, its own scope wins over any new lessonId, so continuing a
  // lesson-anchored thread stays anchored (spec §10).
  let conversation: TutorConversation | null = null;
  let createdConversation = false;

  if (input.conversationId) {
    conversation = await loadConversation(supabase, userId, input.conversationId);
    if (!conversation) {
      throw new LearningPathError(
        "not_found",
        "That conversation was not found.",
        `conversation ${input.conversationId} is not owned by user ${userId}`,
      );
    }
  }

  const anchorLessonId = conversation ? conversation.lessonId : input.lessonId ?? null;
  const context = await loadTutorContext(supabase, userId, anchorLessonId);

  // A lesson named by the CLIENT must belong to the caller's own active path
  // (spec §2). Resolving here - before any row is created - means a bad anchor
  // can never leave a stray, mis-anchored conversation behind, and the route
  // answers a safe 404 that reveals nothing about other learners' lessons.
  // A CONTINUED conversation degrades gracefully instead: if its lesson has
  // since left the active path (the learner switched paths, say), the thread
  // simply falls back to path-level context rather than failing the follow-up.
  if (!conversation && input.lessonId && !context.lesson) {
    throw new LearningPathError(
      "not_found",
      "We could not find that lesson on your current path.",
      `lesson ${input.lessonId} is not on the active path for user ${userId}`,
    );
  }

  if (!conversation) {
    conversation = await createConversation(supabase, userId, context);
    createdConversation = true;
  }

  // Bounded history window (spec §10/§22): only the trailing turns travel.
  const history: TutorHistoryTurn[] = conversation.messages
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content }));

  const messages = buildTutorMessages(context, history, message);
  const reply = await nvidiaChatCompletion(messages);

  // The AI call succeeded; now persist both turns honestly.
  const userMessage = await insertMessage(supabase, conversation.id, "user", message.slice(0, MAX_MESSAGE_LENGTH));
  const assistantMessage = await insertMessage(
    supabase,
    conversation.id,
    "assistant",
    reply.slice(0, MAX_MESSAGE_LENGTH),
  );
  await touchConversation(supabase, conversation.id);

  return {
    conversationId: conversation.id,
    userMessage,
    assistantMessage,
    createdConversation,
    context,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMessageRow(row: MessageRow): TutorMessageRow {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    createdAt: row.created_at,
  };
}

function persistenceError(
  safeMessage: string,
  detail: string,
  error: { message?: string } | null | undefined,
): LearningPathError {
  const observed = error?.message ? `: ${error.message}` : "";
  return new LearningPathError("persistence", safeMessage, `${detail}${observed}`);
}
