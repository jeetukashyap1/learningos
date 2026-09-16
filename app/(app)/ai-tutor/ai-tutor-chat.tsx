"use client";

import {
  ArrowRight,
  Bot,
  BookOpen,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type TutorContext } from "@/lib/ai-tutor/context";
import { type TutorConversationSummary } from "@/lib/ai-tutor/service";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AnswerBody {
  conversationId?: unknown;
  createdConversation?: unknown;
  userMessage?: unknown;
  assistantMessage?: unknown;
  context?: unknown;
}

interface ThreadBody {
  conversation?: { id?: unknown; messages?: unknown };
  context?: unknown;
}

/** Quick actions (spec §13) - they only fill the composer, never fake a reply. */
const QUICK_ACTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: "Explain simply", prompt: "Explain this lesson in simple terms, as if I am new to it." },
  { label: "Give an example", prompt: "Give me a concrete example that shows this in action." },
  { label: "Quiz me", prompt: "Quiz me on this lesson with a few short questions. Ask one at a time and wait for my answer." },
  { label: "Give me a hint", prompt: "Give me a hint to guide me toward the answer - do not reveal the full solution yet." },
  { label: "Summarize", prompt: "Summarize this lesson in a few clear points I can review later." },
  { label: "Explain in Hinglish", prompt: "Explain this lesson in Hinglish (Hindi in Roman script), keeping technical terms in English." },
];

const VISIBLE_CONVERSATIONS = 6;
const MAX_MESSAGE_LENGTH = 8000;

/**
 * The integrated AI Tutor surface (spec §12). It renders the server-derived
 * context header, the conversation itself, quick actions, and every honest
 * loading/error/retry state. All context and history keep flowing through the
 * one POST /api/ai-tutor flow (spec §20) - this component never invents lesson
 * or progress data, and it never sends a path id or user id.
 */
export function AiTutorChat({
  initialContext,
  initialConversations,
  studentName,
}: {
  initialContext: TutorContext;
  initialConversations: TutorConversationSummary[];
  studentName: string | null;
}) {
  const [context, setContext] = useState<TutorContext>(initialContext);
  const [conversations, setConversations] = useState<TutorConversationSummary[]>(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [isNewThread, setIsNewThread] = useState(true);
  const [showAllConversations, setShowAllConversations] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const lesson = context.lesson;
  const path = context.path;

  function clearThread() {
    setConversationId(null);
    setMessages([]);
    setIsNewThread(true);
    setLastFailed(null);
  }

  function startNewConversation() {
    if (busy) return;
    setError(null);
    clearThread();
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    if (busy || loadingThread || id === conversationId) return;
    setLoadingThread(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai-tutor/conversations/${id}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(extractError(body, "We could not open that conversation."));
        return;
      }
      const body = (await response.json()) as ThreadBody;
      const thread = Array.isArray(body.conversation?.messages)
        ? toMessages(body.conversation?.messages)
        : [];
      setMessages(thread);
      setConversationId(typeof body.conversation?.id === "string" ? body.conversation.id : id);
      if (isTutorContext(body.context)) setContext(body.context);
      setIsNewThread(false);
      setLastFailed(null);
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setLoadingThread(false);
    }
  }

  async function removeConversation(id: string) {
    if (busy || loadingThread) return;
    setError(null);
    try {
      const response = await fetch(`/api/ai-tutor/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(extractError(body, "We could not clear that conversation."));
        return;
      }
      setConversations((current) => current.filter((item) => item.id !== id));
      if (id === conversationId) clearThread();
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    }
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // A brand-new thread anchors to the lesson the student was just looking at
    // (spec §4/§11); a continued thread lets the server keep its own anchor.
    const lessonId = isNewThread ? lesson?.id ?? null : null;

    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [...current, { id: optimisticId, role: "user", content: trimmed }]);
    setInput("");
    setError(null);
    setLastFailed(null);
    setBusy(true);

    try {
      const response = await fetch("/api/ai-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversationId: isNewThread ? undefined : conversationId ?? undefined,
          lessonId: lessonId ?? undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        // Drop the optimistic turn so Retry cannot double-post it.
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setLastFailed(trimmed);
        setError(extractError(body, "Your AI Tutor could not answer just now. Please try again."));
        return;
      }

      const body = (await response.json()) as AnswerBody;
      const assistant = toMessage(body.assistantMessage);
      const serverUser = toMessage(body.userMessage);
      if (serverUser) {
        setMessages((current) =>
          current.map((item) => (item.id === optimisticId ? serverUser : item)),
        );
      }
      if (assistant) setMessages((current) => [...current, assistant]);
      if (isTutorContext(body.context)) setContext(body.context);

      const newId = typeof body.conversationId === "string" ? body.conversationId : conversationId;
      if (newId) {
        setConversationId(newId);
        const summary: TutorConversationSummary = {
          id: newId,
          title: serverUserOr(serverUser, trimmed),
          lessonId: context.lesson?.id ?? null,
          updatedAt: new Date().toISOString(),
        };
        setConversations((current) => [summary, ...current.filter((item) => item.id !== newId)]);
      }
      setIsNewThread(false);
    } catch {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setLastFailed(trimmed);
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit(input);
    }
  }

  // Fills the composer only - it never fabricates a reply (spec §13).
  function applyQuickAction(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus();
  }

  const visibleConversations = showAllConversations
    ? conversations
    : conversations.slice(0, VISIBLE_CONVERSATIONS);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "flex-start", marginTop: 28 }}>
      <section style={{ flex: "2 1 440px", minWidth: 0, display: "grid", gap: 16 }}>
        <ContextHeader context={context} />

        <div className="card pad" style={{ display: "grid", gap: 0, padding: 0, overflow: "hidden" }}>
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="move-icon" style={{ background: "var(--navy)", color: "var(--lime)" }}>
                <Bot size={18} />
              </span>
              <span>
                <strong style={{ display: "block", fontSize: 14 }}>
                  {lesson ? lesson.title : path ? `${path.subject || path.title} tutor` : "LearningOS Tutor"}
                </strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  {isNewThread ? "New conversation" : "Continuing conversation"}
                </span>
              </span>
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={startNewConversation}
              disabled={busy || loadingThread}
            >
              <Plus size={14} />
              New
            </button>
          </header>

          <div
            ref={scrollRef}
            aria-live="polite"
            style={{
              display: "grid",
              gap: 14,
              padding: "20px 18px",
              minHeight: 320,
              maxHeight: 520,
              overflowY: "auto",
              background: "var(--paper)",
            }}
          >
            {loadingThread ? (
              <p className="muted" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={14} className="auth-spinner" />
                Loading conversation…
              </p>
            ) : messages.length === 0 ? (
              <EmptyThread studentName={studentName} lessonTitle={lesson?.title ?? null} />
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}

            {busy ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="move-icon" style={{ background: "var(--mint)", color: "var(--ink)" }}>
                  <Bot size={16} />
                </span>
                <span className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Loader2 size={13} className="auth-spinner" />
                  Your tutor is thinking…
                </span>
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => applyQuickAction(action.prompt)}
                  disabled={busy || loadingThread}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  <Sparkles size={12} />
                  {action.label}
                </button>
              ))}
            </div>

            {error ? (
              <div
                role="alert"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--peach, #ffe9e2)",
                  color: "var(--peach-ink, #7a2c17)",
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1, minWidth: 180 }}>{error}</span>
                {lastFailed ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void submit(lastFailed)}
                    disabled={busy}
                    style={{ fontSize: 12 }}
                  >
                    <RotateCcw size={12} />
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                aria-label="Ask your AI tutor"
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder={lesson ? `Ask about “${lesson.title}”…` : "Ask about what you are learning…"}
                rows={2}
                disabled={busy || loadingThread}
                style={{
                  flex: 1,
                  minWidth: 0,
                  resize: "vertical",
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  padding: "12px 14px",
                  background: "var(--card)",
                  font: "inherit",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              />
              <button
                type="button"
                className="btn btn-dark"
                onClick={() => void submit(input)}
                disabled={busy || loadingThread || input.trim() === ""}
                aria-label="Send message"
                style={{ height: 46, padding: "0 18px" }}
              >
                {busy ? <Loader2 size={16} className="auth-spinner" /> : <Send size={16} />}
              </button>
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
              Enter to send · Shift + Enter for a new line
            </span>
          </div>
        </div>
      </section>

      <aside style={{ flex: "1 1 260px", minWidth: 0, display: "grid", gap: 16 }}>
        <section className="card pad" style={{ display: "grid", gap: 12 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="eyebrow" style={{ margin: 0 }}>RECENT CONVERSATIONS</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={startNewConversation}
              disabled={busy || loadingThread}
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              <Plus size={12} />
              New
            </button>
          </header>

          {conversations.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              No saved conversations yet. Anything you ask is kept here so you can pick it back up later.
            </p>
          ) : (
            <ul className="list" style={{ display: "grid", gap: 6 }}>
              {visibleConversations.map((conversation) => {
                const active = conversation.id === conversationId;
                return (
                  <li
                    key={conversation.id}
                    className="list-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: active ? "var(--mint)" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      disabled={busy || loadingThread || active}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: active ? "default" : "pointer",
                        font: "inherit",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {conversation.title}
                      </span>
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        {formatRelative(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Clear conversation: ${conversation.title}`}
                      onClick={() => void removeConversation(conversation.id)}
                      disabled={busy || loadingThread}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {conversations.length > VISIBLE_CONVERSATIONS ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowAllConversations((value) => !value)}
              style={{ fontSize: 12 }}
            >
              {showAllConversations
                ? "Show fewer"
                : `Show ${conversations.length - VISIBLE_CONVERSATIONS} more`}
            </button>
          ) : null}
        </section>

        <section className="card pad" style={{ display: "grid", gap: 10 }}>
          <span className="eyebrow" style={{ margin: 0 }}>
            <Target size={12} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            HOW I HELP
          </span>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            Ask for a simpler explanation, a hint before the answer, a quick quiz, or a summary in the language you
            prefer. I stay on your current lesson and never mark anything complete for you.
          </p>
          {lesson ? (
            <a className="btn btn-ghost" href={`/learn/${lesson.id}`} style={{ fontSize: 12 }}>
              <BookOpen size={12} />
              Back to this lesson
              <ArrowRight size={12} />
            </a>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function ContextHeader({ context }: { context: TutorContext }) {
  const path = context.path;
  const lesson = context.lesson;
  if (!path) return null;

  const progress =
    path.totalLessonCount > 0
      ? Math.round((path.completedLessonCount / path.totalLessonCount) * 100)
      : 0;

  return (
    <section className="card pad" aria-label="What you are currently learning" style={{ display: "grid", gap: 12 }}>
      <span className="eyebrow" style={{ margin: 0 }}>CURRENTLY LEARNING</span>

      <div style={{ display: "grid", gap: 4 }}>
        <strong style={{ fontSize: 15 }}>{path.title}</strong>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {lesson ? (
            <>
              {lesson.moduleTitle ? <>Module: {lesson.moduleTitle} · </> : null}
              Lesson: {lesson.title}
            </>
          ) : (
            <>Path-wide conversation · ask about any lesson on this path</>
          )}
        </span>
      </div>

      {lesson ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {lesson.moduleTitle ? <span className="tag">{lesson.moduleTitle}</span> : null}
          <span className="tag">Lesson {lesson.order} of {path.totalLessonCount}</span>
          {lesson.skill ? <span className="tag">{lesson.skill}</span> : null}
          {lesson.level ? <span className="tag">{lesson.level}</span> : null}
          {lesson.completed ? <span className="tag">Completed</span> : null}
        </div>
      ) : null}

      {lesson && lesson.objective ? (
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, margin: 0 }}>
          <strong style={{ color: "var(--ink)" }}>Objective:</strong> {lesson.objective}
        </p>
      ) : path.goal ? (
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, margin: 0 }}>
          <strong style={{ color: "var(--ink)" }}>Goal:</strong> {path.goal}
        </p>
      ) : null}

      {lesson && lesson.concepts.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {lesson.concepts.slice(0, 6).map((concept) => (
            <span key={concept} className="tag">{concept}</span>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {path.completedLessonCount}/{path.totalLessonCount} lessons complete
        </span>
        <div className="progress" style={{ flex: "1 1 120px", minWidth: 100 }} aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        {context.previousLessonTitle ? (
          <span className="muted" style={{ fontSize: 11.5 }}>Prev: {context.previousLessonTitle}</span>
        ) : null}
        {context.nextLessonTitle ? (
          <span className="muted" style={{ fontSize: 11.5 }}>Next: {context.nextLessonTitle}</span>
        ) : null}
      </div>
    </section>
  );
}

function EmptyThread({ studentName, lessonTitle }: { studentName: string | null; lessonTitle: string | null }) {
  const greeting = studentName ? `Hi ${studentName.split(" ")[0]} — I'm your` : "I'm your";
  return (
    <div style={{ maxWidth: 560, display: "grid", gap: 10 }}>
      <div className="card pad" style={{ background: "var(--mint)", boxShadow: "none" }}>
        <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
          {greeting} LearningOS tutor. I already know your path{lessonTitle ? <> and that you are on <strong>{lessonTitle}</strong></> : null}, so you can ask in plain words - no need to explain your course to me.
        </p>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        Try a quick action below, or ask something like “why does this matter?” or “I still don’t understand”.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", gap: 10 }}>
      {!isUser ? (
        <span className="move-icon" style={{ background: "var(--mint)", color: "var(--ink)", flexShrink: 0 }}>
          <Bot size={16} />
        </span>
      ) : null}
      <div
        style={{
          maxWidth: "86%",
          padding: "11px 14px",
          borderRadius: 14,
          background: isUser ? "var(--navy)" : "var(--card)",
          color: isUser ? "white" : "var(--ink)",
          border: isUser ? "none" : "1px solid var(--line)",
          fontSize: 13.5,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

/** Reads a { id, role, content } message object off an untrusted response. */
function toMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { id?: unknown; role?: unknown; content?: unknown };
  if (typeof record.content !== "string") return null;
  return {
    id: typeof record.id === "string" ? record.id : `msg-${Date.now()}`,
    role: record.role === "assistant" ? "assistant" : "user",
    content: record.content,
  };
}

function toMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map(toMessage).filter((item): item is ChatMessage => item !== null);
}

/** Minimal guard: the server always sends a TutorContext, but never trust it blindly. */
function isTutorContext(value: unknown): value is TutorContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { hasPath?: unknown }).hasPath === "boolean",
  );
}

function serverUserOr(message: ChatMessage | null, fallback: string): string {
  const text = message?.content?.trim();
  return text ? text.slice(0, 80) : fallback.slice(0, 80);
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
