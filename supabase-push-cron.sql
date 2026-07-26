-- Rulează după ce funcțiile Edge `send-push` și `push-config` sunt publicate.
-- Înlocuiește PROJECT_REF și CRON_SECRET înainte de Run.

select vault.create_secret(
  'https://PROJECT_REF.supabase.co/functions/v1/send-push',
  'itera_push_function_url'
);

select vault.create_secret(
  'CRON_SECRET',
  'itera_push_cron_secret'
);

select cron.schedule(
  'itera-enqueue-reminders',
  '*/10 * * * *',
  $$ select public.enqueue_due_task_notifications(); $$
);

select cron.schedule(
  'itera-send-push',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'itera_push_function_url'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'itera_push_cron_secret'
      )
    ),
    body := '{"scheduled":true}'::jsonb
  );
  $$
);
