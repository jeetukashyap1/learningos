/**
 * Notification read-state service.
 *
 * Notifications in LearningOS are DERIVED signals: each one is recomputed
 * from the learner's own persisted learning path (videos still loading,
 * what is up next, milestones earned). There is deliberately no second
 * content system, so the only thing that ever needs storing is the READ
 * state: a stable per-user record of "this learner already opened this
 * signal".
 *
 * This module owns two responsibilities:
 *
 * 1. SIGNAL IDENTITY. buildNotificationSignals() derives the same signal
 *    list every page renders, and stamps each one with a stable `key`: a
 *    server-derived fingerprint of the signal (kind + a stable source
 *    reference + target), NEVER a render index. Re-ordering signals or
 *    changing a timestamp therefore never changes a signal's identity, so
 *    its read state survives the next render. A genuinely new signal (a
 *    different lesson completed, a different "up next") gets a new key and
 *    is therefore unread - the honest default.
 *
 * 2. READ I/O. loadNotificationReadKeys() / markNotificationRead() read and
 *    write the small public.notification_reads table. A row exists ONLY
 *    once a learner has read a signal, so a new signal is unread without
 *    anything having to be written first. Marking the same signal read
 *    again is a no-op (idempotent upsert), so "read stays read" survives
 *    any number of page loads, refreshes and re-logins.
 *
 * RLS scopes every query to the caller (user_id = auth.uid()) and the
 * service always passes the authenticated user id explicitly, so two
 * learners can never read each other's state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { NotificationError } from "./errors";

/**
 * Maximum stored key length. Mirrors the check constraint on
 * public.notification_reads.signal_key.
 */
export const MAX_SIGNAL_KEY_LENGTH = 200;

export interface NotificationSignal {
  /** Stable, server-derived identity of the signal. */
  key: string;
  title: string;
  detail: string;
  kind: string;
  href: string;
}

/** Shared empty result so callers never need to allocate a new Set. */
export const NO_READ_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Builds the fingerprint stored as signal_key. Kind, a stable source
 * reference and the target make the identity descriptive and unique
 * without ever depending on render order or volatile detail text.
 */
function fingerprint(parts: Array<string | null | undefined>): string {
  const collapsed = parts
    .map((part) => (part ?? "").trim().replace(/\s+/g, " "))
    .join("|");
  return collapsed.length <= MAX_SIGNAL_KEY_LENGTH
    ? collapsed
    : collapsed.slice(0, MAX_SIGNAL_KEY_LENGTH);
}

/**
 * The single source of truth for the signals a learner's active path
 * produces. Content is unchanged from the original page derivation - only
 * the stable `key` is new. The order the signals are pushed in is the order
 * the page renders them.
 */
export function buildNotificationSignals(overview: LearningPathOverview): NotificationSignal[] {
  const { path, lessons, nextLessonId, completedLessonCount } = overview;
  const total = lessons.length;
  const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId) ?? null;
  const pendingVideos = lessons.filter((lesson) => lesson.resource_status === "pending");
  const missingVideos = lessons.filter((lesson) => lesson.resource_status === "unavailable");
  const recentCompletions = lessons
    .filter((lesson) => lesson.completed_at != null)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 3);
  const remaining = total - completedLessonCount;

  const signals: NotificationSignal[] = [];

  if (pendingVideos.length > 0) {
    signals.push({
      key: fingerprint(["Videos", "pending", "/journey"]),
      title: "Videos still loading",
      detail: `${pendingVideos.length} ${pendingVideos.length === 1 ? "lesson is" : "lessons are"} still waiting for a matched video. They finish loading in the background — you can retry from your journey.`,
      kind: "Videos",
      href: "/journey",
    });
  }
  for (const lesson of missingVideos.slice(0, 2)) {
    signals.push({
      key: fingerprint(["Videos", `missing:${lesson.id}`, "/journey"]),
      title: "No strong video found yet",
      detail: `We could not find a highly relevant video for “${lesson.title}”. Retry the search from your journey, or open the lesson and learn without one.`,
      kind: "Videos",
      href: "/journey",
    });
  }
  if (nextLesson) {
    signals.push({
      key: fingerprint(["Next up", `lesson:${nextLesson.id}`, `/learn/${nextLesson.id}`]),
      title: "Up next on your path",
      detail: `“${nextLesson.title}” — ${nextLesson.estimated_minutes} min · ${nextLesson.level}${nextLesson.skill ? ` · ${nextLesson.skill}` : ""}.`,
      kind: "Next up",
      href: `/learn/${nextLesson.id}`,
    });
  }
  for (const lesson of recentCompletions) {
    signals.push({
      key: fingerprint(["Milestone", `complete:${lesson.id}`, `/learn/${lesson.id}`]),
      title: "Lesson complete",
      detail: `“${lesson.title}” is done${remaining > 0 ? ` — ${remaining} ${remaining === 1 ? "lesson" : "lessons"} to go on “${path.title}”` : ""}.`,
      kind: "Milestone",
      href: `/learn/${lesson.id}`,
    });
  }
  if (total > 0 && remaining === 0) {
    signals.push({
      key: fingerprint(["Milestone", `path:${path.id}`, "/paths"]),
      title: "Path complete",
      detail: `You finished every lesson on “${path.title}”. Ready for the next goal? Start a new path from your library.`,
      kind: "Milestone",
      href: "/paths",
    });
  }

  return signals;
}

/** How many of these signals the learner has NOT read yet. */
export function countUnreadSignals(
  signals: NotificationSignal[],
  readKeys: ReadonlySet<string>,
): number {
  return signals.reduce(
    (count, signal) => (readKeys.has(signal.key) ? count : count + 1),
    0,
  );
}

/**
 * The set of signal keys this learner has already read. Absence of a key is
 * the unread state. Throws NotificationError("persistence") if the read
 * state cannot be loaded.
 */
export async function loadNotificationReadKeys(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("notification_reads")
    .select("signal_key")
    .eq("user_id", userId);
  if (error) {
    throw new NotificationError(
      "persistence",
      "We could not load your notifications right now. Please refresh the page.",
      describe(error),
    );
  }
  return new Set(
    ((data as Array<{ signal_key: string }> | null) ?? []).map((row) => row.signal_key),
  );
}

/**
 * Persists "this learner has read this signal". Idempotent: the primary key
 * is (user_id, signal_key), so re-reading never duplicates a row and never
 * moves read_at. Only the caller's own rows are ever written (RLS plus the
 * explicit user id).
 */
export async function markNotificationRead(
  supabase: SupabaseClient,
  userId: string,
  signalKey: string,
): Promise<void> {
  const key = signalKey.trim();
  if (key === "" || key.length > MAX_SIGNAL_KEY_LENGTH) {
    throw new NotificationError("invalid", "That notification could not be recognised.");
  }
  const { error } = await supabase
    .from("notification_reads")
    .upsert(
      { user_id: userId, signal_key: key },
      { onConflict: "user_id,signal_key", ignoreDuplicates: true },
    );
  if (error) {
    throw new NotificationError(
      "persistence",
      "We could not save your notification state. Please try again.",
      describe(error),
    );
  }
}

/**
 * Whether the learner has any unread signal on their active path. Used by
 * the app shell to show the sidebar dot from REAL state instead of learning
 * history. No active path (or no signals) means nothing to be unread.
 */
export async function hasUnreadNotifications(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const overview = await loadLearningPathOverview(supabase, userId);
  if (!overview) return false;
  const signals = buildNotificationSignals(overview);
  if (signals.length === 0) return false;
  const readKeys = await loadNotificationReadKeys(supabase, userId);
  return countUnreadSignals(signals, readKeys) > 0;
}

function describe(error: { message?: string; code?: string } | null): string {
  if (!error) return "unknown";
  return error.code ? `${error.code}: ${error.message ?? ""}` : error.message ?? "unknown";
}
