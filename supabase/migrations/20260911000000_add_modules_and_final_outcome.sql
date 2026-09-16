-- ============================================================================
-- LearningOS — Migration 005: curriculum structure — modules + final outcome
-- ----------------------------------------------------------------------------
-- ADDS the real curriculum hierarchy the product spec describes:
--
--   Learning Goal → Path → Modules → Lessons → Practice → Final Outcome
--
-- Nothing existing is recreated or dropped; every change is additive.
-- Supports the curriculum-structure spec:
--
--   PART 2/3   modules/stages between the path and its lessons, and a
--              domain-appropriate final outcome (project, assessment, mock
--              interview, case study, ...) — never a forced universal project
--   PART 4     normalized model: learning_paths → learning_path_modules →
--              learning_path_lessons; final outcome structure on the path
--   PART 5     the outcome kind is explicit so the UI labels it honestly
--   PART 14    every path carries its own modules/outcome (path_id scoping)
--   PART 15    existing paths stay intact: module_id is nullable and the
--              outcome columns default to empty, so legacy paths keep working
--
-- Summary of changes:
--   learning_path_modules (new table)
--     id / path_id / order_index / title / description / objective /
--     estimated_minutes — one ordered stage of a path
--   learning_path_lessons
--     + module_id  nullable FK to learning_path_modules (null = legacy path
--       generated before modules existed); a guard trigger enforces that a
--       lesson can only reference a module of its OWN path
--   learning_paths
--     + outcome_kind / outcome_title / outcome_description /
--       outcome_objective / outcome_requirements / outcome_milestones /
--       outcome_expected_result / outcome_estimated_minutes
--
-- Module progress and outcome readiness are NOT stored — they are derived
-- from real lesson completion (spec PART 9/13), so no status column exists.
--
-- Idempotent and non-destructive: IF EXISTS / IF NOT EXISTS everywhere,
-- additive columns only. Apply like migrations 001-004 (Supabase SQL editor
-- or supabase db push).
-- ============================================================================


-- ============================================================================
-- Section 1: learning_path_modules — ordered stages of a path (PART 2/3/4)
-- ----------------------------------------------------------------------------
-- A module groups the lessons of one stage (e.g. "JavaScript Foundations",
-- "React Fundamentals", "Mechanics", "Thermal Physics"). Modules die with
-- their path, exactly like lessons. Re-generation replaces the module set of
-- a path by (path_id, order_index), never duplicating.
-- ============================================================================

create table if not exists public.learning_path_modules (
  id uuid primary key default gen_random_uuid(),
  -- Owning path; modules die with it.
  path_id uuid not null references public.learning_paths(id) on delete cascade,
  -- 1-based position within the path.
  order_index integer not null check (order_index >= 1),
  -- AI-generated module content.
  title text not null check (char_length(title) between 3 and 150),
  description text not null default '' check (char_length(description) <= 1000),
  objective text not null default '' check (char_length(objective) <= 500),
  -- Sum of the module's lesson minutes (AI-provided, display-only).
  estimated_minutes integer not null default 0 check (estimated_minutes between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Re-generation replaces modules by position; never duplicates.
  constraint learning_path_modules_path_order_key unique (path_id, order_index)
);

comment on table public.learning_path_modules is
  'Ordered modules (stages) of a learning path, generated with the curriculum; lessons link to their module through learning_path_lessons.module_id.';

comment on constraint learning_path_modules_path_order_key on public.learning_path_modules is
  'One module per position per path: re-generation upserts by (path_id, order_index) and cannot duplicate.';

comment on column public.learning_path_modules.objective is
  'What the learner can do once this stage is complete (AI-provided).';

comment on column public.learning_path_modules.estimated_minutes is
  'AI-estimated total minutes for the module''s lessons; progress itself is derived from lesson completion, never stored here.';

create index if not exists learning_path_modules_path_id_idx
  on public.learning_path_modules (path_id);

-- updated_at maintenance (same house function as the other tables).
drop trigger if exists set_learning_path_modules_updated_at on public.learning_path_modules;
create trigger set_learning_path_modules_updated_at
  before update on public.learning_path_modules
  for each row execute function public.set_updated_at();

-- Row Level Security: a learner can only touch modules of their own path.
-- The exists() subquery checks ownership through learning_paths, whose own
-- RLS select policy is applied to the invoking user, so only real owners pass.
alter table public.learning_path_modules enable row level security;

drop policy if exists "learning_path_modules_select" on public.learning_path_modules;
create policy "learning_path_modules_select"
  on public.learning_path_modules
  for select
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_modules.path_id
      and p.user_id = auth.uid()
  ));

drop policy if exists "learning_path_modules_insert" on public.learning_path_modules;
create policy "learning_path_modules_insert"
  on public.learning_path_modules
  for insert
  to authenticated
  with check (exists (
    select 1 from public.learning_paths p
    where p.id = path_id
      and p.user_id = auth.uid()
  ));

drop policy if exists "learning_path_modules_update" on public.learning_path_modules;
create policy "learning_path_modules_update"
  on public.learning_path_modules
  for update
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_modules.path_id
      and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_modules.path_id
      and p.user_id = auth.uid()
  ));

-- Delete lets re-generation replace the module set of a path.
drop policy if exists "learning_path_modules_delete" on public.learning_path_modules;
create policy "learning_path_modules_delete"
  on public.learning_path_modules
  for delete
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_modules.path_id
      and p.user_id = auth.uid()
  ));

revoke all on public.learning_path_modules from anon;
grant select, insert, update, delete on public.learning_path_modules to authenticated;


-- ============================================================================
-- Section 2: learning_path_lessons.module_id — the lesson→module link (PART 4)
-- ----------------------------------------------------------------------------
-- Nullable on purpose (spec PART 15): paths generated before this migration
-- keep their lessons untouched and simply render without module grouping.
-- ON DELETE SET NULL mirrors that safety: deleting a module never deletes a
-- lesson. A guard trigger additionally enforces that a lesson can only point
-- at a module of its OWN path, so paths can never be cross-linked.
-- ============================================================================

alter table public.learning_path_lessons
  add column if not exists module_id uuid references public.learning_path_modules(id) on delete set null;

comment on column public.learning_path_lessons.module_id is
  'learning_path_modules.id of the stage this lesson belongs to; null for legacy paths generated before modules existed.';

create index if not exists learning_path_lessons_module_id_idx
  on public.learning_path_lessons (module_id);

-- Guard: module_id must reference a module of the same path. Runs with the
-- privileges of the table owner, so the check cannot be bypassed through RLS.
create or replace function public.assert_lesson_module_same_path()
returns trigger
language plpgsql
as $$
begin
  if new.module_id is not null then
    if not exists (
      select 1
      from public.learning_path_modules m
      where m.id = new.module_id
        and m.path_id = new.path_id
    ) then
      raise exception 'learning_path_lessons.module_id must reference a module of the same path';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assert_lesson_module_same_path on public.learning_path_lessons;
create trigger assert_lesson_module_same_path
  before insert or update of module_id, path_id on public.learning_path_lessons
  for each row execute function public.assert_lesson_module_same_path();


-- ============================================================================
-- Section 3: learning_paths — the domain-appropriate final outcome (PART 3/5)
-- ----------------------------------------------------------------------------
-- The final outcome is part of the path itself (one per path). The kind is
-- explicit so the UI can label it honestly — PROJECT for a build, FINAL
-- ASSESSMENT for academic mastery, MOCK EXAM for exam prep, MOCK INTERVIEW
-- for speaking, CASE STUDY for design, PRESENTATION / PORTFOLIO / other
-- where those fit. '' means a legacy path generated before outcomes existed.
-- Requirements and milestones are JSON arrays of short strings (AI-provided).
-- Outcome readiness is derived from lesson completion, never stored.
-- ============================================================================

alter table public.learning_paths
  add column if not exists outcome_kind text not null default ''
    constraint learning_paths_outcome_kind_allowed
    check (outcome_kind in ('', 'project', 'assessment', 'mock-exam', 'mock-interview', 'case-study', 'presentation', 'portfolio', 'other')),
  add column if not exists outcome_title text not null default ''
    constraint learning_paths_outcome_title_len check (char_length(outcome_title) <= 150),
  add column if not exists outcome_description text not null default ''
    constraint learning_paths_outcome_description_len check (char_length(outcome_description) <= 1000),
  add column if not exists outcome_objective text not null default ''
    constraint learning_paths_outcome_objective_len check (char_length(outcome_objective) <= 500),
  add column if not exists outcome_requirements jsonb not null default '[]'::jsonb,
  add column if not exists outcome_milestones jsonb not null default '[]'::jsonb,
  add column if not exists outcome_expected_result text not null default ''
    constraint learning_paths_outcome_expected_result_len check (char_length(outcome_expected_result) <= 500),
  add column if not exists outcome_estimated_minutes integer not null default 0
    constraint learning_paths_outcome_estimated_minutes_range
    check (outcome_estimated_minutes between 0 and 10000);

comment on column public.learning_paths.outcome_kind is
  'Domain-appropriate final outcome kind: project, assessment, mock-exam, mock-interview, case-study, presentation, portfolio, other; empty for legacy paths.';
comment on column public.learning_paths.outcome_title is
  'Title of the final outcome (AI-provided), e.g. "Capstone: build a small React app" or "Board-style final assessment".';
comment on column public.learning_paths.outcome_description is
  'What the final outcome is and why it fits this goal (AI-provided).';
comment on column public.learning_paths.outcome_objective is
  'What completing the outcome proves about the learner (AI-provided).';
comment on column public.learning_paths.outcome_requirements is
  'JSON array of requirement strings the outcome must satisfy (AI-provided).';
comment on column public.learning_paths.outcome_milestones is
  'JSON array of milestone strings marking progress through the outcome (AI-provided).';
comment on column public.learning_paths.outcome_expected_result is
  'What exists / happens when the outcome is done (AI-provided).';
comment on column public.learning_paths.outcome_estimated_minutes is
  'AI-estimated minutes for the outcome; 0 = not specified.';


-- ============================================================================
-- Section 4: RLS / grants — existing policies intentionally unchanged
-- ----------------------------------------------------------------------------
-- learning_paths and learning_path_lessons policies from migrations 003/004
-- already scope every row to auth.uid() (directly, and via the exists()
-- subquery respectively); adding the module_id column does not affect them.
-- The new learning_path_modules policies in Section 1 follow the exact same
-- pattern, and the anon role stays revoked on every table touched here.
-- ============================================================================
