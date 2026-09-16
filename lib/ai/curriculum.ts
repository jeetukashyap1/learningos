/**
 * Curriculum contract between the NVIDIA model and LearningOS.
 *
 * The shape mirrors the integration spec exactly (snake_case field names
 * included): the model must answer with a single JSON object containing
 * title/description/goal/estimated_days/domain/subject, an ordered modules
 * array where every module is a real stage of the subject and contains that
 * stage's ordered lessons (each carrying the YouTube search queries the
 * existing engine will run later), and a final_outcome object describing the
 * domain-appropriate culmination of the path. The model decides the
 * curriculum; it never picks videos.
 *
 * The contract is domain-agnostic: LearningOS serves ANY student (academic
 * subjects, spoken languages, exam prep, creative skills, programming...),
 * so the model reports the detected domain and subject alongside the
 * modules, and every lesson carries the richer structure (objective,
 * concepts, practical outcome, practice concept, goal relevance) the app
 * renders on the Journey/Learn/Skills/Practice pages. Lesson order is
 * global across the whole path (the DB uniqueness is (path_id,
 * lesson_order)); modules partition that sequence into contiguous stages.
 */

import type { LearningLevel } from "@/lib/types";

/** Onboarding answers, exactly as persisted (check-constrained ids). */
export type OnboardingLevel = "fresh" | "basics" | "building";
export type OnboardingDailyTime = "15" | "30" | "60" | "weekend";
export type OnboardingGoalType = "career" | "job" | "project" | "curiosity";

/**
 * Preferred video language (PART 6). Extensible model: 'hinglish' is a
 * first-class value even though it is not a BCP-47 code - the YouTube
 * layer handles it with language-aware queries and ranking instead of the
 * API's relevanceLanguage parameter. 'any' = no preference.
 */
export type VideoLanguage = "en" | "hi" | "hinglish" | "any";

export const VIDEO_LANGUAGES: readonly VideoLanguage[] = ["en", "hi", "hinglish", "any"] as const;

/**
 * AI-detected learning domain (PART 9). Determined before generation and
 * persisted with the path; drives curriculum structure and downstream
 * validation (programming terminology is rejected in other domains).
 */
export type LearningDomain =
  | "academic"
  | "programming"
  | "language"
  | "exam-prep"
  | "creative"
  | "practical"
  | "other";

export const LEARNING_DOMAINS: readonly LearningDomain[] = [
  "academic",
  "programming",
  "language",
  "exam-prep",
  "creative",
  "practical",
  "other",
] as const;

/** The learner's saved onboarding answers - the ONLY personalization input. */
export interface OnboardingProfile {
  topic: string;
  currentLevel: OnboardingLevel;
  dailyTime: OnboardingDailyTime;
  goalType: OnboardingGoalType;
  videoLanguage: VideoLanguage;
}

/** One lesson as returned by the model (snake_case = AI contract). */
export interface AiCurriculumLesson {
  order: number;
  title: string;
  description: string;
  topic: string;
  skill: string;
  level: LearningLevel;
  estimated_minutes: number;
  prerequisites: string[];
  search_queries: string[];
  objective: string;
  concepts: string[];
  practical_outcome: string;
  practice_concept: string;
  goal_relevance: string;
}

/**
 * Kind of the path's final outcome. The values mirror the DB check
 * constraint on learning_paths.outcome_kind (20260911000000) exactly, so a
 * validated outcome can always be persisted without translation.
 */
export type AiOutcomeKind =
  | "project"
  | "assessment"
  | "mock-exam"
  | "mock-interview"
  | "case-study"
  | "presentation"
  | "portfolio"
  | "other";

export const AI_OUTCOME_KINDS: readonly AiOutcomeKind[] = [
  "project",
  "assessment",
  "mock-exam",
  "mock-interview",
  "case-study",
  "presentation",
  "portfolio",
  "other",
] as const;

/** One module (stage) as returned by the model: metadata + its lessons. */
export interface AiCurriculumModule {
  order: number;
  title: string;
  description: string;
  objective: string;
  estimated_minutes: number;
  lessons: AiCurriculumLesson[];
}

/**
 * The final outcome of the path: the domain-appropriate culmination the
 * learner works toward (a project for build goals, an assessment or mock
 * exam for academic/exam goals, a mock interview for spoken-language or
 * interview goals, a case study for design goals...). Never a forced
 * "project" - the kind must fit the domain.
 */
export interface AiFinalOutcome {
  kind: AiOutcomeKind;
  title: string;
  description: string;
  objective: string;
  requirements: string[];
  milestones: string[];
  expected_result: string;
  estimated_minutes: number;
}

/** The full curriculum as returned by the model. */
export interface AiCurriculum {
  title: string;
  description: string;
  goal: string;
  estimated_days: number;
  domain: LearningDomain;
  subject: string;
  modules: AiCurriculumModule[];
  final_outcome: AiFinalOutcome;
}

/**
 * Bounds enforced by validate.ts. They mirror the DB check constraints in
 * 20260909000000_create_learning_paths.sql,
 * 20260910000000_extend_personalized_learning.sql and
 * 20260911000000_add_modules_and_final_outcome.sql so a validated
 * curriculum can always be persisted without a second truncation layer.
 */
export const CURRICULUM_LIMITS = {
  pathTitleMin: 3,
  pathTitleMax: 150,
  pathDescriptionMax: 1000,
  pathGoalMax: 500,
  estimatedDaysMin: 1,
  estimatedDaysMax: 365,
  lessonCountMin: 4,
  lessonCountMax: 12,
  lessonTitleMin: 3,
  lessonTitleMax: 150,
  lessonDescriptionMax: 2000,
  lessonTopicMax: 120,
  lessonSkillMax: 120,
  estimatedMinutesMin: 1,
  estimatedMinutesMax: 600,
  prerequisitesMax: 8,
  prerequisiteLengthMax: 150,
  searchQueriesMin: 1,
  searchQueriesMax: 5,
  searchQueryLengthMin: 3,
  searchQueryLengthMax: 120,
  subjectMax: 120,
  objectiveMax: 500,
  conceptsMin: 1,
  conceptsMax: 8,
  conceptLengthMax: 120,
  practicalOutcomeMax: 500,
  practiceConceptMax: 300,
  goalRelevanceMax: 300,
  // Modules + final outcome (20260911000000_add_modules_and_final_outcome.sql).
  moduleCountMin: 2,
  moduleCountMax: 10,
  moduleTitleMin: 3,
  moduleTitleMax: 150,
  moduleDescriptionMax: 1000,
  moduleObjectiveMax: 500,
  moduleEstimatedMinutesMax: 10000,
  outcomeTitleMin: 3,
  outcomeTitleMax: 150,
  outcomeDescriptionMax: 1000,
  outcomeObjectiveMax: 500,
  outcomeRequirementsMin: 1,
  outcomeRequirementsMax: 8,
  outcomeRequirementLengthMax: 300,
  outcomeMilestonesMin: 1,
  outcomeMilestonesMax: 8,
  outcomeMilestoneLengthMax: 300,
  outcomeExpectedResultMax: 500,
  outcomeEstimatedMinutesMax: 10000,
} as const;
