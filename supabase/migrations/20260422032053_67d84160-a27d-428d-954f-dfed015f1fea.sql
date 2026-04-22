-- Migration: schedule_activecampaign_sync
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

create or replace function public.upsert_launchhub_scheduler_secret(
  secret_name text,
  secret_value text,
  secret_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_secret_id uuid;
begin
  if nullif(btrim(coalesce(secret_name, '')), '') is null then
    raise exception 'secret_name is required';
  end if;

  if nullif(btrim(coalesce(secret_value, '')), '') is null then
    raise exception 'secret_value is required';
  end if;

  select decrypted.id
  into existing_secret_id
  from vault.decrypted_secrets as decrypted
  where decrypted.name = secret_name
  order by decrypted.created_at desc
  limit 1;

  if existing_secret_id is null then
    return vault.create_secret(secret_value, secret_name, secret_description);
  end if;

  perform vault.update_secret(existing_secret_id, secret_value, secret_name, secret_description);
  return existing_secret_id;
end;
$$;

create or replace function public.dispatch_activecampaign_sync_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  launch_row public.launches%rowtype;
  latest_metadata jsonb;
  sync_mode text;
  dispatched_count integer := 0;
  project_url text;
  anon_key text;
  cron_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'launchhub_project_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into anon_key
  from vault.decrypted_secrets
  where name = 'launchhub_anon_key'
  order by created_at desc
  limit 1;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'launchhub_sync_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(btrim(coalesce(project_url, '')), '') is null then
    raise exception 'launchhub_project_url is not configured in Vault';
  end if;

  if nullif(btrim(coalesce(anon_key, '')), '') is null then
    raise exception 'launchhub_anon_key is not configured in Vault';
  end if;

  if nullif(btrim(coalesce(cron_secret, '')), '') is null then
    raise exception 'launchhub_sync_cron_secret is not configured in Vault';
  end if;

  for launch_row in
    select *
    from public.launches
    where nullif(btrim(coalesce(ac_api_url, '')), '') is not null
      and nullif(btrim(coalesce(ac_api_key, '')), '') is not null
      and coalesce(status, 'active') = 'active'
      and not exists (
        select 1
        from public.platform_sync_runs as running_run
        where running_run.launch_id = launches.id
          and running_run.source = 'activecampaign'
          and running_run.status = 'running'
          and running_run.started_at > now() - interval '20 minutes'
      )
  loop
    select run.metadata
    into latest_metadata
    from public.platform_sync_runs as run
    where run.launch_id = launch_row.id
      and run.source = 'activecampaign'
    order by run.started_at desc
    limit 1;

    sync_mode := case
      when coalesce((latest_metadata -> 'cursor' ->> 'hasMore')::boolean, false) then 'resume'
      when nullif(btrim(coalesce(latest_metadata ->> 'syncedUntil', '')), '') is not null then 'incremental'
      else 'full'
    end;

    perform net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/sync-platform-contacts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'x-launchhub-cron-secret', cron_secret
      ),
      body := jsonb_build_object(
        'launchId', launch_row.id,
        'source', 'activecampaign',
        'syncMode', sync_mode,
        'trigger', 'scheduled_cron'
      )
    );

    dispatched_count := dispatched_count + 1;
  end loop;

  return jsonb_build_object(
    'dispatchedCount', dispatched_count,
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
set search_path = public, vault
as $$
begin
  perform public.upsert_launchhub_scheduler_secret(
    'launchhub_project_url',
    project_url,
    'Supabase project URL for Launch Hub scheduled sync'
  );

  perform public.upsert_launchhub_scheduler_secret(
    'launchhub_anon_key',
    anon_key,
    'Supabase anon key for Launch Hub scheduled sync'
  );

  perform public.upsert_launchhub_scheduler_secret(
    'launchhub_sync_cron_secret',
    cron_secret,
    'Shared secret for Launch Hub scheduled sync invocations'
  );

  perform cron.schedule(
    'launchhub-activecampaign-sync-dispatcher',
    '*/30 * * * *',
    $cron$select public.dispatch_activecampaign_sync_jobs();$cron$
  );

  return jsonb_build_object(
    'status', 'scheduled',
    'jobName', 'launchhub-activecampaign-sync-dispatcher',
    'frequency', 'every 30 minutes'
  );
end;
$$;

revoke all on function public.upsert_launchhub_scheduler_secret(text, text, text) from public;
revoke all on function public.dispatch_activecampaign_sync_jobs() from public;
revoke all on function public.configure_activecampaign_sync_scheduler(text, text, text) from public;

grant execute on function public.configure_activecampaign_sync_scheduler(text, text, text) to authenticated;

-- Migration: add_visible_leads_rpc
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
  where lead.launch_id = target_launch_id
    and exists (
      select 1
      from public.inbound_contact_events as event
      where event.launch_id = target_launch_id
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