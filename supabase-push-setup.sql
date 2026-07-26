-- Itera Web Push
-- Rulează acest fișier o singură dată în Supabase SQL Editor.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  task_reminders boolean not null default true,
  test_reminders boolean not null default true,
  study_reminders boolean not null default true,
  quiet_start time default '22:00',
  quiet_end time default '08:00',
  timezone text not null default 'Europe/Bucharest',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  target_url text not null default './index.html#/',
  tag text not null default 'itera-reminder',
  notification_type text not null default 'reminder',
  source_id uuid,
  dedupe_key text unique,
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id) where enabled = true;
create index if not exists notification_queue_pending_idx
  on public.notification_queue(scheduled_for)
  where status = 'pending';

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_queue enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
on public.push_subscriptions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own notification preferences" on public.notification_preferences;
create policy "Users manage own notification preferences"
on public.notification_preferences for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users view own notification queue" on public.notification_queue;
create policy "Users view own notification queue"
on public.notification_queue for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users create own reminders" on public.notification_queue;
create policy "Users create own reminders"
on public.notification_queue for insert
to authenticated
with check (auth.uid() = user_id);

-- Creează notificări pentru task-urile cu termen astăzi sau mâine.
create or replace function public.enqueue_due_task_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.notification_queue (
    user_id,
    title,
    body,
    target_url,
    tag,
    notification_type,
    source_id,
    dedupe_key,
    scheduled_for
  )
  select
    task.user_id,
    case
      when task.deadline_date = current_date then 'Task pentru astăzi'
      else 'Task pentru mâine'
    end,
    task.title || ' · ' || coalesce(task.estimated_minutes, 30) || ' minute estimate',
    './index.html#/tasks',
    'task-' || task.id::text,
    'task-deadline',
    task.id,
    'task-' || task.id::text || '-' || task.deadline_date::text,
    now()
  from public.tasks task
  left join public.notification_preferences preference
    on preference.user_id = task.user_id
  where task.completed = false
    and task.deadline_date between current_date and current_date + 1
    and coalesce(preference.task_reminders, true)
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.enqueue_due_task_notifications() from public;
grant execute on function public.enqueue_due_task_notifications() to service_role;
