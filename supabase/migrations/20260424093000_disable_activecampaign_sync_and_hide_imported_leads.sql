do $$
declare
  target_job_id bigint;
begin
  begin
    select jobid
      into target_job_id
    from cron.job
    where jobname = 'launchhub-activecampaign-sync-dispatcher'
    order by jobid desc
    limit 1;

    if target_job_id is not null then
      perform cron.unschedule(target_job_id);
    end if;
  exception
    when undefined_table then
      null;
  end;
end;
$$;

create or replace function public.dispatch_activecampaign_sync_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'status', 'disabled',
    'reason', 'activecampaign_sync_disabled',
    'dispatchedCount', 0,
    'executedAt', now()
  );
end;
$$;

create or replace function public.configure_activecampaign_sync_scheduler(
  project_url text,
  anon_key text,
  cron_secret text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id bigint;
begin
  project_url := nullif(btrim(coalesce(project_url, '')), '');
  anon_key := nullif(btrim(coalesce(anon_key, '')), '');
  cron_secret := nullif(btrim(coalesce(cron_secret, '')), '');

  begin
    select jobid
      into target_job_id
    from cron.job
    where jobname = 'launchhub-activecampaign-sync-dispatcher'
    order by jobid desc
    limit 1;

    if target_job_id is not null then
      perform cron.unschedule(target_job_id);
    end if;
  exception
    when undefined_table then
      null;
  end;

  return jsonb_build_object(
    'status', 'disabled',
    'reason', 'activecampaign_sync_disabled',
    'jobName', 'launchhub-activecampaign-sync-dispatcher'
  );
end;
$$;

create or replace function public.get_launch_visible_leads(
  target_launch_id uuid,
  limit_count integer default 100
)
returns table (
  id uuid,
  primary_name text,
  primary_email text,
  primary_phone text,
  merged_from_count integer,
  last_source text,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to access visible leads';
  end if;

  return query
  select
    lead.id,
    lead.primary_name,
    lead.primary_email,
    lead.primary_phone,
    lead.merged_from_count,
    lead.last_source,
    lead.status,
    lead.updated_at
  from public.lead_contacts as lead
  join public.launches as launch
    on launch.id = lead.launch_id
  where lead.launch_id = target_launch_id
    and lead.cycle_number = launch.current_cycle_number
    and exists (
      select 1
      from public.inbound_contact_events as event
      where event.launch_id = target_launch_id
        and event.cycle_number = launch.current_cycle_number
        and event.processed_contact_id = lead.id
        and event.processing_status = 'processed'
        and event.event_type not in ('contact_import', 'subscriber_import')
    )
  order by lead.updated_at desc
  limit greatest(coalesce(limit_count, 100), 1);
end;
$$;

revoke all on function public.get_launch_visible_leads(uuid, integer) from public;
grant execute on function public.get_launch_visible_leads(uuid, integer) to authenticated;
