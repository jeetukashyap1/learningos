-- ============================================================================
-- LearningOS — Migration 001: profiles + onboarding_profiles (Phase 2.1)
-- ----------------------------------------------------------------------------
-- Creates the minimal database foundation for real authentication:
--   * public.profiles            — one row per Supabase Auth user
--   * public.onboarding_profiles — answers from the 5-step onboarding flow
--   * Row Level Security         — users can only access their own rows
--   * Triggers                   — auto-provision profiles, maintain updated_at
--
-- How to apply (choose one):
--   1. Supabase Dashboard -> SQL Editor -> paste this file -> Run
--   2. Supabase CLI with this file in supabase/migrations: supabase db push
--
-- The migration is idempotent: every statement uses IF NOT EXISTS,
-- CREATE OR REPLACE, or DROP ... IF EXISTS, so re-running is safe.
-- It is also non-destructive: no existing table or column is dropped.
-- ============================================================================


-- ============================================================================
-- Section 1: shared updated_at trigger function
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- Section 2: profiles
-- ----------------------------------------------------------------------------
-- id mirrors auth.users(id) so ownership is provable with auth.uid() = id.
-- Email is intentionally NOT stored here; it lives in auth.users and is read
-- from the authenticated user object. No password or token material is ever
-- stored in this schema.
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user; id equals the Supabase Auth user id.';

alter table public.profiles enable row level security;

-- Users can read only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Users can insert only their own profile.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Users can update only their own profile.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- There is deliberately no DELETE policy: a profile is removed only when the
-- auth account is deleted (ON DELETE CASCADE).

-- Least-privilege grants (RLS still applies on top of these).
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ============================================================================
-- Section 3: onboarding_profiles
-- ----------------------------------------------------------------------------
-- Persists the answers from the onboarding flow. The existence of a row means
-- the user has completed onboarding. The check constraints mirror the exact
-- option ids used by the onboarding UI:
--   current_level: fresh | basics | building
--   daily_time:    15 | 30 | 60 | weekend
--   goal_type:     career | job | project | curiosity
-- ============================================================================

create table if not exists public.onboarding_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references public.profiles (id) on delete cascade,
  topic         text not null check (char_length(btrim(topic)) between 1 and 120),
  current_level text not null check (current_level in ('fresh', 'basics', 'building')),
  daily_time    text not null check (daily_time in ('15', '30', '60', 'weekend')),
  goal_type     text not null check (goal_type in ('career', 'job', 'project', 'curiosity')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.onboarding_profiles is
  'Onboarding answers; one row per user (user_id unique). Row exists = onboarding complete.';

alter table public.onboarding_profiles enable row level security;

drop policy if exists "onboarding_profiles_select_own" on public.onboarding_profiles;
create policy "onboarding_profiles_select_own"
  on public.onboarding_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "onboarding_profiles_insert_own" on public.onboarding_profiles;
create policy "onboarding_profiles_insert_own"
  on public.onboarding_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "onboarding_profiles_update_own" on public.onboarding_profiles;
create policy "onboarding_profiles_update_own"
  on public.onboarding_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No DELETE policy, same reasoning as profiles.

revoke all on public.onboarding_profiles from anon, authenticated;
grant select, insert, update on public.onboarding_profiles to authenticated;

drop trigger if exists onboarding_profiles_set_updated_at on public.onboarding_profiles;
create trigger onboarding_profiles_set_updated_at
  before update on public.onboarding_profiles
  for each row execute function public.set_updated_at();

-- Note: user_id is UNIQUE, which already provides the lookup index; no extra
-- index is required for the access patterns in this phase.


-- ============================================================================
-- Section 4: auto-provision a profile when a user signs up
-- ----------------------------------------------------------------------------
-- full_name is taken from the metadata passed to supabase.auth.signUp()
-- (options.data.full_name). SECURITY DEFINER is required because the Supabase
-- Auth service role cannot read public schema objects by default.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
