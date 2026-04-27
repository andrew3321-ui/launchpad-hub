create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

create or replace function public.dispatch_launch_webhook_job(target_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  worker_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'launchhub_project_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'launchhub_sync_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(btrim(coalesce(project_url, '')), '') is null then
    return false;
  end if;

  if nullif(btrim(coalesce(worker_secret, '')), '') is null then
    return false;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/launch-webhook-router?workerJobId=' || target_job_id::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-launchhub-worker-secret', worker_secret
    ),
    body := jsonb_build_object(
      'jobId', target_job_id,
      'trigger', 'launch_webhook_job_dispatch'
    ),
    timeout_milliseconds := 60000
  );

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.dispatch_pending_launch_webhook_jobs(limit_count integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row record;
  dispatched_count integer := 0;
begin
  for job_row in
    select id
    from public.launch_webhook_jobs
    where attempts < 5
      and (
        (
          status in ('pending', 'failed')
          and coalesce(next_attempt_at, now()) <= now()
        )
        or (
          status = 'running'
          and updated_at < now() - interval '2 minutes'
        )
      )
    order by created_at asc
    limit greatest(coalesce(limit_count, 50), 1)
  loop
    if public.dispatch_launch_webhook_job(job_row.id) then
      dispatched_count := dispatched_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'dispatchedCount', dispatched_count,
    'executedAt', now()
  );
end;
$$;
