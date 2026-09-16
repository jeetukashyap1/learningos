-- LearningOS: YouTube learning resources and search cache.
--
-- Purpose:
--   learning_resources        - normalized external learning content (YouTube
--                               videos), deduplicated per (provider, external_id)
--                               and reusable across searches, lessons, and skills.
--   learning_resource_searches - query-level cache of recent searches so the
--                               YouTube Data API quota is spent once per query,
--                               not once per server instance or per request.
--
-- Design notes:
--   - Content rows are NOT user-owned: every authenticated user can read the
--     shared catalog (RLS: select for authenticated). Writes go through the
--     server route using the authenticated user's own session, so insert/
--     update are also granted to authenticated. No anon access.
--   - Watch progress (started/completed/last position/watched %) is deliberately
--     NOT built here: the existing progress system remains the single source of
--     truth. learning_resources just carries stable ids a future feature can
--     reference.
--   - Idempotent and non-destructive, matching the migration style of
--     20260907000000_create_profiles_and_onboarding.sql.

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
-- learning_resources: the shared content catalog
-- ---------------------------------------------------------------------------

create table if not exists public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  -- Resource classification. 'video' today; leaves room for articles etc.
  type text not null default 'video' check (type in ('video')),
  -- External source identifier, e.g. 'youtube'.
  provider text not null check (provider in ('youtube')),
  -- Canonical id at the provider, e.g. the 11-char YouTube video id.
  external_id text not null,
  title text not null,
  description text not null default '',
  -- Canonical watch URL (constructed server-side from the validated id).
  url text not null,
  thumbnail_url text,
  channel_name text not null default '',
  duration_seconds integer,
  published_at timestamptz,
  -- Open-ended provider metadata (privacy status, embeddability, ...).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same video found through different searches is stored exactly once.
  constraint learning_resources_provider_external_id_key unique (provider, external_id)
);

comment on table public.learning_resources is
  'External learning content (YouTube videos) discovered via /api/learning/youtube/search and shared across all learners.';

comment on constraint learning_resources_provider_external_id_key on public.learning_resources is
  'Deduplicates resources per (provider, external_id): one row per external video.';

create index if not exists learning_resources_provider_idx
  on public.learning_resources (provider);

create index if not exists learning_resources_external_id_idx
  on public.learning_resources (external_id);

create index if not exists learning_resources_type_idx
  on public.learning_resources (type);

-- updated_at maintenance (create or replace keeps re-runs safe).
drop trigger if exists set_learning_resources_updated_at on public.learning_resources;
create trigger set_learning_resources_updated_at
  before update on public.learning_resources
  for each row execute function public.set_updated_at();

-- Row Level Security: shared read catalog, no anon access.
alter table public.learning_resources enable row level security;

drop policy if exists "learning_resources_select" on public.learning_resources;
create policy "learning_resources_select"
  on public.learning_resources
  for select
  to authenticated
  using (true);

drop policy if exists "learning_resources_insert" on public.learning_resources;
create policy "learning_resources_insert"
  on public.learning_resources
  for insert
  to authenticated
  with check (true);

drop policy if exists "learning_resources_update" on public.learning_resources;
create policy "learning_resources_update"
  on public.learning_resources
  for update
  to authenticated
  using (true)
  with check (true);

-- No DELETE policy: content rows are shared; removal is an admin/DBA concern.

revoke all on public.learning_resources from anon;
grant select, insert, update on public.learning_resources to authenticated;

-- ---------------------------------------------------------------------------
-- learning_resource_searches: quota-protecting search cache
-- ---------------------------------------------------------------------------

create table if not exists public.learning_resource_searches (
  id uuid primary key default gen_random_uuid(),
  -- Normalized query + options fingerprint; identical searches reuse the row.
  cache_key text not null,
  normalized_query text not null,
  -- The options that produced this search (topic, skill, level, ...).
  options jsonb not null default '{}'::jsonb,
  -- Ordered external ids as returned for this search.
  result_external_ids text[] not null default '{}',
  result_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  -- When this cache entry stops being fresh.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_resource_searches_cache_key_key unique (cache_key)
);

comment on table public.learning_resource_searches is
  'Cache of recent /api/learning/youtube/search results, keyed by normalized query + options, to protect the YouTube API quota.';

create index if not exists learning_resource_searches_expires_at_idx
  on public.learning_resource_searches (expires_at);

create index if not exists learning_resource_searches_fetched_at_idx
  on public.learning_resource_searches (fetched_at);

-- The unique cache_key constraint doubles as the lookup index.

-- updated_at maintenance.
drop trigger if exists set_learning_resource_searches_updated_at on public.learning_resource_searches;
create trigger set_learning_resource_searches_updated_at
  before update on public.learning_resource_searches
  for each row execute function public.set_updated_at();

-- Row Level Security: cache rows are readable/writable by any authenticated
-- user (shared cache), never by anon.
alter table public.learning_resource_searches enable row level security;

drop policy if exists "learning_resource_searches_select" on public.learning_resource_searches;
create policy "learning_resource_searches_select"
  on public.learning_resource_searches
  for select
  to authenticated
  using (true);

drop policy if exists "learning_resource_searches_insert" on public.learning_resource_searches;
create policy "learning_resource_searches_insert"
  on public.learning_resource_searches
  for insert
  to authenticated
  with check (true);

drop policy if exists "learning_resource_searches_update" on public.learning_resource_searches;
create policy "learning_resource_searches_update"
  on public.learning_resource_searches
  for update
  to authenticated
  using (true)
  with check (true);

-- No DELETE policy: expired rows are cleaned up by maintenance, not by users.

revoke all on public.learning_resource_searches from anon;
grant select, insert, update on public.learning_resource_searches to authenticated;
