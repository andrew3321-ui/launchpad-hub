create or replace function public.get_launch_visible_webhook_jobs(
  target_launch_id uuid,
  limit_count integer default 30
)
returns table (
  id uuid,
  source text,
  event_type text,
  status text,
  attempts integer,
  next_attempt_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  last_error text,
  dedupe_key text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to access webhook jobs';
  end if;

  return query
  select
    job.id,
    job.source,
    job.event_type,
    job.status,
    job.attempts,
    job.next_attempt_at,
    job.created_at,
    job.updated_at,
    job.last_error,
    job.dedupe_key
  from public.launch_webhook_jobs as job
  where job.launch_id = target_launch_id
  order by job.created_at desc
  limit least(greatest(coalesce(limit_count, 30), 1), 100);
end;
$$;

revoke all on function public.get_launch_visible_webhook_jobs(uuid, integer) from public;
grant execute on function public.get_launch_visible_webhook_jobs(uuid, integer) to authenticated;

drop index if exists public.ux_launch_webhook_jobs_global_dedupe;
create unique index if not exists ux_launch_webhook_jobs_global_dedupe
  on public.launch_webhook_jobs (launch_id, source, dedupe_key)
  where dedupe_key is not null
    and status in ('pending', 'retrying', 'running', 'success');