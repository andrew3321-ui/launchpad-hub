create table if not exists public.contact_technical_logs (
  id uuid not null default gen_random_uuid() primary key,
  operational_log_id uuid references public.contact_processing_logs(id) on delete set null,
  launch_id uuid not null references public.launches(id) on delete cascade,
  event_id uuid references public.inbound_contact_events(id) on delete set null,
  contact_id uuid references public.lead_contacts(id) on delete set null,
  source text not null check (source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual')),
  level text not null check (level in ('info', 'warning', 'error', 'success')),
  code text not null,
  title text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  expires_at timestamp with time zone not null default (now() + interval '14 days'),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_contact_technical_logs_launch_created
  on public.contact_technical_logs (launch_id, created_at desc);

create index if not exists idx_contact_technical_logs_launch_code_created
  on public.contact_technical_logs (launch_id, code, created_at desc);

create index if not exists idx_contact_technical_logs_expires_at
  on public.contact_technical_logs (expires_at);

create index if not exists idx_contact_technical_logs_operational
  on public.contact_technical_logs (operational_log_id)
  where operational_log_id is not null;

alter table public.contact_technical_logs enable row level security;

drop policy if exists "Users can view technical logs of their launches" on public.contact_technical_logs;
create policy "Users can view technical logs of their launches"
  on public.contact_technical_logs
  for select
  to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

drop policy if exists "Users can create technical logs of their launches" on public.contact_technical_logs;
create policy "Users can create technical logs of their launches"
  on public.contact_technical_logs
  for insert
  to authenticated
  with check (public.user_owns_launch(auth.uid(), launch_id));

create or replace function public.purge_expired_contact_technical_logs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.contact_technical_logs
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_contact_technical_logs() from public;

do $$
begin
  grant execute on function public.purge_expired_contact_technical_logs() to service_role;
exception
  when undefined_object then
    null;
end $$;

do $$
declare
  target_job_id bigint;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    return;
  end if;

  select jobid into target_job_id
  from cron.job
  where jobname = 'launchhub-purge-contact-technical-logs'
  limit 1;

  if target_job_id is not null then
    perform cron.unschedule(target_job_id);
  end if;

  perform cron.schedule(
    'launchhub-purge-contact-technical-logs',
    '23 3 * * *',
    $cron$select public.purge_expired_contact_technical_logs();$cron$
  );
exception
  when others then
    null;
end $$;
