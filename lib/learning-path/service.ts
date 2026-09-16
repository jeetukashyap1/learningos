/**
 * Learning-path generation service (spec parts 3-8, 10, 11, 15-17).
 *
 * Path creation runs in two honest, separately observable phases (spec
 * part 11: real button states, no fake timers):
 *
 *   generateLearningPath():
 *     real onboarding answers -> NVIDIA curriculum (lib/ai)
 *       -> persisted learning path + ordered modules + lessons linked to
 *          their module (all 'pending') + the final outcome on the path
 *
 *   attachPathResources():
 *     per-lesson video search through the EXISTING YouTube engine
 *       (lib/youtube searchEducationalVideos - the only YouTube caller)
 *       -> lessons updated to 'found' / 'unavailable' (or left 'pending'
 *          when the engine is down; this same phase retries them later)
 *
 * Multiple paths (spec parts 16-17): every learner has exactly ONE
 * active path at a time - enforced by the partial unique index on
 * learning_paths (user_id) where is_active. Every read and write here
 * operates on the active path, so paths can never mix. Onboarding-driven
 * generation is idempotent: unchanged answers + an active path with
 * lessons return that path untouched (no AI call, no quota, no writes -
 * an accidental duplicate click can never duplicate a path), and changed
 * answers REPLACE the active path's curriculum and lesson set.
 * createNewLearningPath() is the explicit counterpart: it always inserts
 * a NEW row, deactivates the previous active one, and the old path stays
 * fully intact and browsable in the learner's path library.
 *
 * Preferred video language (spec part 6): the onboarding answer is
 * persisted with the path and forwarded to the YouTube engine for both
 * querying and ranking. 'hinglish' is a first-class value: the engine
 * handles it with language-aware ranking instead of the API's
 * relevanceLanguage parameter (which only accepts BCP-47 codes).
 *
 * Video quality (spec parts 13-15): a video is attached only when it
 * clears a minimum relevance score. Weak results fall through to the
 * lesson's next query; a lesson whose every query came back weak or
 * empty is honestly 'unavailable' ("no strong video found yet") instead
 * of carrying an unrelated video.
 *
 * Failure semantics (parts 15, 32): the AI call happens before any
 * write, so an AI failure leaves the learner exactly where they were
 * (onboarding answers intact). A hard YouTube failure never fails
 * attachment: the path and its lessons stay persisted, untouched
 * lessons remain 'pending', and attachPathResources() can finish the
 * job later.
 *
 * Quota: queries per lesson are bounded by the AI contract
 * (CURRICULUM_LIMITS.searchQueriesMax = 5, tried best-first and
 * stopping at the first query with a strong result), and every call
 * goes through the engine's memory cache, database cache, and
 * single-flight coalescing.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { generateCurriculum } from "@/lib/ai/generate";
import type {
  AiCurriculum,
  AiCurriculumLesson,
  OnboardingProfile,
  VideoLanguage,
} from "@/lib/ai/curriculum";
import type { LearningLevel, ScoredLearningResource } from "@/lib/types";
import type { SearchItem } from "@/lib/user-state";
import { searchEducationalVideos } from "@/lib/youtube/service";
import { isYoutubeError } from "@/lib/youtube/errors";
import { LearningPathError } from "./errors";

// ---------------------------------------------------------------------------
// Database row shapes (column names as returned by PostgREST)
// ---------------------------------------------------------------------------

/** One row of learning_paths (migrations 20260909000000 + 20260910000000). */
export interface LearningPathRow {
  id: string;
  user_id: string;
  topic: string;
  current_level: string;
  daily_time: string;
  goal_type: string;
  video_language: string;
  title: string;
  description: string;
  goal: string;
  estimated_days: number;
  domain: string;
  subject: string;
  generated_model: string;
  // Final outcome columns (migration 20260911000000); '' / [] / 0 on
  // legacy paths generated before outcomes existed.
  outcome_kind: string;
  outcome_title: string;
  outcome_description: string;
  outcome_objective: string;
  outcome_requirements: string[];
  outcome_milestones: string[];
  outcome_expected_result: string;
  outcome_estimated_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of learning_path_lessons (migrations 20260909000000 + 20260910000000 + 20260911000000). */
export interface LearningPathLessonRow {
  id: string;
  path_id: string;
  /** Owning module (migration 20260911000000); null on legacy paths generated before modules existed. */
  module_id: string | null;
  lesson_order: number;
  title: string;
  description: string;
  topic: string;
  skill: string;
  level: string;
  estimated_minutes: number;
  prerequisites: string[];
  search_queries: string[];
  objective: string;
  concepts: string[];
  practical_outcome: string;
  practice_concept: string;
  goal_relevance: string;
  selected_resource_id: string | null;
  backup_resource_ids: string[];
  resource_status: string;
  last_resource_searched_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of learning_path_modules (migration 20260911000000): an ordered stage of a path. */
export interface LearningPathModuleRow {
  id: string;
  path_id: string;
  /** 1-based position within the path. */
  order_index: number;
  title: string;
  description: string;
  objective: string;
  estimated_minutes: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Safe, JSON-serializable summary returned to the API routes. */
export interface LearningPathGenerationResult {
  /** True when a new curriculum was generated; false when the existing path was reused or retried. */
  created: boolean;
  pathId: string;
  title: string;
  /** Ordered modules (stages) on the generated path (curriculum-structure spec parts 2-4). */
  moduleCount: number;
  /** Final outcome kind on the path; '' on legacy rows without one. */
  outcomeKind: string;
  lessonCount: number;
  resourcesFound: number;
  resourcesPending: number;
  resourcesUnavailable: number;
}

/** One entry of the learner's path library (spec part 16). */
export interface LearningPathListItem {
  id: string;
  title: string;
  subject: string;
  domain: string;
  /** Preferred video language persisted with the path (spec part 6). */
  videoLanguage: string;
  isActive: boolean;
  createdAt: string;
  lessonCount: number;
  completedLessonCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ranked videos requested per query: the pick plus backups. */
const SEARCH_LIMIT_PER_QUERY = 5;
/** Alternative videos stored next to the selected one. */
const MAX_BACKUP_RESOURCES = 3;
/**
 * Minimum relevance score (0-100, from the YouTube engine's ranking)
 * a video needs before it is attached to a lesson (spec parts 13-14:
 * never attach an unrelated or weak video - honest 'unavailable'
 * beats a wrong video).
 */
const MIN_RESOURCE_SCORE = 40;

const ONBOARDING_LEVELS: ReadonlySet<string> = new Set(["fresh", "basics", "building"]);
const ONBOARDING_DAILY_TIMES: ReadonlySet<string> = new Set(["15", "30", "60", "weekend"]);
const ONBOARDING_GOAL_TYPES: ReadonlySet<string> = new Set(["career", "job", "project", "curiosity"]);

const SAVE_FAILED_MESSAGE = "We could not save your learning path. Please try again.";
const LOAD_FAILED_MESSAGE = "We could not load your learning path. Please try again.";

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Video data attached to a lesson's selected resource. */
export interface ResourceSummary {
  id: string;
  title: string;
  description: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  url: string | null;
  /** Canonical YouTube video id (used by the existing YouTubeEmbed). */
  externalId: string | null;
}

/** One module (stage) of the path with its member lessons, display-ready. */
export interface LearningPathModule {
  id: string;
  /** 1-based position within the path. */
  orderIndex: number;
  title: string;
  description: string;
  objective: string;
  estimatedMinutes: number;
  /** The module's lessons in curriculum order. */
  lessons: LearningPathLessonRow[];
}

/**
 * The path's final outcome, display-ready. kind is the raw DB value ('' on
 * legacy paths generated before outcomes existed) - pages compare it
 * against the known kinds to label the outcome honestly.
 */
export interface FinalOutcome {
  kind: string;
  title: string;
  description: string;
  objective: string;
  requirements: string[];
  milestones: string[];
  expectedResult: string;
  estimatedMinutes: number;
}

/** The path plus ordered modules, lessons, and final outcome, ready for the display pages. */
export interface LearningPathOverview {
  path: LearningPathRow;
  /** Every lesson of the path in curriculum order (the flat list). */
  lessons: LearningPathLessonRow[];
  /** The path's modules with their member lessons; empty on legacy paths. */
  modules: LearningPathModule[];
  /** The path's final outcome; kind '' means a legacy path without one. */
  finalOutcome: FinalOutcome;
  /** Selected resource summaries keyed by lesson id (empty unless requested). */
  resourceById: Map<string, ResourceSummary>;
  /** First not-yet-completed lesson in curriculum order; null when all done. */
  nextLessonId: string | null;
  completedLessonCount: number;
}

/**
 * Generates (or idempotently returns) the learner's personalized ACTIVE
 * path: real onboarding answers -> AI curriculum -> persisted path and
 * ordered lessons. Every lesson is persisted with resource_status
 * 'pending'; attachPathResources() then attaches the videos in a second
 * request, so the UI can show each real stage as it happens (spec part 11).
 *
 * Idempotency (spec part 17): unchanged answers + an active path that
 * already has lessons return that path untouched - no AI call, no quota,
 * no writes. Changed answers replace the active path's curriculum and
 * lesson set in place. Use createNewLearningPath() for the explicit
 * "create a new path" action, which always inserts a separate row.
 *
 * Throws AiError when the curriculum provider fails (nothing is
 * persisted) and LearningPathError for onboarding/database problems. No
 * YouTube call happens here, so quota is only spent by
 * attachPathResources().
 */
export async function generateLearningPath(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningPathGenerationResult> {
  // The learner's REAL saved answers are the only personalization input.
  const profile = await loadOnboardingProfile(supabase, userId);

  // Idempotency: unchanged answers + an active path with lessons ->
  // return it untouched (no AI call, no quota, no writes). A path with
  // zero lessons (a generation interrupted between path write and lesson
  // insert) falls through and is regenerated.
  const existing = await loadActivePathData(supabase, userId);
  if (existing && existing.lessons.length > 0 && snapshotMatches(existing.path, profile)) {
    return summarize(existing.path, existing.modules, existing.lessons, false);
  }

  // AI curriculum. Runs before any write, so a failure here changes nothing.
  const { curriculum, model } = await generateCurriculum(profile);

  // Persist: update the active path in place (the learner regenerated
  // with changed answers) or insert the first active path. The partial
  // unique index (user_id where is_active) keeps one active path per
  // learner, so this can never duplicate a path.
  const path = existing
    ? await updateActivePath(supabase, existing.path.id, profile, curriculum, model)
    : await insertPath(supabase, userId, profile, curriculum, model);

  // Replace the whole curriculum: the final outcome lives on the path row
  // (written above), and the module + lesson sets are replaced below. The
  // (path_id, order_index) and (path_id, lesson_order) unique constraints
  // make duplicates impossible, and lessons/modules the new curriculum
  // dropped disappear. Completion state belongs to the old curriculum and
  // is intentionally reset when the answers changed. Other paths are never
  // touched (spec part 26: path isolation).
  const { modules, lessons } = await replaceCurriculum(supabase, path.id, curriculum);

  // Videos are attached by attachPathResources() (spec parts 7 and 8) in a
  // second request, so the UI can show each real stage as it happens.
  return summarize(path, modules, lessons, true);
}

/**
 * Explicitly creates a SECOND (or later) learning path for the learner
 * (spec part 17): always generates a fresh curriculum and inserts a NEW
 * learning_paths row, deactivating the previously active one. The old
 * path and its lessons are left fully intact for the path library -
 * this is the deliberate counterpart to the idempotent
 * generateLearningPath(), which reuses the active path on unchanged
 * answers.
 *
 * Throws AiError when the curriculum provider fails (nothing is
 * persisted - the previously active path stays active).
 */
export async function createNewLearningPath(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningPathGenerationResult> {
  const profile = await loadOnboardingProfile(supabase, userId);

  // AI curriculum. Runs before any write, so a failure here changes
  // nothing (the current active path keeps serving the learner).
  const { curriculum, model } = await generateCurriculum(profile);

  // The partial unique index (user_id where is_active) allows only one
  // active row, so deactivate the current one BEFORE inserting the new
  // active path. If the insert then fails, the learner honestly has no
  // active path until the next successful generation - never a mixed or
  // duplicated state.
  await deactivateActivePaths(supabase, userId);

  const path = await insertPath(supabase, userId, profile, curriculum, model);
  const { modules, lessons } = await replaceCurriculum(supabase, path.id, curriculum);

  return summarize(path, modules, lessons, true);
}

/**
 * Lists ALL of the learner's paths for the path library (spec part 16),
 * newest first, with per-path lesson and completion counts. Data is
 * user-scoped by RLS; this adds nothing the caller could not read.
 */
export async function listLearningPaths(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningPathListItem[]> {
  const { data: pathData, error: pathError } = await supabase
    .from("learning_paths")
    .select("id, title, subject, domain, is_active, video_language, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (pathError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "learning_paths list read failed", pathError);
  }
  const paths = (pathData ?? []) as Array<{
    id: string;
    title: string;
    subject: string;
    domain: string;
    is_active: boolean;
    video_language: string;
    created_at: string;
  }>;
  if (paths.length === 0) return [];

  const { data: lessonData, error: lessonError } = await supabase
    .from("learning_path_lessons")
    .select("path_id, completed_at")
    .in(
      "path_id",
      paths.map((path) => path.id),
    );
  if (lessonError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "learning_path_lessons list read failed", lessonError);
  }

  const stats = new Map<string, { total: number; completed: number }>();
  for (const row of (lessonData ?? []) as Array<{ path_id: string; completed_at: string | null }>) {
    const entry = stats.get(row.path_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (row.completed_at != null) entry.completed += 1;
    stats.set(row.path_id, entry);
  }

  return paths.map((path) => ({
    id: path.id,
    title: path.title,
    subject: path.subject,
    domain: path.domain,
    videoLanguage: path.video_language,
    isActive: path.is_active,
    createdAt: path.created_at,
    lessonCount: stats.get(path.id)?.total ?? 0,
    completedLessonCount: stats.get(path.id)?.completed ?? 0,
  }));
}

/**
 * Switches the learner's active path (spec part 16). The target must be
 * one of the caller's own paths - RLS enforces it, this checks it again.
 * After a switch every page (Journey, Learn, Progress, ...) operates on
 * the newly active path; the previous one stays intact for later.
 */
export async function setActiveLearningPath(
  supabase: SupabaseClient,
  userId: string,
  pathId: string,
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from("learning_paths")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (readError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "learning_paths active read failed", readError);
  }
  if (current?.id === pathId) return; // Already active: nothing to do.

  // Deactivate the other active row first: the partial unique index
  // (user_id where is_active) would reject a second active row.
  const { error: deactivateError } = await supabase
    .from("learning_paths")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true)
    .neq("id", pathId);
  if (deactivateError) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_paths deactivate failed", deactivateError);
  }

  // Activate the target. Scoping by user_id makes a foreign path affect
  // zero rows, which surfaces as the honest 404 below.
  const { data: activated, error: activateError } = await supabase
    .from("learning_paths")
    .update({ is_active: true })
    .eq("id", pathId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (activateError) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_paths activate failed", activateError);
  }
  if (!activated) {
    throw new LearningPathError(
      "not_found",
      "Learning path not found.",
      `path ${pathId} does not belong to user ${userId}`,
    );
  }
}

/**
 * Attaches videos to every lesson still 'pending' on the learner's
 * ACTIVE path through the existing YouTube engine. Called right after
 * generation and again whenever the learner retries (spec part 15: a
 * YouTube failure never blocks the path itself - the path persists and
 * attachment can finish later).
 *
 * 'unavailable' lessons are not retried - their queries were all
 * searched and the engine caches results, so an immediate retry cannot
 * change the outcome.
 */
export async function attachPathResources(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningPathGenerationResult> {
  const existing = await loadActivePathData(supabase, userId);
  if (!existing) {
    throw new LearningPathError(
      "not_found",
      "Create your learning path first.",
      `attach requested but no active learning_paths row exists for user ${userId}`,
    );
  }

  const videoLanguage = normalizeVideoLanguage(existing.path.video_language);
  const pending = existing.lessons.filter((lesson) => lesson.resource_status === "pending");
  if (pending.length > 0) {
    await attachResources(supabase, pending, videoLanguage);
  }
  return summarize(existing.path, existing.modules, existing.lessons, false);
}

/**
 * Loads the caller's ACTIVE path with its ordered modules, lessons, and
 * final outcome for the display pages (Journey, Learn, Progress,
 * Projects, Practice). Returns null when no active path exists yet -
 * pages render their empty states - and throws LearningPathError only
 * when the database itself fails. RLS scopes every row to the caller;
 * paths never mix (spec parts 16, 26).
 *
 * includeResource joins each lesson's selected learning_resources row so
 * the Learn page can offer the chosen video without a second lookup.
 */
export async function loadLearningPathOverview(
  supabase: SupabaseClient,
  userId: string,
  options: { includeResource?: boolean } = {},
): Promise<LearningPathOverview | null> {
  const loaded = await loadActivePathData(supabase, userId);
  if (!loaded) return null;

  let resourceById: Map<string, ResourceSummary> | null = null;
  if (options.includeResource) {
    resourceById = await loadResourceSummaries(supabase, loaded.lessons);
  }

  const nextLesson = loaded.lessons.find((lesson) => lesson.completed_at == null) ?? null;
  const completedCount = loaded.lessons.filter((lesson) => lesson.completed_at != null).length;

  // Module grouping (curriculum-structure spec parts 8-9): the ordered
  // lesson list is partitioned under its module rows. Lessons without a
  // module (legacy paths) stay out of every group, so those pages keep
  // rendering the flat list unchanged.
  const lessonsByModuleId = new Map<string, LearningPathLessonRow[]>();
  for (const lesson of loaded.lessons) {
    if (!lesson.module_id) continue;
    const group = lessonsByModuleId.get(lesson.module_id) ?? [];
    group.push(lesson);
    lessonsByModuleId.set(lesson.module_id, group);
  }
  const modules: LearningPathModule[] = loaded.modules.map((row) => ({
    id: row.id,
    orderIndex: row.order_index,
    title: row.title,
    description: row.description,
    objective: row.objective,
    estimatedMinutes: row.estimated_minutes,
    lessons: lessonsByModuleId.get(row.id) ?? [],
  }));

  // The final outcome travels on the path row; normalizePathRow already
  // coerced legacy rows to '' / [] so pages can branch on kind === "".
  const finalOutcome: FinalOutcome = {
    kind: loaded.path.outcome_kind,
    title: loaded.path.outcome_title,
    description: loaded.path.outcome_description,
    objective: loaded.path.outcome_objective,
    requirements: loaded.path.outcome_requirements,
    milestones: loaded.path.outcome_milestones,
    expectedResult: loaded.path.outcome_expected_result,
    estimatedMinutes: loaded.path.outcome_estimated_minutes,
  };

  return {
    path: loaded.path,
    lessons: loaded.lessons,
    modules,
    finalOutcome,
    resourceById: resourceById ?? new Map<string, ResourceSummary>(),
    nextLessonId: nextLesson?.id ?? null,
    completedLessonCount: completedCount,
  };
}

/**
 * Real content entries for the global search (spec part 35): every lesson
 * on the learner's ACTIVE path plus the path itself. Derived only from
 * persisted rows - never from sample data. Returns an empty list when the
 * learner has no active path; database failures throw LearningPathError
 * so callers can degrade to page-only search.
 */
export async function loadSearchItems(supabase: SupabaseClient, userId: string): Promise<SearchItem[]> {
  const loaded = await loadActivePathData(supabase, userId);
  if (!loaded) return [];

  const items: SearchItem[] = loaded.lessons.map((lesson) => ({
    title: lesson.title,
    kind: "Lesson",
    href: `/learn/${lesson.id}`,
    hint: lesson.skill.trim() || lesson.topic,
  }));
  items.push({
    title: loaded.path.title,
    kind: "Path",
    href: "/journey",
    hint: loaded.path.goal || loaded.path.description,
  });
  return items;
}

/**
 * Marks one lesson of the learner's ACTIVE path complete (or, with
 * completed = false, not complete). completed_at is the SINGLE progress
 * signal consumed by the existing Journey/Learn/Progress pages (spec
 * parts 13-14: there is deliberately no second progress system). The
 * lesson must sit on the caller's own active path - RLS enforces it,
 * this checks it again.
 */
export async function setLessonCompletion(
  supabase: SupabaseClient,
  userId: string,
  lessonId: string,
  completed: boolean,
): Promise<LearningPathLessonRow> {
  const existing = await loadActivePathData(supabase, userId);
  if (!existing) {
    throw new LearningPathError(
      "not_found",
      "Lesson not found.",
      `completion update requested but no active learning_paths row exists for user ${userId}`,
    );
  }

  const lesson = existing.lessons.find((row) => row.id === lessonId);
  if (!lesson) {
    // RLS would already hide another user's lesson (and lessons of the
    // learner's own INACTIVE paths); this guard keeps the honest 404
    // for anything not on the caller's active path.
    throw new LearningPathError(
      "not_found",
      "Lesson not found.",
      `lesson ${lessonId} is not on the active path of user ${userId}`,
    );
  }

  const completedAt = completed ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("learning_path_lessons")
    .update({ completed_at: completedAt })
    .eq("id", lessonId)
    .select()
    .single();

  if (error || !data) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_path_lessons completion update failed", error);
  }

  const updated = data as LearningPathLessonRow;
  lesson.completed_at = updated.completed_at;
  return updated;
}

// ---------------------------------------------------------------------------
// Onboarding + path loading
// ---------------------------------------------------------------------------

/** Loads the learner's real onboarding answers; the only personalization input. */
async function loadOnboardingProfile(supabase: SupabaseClient, userId: string): Promise<OnboardingProfile> {
  const { data, error } = await supabase
    .from("onboarding_profiles")
    .select("topic, current_level, daily_time, goal_type, video_language")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "onboarding_profiles read failed", error);
  }

  const row = data as
    | {
        topic: string | null;
        current_level: string | null;
        daily_time: string | null;
        goal_type: string | null;
        video_language: string | null;
      }
    | null;
  if (!row || !row.topic || !row.current_level || !row.daily_time || !row.goal_type) {
    throw new LearningPathError(
      "onboarding_missing",
      "Complete onboarding first - your path is built from your answers.",
      `no complete onboarding_profiles row for user ${userId}`,
    );
  }

  // The DB check constraints guarantee these sets; the guard keeps a
  // corrupted row from reaching the AI prompt.
  if (
    !ONBOARDING_LEVELS.has(row.current_level) ||
    !ONBOARDING_DAILY_TIMES.has(row.daily_time) ||
    !ONBOARDING_GOAL_TYPES.has(row.goal_type)
  ) {
    throw new LearningPathError(
      "unexpected",
      "Your learning profile has unexpected values. Please complete onboarding again.",
      `invalid onboarding values for user ${userId}: level="${row.current_level}" daily_time="${row.daily_time}" goal_type="${row.goal_type}"`,
    );
  }

  return {
    topic: row.topic,
    currentLevel: row.current_level as OnboardingProfile["currentLevel"],
    dailyTime: row.daily_time as OnboardingProfile["dailyTime"],
    goalType: row.goal_type as OnboardingProfile["goalType"],
    videoLanguage: normalizeVideoLanguage(row.video_language),
  };
}

/**
 * Loads the learner's ACTIVE path with its ordered modules and lessons;
 * null when no active path exists. The partial unique index (user_id where
 * is_active) guarantees at most one active row per learner.
 *
 * Outcome columns are normalized to their legacy defaults ('' / []) so
 * rows written before migration 20260911000000 keep rendering unchanged.
 */
async function loadActivePathData(
  supabase: SupabaseClient,
  userId: string,
): Promise<
  | { path: LearningPathRow; lessons: LearningPathLessonRow[]; modules: LearningPathModuleRow[] }
  | null
> {
  const { data: pathData, error: pathError } = await supabase
    .from("learning_paths")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (pathError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "learning_paths read failed", pathError);
  }
  if (!pathData) return null;
  const path = normalizePathRow(pathData as LearningPathRow);

  const { data: lessonData, error: lessonError } = await supabase
    .from("learning_path_lessons")
    .select("*")
    .eq("path_id", path.id)
    .order("lesson_order", { ascending: true });
  if (lessonError) {
    throw persistenceError(LOAD_FAILED_MESSAGE, "learning_path_lessons read failed", lessonError);
  }

  const { data: moduleData, error: moduleError } = await supabase
    .from("learning_path_modules")
    .select("*")
    .eq("path_id", path.id)
    .order("order_index", { ascending: true });
  if (moduleError) {
    // Non-fatal on purpose: paths generated before modules existed (and
    // databases that have not run migration 005 yet) still render their
    // flat lesson list - only the module grouping is lost. A missing
    // table is the one failure mode where degrading beats failing a page.
    console.error(`[learning-path] learning_path_modules read failed: ${describe(moduleError)}`);
    return { path, lessons: (lessonData ?? []) as LearningPathLessonRow[], modules: [] };
  }

  return {
    path,
    lessons: (lessonData ?? []) as LearningPathLessonRow[],
    modules: (moduleData ?? []) as LearningPathModuleRow[],
  };
}

/** Coerces nullable legacy outcome columns onto their documented defaults. */
function normalizePathRow(row: LearningPathRow): LearningPathRow {
  return {
    ...row,
    outcome_kind: row.outcome_kind ?? "",
    outcome_title: row.outcome_title ?? "",
    outcome_description: row.outcome_description ?? "",
    outcome_objective: row.outcome_objective ?? "",
    outcome_requirements: Array.isArray(row.outcome_requirements) ? row.outcome_requirements : [],
    outcome_milestones: Array.isArray(row.outcome_milestones) ? row.outcome_milestones : [],
    outcome_expected_result: row.outcome_expected_result ?? "",
    outcome_estimated_minutes: row.outcome_estimated_minutes ?? 0,
  };
}

/** True when the existing path was generated from exactly these answers. */
function snapshotMatches(path: LearningPathRow, profile: OnboardingProfile): boolean {
  return (
    path.topic === profile.topic &&
    path.current_level === profile.currentLevel &&
    path.daily_time === profile.dailyTime &&
    path.goal_type === profile.goalType &&
    path.video_language === profile.videoLanguage
  );
}

/** Maps a stored video_language onto the contract values; unknown/null -> 'any'. */
function normalizeVideoLanguage(value: string | null | undefined): VideoLanguage {
  return value === "en" || value === "hi" || value === "hinglish" ? value : "any";
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Deactivates the learner's currently active path(s) before a new active row. */
async function deactivateActivePaths(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("learning_paths")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_paths deactivate failed", error);
  }
}

/** Inserts a fresh active path row and returns it. */
async function insertPath(
  supabase: SupabaseClient,
  userId: string,
  profile: OnboardingProfile,
  curriculum: AiCurriculum,
  model: string,
): Promise<LearningPathRow> {
  const { data, error } = await supabase
    .from("learning_paths")
    .insert({
      user_id: userId,
      topic: profile.topic,
      current_level: profile.currentLevel,
      daily_time: profile.dailyTime,
      goal_type: profile.goalType,
      video_language: profile.videoLanguage,
      title: curriculum.title,
      description: curriculum.description,
      goal: curriculum.goal,
      estimated_days: curriculum.estimated_days,
      domain: curriculum.domain,
      subject: curriculum.subject,
      generated_model: model,
      ...outcomeColumns(curriculum),
      is_active: true,
    })
    .select()
    .single();

  if (error || !data) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_paths insert failed", error);
  }
  return data as LearningPathRow;
}

/** Updates the active path row in place with a regenerated curriculum. */
async function updateActivePath(
  supabase: SupabaseClient,
  pathId: string,
  profile: OnboardingProfile,
  curriculum: AiCurriculum,
  model: string,
): Promise<LearningPathRow> {
  const { data, error } = await supabase
    .from("learning_paths")
    .update({
      topic: profile.topic,
      current_level: profile.currentLevel,
      daily_time: profile.dailyTime,
      goal_type: profile.goalType,
      video_language: profile.videoLanguage,
      title: curriculum.title,
      description: curriculum.description,
      goal: curriculum.goal,
      estimated_days: curriculum.estimated_days,
      domain: curriculum.domain,
      subject: curriculum.subject,
      generated_model: model,
      ...outcomeColumns(curriculum),
      is_active: true,
    })
    .eq("id", pathId)
    .select()
    .single();

  if (error || !data) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_paths update failed", error);
  }
  return data as LearningPathRow;
}

/**
 * The final-outcome columns written onto the learning_paths row
 * (migration 20260911000000). The validated AiFinalOutcome mirrors the DB
 * check constraints exactly, so no truncation layer is needed.
 */
function outcomeColumns(curriculum: AiCurriculum) {
  return {
    outcome_kind: curriculum.final_outcome.kind,
    outcome_title: curriculum.final_outcome.title,
    outcome_description: curriculum.final_outcome.description,
    outcome_objective: curriculum.final_outcome.objective,
    outcome_requirements: curriculum.final_outcome.requirements,
    outcome_milestones: curriculum.final_outcome.milestones,
    outcome_expected_result: curriculum.final_outcome.expected_result,
    outcome_estimated_minutes: curriculum.final_outcome.estimated_minutes,
  };
}

/**
 * Replaces the path's whole curriculum (modules + lessons): delete the old
 * lesson rows, delete the old module rows, insert the new modules, then
 * insert the new lessons (all starting 'pending') with each lesson linked
 * to its module. The unique (path_id, order_index) and (path_id,
 * lesson_order) constraints make duplicates impossible, rows the new
 * curriculum dropped disappear, and other paths are never touched.
 *
 * This relies on the validator's contract: modules are numbered 1..M,
 * lessons 1..N across the WHOLE path, and each module's lessons form one
 * contiguous block - so flattening the modules in order yields the
 * global lesson sequence.
 */
async function replaceCurriculum(
  supabase: SupabaseClient,
  pathId: string,
  curriculum: AiCurriculum,
): Promise<{ modules: LearningPathModuleRow[]; lessons: LearningPathLessonRow[] }> {
  const { error: lessonDeleteError } = await supabase
    .from("learning_path_lessons")
    .delete()
    .eq("path_id", pathId);
  if (lessonDeleteError) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_path_lessons delete failed", lessonDeleteError);
  }

  const { error: moduleDeleteError } = await supabase
    .from("learning_path_modules")
    .delete()
    .eq("path_id", pathId);
  if (moduleDeleteError) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_path_modules delete failed", moduleDeleteError);
  }

  // Modules first: the lesson rows below reference their module ids, and
  // the assert_lesson_module_same_path trigger enforces the same-path link.
  const moduleRows = curriculum.modules.map((module) => ({
    path_id: pathId,
    order_index: module.order,
    title: module.title,
    description: module.description,
    objective: module.objective,
    estimated_minutes: module.estimated_minutes,
  }));
  const { data: moduleData, error: moduleError } = await supabase
    .from("learning_path_modules")
    .insert(moduleRows)
    .select();
  if (moduleError || !moduleData || moduleData.length !== moduleRows.length) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_path_modules insert failed", moduleError);
  }
  const modules = (moduleData as LearningPathModuleRow[]).slice().sort((a, b) => a.order_index - b.order_index);
  const moduleIdByOrder = new Map(modules.map((row) => [row.order_index, row.id]));

  // Flatten the modules into the global lesson sequence (validator:
  // lessons are numbered 1..N across the whole path, grouped by module).
  const flat: Array<{ moduleId: string; lesson: AiCurriculumLesson }> = [];
  for (const curriculumModule of curriculum.modules) {
    const moduleId = moduleIdByOrder.get(curriculumModule.order) ?? "";
    for (const lesson of curriculumModule.lessons) {
      flat.push({ moduleId, lesson });
    }
  }

  const lessonRows = flat.map(({ moduleId, lesson }) => ({
    path_id: pathId,
    module_id: moduleId,
    lesson_order: lesson.order,
    title: lesson.title,
    description: lesson.description,
    topic: lesson.topic,
    skill: lesson.skill,
    level: lesson.level,
    estimated_minutes: lesson.estimated_minutes,
    prerequisites: lesson.prerequisites,
    search_queries: lesson.search_queries,
    objective: lesson.objective,
    concepts: lesson.concepts,
    practical_outcome: lesson.practical_outcome,
    practice_concept: lesson.practice_concept,
    goal_relevance: lesson.goal_relevance,
    // Attachment happens right after insert; 'pending' is the honest start.
    resource_status: "pending" as const,
  }));

  const { data, error } = await supabase
    .from("learning_path_lessons")
    .insert(lessonRows)
    .select();
  if (error || !data || data.length !== lessonRows.length) {
    throw persistenceError(SAVE_FAILED_MESSAGE, "learning_path_lessons insert failed", error);
  }

  // PostgREST returns rows in arbitrary order; restore curriculum order.
  const inserted = data as LearningPathLessonRow[];
  const byOrder = new Map(inserted.map((row) => [row.lesson_order, row]));
  const ordered: LearningPathLessonRow[] = [];
  for (const { lesson } of flat) {
    const row = byOrder.get(lesson.order);
    if (row) ordered.push(row);
  }
  return { modules, lessons: ordered };
}

// ---------------------------------------------------------------------------
// Resource attachment (spec parts 7, 8, 11-15)
// ---------------------------------------------------------------------------

/** The outcome of trying to attach a video to one lesson. */
interface LessonResourceOutcome {
  selectedResourceId: string | null;
  backupResourceIds: string[];
  resourceStatus: "found" | "unavailable" | "pending";
  /** ISO timestamp of the search attempt (observability / retry backoff). */
  searchedAt: string;
}

/**
 * Searches and attaches a video for every given lesson through the EXISTING
 * YouTube engine, updating each lesson row as it goes. A hard engine failure
 * (config, quota, upstream) stops the loop and leaves the remaining lessons
 * 'pending' - it never fails the surrounding request.
 */
async function attachResources(
  supabase: SupabaseClient,
  lessons: LearningPathLessonRow[],
  videoLanguage: VideoLanguage,
): Promise<void> {
  let engineFailed = false;

  for (const lesson of lessons) {
    if (engineFailed) {
      // Never attempted: stays 'pending' with last_resource_searched_at null.
      continue;
    }

    try {
      const outcome = await attachLessonResource(supabase, lesson, videoLanguage);
      lesson.selected_resource_id = outcome.selectedResourceId;
      lesson.backup_resource_ids = outcome.backupResourceIds;
      lesson.resource_status = outcome.resourceStatus;
      lesson.last_resource_searched_at = outcome.searchedAt;
      await updateLessonResource(supabase, lesson.id, outcome);
    } catch (error) {
      if (!isYoutubeError(error)) throw error;
      console.error(
        `[learning-path] youtube engine failed while attaching lesson ${lesson.lesson_order}: ${error.message}`,
      );
      engineFailed = true;
      const searchedAt = new Date().toISOString();
      lesson.last_resource_searched_at = searchedAt;
      await updateLessonResource(supabase, lesson.id, {
        selectedResourceId: null,
        backupResourceIds: [],
        resourceStatus: "pending",
        searchedAt,
      });
    }
  }
}

/**
 * Runs one lesson's AI-written queries through the existing engine, best
 * query first, and attaches the best-ranked STRONG result (spec parts
 * 11-14). A result only counts when it is engine-persisted (it carries
 * the stable database id) AND clears MIN_RESOURCE_SCORE - a weak or
 * unrelated video is never attached. Weak or empty results move on to
 * the next query; a lesson whose every query came back weak or empty is
 * honestly 'unavailable'. The learner's preferred video language is
 * forwarded to the engine for both querying and ranking (spec part 6).
 * Only hard engine failures throw (YoutubeError).
 */
async function attachLessonResource(
  supabase: SupabaseClient,
  lesson: LearningPathLessonRow,
  videoLanguage: VideoLanguage,
): Promise<LessonResourceOutcome> {
  const searchedAt = new Date().toISOString();
  const queries = Array.isArray(lesson.search_queries) ? lesson.search_queries : [];
  // 'any' means no preference: let the engine search language-neutral.
  const language = videoLanguage === "any" ? undefined : videoLanguage;

  for (const query of queries) {
    const result = await searchEducationalVideos(supabase, {
      query,
      topic: lesson.topic || undefined,
      skill: lesson.skill || undefined,
      level: lesson.level as LearningLevel,
      language,
      limit: SEARCH_LIMIT_PER_QUERY,
    });

    // Only engine-persisted resources are attachable: they carry the stable
    // database id that learning_path_lessons.selected_resource_id expects.
    // The relevance threshold keeps unrelated videos off the path.
    const qualifying = result.results.filter(
      (item): item is ScoredLearningResource & { resource: { id: string } } =>
        typeof item.resource.id === "string" && item.relevanceScore >= MIN_RESOURCE_SCORE,
    );

    if (qualifying.length > 0) {
      return {
        selectedResourceId: qualifying[0].resource.id,
        backupResourceIds: qualifying
          .slice(1, MAX_BACKUP_RESOURCES + 1)
          .map((item) => item.resource.id),
        resourceStatus: "found",
        searchedAt,
      };
    }
    // Nothing strong enough for this query - fall through to the next one.
  }

  return {
    selectedResourceId: null,
    backupResourceIds: [],
    resourceStatus: "unavailable",
    searchedAt,
  };
}

/**
 * Persists one attach outcome. Non-fatal by design (mirrors the engine's
 * persist behavior): a failed update leaves the lesson 'pending', which a
 * later retry can fix. The path itself stays fully usable.
 */
async function updateLessonResource(
  supabase: SupabaseClient,
  lessonId: string,
  outcome: LessonResourceOutcome,
): Promise<void> {
  const { error } = await supabase
    .from("learning_path_lessons")
    .update({
      selected_resource_id: outcome.selectedResourceId,
      backup_resource_ids: outcome.backupResourceIds,
      resource_status: outcome.resourceStatus,
      last_resource_searched_at: outcome.searchedAt,
    })
    .eq("id", lessonId);

  if (error) {
    console.error(`[learning-path] resource update for lesson ${lessonId} failed: ${describe(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarize(
  path: LearningPathRow,
  modules: LearningPathModuleRow[],
  lessons: LearningPathLessonRow[],
  created: boolean,
): LearningPathGenerationResult {
  return {
    created,
    pathId: path.id,
    title: path.title,
    moduleCount: modules.length,
    outcomeKind: path.outcome_kind,
    lessonCount: lessons.length,
    resourcesFound: countByStatus(lessons, "found"),
    resourcesPending: countByStatus(lessons, "pending"),
    resourcesUnavailable: countByStatus(lessons, "unavailable"),
  };
}

function countByStatus(
  lessons: LearningPathLessonRow[],
  status: "found" | "pending" | "unavailable",
): number {
  return lessons.filter((lesson) => lesson.resource_status === status).length;
}

function persistenceError(safeMessage: string, context: string, error: PostgrestError | null): LearningPathError {
  return new LearningPathError("persistence", safeMessage, `${context}: ${describe(error)}`);
}

/**
 * Fetches the selected resources for a page render, keyed by LESSON id (the
 * documented LearningPathOverview contract); missing rows degrade to an
 * empty map so the page still renders lessons with their pending or
 * unavailable video states.
 */
async function loadResourceSummaries(
  supabase: SupabaseClient,
  lessons: LearningPathLessonRow[],
): Promise<Map<string, ResourceSummary>> {
  const byLessonId = new Map<string, ResourceSummary>();
  const wanted = lessons.filter(
    (lesson): lesson is LearningPathLessonRow & { selected_resource_id: string } =>
      typeof lesson.selected_resource_id === "string" && lesson.selected_resource_id.length > 0,
  );
  if (wanted.length === 0) return byLessonId;

  // Several lessons may share one resource; fetch each row once.
  const resourceIds = [...new Set(wanted.map((lesson) => lesson.selected_resource_id))];
  const { data, error } = await supabase
    .from("learning_resources")
    .select("id, title, description, channel_name, thumbnail_url, duration_seconds, url, external_id")
    .in("id", resourceIds);
  if (error) {
    // Non-fatal: the page still renders lessons; resources just show
    // their unavailable state.
    console.error(`[learning-path] learning_resources read failed: ${describe(error)}`);
    return byLessonId;
  }
  const byResourceId = new Map<string, ResourceSummary>();
  for (const row of (data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    channel_name: string | null;
    thumbnail_url: string | null;
    duration_seconds: number | null;
    url: string | null;
    external_id: string | null;
  }>) {
    byResourceId.set(row.id, {
      id: row.id,
      title: row.title,
      description: row.description,
      channelTitle: row.channel_name,
      thumbnailUrl: row.thumbnail_url,
      durationSeconds: row.duration_seconds,
      url: row.url,
      externalId: row.external_id,
    });
  }
  for (const lesson of wanted) {
    const resource = byResourceId.get(lesson.selected_resource_id);
    if (resource) byLessonId.set(lesson.id, resource);
  }
  return byLessonId;
}

function describe(error: PostgrestError | null): string {
  if (!error) return "unknown error";
  const parts = [error.message];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.details) parts.push(`details: ${error.details}`);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.join(" | ");
}
