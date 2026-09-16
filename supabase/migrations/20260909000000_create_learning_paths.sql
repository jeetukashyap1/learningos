-- LearningOS: AI-generated personalized learning paths.
--
-- Purpose:
--   learning_paths        - one personalized curriculum per learner, generated
--                           from their onboarding answers by the NVIDIA NIM
--                           curriculum model and persisted server-side.
--   learning_path_lessons - the ordered lessons of a path, carrying the
--                           AI-provided YouTube search queries and the video
--                           attached by the existing YouTube learning engine.
--
-- Design notes:
--   - One active path per user: learning_paths.user_id is UNIQUE, so repeated
--     "Create Your Path" clicks can never duplicate paths. Re-generation
--     upserts the single path row and replaces its lesson set.
--   - Lessons belong to exactly one path (cascade delete) and are unique per
--     (path_id, lesson_order), so re-generation never duplicates lessons.
--   - Videos are NOT copied here: lessons reference the shared
--     learning_resources catalog (selected_resource_id + backup ids), so the
--     existing engine stays the only component that talks to YouTube and the
--     per-video rows remain deduplicated.
--   - resource_status tracks video attachment separately from lesson
--     completion: 'pending' (not searched yet, e.g. YouTube was unavailable
--     during generation and the route can retry), 'found' (video attached),
--     'unavailable' (all queries searched, nothing usable).
--   - Lesson completion (completed_at) is the single progress signal consumed
--     by the existing Journey/Learn/Progress pages. There is deliberately no
--     second progress system.
--   - The onboarding snapshot columns (topic/current_level/daily_time/
--     goal_type) mirror onboarding_profiles and let generation detect
--     unchanged answers and return the existing path (idempotency), and let
--     the UI explain why the path looks the way it does.
--   - Idempotent and non-destructive, matching the migration style of
--     20260907000000_create_profiles_and_onboarding.sql and
--     20260908000000_create_learning_resources.sql.

-- ---------------------------------------------------------------------------
-- Shared trigger function: set_updated_at()
-- ---------------------------------------------------------------------------

-- Already created by the first migration; created here as well so this file
-- can also be applied standalone. "or replace" keeps it idempotent.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- learning_paths: one personalized curriculum per learner
-- ---------------------------------------------------------------------------

create table if not exists public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  -- Owner. UNIQUE: one active path per learner, forever.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Onboarding snapshot the path was generated from (mirrors
  -- onboarding_profiles checks) so re-generation can detect unchanged
  -- answers and the UI can personalize copy.
  topic text not null check (char_length(topic) between 1 and 120),
  current_level text not null check (current_level in ('fresh', 'basics', 'building')),
  daily_time text not null check (daily_time in ('15', '30', '60', 'weekend')),
  goal_type text not null check (goal_type in ('career', 'job', 'project', 'curiosity')),
  -- AI-generated curriculum content.
  title text not null check (char_length(title) between 3 and 150),
  description text not null default '' check (char_length(description) <= 1000),
  goal text not null default '' check (char_length(goal) <= 500),
  estimated_days integer not null default 7 check (estimated_days between 1 and 365),
  -- Which NVIDIA model produced this curriculum (observability only).
  generated_model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_paths_user_id_key unique (user_id)
);

comment on table public.learning_paths is
  'Personalized learning path generated from a learner''s onboarding answers; one active path per user.';

comment on constraint learning_paths_user_id_key on public.learning_paths is
  'One path per learner: repeated generation replaces the row, it can never duplicate paths.';

-- The unique user_id constraint doubles as the per-user lookup index.

-- updated_at maintenance (drop + create keeps re-runs safe).
drop trigger if exists set_learning_paths_updated_at on public.learning_paths;
create trigger set_learning_paths_updated_at
  before update on public.learning_paths
  for each row execute function public.set_updated_at();

-- Row Level Security: strictly user-scoped rows, no anon access.
alter table public.learning_paths enable row level security;

drop policy if exists "learning_paths_select" on public.learning_paths;
create policy "learning_paths_select"
  on public.learning_paths
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "learning_paths_insert" on public.learning_paths;
create policy "learning_paths_insert"
  on public.learning_paths
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "learning_paths_update" on public.learning_paths;
create policy "learning_paths_update"
  on public.learning_paths
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete lets re-generation replace a path (and cascade its lessons).
drop policy if exists "learning_paths_delete" on public.learning_paths;
create policy "learning_paths_delete"
  on public.learning_paths
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.learning_paths from anon;
grant select, insert, update, delete on public.learning_paths to authenticated;

-- ---------------------------------------------------------------------------
-- learning_path_lessons: ordered lessons of a path
-- ---------------------------------------------------------------------------

create table if not exists public.learning_path_lessons (
  id uuid primary key default gen_random_uuid(),
  -- Owning path; lessons die with it.
  path_id uuid not null references public.learning_paths(id) on delete cascade,
  -- 1-based position within the path.
  lesson_order integer not null check (lesson_order >= 1),
  -- AI-generated lesson content.
  title text not null check (char_length(title) between 3 and 150),
  description text not null default '' check (char_length(description) <= 2000),
  topic text not null default '' check (char_length(topic) <= 120),
  skill text not null default '' check (char_length(skill) <= 120),
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  estimated_minutes integer not null default 15 check (estimated_minutes between 1 and 600),
  -- Earlier lesson titles this lesson builds on (AI-provided, display-only).
  prerequisites jsonb not null default '[]'::jsonb,
  -- AI-written YouTube search queries, best first; consumed by the existing
  -- YouTube learning engine (searchEducationalVideos) at generation time and
  -- kept for later retries.
  search_queries jsonb not null default '[]'::jsonb,
  -- Video attached by the existing engine: the best result for the best
  -- query that returned something.
  selected_resource_id uuid references public.learning_resources(id) on delete set null,
  -- Next-best results for the same lesson, shown as alternatives.
  backup_resource_ids uuid[] not null default '{}',
  -- Attachment state, independent of completion:
  resource_status text not null default 'pending' check (resource_status in ('pending', 'found', 'unavailable')),
  -- When the engine last tried to attach a video (retry backoff/observability).
  last_resource_searched_at timestamptz,
  -- Completion in the existing learning flow; null = not completed yet.
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Re-generation replaces lessons by position; never duplicates.
  constraint learning_path_lessons_path_order_key unique (path_id, lesson_order)
);

comment on table public.learning_path_lessons is
  'Ordered lessons of a learning path with the AI-provided YouTube search queries and the video attached by the existing YouTube engine.';

comment on constraint learning_path_lessons_path_order_key on public.learning_path_lessons is
  'One lesson per position per path: re-generation upserts by (path_id, lesson_order) and cannot duplicate.';

comment on column public.learning_path_lessons.search_queries is
  'JSON array of query strings (best first) written by the curriculum model for the YouTube engine.';

comment on column public.learning_path_lessons.selected_resource_id is
  'learning_resources.id of the best video found by the existing engine; null while pending/unavailable.';

create index if not exists learning_path_lessons_path_id_idx
  on public.learning_path_lessons (path_id);

create index if not exists learning_path_lessons_selected_resource_id_idx
  on public.learning_path_lessons (selected_resource_id);

-- updated_at maintenance.
drop trigger if exists set_learning_path_lessons_updated_at on public.learning_path_lessons;
create trigger set_learning_path_lessons_updated_at
  before update on public.learning_path_lessons
  for each row execute function public.set_updated_at();

-- Row Level Security: a learner can only touch lessons of their own path.
-- The exists() subquery checks ownership through learning_paths, whose own
-- RLS select policy is applied to the invoking user, so only real owners pass.
alter table public.learning_path_lessons enable row level security;

drop policy if exists "learning_path_lessons_select" on public.learning_path_lessons;
create policy "learning_path_lessons_select"
  on public.learning_path_lessons
  for select
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_lessons.path_id
      and p.user_id = auth.uid()
  ));

drop policy if exists "learning_path_lessons_insert" on public.learning_path_lessons;
create policy "learning_path_lessons_insert"
  on public.learning_path_lessons
  for insert
  to authenticated
  with check (exists (
    select 1 from public.learning_paths p
    where p.id = path_id
      and p.user_id = auth.uid()
  ));

drop policy if exists "learning_path_lessons_update" on public.learning_path_lessons;
create policy "learning_path_lessons_update"
  on public.learning_path_lessons
  for update
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_lessons.path_id
      and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_lessons.path_id
      and p.user_id = auth.uid()
  ));

-- Delete lets re-generation replace the lesson set of the single path row.
drop policy if exists "learning_path_lessons_delete" on public.learning_path_lessons;
create policy "learning_path_lessons_delete"
  on public.learning_path_lessons
  for delete
  to authenticated
  using (exists (
    select 1 from public.learning_paths p
    where p.id = learning_path_lessons.path_id
      and p.user_id = auth.uid()
  ));

revoke all on public.learning_path_lessons from anon;
grant select, insert, update, delete on public.learning_path_lessons to authenticated;
