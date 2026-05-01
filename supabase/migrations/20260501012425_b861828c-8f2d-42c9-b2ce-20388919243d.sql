create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.launches
  add column if not exists gs_capture_tag_id text,
  add column if not exists gs_capture_tag_name text,
  add column if not exists gs_default_product_name text;

create table if not exists public.launch_google_sheet_capture_records (
  id uuid not null default gen_random_uuid() primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  cycle_number integer not null default 1,
  active_contact_id text,
  primary_email text,
  normalized_phone text,
  spreadsheet_id text not null,
  sheet_name text not null,
  row_fingerprint text not null,
  source text not null default 'activecampaign_webhook',
  created_at timestamp with time zone not null default now()
);

create unique index if not exists ux_launch_google_sheet_capture_records_row
  on public.launch_google_sheet_capture_records (
    launch_id,
    cycle_number,
    spreadsheet_id,
    sheet_name,
    row_fingerprint
  );

create index if not exists idx_launch_google_sheet_capture_records_launch_created
  on public.launch_google_sheet_capture_records (launch_id, created_at desc);

alter table public.launch_google_sheet_capture_records enable row level security;

drop policy if exists "Users can view Google Sheets capture records of their launches"
  on public.launch_google_sheet_capture_records;
create policy "Users can view Google Sheets capture records of their launches"
  on public.launch_google_sheet_capture_records for select to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

create table if not exists public.launch_google_sheet_reconcile_state (
  launch_id uuid not null primary key references public.launches(id) on delete cascade,
  tag_id text,
  tag_name text,
  next_offset integer not null default 0,
  last_started_at timestamp with time zone,
  last_finished_at timestamp with time zone,
  last_status text,
  last_error text,
  last_run_summary jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

drop trigger if exists set_launch_google_sheet_reconcile_state_updated_at
  on public.launch_google_sheet_reconcile_state;
create trigger set_launch_google_sheet_reconcile_state_updated_at
before update on public.launch_google_sheet_reconcile_state
for each row execute function public.set_updated_at();

alter table public.launch_google_sheet_reconcile_state enable row level security;

drop policy if exists "Users can view Google Sheets reconcile state of their launches"
  on public.launch_google_sheet_reconcile_state;
create policy "Users can view Google Sheets reconcile state of their launches"
  on public.launch_google_sheet_reconcile_state for select to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

create or replace function public.get_launch_sources(target_launch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  launch_row public.launches%rowtype;
  workspace_rows jsonb;
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to access expert sources';
  end if;

  select * into launch_row from public.launches where id = target_launch_id;
  if not found then raise exception 'Expert not found'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', workspace.id,
        'workspace_name', workspace.workspace_name,
        'workspace_id', workspace.workspace_id,
        'api_token', workspace.api_token,
        'welcome_subflow_ns', workspace.welcome_subflow_ns,
        'default_tag_name', workspace.default_tag_name
      ) order by workspace.created_at asc
    ), '[]'::jsonb
  ) into workspace_rows
  from public.uchat_workspaces as workspace
  where workspace.launch_id = target_launch_id;

  return jsonb_build_object(
    'launch', jsonb_build_object(
      'id', launch_row.id,
      'name', launch_row.name,
      'project_id', launch_row.project_id,
      'slug', launch_row.slug,
      'webhook_secret', launch_row.webhook_secret,
      'ac_api_url', launch_row.ac_api_url,
      'ac_api_key', launch_row.ac_api_key,
      'ac_default_list_id', launch_row.ac_default_list_id,
      'ac_named_tags', launch_row.ac_named_tags,
      'current_cycle_number', launch_row.current_cycle_number,
      'current_cycle_started_at', launch_row.current_cycle_started_at,
      'gs_enabled', launch_row.gs_enabled,
      'gs_auth_mode', launch_row.gs_auth_mode,
      'gs_service_account_email', launch_row.gs_service_account_email,
      'gs_private_key', launch_row.gs_private_key,
      'gs_spreadsheet_id', launch_row.gs_spreadsheet_id,
      'gs_spreadsheet_title', launch_row.gs_spreadsheet_title,
      'gs_sheet_name', launch_row.gs_sheet_name,
      'gs_oauth_email', launch_row.gs_oauth_email,
      'gs_oauth_connected', coalesce(nullif(btrim(launch_row.gs_oauth_refresh_token), ''), null) is not null,
      'gs_capture_tag_id', launch_row.gs_capture_tag_id,
      'gs_capture_tag_name', launch_row.gs_capture_tag_name,
      'gs_default_product_name', launch_row.gs_default_product_name
    ),
    'uchat_workspaces', workspace_rows
  );
end;
$$;

drop function if exists public.update_launch_google_sheets_settings(
  uuid,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
);

create or replace function public.update_launch_google_sheets_settings(
  target_launch_id uuid,
  next_auth_mode text default null,
  next_enabled boolean default false,
  next_service_account_email text default null,
  next_private_key text default null,
  next_spreadsheet_id text default null,
  next_spreadsheet_title text default null,
  next_sheet_name text default null,
  next_capture_tag_id text default null,
  next_capture_tag_name text default null,
  next_default_product_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.launches%rowtype;
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to update Google Sheets settings';
  end if;

  update public.launches
  set gs_auth_mode = case
        when coalesce(nullif(btrim(next_auth_mode), ''), gs_auth_mode) in ('service_account', 'oauth')
          then coalesce(nullif(btrim(next_auth_mode), ''), gs_auth_mode)
        else gs_auth_mode
      end,
      gs_enabled = coalesce(next_enabled, false),
      gs_service_account_email = nullif(btrim(coalesce(next_service_account_email, '')), ''),
      gs_private_key = nullif(next_private_key, ''),
      gs_spreadsheet_id = nullif(btrim(coalesce(next_spreadsheet_id, '')), ''),
      gs_spreadsheet_title = nullif(btrim(coalesce(next_spreadsheet_title, '')), ''),
      gs_sheet_name = nullif(btrim(coalesce(next_sheet_name, '')), ''),
      gs_capture_tag_id = nullif(btrim(coalesce(next_capture_tag_id, '')), ''),
      gs_capture_tag_name = nullif(btrim(coalesce(next_capture_tag_name, '')), ''),
      gs_default_product_name = nullif(btrim(coalesce(next_default_product_name, '')), '')
  where id = target_launch_id
  returning * into updated_row;

  if not found then
    raise exception 'Expert not found';
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'project_id', updated_row.project_id,
    'slug', updated_row.slug,
    'webhook_secret', updated_row.webhook_secret,
    'ac_api_url', updated_row.ac_api_url,
    'ac_api_key', updated_row.ac_api_key,
    'ac_default_list_id', updated_row.ac_default_list_id,
    'ac_named_tags', updated_row.ac_named_tags,
    'current_cycle_number', updated_row.current_cycle_number,
    'current_cycle_started_at', updated_row.current_cycle_started_at,
    'gs_enabled', updated_row.gs_enabled,
    'gs_auth_mode', updated_row.gs_auth_mode,
    'gs_service_account_email', updated_row.gs_service_account_email,
    'gs_private_key', updated_row.gs_private_key,
    'gs_spreadsheet_id', updated_row.gs_spreadsheet_id,
    'gs_spreadsheet_title', updated_row.gs_spreadsheet_title,
    'gs_sheet_name', updated_row.gs_sheet_name,
    'gs_oauth_email', updated_row.gs_oauth_email,
    'gs_oauth_connected', coalesce(nullif(btrim(updated_row.gs_oauth_refresh_token), ''), null) is not null,
    'gs_capture_tag_id', updated_row.gs_capture_tag_id,
    'gs_capture_tag_name', updated_row.gs_capture_tag_name,
    'gs_default_product_name', updated_row.gs_default_product_name
  );
end;
$$;

create or replace function public.update_launch_activecampaign_settings(
  target_launch_id uuid,
  next_api_url text default null,
  next_api_key text default null,
  next_default_list_id text default null,
  next_named_tags jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.launches%rowtype;
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to update launch credentials';
  end if;

  update public.launches
  set ac_api_url = nullif(btrim(next_api_url), ''),
      ac_api_key = nullif(btrim(next_api_key), ''),
      ac_default_list_id = nullif(btrim(next_default_list_id), ''),
      ac_named_tags = coalesce(next_named_tags, '[]'::jsonb)
  where id = target_launch_id
  returning * into updated_row;

  if not found then
    raise exception 'Expert not found';
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'project_id', updated_row.project_id,
    'slug', updated_row.slug,
    'webhook_secret', updated_row.webhook_secret,
    'ac_api_url', updated_row.ac_api_url,
    'ac_api_key', updated_row.ac_api_key,
    'ac_default_list_id', updated_row.ac_default_list_id,
    'ac_named_tags', updated_row.ac_named_tags,
    'current_cycle_number', updated_row.current_cycle_number,
    'current_cycle_started_at', updated_row.current_cycle_started_at,
    'gs_enabled', updated_row.gs_enabled,
    'gs_service_account_email', updated_row.gs_service_account_email,
    'gs_private_key', updated_row.gs_private_key,
    'gs_spreadsheet_id', updated_row.gs_spreadsheet_id,
    'gs_sheet_name', updated_row.gs_sheet_name,
    'gs_capture_tag_id', updated_row.gs_capture_tag_id,
    'gs_capture_tag_name', updated_row.gs_capture_tag_name,
    'gs_default_product_name', updated_row.gs_default_product_name
  );
end;
$$;

revoke all on function public.update_launch_google_sheets_settings(
  uuid,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;
grant execute on function public.update_launch_google_sheets_settings(
  uuid,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

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

do $$
declare
  target_job_id bigint;
begin
  select jobid
    into target_job_id
  from cron.job
  where jobname = 'launchhub-activecampaign-sheets-reconciler'
  limit 1;

  if target_job_id is not null then
    perform cron.unschedule(target_job_id);
  end if;
end $$;

select cron.schedule(
  'launchhub-activecampaign-sheets-reconciler',
  '0 * * * *',
  $cron$select public.dispatch_activecampaign_sheet_reconcile_jobs();$cron$
);

revoke all on function public.dispatch_activecampaign_sheet_reconcile_jobs() from public;
