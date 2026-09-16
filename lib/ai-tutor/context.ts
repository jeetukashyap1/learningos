/**
 * AI Tutor 2.0 - trusted tutor context builder (spec §1, §3, §4, §5, §17, §18).
 *
 * The single place where the tutor's understanding of "the learner right
 * now" is DERIVED. It is called server-side only, from the authenticated
 * user's own database state:
 *
 *   Student -> Active path -> Current module -> Current lesson -> objective,
 *   concepts, practical outcome, goal relevance, prerequisites,
 *   completed/prev/next lessons, progress, and the final outcome.
 *
 * Two deliberate properties (spec §1/§2):
 *
 *   1. Nothing here trusts client input for ownership. lessonId is resolved
 *      against the caller's OWN active path; a lesson that is not on it
 *      resolves to null (the caller turns that into a safe 404). The client
 *      never supplies a path id or a user id.
 *
 *   2. The context is COMPACT and RELEVANT (spec §3/§22): only the fields a
 *      tutor actually needs travel to the model - never the whole curriculum,
 *      never the whole conversation, never the resource/provider payloads.
 *
 * No database write happens here, and no AI call. This module is pure
 * derivation so both the tutor prompt builder and the API route share one
 * honest source of truth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadLearningPathOverview,
  type LearningPathLessonRow,
  type LearningPathOverview,
} from "@/lib/learning-path/service";

/** The learner's active path, compacted to what a tutor needs (spec §3). */
export interface TutorPathContext {
  id: string;
  title: string;
  /** Short subject name, e.g. "Physics", "React", "Spoken English". */
  subject: string;
  /** LearningDomain value (academic/programming/language/...); '' on legacy rows. */
  domain: string;
  /** One-sentence outcome the learner works toward. */
  goal: string;
  description: string;
  /** Onboarding answers, carried through for level/language matching (spec §6/§8). */
  currentLevel: string;
  dailyTime: string;
  goalType: string;
  videoLanguage: string;
  completedLessonCount: number;
  totalLessonCount: number;
  /** Final outcome the path culminates in (spec §18); empty on legacy rows. */
  finalOutcomeKind: string;
  finalOutcomeTitle: string;
}

/** The current lesson, compacted to what a tutor needs (spec §4). */
export interface TutorLessonContext {
  id: string;
  /** 1-based position across the whole path. */
  order: number;
  title: string;
  description: string;
  /** What the learner will be able to DO after this lesson. */
  objective: string;
  /** Key concepts this lesson covers. */
  concepts: string[];
  /** The concrete practical result of the lesson. */
  practicalOutcome: string;
  /** What practice should drill for this lesson (used for quizzes/hints). */
  practiceConcept: string;
  /** Why this lesson matters for the learner's stated goal. */
  goalRelevance: string;
  skill: string;
  level: string;
  estimatedMinutes: number;
  prerequisites: string[];
  completed: boolean;
  /** Owning module label, when the lesson sits in a module. */
  moduleTitle: string;
  /** 1-based module position within the path (0 when the lesson has no module). */
  moduleOrderIndex: number;
  /** 1-based position of the lesson inside its module (0 when ungrouped). */
  positionInModule: number;
  /** Number of lessons in the owning module (0 when ungrouped). */
  moduleLessonCount: number;
}

/**
 * The full trusted context. `hasPath` false means the learner has no active
 * path - the tutor must NOT invent a course (spec §19); the route renders the
 * existing NoLearningPath flow instead.
 */
export interface TutorContext {
  hasPath: boolean;
  path: TutorPathContext | null;
  /** The lesson the tutor is anchored to; null for a general conversation. */
  lesson: TutorLessonContext | null;
  /** Title of the immediately preceding lesson on the path, when one exists. */
  previousLessonTitle: string | null;
  /** Title of the immediately following lesson on the path, when one exists. */
  nextLessonTitle: string | null;
}

/** The honest no-path context: real absence, never a fabricated course (spec §19). */
export const NO_PATH_CONTEXT: TutorContext = {
  hasPath: false,
  path: null,
  lesson: null,
  previousLessonTitle: null,
  nextLessonTitle: null,
};

/**
 * Loads the learner's trusted tutor context from their own active path.
 *
 * @param supabase an RLS-scoped server client for the authenticated user
 * @param userId   the authenticated user id (from the server session)
 * @param lessonId optional lesson to anchor to; resolved against the caller's
 *                 own active path - an unknown/foreign lesson yields
 *                 `lesson: null` (callers return a safe 404), never a leak.
 *
 * Returns NO_PATH_CONTEXT when the learner has no active path. Throws only a
 * LearningPathError when the database itself fails (mapped to a safe 500 by
 * the route).
 */
export async function loadTutorContext(
  supabase: SupabaseClient,
  userId: string,
  lessonId?: string | null,
): Promise<TutorContext> {
  const overview: LearningPathOverview | null = await loadLearningPathOverview(supabase, userId);
  if (!overview) return NO_PATH_CONTEXT;

  const { path, lessons, modules, finalOutcome, completedLessonCount } = overview;

  const pathContext: TutorPathContext = {
    id: path.id,
    title: path.title,
    subject: path.subject.trim(),
    domain: path.domain,
    goal: path.goal,
    description: path.description,
    currentLevel: path.current_level,
    dailyTime: path.daily_time,
    goalType: path.goal_type,
    videoLanguage: path.video_language,
    completedLessonCount,
    totalLessonCount: lessons.length,
    finalOutcomeKind: finalOutcome.kind,
    finalOutcomeTitle: finalOutcome.title.trim(),
  };

  // No lesson requested: a general, path-aware tutor conversation.
  if (!lessonId) {
    return {
      hasPath: true,
      path: pathContext,
      lesson: null,
      previousLessonTitle: null,
      nextLessonTitle: null,
    };
  }

  // Resolve the requested lesson against the caller's OWN active path only.
  // A lesson from another user or an inactive path is simply not present in
  // this list, so it can never be anchored to (spec §2 cross-user safety).
  const lesson = lessons.find((row) => row.id === lessonId) ?? null;
  if (!lesson) {
    return {
      hasPath: true,
      path: pathContext,
      lesson: null,
      previousLessonTitle: null,
      nextLessonTitle: null,
    };
  }

  return {
    hasPath: true,
    path: pathContext,
    lesson: toLessonContext(lesson, modules),
    previousLessonTitle: titleAt(lessons, lesson.lesson_order - 1),
    nextLessonTitle: titleAt(lessons, lesson.lesson_order + 1),
  };
}

/** Compacts one lesson row (plus its module placement) for the tutor. */
function toLessonContext(
  lesson: LearningPathLessonRow,
  modules: LearningPathOverview["modules"],
): TutorLessonContext {
  const moduleRow = lesson.module_id
    ? modules.find((item) => item.id === lesson.module_id) ?? null
    : null;
  const positionInModule = moduleRow
    ? moduleRow.lessons.findIndex((item) => item.id === lesson.id) + 1
    : 0;

  return {
    id: lesson.id,
    order: lesson.lesson_order,
    title: lesson.title,
    description: lesson.description,
    objective: lesson.objective,
    concepts: lesson.concepts,
    practicalOutcome: lesson.practical_outcome,
    practiceConcept: lesson.practice_concept,
    goalRelevance: lesson.goal_relevance,
    skill: lesson.skill,
    level: lesson.level,
    estimatedMinutes: lesson.estimated_minutes,
    prerequisites: lesson.prerequisites,
    completed: lesson.completed_at != null,
    moduleTitle: moduleRow?.title ?? "",
    moduleOrderIndex: moduleRow?.orderIndex ?? 0,
    positionInModule,
    moduleLessonCount: moduleRow?.lessons.length ?? 0,
  };
}

/** Title of the lesson at a given 1-based order, or null when none exists. */
function titleAt(lessons: LearningPathLessonRow[], order: number): string | null {
  if (order < 1) return null;
  const match = lessons.find((row) => row.lesson_order === order);
  return match ? match.title : null;
}

/**
 * A short, honest conversation title derived from the TRUSTED context only
 * (spec §9) - never from untrusted client text. Prefers the current lesson,
 * then the path, then a generic label. Bounded to the DB's 200-char column.
 */
export function tutorConversationTitle(context: TutorContext): string {
  const raw = context.lesson?.title || context.path?.title || "AI Tutor conversation";
  return raw.slice(0, 200);
}
