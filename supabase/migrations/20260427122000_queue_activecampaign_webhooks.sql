create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

create table if not exists public.launch_webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  source text not null check (source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat')),
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  processed_at timestamptz,
  response_payload jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_launch_webhook_jobs_pending
  on public.launch_webhook_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index if not exists idx_launch_webhook_jobs_launch_created
  on public.launch_webhook_jobs (launch_id, created_at desc);

alter table public.launch_webhook_jobs enable row level security;

drop trigger if exists set_launch_webhook_jobs_updated_at on public.launch_webhook_jobs;
create trigger set_launch_webhook_jobs_updated_at
  before update on public.launch_webhook_jobs
  for each row execute function public.set_updated_at();

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
    timeout_milliseconds := 1000
  );

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.notify_launch_webhook_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.dispatch_launch_webhook_job(new.id);
  return new;
end;
$$;

drop trigger if exists dispatch_launch_webhook_job_on_insert on public.launch_webhook_jobs;
create trigger dispatch_launch_webhook_job_on_insert
  after insert on public.launch_webhook_jobs
  for each row execute function public.notify_launch_webhook_job();

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
    where status in ('pending', 'failed')
      and coalesce(next_attempt_at, now()) <= now()
      and attempts < 5
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

do $$
begin
  perform cron.unschedule('launchhub-webhook-job-dispatcher');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'launchhub-webhook-job-dispatcher',
  '* * * * *',
  $cron$select public.dispatch_pending_launch_webhook_jobs(50);$cron$
);
