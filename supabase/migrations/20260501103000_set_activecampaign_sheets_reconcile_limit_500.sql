create or replace function public.dispatch_activecampaign_sheet_reconcile_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  launch_row public.launches%rowtype;
  dispatched_count integer := 0;
  project_url text;
  cron_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'launchhub_project_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'launchhub_sync_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(btrim(coalesce(project_url, '')), '') is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'launchhub_project_url_missing');
  end if;

  if nullif(btrim(coalesce(cron_secret, '')), '') is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'launchhub_sync_cron_secret_missing');
  end if;

  for launch_row in
    select *
    from public.launches
    where coalesce(status, 'active') = 'active'
      and coalesce(gs_enabled, false) = true
      and nullif(btrim(coalesce(ac_api_url, '')), '') is not null
      and nullif(btrim(coalesce(ac_api_key, '')), '') is not null
      and nullif(btrim(coalesce(gs_spreadsheet_id, '')), '') is not null
      and nullif(btrim(coalesce(gs_sheet_name, '')), '') is not null
      and (
        nullif(btrim(coalesce(gs_capture_tag_id, '')), '') is not null
        or nullif(btrim(coalesce(gs_capture_tag_name, '')), '') is not null
      )
  loop
    perform net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/activecampaign-sheets-reconcile',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-launchhub-cron-secret', cron_secret
      ),
      body := jsonb_build_object(
        'launchId', launch_row.id,
        'limit', 500,
        'trigger', 'scheduled_hourly_capture_reconcile'
      ),
      timeout_milliseconds := 60000
    );

    dispatched_count := dispatched_count + 1;
  end loop;

  return jsonb_build_object(
    'status', 'dispatched',
    'dispatchedCount', dispatched_count,
    'executedAt', now()
  );
end;
$$;

revoke all on function public.dispatch_activecampaign_sheet_reconcile_jobs() from public;
