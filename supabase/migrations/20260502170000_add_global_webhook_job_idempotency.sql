alter table public.launch_webhook_jobs
  add column if not exists dedupe_key text;

create index if not exists idx_launch_webhook_jobs_global_dedupe_lookup
  on public.launch_webhook_jobs (launch_id, source, dedupe_key, created_at desc)
  where dedupe_key is not null;

update public.launch_webhook_jobs
set
  status = 'failed',
  last_error = 'Duplicate webhook job collapsed before global idempotency lock creation',
  updated_at = now()
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by launch_id, source, dedupe_key
        order by created_at asc
      ) as duplicate_rank
    from public.launch_webhook_jobs
    where dedupe_key is not null
      and status in ('pending', 'running', 'success')
  ) ranked_jobs
  where duplicate_rank > 1
);

create unique index if not exists ux_launch_webhook_jobs_global_dedupe
  on public.launch_webhook_jobs (launch_id, source, dedupe_key)
  where dedupe_key is not null
    and status in ('pending', 'running', 'success');
