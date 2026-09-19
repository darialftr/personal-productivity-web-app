-- Run once in Supabase SQL Editor. Existing local notebooks are uploaded on the next save.
create table if not exists public.notebooks (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  content jsonb not null default '{"version":3,"pages":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);
alter table public.notebooks enable row level security;
drop policy if exists "Users manage own notebooks" on public.notebooks;
create policy "Users manage own notebooks" on public.notebooks for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
