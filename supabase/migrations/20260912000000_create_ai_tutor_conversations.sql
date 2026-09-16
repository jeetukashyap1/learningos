-- ============================================================================
-- LearningOS — Migration 006: AI Tutor 2.0 conversation persistence
-- ----------------------------------------------------------------------------
-- ADDS the real, user-scoped conversation store the AI Tutor needs so a
-- learner can continue a tutoring conversation instead of losing it on
-- refresh. Nothing existing is recreated or dropped; every change is additive.
--
-- Supports the AI Tutor 2.0 spec:
--
--   §9  conversation memory with a PROPER schema (never fake/local-only
--        history): ai_tutor_conversations + ai_tutor_messages
--   §10 chat history: enough stored turns for coherent follow-ups; the
--        server applies the window, the schema just persists honestly
--   §2  auth & security: RLS isolates every row by the authenticated user,
--        so a learner can never read or write another learner's conversation
--   §20 lessons/paths stay real: path_id / lesson_id are nullable references
--        to the learner's OWN rows and are set from the SERVER-derived
--        context, never from untrusted client input
--
-- Summary of changes:
--   ai_tutor_conversations (new table)
--     id / user_id / path_id (nullable) / lesson_id (nullable) / title /
--     created_at / updated_at
--   ai_tutor_messages (new table)
--     id / conversation_id / role / content / created_at
--
-- Deliberately NOT stored (spec §9 "do not store unnecessary sensitive
-- info" and §22 cost control):
--   - No copy of the learner's curriculum, module, or lesson content: the
--     tutor context is DERIVED live from the existing tables on every turn
--     (§1: never trust client context; always derive server-side).
--   - No provider keys, prompts, token counts, or raw provider payloads.
--   - No per-message metadata beyond role + content + created_at.
--
-- Ownership / deletion semantics:
--   - Conversations die with their user (on delete cascade).
--   - Messages die with their conversation (on delete cascade).
--   - Deleting a path or a lesson never deletes history: path_id and
--     lesson_id are ON DELETE SET NULL, so the conversation survives with a
--     null scope and keeps rendering honestly (no dangling id, no crash).
--
-- Idempotent and non-destructive: IF EXISTS / IF NOT EXISTS everywhere,
-- additive only. Apply like migrations 001-005 (Supabase SQL editor or
-- supabase db push).
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
-- Section 1: ai_tutor_conversations — one tutoring thread per learner scope
-- ----------------------------------------------------------------------------
-- A conversation belongs to exactly one learner. path_id / lesson_id record
-- which real path/lesson the thread started from (server-derived), so the UI
-- can show "Currently learning: ... / Module: ... / Lesson: ..." and the
-- server can keep the tutor anchored to the learner's actual curriculum.
-- The scope is informational and nullable: a conversation created from the
-- standalone tutor page has lesson_id null, and a path that is later swapped
-- or deleted simply clears the reference without destroying the history.
-- ============================================================================

create table if not exists public.ai_tutor_conversations (
  id uuid primary key default gen_random_uuid(),
  -- Owner. Conversations are strictly private to this learner.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The learner's path this thread is anchored to (server-derived); null when
  -- the tutor was opened without an active path, or the path was removed.
  path_id uuid references public.learning_paths(id) on delete set null,
  -- The lesson this thread started from (server-derived); null for a general
  -- tutor conversation not tied to one lesson.
  lesson_id uuid references public.learning_path_lessons(id) on delete set null,
  -- Short, human label for the thread (derived server-side from the trusted
  -- context - lesson title, else path title, else a generic label).
  title text not null default '' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ai_tutor_conversations is
  'One AI Tutor conversation thread per learner; anchored to the learner''s real path/lesson via nullable, server-derived references.';

comment on column public.ai_tutor_conversations.path_id is
  'learning_paths.id this thread was opened against (server-derived); null when opened without an active path or after the path was removed.';

comment on column public.ai_tutor_conversations.lesson_id is
  'learning_path_lessons.id this thread started from (server-derived); null for a general (non-lesson) conversation.';

comment on column public.ai_tutor_conversations.title is
  'Short label for the thread, derived server-side from the trusted tutor context; never from untrusted client text.';

-- Listing a learner's threads (newest first) is the hot path.
create index if not exists ai_tutor_conversations_user_updated_idx
  on public.ai_tutor_conversations (user_id, updated_at desc);

create index if not exists ai_tutor_conversations_path_id_idx
  on public.ai_tutor_conversations (path_id);

-- updated_at maintenance (same house function as the other tables).
drop trigger if exists set_ai_tutor_conversations_updated_at on public.ai_tutor_conversations;
create trigger set_ai_tutor_conversations_updated_at
  before update on public.ai_tutor_conversations
  for each row execute function public.set_updated_at();

-- Row Level Security: strictly user-scoped rows, no anon access.
alter table public.ai_tutor_conversations enable row level security;

drop policy if exists "ai_tutor_conversations_select" on public.ai_tutor_conversations;
create policy "ai_tutor_conversations_select"
  on public.ai_tutor_conversations
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "ai_tutor_conversations_insert" on public.ai_tutor_conversations;
create policy "ai_tutor_conversations_insert"
  on public.ai_tutor_conversations
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "ai_tutor_conversations_update" on public.ai_tutor_conversations;
create policy "ai_tutor_conversations_update"
  on public.ai_tutor_conversations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete powers "clear / new conversation" (spec §12) and user data control.
drop policy if exists "ai_tutor_conversations_delete" on public.ai_tutor_conversations;
create policy "ai_tutor_conversations_delete"
  on public.ai_tutor_conversations
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.ai_tutor_conversations from anon;
grant select, insert, update, delete on public.ai_tutor_conversations to authenticated;


-- ============================================================================
-- Section 2: ai_tutor_messages — the ordered turns of a conversation
-- ----------------------------------------------------------------------------
-- role is limited to the three chat roles the provider contract understands
-- (system messages are built fresh server-side on every turn and are never
-- persisted). content is the single stored payload; nothing sensitive
-- (keys, prompts, provider metadata) is ever written here.
-- ============================================================================

create table if not exists public.ai_tutor_messages (
  id uuid primary key default gen_random_uuid(),
  -- Owning conversation; messages die with it.
  conversation_id uuid not null references public.ai_tutor_conversations(id) on delete cascade,
  -- Turn author. 'system' is intentionally excluded: prompts are rebuilt
  -- server-side and never persisted.
  role text not null check (role in ('user', 'assistant')),
  -- The turn text. Bounded so a runaway client can never store megabytes.
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

comment on table public.ai_tutor_messages is
  'Ordered user/assistant turns of an AI Tutor conversation; system prompts are rebuilt server-side and never stored.';

comment on column public.ai_tutor_messages.role is
  'Turn author: user or assistant (system prompts are never persisted).';

-- Reading a thread's turns in order is the hot path.
create index if not exists ai_tutor_messages_conversation_created_idx
  on public.ai_tutor_messages (conversation_id, created_at);

-- Row Level Security: a learner can only touch messages of their own thread.
-- The exists() subquery checks ownership through ai_tutor_conversations, whose
-- own RLS select policy is applied to the invoking user, so only real owners
-- pass - the same pattern as learning_path_lessons -> learning_paths.
alter table public.ai_tutor_messages enable row level security;

drop policy if exists "ai_tutor_messages_select" on public.ai_tutor_messages;
create policy "ai_tutor_messages_select"
  on public.ai_tutor_messages
  for select
  to authenticated
  using (exists (
    select 1 from public.ai_tutor_conversations c
    where c.id = ai_tutor_messages.conversation_id
      and c.user_id = auth.uid()
  ));

drop policy if exists "ai_tutor_messages_insert" on public.ai_tutor_messages;
create policy "ai_tutor_messages_insert"
  on public.ai_tutor_messages
  for insert
  to authenticated
  with check (exists (
    select 1 from public.ai_tutor_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
  ));

-- Update is granted for completeness (a future edit/anonymize action); the
-- app never rewrites history today.
drop policy if exists "ai_tutor_messages_update" on public.ai_tutor_messages;
create policy "ai_tutor_messages_update"
  on public.ai_tutor_messages
  for update
  to authenticated
  using (exists (
    select 1 from public.ai_tutor_conversations c
    where c.id = ai_tutor_messages.conversation_id
      and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.ai_tutor_conversations c
    where c.id = ai_tutor_messages.conversation_id
      and c.user_id = auth.uid()
  ));

drop policy if exists "ai_tutor_messages_delete" on public.ai_tutor_messages;
create policy "ai_tutor_messages_delete"
  on public.ai_tutor_messages
  for delete
  to authenticated
  using (exists (
    select 1 from public.ai_tutor_conversations c
    where c.id = ai_tutor_messages.conversation_id
      and c.user_id = auth.uid()
  ));

revoke all on public.ai_tutor_messages from anon;
grant select, insert, update, delete on public.ai_tutor_messages to authenticated;
