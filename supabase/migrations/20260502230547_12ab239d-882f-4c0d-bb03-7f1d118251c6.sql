do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.launch_webhook_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.launch_webhook_jobs drop constraint if exists %I', constraint_record.conname);
  end loop;
end;
$$;

alter table public.launch_webhook_jobs
  add constraint launch_webhook_jobs_status_check
  check (status in ('pending', 'running', 'success', 'failed', 'retrying', 'dead_letter'));

update public.launch_webhook_jobs
set status = 'dead_letter',
    last_error = coalesce(last_error, 'Webhook job moved to dead letter after exhausting retry attempts'),
    updated_at = now()
where status = 'failed'
  and attempts >= 5;

drop index if exists public.idx_launch_webhook_jobs_pending;
create index if not exists idx_launch_webhook_jobs_pending
  on public.launch_webhook_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'retrying', 'failed');

drop index if exists public.ux_launch_webhook_jobs_global_dedupe;
create unique index if not exists ux_launch_webhook_jobs_global_dedupe
  on public.launch_webhook_jobs (launch_id, source, dedupe_key)
  where dedupe_key is not null
    and status in ('pending', 'retrying', 'running', 'success');

create or replace function public.dispatch_pending_launch_webhook_jobs(
  limit_count integer default 50,
  stale_after interval default interval '5 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row record;
  dispatched_count integer := 0;
  rescued_count integer := 0;
  dead_letter_count integer := 0;
begin
  update public.launch_webhook_jobs
  set status = 'dead_letter',
      next_attempt_at = null,
      last_error = coalesce(last_error, 'Webhook job moved to dead letter after exhausting retry attempts'),
      updated_at = now()
  where status in ('pending', 'retrying', 'failed', 'running')
    and attempts >= 5;

  get diagnostics dead_letter_count = row_count;

  update public.launch_webhook_jobs
  set status = 'retrying',
      next_attempt_at = now(),
      last_error = coalesce(last_error, 'Webhook job was rescued from stale running state'),
      updated_at = now()
  where status = 'running'
    and attempts < 5
    and updated_at < now() - coalesce(stale_after, interval '5 minutes');

  get diagnostics rescued_count = row_count;

  for job_row in
    select id
    from public.launch_webhook_jobs
    where attempts < 5
      and (
        (
          status in ('pending', 'retrying', 'failed')
          and coalesce(next_attempt_at, now()) <= now()
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
    'rescuedRunningCount', rescued_count,
    'deadLetterCount', dead_letter_count,
    'staleAfter', coalesce(stale_after, interval '5 minutes')::text,
    'executedAt', now()
  );
end;
$$;