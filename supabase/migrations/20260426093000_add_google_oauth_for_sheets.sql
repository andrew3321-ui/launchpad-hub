alter table public.launches
  add column if not exists gs_auth_mode text not null default 'service_account',
  add column if not exists gs_oauth_email text,
  add column if not exists gs_oauth_refresh_token text,
  add column if not exists gs_spreadsheet_title text;

update public.launches
set gs_auth_mode = case
  when coalesce(nullif(btrim(gs_oauth_refresh_token), ''), null) is not null then 'oauth'
  else 'service_account'
end
where gs_auth_mode not in ('service_account', 'oauth');

alter table public.launches
  drop constraint if exists launches_gs_auth_mode_check;

alter table public.launches
  add constraint launches_gs_auth_mode_check
  check (gs_auth_mode in ('service_account', 'oauth'));

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
      'gs_oauth_connected', coalesce(nullif(btrim(launch_row.gs_oauth_refresh_token), ''), null) is not null
    ),
    'uchat_workspaces', workspace_rows
  );
end;
$$;

create or replace function public.update_launch_google_sheets_settings(
  target_launch_id uuid,
  next_auth_mode text default null,
  next_enabled boolean default false,
  next_service_account_email text default null,
  next_private_key text default null,
  next_spreadsheet_id text default null,
  next_spreadsheet_title text default null,
  next_sheet_name text default null
) returns jsonb
language plpgsql security definer set search_path = public
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
      gs_sheet_name = nullif(btrim(coalesce(next_sheet_name, '')), '')
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
    'gs_oauth_connected', coalesce(nullif(btrim(updated_row.gs_oauth_refresh_token), ''), null) is not null
  );
end;
$$;

revoke select (
  gs_auth_mode,
  gs_enabled,
  gs_oauth_email,
  gs_oauth_refresh_token,
  gs_private_key,
  gs_service_account_email,
  gs_sheet_name,
  gs_spreadsheet_id,
  gs_spreadsheet_title
) on public.launches from anon, authenticated;

revoke update (
  gs_auth_mode,
  gs_enabled,
  gs_oauth_email,
  gs_oauth_refresh_token,
  gs_private_key,
  gs_service_account_email,
  gs_sheet_name,
  gs_spreadsheet_id,
  gs_spreadsheet_title
) on public.launches from anon, authenticated;

revoke all on function public.update_launch_google_sheets_settings(uuid, text, boolean, text, text, text, text, text) from public;
grant execute on function public.update_launch_google_sheets_settings(uuid, text, boolean, text, text, text, text, text) to authenticated;
