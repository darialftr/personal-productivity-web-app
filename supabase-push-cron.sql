-- Rulează după ce funcțiile Edge `send-push` și `push-config` sunt publicate.
-- Înlocuiește PROJECT_REF și CRON_SECRET înainte de Run.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'itera_push_function_url') then
    perform vault.create_secret(
      'https://PROJECT_REF.supabase.co/functions/v1/send-push',
      'itera_push_function_url'
    );
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'itera_push_cron_secret') then
    perform vault.create_secret('CRON_SECRET', 'itera_push_cron_secret');
  end if;
end;
$$;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in ('itera-enqueue-reminders', 'itera-send-push')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'itera-send-push',
  '* * * * *',
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
