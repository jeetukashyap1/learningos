-- ============================================================================
-- LearningOS — Migration 007: persisted notification read/unread state
-- ----------------------------------------------------------------------------
-- ADDS one small table that remembers which notifications a learner has
-- already seen. Nothing existing is recreated or dropped; the change is
-- purely additive.
--
-- Why this table exists:
--   Notifications in LearningOS are DERIVED signals: each one is recomputed
--   from the learner's own persisted learning path (videos still loading,
--   what is up next, milestones earned). There is deliberately no second
--   content system, so there is nothing to store about the notification
--   itself. What was missing was the READ state: a stable per-user record
--   of "this learner has already opened this signal", so an unread signal
--   stays visibly unread across a refresh, a logout, and a re-login.
--
-- Design notes:
--   - The signal key is a stable, server-derived fingerprint of the signal
--     (kind + title + target), never a render index: the same signal keeps
--     the same identity across renders, so its read state survives.
--   - A row exists ONLY once the learner has actually read the signal.
--     Absence of a row is the unread state - the honest default, so a new
--     signal is unread without anything having to be written first.
--   - Keys are scoped per user via the primary key (user_id, signal_key), so
--     two learners can never affect each other's read state, and RLS enforces
--     the same isolation at the database level.
--   - Re-reading a signal is idempotent: read_at is written once and never
--     moved, so "read stays read" survives any number of page loads.
--
-- Idempotent and non-destructive, matching the migration style of
-- 20260907000000_create_profiles_and_onboarding.sql through
-- 20260912000000_create_ai_tutor_conversations.sql.
-- ============================================================================


-- ============================================================================
-- Section 0: shared trigger function (defensive re-create for standalone use)
-- ============================================================================

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


-- ============================================================================
-- Section 1: notification_reads — which derived signals a learner has read
-- ============================================================================

create table if not exists public.notification_reads (
  -- Owner. Read state is strictly private to this learner.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable fingerprint of the derived signal this row marks as read
  -- (server-derived; see lib/notifications/service.ts). Deliberately not a
  -- render index: identity must survive re-ordering between renders.
  signal_key text not null check (char_length(signal_key) between 1 and 200),
  -- When the learner first opened the signal. Written once; never moved.
  read_at timestamptz not null default now(),
  -- One read record per learner per signal: marking the same signal read
  -- again is a no-op instead of a duplicate row.
  primary key (user_id, signal_key)
);

comment on table public.notification_reads is
  'Per-learner read state for DERIVED notifications; a row exists only after the learner read that signal (absence of a row is unread).';

comment on column public.notification_reads.signal_key is
  'Stable server-derived fingerprint of the notification signal (kind + title + target); never a render index.';

comment on column public.notification_reads.read_at is
  'When the learner first opened this signal; written once so read state stays read across refresh and re-login.';

-- Counting/listing a learner's read keys is the hot path; the primary key
-- already covers (user_id, signal_key) lookups.
create index if not exists notification_reads_user_read_idx
  on public.notification_reads (user_id, read_at desc);

-- Row Level Security: strictly user-scoped rows, no anon access.
alter table public.notification_reads enable row level security;

drop policy if exists "notification_reads_select" on public.notification_reads;
create policy "notification_reads_select"
  on public.notification_reads
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notification_reads_insert" on public.notification_reads;
create policy "notification_reads_insert"
  on public.notification_reads
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Update keeps the existing house pattern complete; the service only ever
-- inserts (read state never needs to be rewritten).
drop policy if exists "notification_reads_update" on public.notification_reads;
create policy "notification_reads_update"
  on public.notification_reads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete lets a learner clear their own read state and supports user data
-- control; it can never touch another learner's rows.
drop policy if exists "notification_reads_delete" on public.notification_reads;
create policy "notification_reads_delete"
  on public.notification_reads
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.notification_reads from anon;
grant select, insert, update, delete on public.notification_reads to authenticated;
