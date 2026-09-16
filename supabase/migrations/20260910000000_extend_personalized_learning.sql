-- ============================================================================
-- LearningOS — Migration 004: personalized learning engine foundations
-- ----------------------------------------------------------------------------
-- EXTENDS the existing tables (nothing is recreated); the only thing removed
-- is the one-path-per-user UNIQUE constraint, replaced by an explicit
-- active-path mechanism. Supports the product spec:
--
--   PART 6   preferred video language for every learner
--   PART 7   richer AI lesson structure (objective, concepts, outcomes)
--   PART 8/9 AI-detected domain + subject per path
--   PART 16  multiple learning paths per learner (library, switching)
--   PART 17  active path marker; accidental-duplicate protection stays in
--            the service layer (onboarding snapshot comparison)
--   PART 33  extend existing tables, keep RLS, idempotent + non-destructive
--
-- Summary of changes:
--   onboarding_profiles
--     + video_language  'en' | 'hi' | 'hinglish' | 'any'
--   learning_paths
--     - learning_paths_user_id_key  (UNIQUE(user_id) blocked multiple paths)
--     + is_active       exactly one active path per user (partial unique idx)
--     + domain          AI-detected domain driving curriculum structure
--     + subject         AI-extracted subject, e.g. "Physics", "UI/UX design"
--     + video_language  language preference snapshot this path was built with
--   learning_path_lessons
--     + objective / concepts / practical_outcome / practice_concept /
--       goal_relevance
--
-- Existing columns already cover the rest of PART 33: prerequisites,
-- difficulty (level), estimated_minutes, search_queries, video status
-- (resource_status) and completion (completed_at).
--
-- Idempotent and non-destructive: IF EXISTS / IF NOT EXISTS everywhere,
-- additive columns only, RLS policies and grants intentionally untouched.
-- Apply like migrations 001-003 (Supabase SQL editor or supabase db push).
-- ============================================================================


-- ============================================================================
-- Section 1: onboarding_profiles — preferred video language (PART 6)
-- ----------------------------------------------------------------------------
-- The onboarding flow now asks which language the learner prefers for
-- videos. 'hinglish' is a first-class value even though it is not a BCP-47
-- code: the YouTube layer handles it with language-aware queries and
-- ranking instead of the API's relevanceLanguage parameter.
-- ============================================================================

alter table public.onboarding_profiles
  add column if not exists video_language text not null default 'any'
    constraint onboarding_profiles_video_language_allowed
    check (video_language in ('en', 'hi', 'hinglish', 'any'));

comment on column public.onboarding_profiles.video_language is
  'Preferred video language from onboarding: en, hi, hinglish, or any (no preference). Existing rows default to any.';


-- ============================================================================
-- Section 2: learning_paths — multiple paths per learner (PART 16/17)
-- ----------------------------------------------------------------------------
-- A learner may keep several paths; exactly one is active at a time and
-- every page operates on the active path. Accidental duplicate generation
-- is still prevented in the service layer: unchanged onboarding answers
-- return the existing path without calling the AI again.
-- ============================================================================

-- 2.1 Drop the one-path-per-user constraint (a constraint, not data).
alter table public.learning_paths
  drop constraint if exists learning_paths_user_id_key;

-- 2.2 Plain lookup index on user_id; the dropped constraint used to serve
--     this role for per-user queries.
create index if not exists learning_paths_user_id_idx
  on public.learning_paths (user_id);

-- 2.3 Active-path marker. Existing rows (at most one per user before this
--     migration) become active.
alter table public.learning_paths
  add column if not exists is_active boolean not null default true;

-- 2.4 Defensive backfill: keep only the newest path per user active so the
--     partial unique index below can be created even if this migration is
--     re-applied after manual edits.
update public.learning_paths as path
set is_active = false
where path.is_active
  and exists (
    select 1
    from public.learning_paths as newer
    where newer.user_id = path.user_id
      and (newer.created_at > path.created_at
        or (newer.created_at = path.created_at and newer.id > path.id))
  );

-- 2.5 Exactly one active path per user, enforced by the database.
create unique index if not exists learning_paths_one_active_per_user_idx
  on public.learning_paths (user_id)
  where is_active;

comment on column public.learning_paths.is_active is
  'The path all app pages currently operate on; exactly one per user (partial unique index learning_paths_one_active_per_user_idx).';


-- ============================================================================
-- Section 3: learning_paths — richer AI curriculum metadata (PART 7/8/9/33)
-- ============================================================================

alter table public.learning_paths
  add column if not exists domain text not null default 'other'
    constraint learning_paths_domain_allowed
    check (domain in ('academic', 'programming', 'language', 'exam-prep', 'creative', 'practical', 'other')),
  add column if not exists subject text not null default ''
    constraint learning_paths_subject_len check (char_length(subject) <= 120),
  add column if not exists video_language text not null default 'any'
    constraint learning_paths_video_language_allowed
    check (video_language in ('en', 'hi', 'hinglish', 'any'));

comment on column public.learning_paths.domain is
  'AI-detected domain that drives curriculum structure: academic, programming, language, exam-prep, creative, practical, other.';
comment on column public.learning_paths.subject is
  'AI-extracted subject of the path, e.g. "Physics", "UI/UX design", "English speaking".';
comment on column public.learning_paths.video_language is
  'Video language preference snapshot the path was generated with (mirrors onboarding_profiles at generation time).';

comment on table public.learning_paths is
  'Personalized learning paths generated from onboarding answers; a learner can keep several paths, exactly one active at a time.';


-- ============================================================================
-- Section 4: learning_path_lessons — richer lesson data (PART 7/18/19/33)
-- ============================================================================

alter table public.learning_path_lessons
  add column if not exists objective text not null default ''
    constraint learning_path_lessons_objective_len check (char_length(objective) <= 500),
  add column if not exists concepts jsonb not null default '[]'::jsonb,
  add column if not exists practical_outcome text not null default ''
    constraint learning_path_lessons_practical_outcome_len check (char_length(practical_outcome) <= 500),
  add column if not exists practice_concept text not null default ''
    constraint learning_path_lessons_practice_concept_len check (char_length(practice_concept) <= 300),
  add column if not exists goal_relevance text not null default ''
    constraint learning_path_lessons_goal_relevance_len check (char_length(goal_relevance) <= 300);

comment on column public.learning_path_lessons.objective is
  'What the learner will be able to do after this lesson (AI-provided).';
comment on column public.learning_path_lessons.concepts is
  'JSON array of key concept strings this lesson covers (AI-provided); consumed by the Skill Map.';
comment on column public.learning_path_lessons.practical_outcome is
  'Concrete practical result of the lesson (AI-provided).';
comment on column public.learning_path_lessons.practice_concept is
  'What the Practice page should drill for this lesson (AI-provided).';
comment on column public.learning_path_lessons.goal_relevance is
  'Why this lesson matters for the learner''s stated goal (AI-provided).';


-- ============================================================================
-- Section 5: RLS / grants — intentionally unchanged
-- ----------------------------------------------------------------------------
-- Every policy from migrations 001/003 already scopes rows to auth.uid()
-- (directly on learning_paths, via an exists() subquery on lessons), and
-- adding columns does not affect them. Re-stating policies here would only
-- risk drift, so this migration touches no policies and no grants.
-- ============================================================================
