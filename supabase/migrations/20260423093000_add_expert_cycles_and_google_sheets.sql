alter table public.launches
  add column if not exists current_cycle_number integer not null default 1,
  add column if not exists current_cycle_started_at timestamp with time zone not null default now(),
  add column if not exists gs_enabled boolean not null default false,
  add column if not exists gs_service_account_email text,
  add column if not exists gs_private_key text,
  add column if not exists gs_spreadsheet_id text,
  add column if not exists gs_sheet_name text;

alter table public.lead_contacts
  add column if not exists cycle_number integer not null default 1;

alter table public.lead_contact_identities
  add column if not exists cycle_number integer not null default 1;

alter table public.inbound_contact_events
  add column if not exists cycle_number integer not null default 1;

alter table public.contact_processing_logs
  add column if not exists cycle_number integer not null default 1;

alter table public.contact_routing_actions
  add column if not exists cycle_number integer not null default 1;

update public.launches
set current_cycle_number = coalesce(current_cycle_number, 1),
    current_cycle_started_at = coalesce(current_cycle_started_at, created_at, now())
where current_cycle_number is null
   or current_cycle_started_at is null;

update public.lead_contacts set cycle_number = 1 where cycle_number is null;
update public.lead_contact_identities set cycle_number = 1 where cycle_number is null;
update public.inbound_contact_events set cycle_number = 1 where cycle_number is null;
update public.contact_processing_logs set cycle_number = 1 where cycle_number is null;
update public.contact_routing_actions set cycle_number = 1 where cycle_number is null;

create index if not exists idx_lead_contacts_launch_cycle_updated
  on public.lead_contacts (launch_id, cycle_number, updated_at desc);

create index if not exists idx_inbound_contact_events_launch_cycle_received
  on public.inbound_contact_events (launch_id, cycle_number, received_at desc);

create index if not exists idx_contact_processing_logs_launch_cycle_created
  on public.contact_processing_logs (launch_id, cycle_number, created_at desc);

create index if not exists idx_contact_routing_actions_launch_cycle_created
  on public.contact_routing_actions (launch_id, cycle_number, created_at desc);

drop index if exists idx_lead_contact_identities_unique_external;
create unique index if not exists idx_lead_contact_identities_unique_external_cycle
  on public.lead_contact_identities (launch_id, cycle_number, source, external_contact_id)
  where external_contact_id is not null;

create or replace function public.assign_cycle_number_from_launch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cycle_number is null then
    select current_cycle_number
      into new.cycle_number
    from public.launches
    where id = new.launch_id;
  end if;

  new.cycle_number := coalesce(new.cycle_number, 1);
  return new;
end;
$$;

drop trigger if exists assign_lead_contacts_cycle_number on public.lead_contacts;
create trigger assign_lead_contacts_cycle_number
before insert on public.lead_contacts
for each row execute function public.assign_cycle_number_from_launch();

drop trigger if exists assign_lead_contact_identities_cycle_number on public.lead_contact_identities;
create trigger assign_lead_contact_identities_cycle_number
before insert on public.lead_contact_identities
for each row execute function public.assign_cycle_number_from_launch();

drop trigger if exists assign_inbound_contact_events_cycle_number on public.inbound_contact_events;
create trigger assign_inbound_contact_events_cycle_number
before insert on public.inbound_contact_events
for each row execute function public.assign_cycle_number_from_launch();

drop trigger if exists assign_contact_processing_logs_cycle_number on public.contact_processing_logs;
create trigger assign_contact_processing_logs_cycle_number
before insert on public.contact_processing_logs
for each row execute function public.assign_cycle_number_from_launch();

drop trigger if exists assign_contact_routing_actions_cycle_number on public.contact_routing_actions;
create trigger assign_contact_routing_actions_cycle_number
before insert on public.contact_routing_actions
for each row execute function public.assign_cycle_number_from_launch();

create table if not exists public.launch_cycle_archives (
  id uuid not null default gen_random_uuid() primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  cycle_number integer not null,
  file_name text not null,
  row_count integer not null default 0,
  csv_content text not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists idx_launch_cycle_archives_launch_cycle
  on public.launch_cycle_archives (launch_id, cycle_number);

create index if not exists idx_launch_cycle_archives_launch_created
  on public.launch_cycle_archives (launch_id, created_at desc);

alter table public.launch_cycle_archives enable row level security;

drop policy if exists "Users can view archives of their launches" on public.launch_cycle_archives;
create policy "Users can view archives of their launches"
  on public.launch_cycle_archives for select to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

create or replace function public.csv_escape(value text)
returns text
language sql
immutable
as $$
  select '"' || replace(replace(replace(coalesce(value, ''), E'\r', ' '), E'\n', ' '), '"', '""') || '"'
$$;

create or replace function public.advance_launch_cycle(target_launch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  launch_row public.launches%rowtype;
  cycle_row_count integer := 0;
  body_csv text;
  csv_content text;
  archive_row public.launch_cycle_archives%rowtype;
  next_cycle_number integer;
  safe_slug text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.user_owns_launch(current_user_id, target_launch_id) then
    raise exception 'Not authorized to advance this expert cycle';
  end if;

  select *
  into launch_row
  from public.launches
  where id = target_launch_id
  for update;

  if not found then
    raise exception 'Expert not found';
  end if;

  select count(*)
    into cycle_row_count
  from public.lead_contacts
  where launch_id = target_launch_id
    and cycle_number = launch_row.current_cycle_number;

  select string_agg(
    public.csv_escape(lead.primary_name) || ',' ||
    public.csv_escape(lead.primary_email) || ',' ||
    public.csv_escape(lead.primary_phone) || ',' ||
    public.csv_escape(lead.first_source) || ',' ||
    public.csv_escape(lead.last_source) || ',' ||
    public.csv_escape(lead.observed_sources) || ',' ||
    public.csv_escape(lead.observed_tags) || ',' ||
    public.csv_escape(lead.observed_aliases) || ',' ||
    public.csv_escape(lead.status) || ',' ||
    public.csv_escape(lead.merged_from_count::text) || ',' ||
    public.csv_escape(to_char(lead.created_at at time zone 'America/Bahia', 'YYYY-MM-DD HH24:MI:SS')) || ',' ||
    public.csv_escape(to_char(lead.updated_at at time zone 'America/Bahia', 'YYYY-MM-DD HH24:MI:SS')) || ',' ||
    public.csv_escape(lead.platform_snapshots),
    E'\n'
    order by lead.created_at, lead.id
  )
    into body_csv
  from (
    select
      lead.id,
      lead.primary_name,
      lead.primary_email,
      lead.primary_phone,
      lead.first_source,
      lead.last_source,
      lead.status,
      lead.merged_from_count,
      lead.created_at,
      lead.updated_at,
      coalesce(
        (
          select string_agg(value, ' | ' order by value)
          from jsonb_array_elements_text(coalesce(lead.data -> 'sources', '[]'::jsonb)) as source_list(value)
        ),
        ''
      ) as observed_sources,
      coalesce(
        (
          select string_agg(value, ' | ' order by value)
          from jsonb_array_elements_text(coalesce(lead.data -> 'journey' -> 'observed_tags', '[]'::jsonb)) as tag_list(value)
        ),
        ''
      ) as observed_tags,
      coalesce(
        (
          select string_agg(value, ' | ' order by value)
          from jsonb_array_elements_text(coalesce(lead.data -> 'journey' -> 'observed_aliases', '[]'::jsonb)) as alias_list(value)
        ),
        ''
      ) as observed_aliases,
      coalesce((lead.data -> 'platforms')::text, '{}') as platform_snapshots
    from public.lead_contacts as lead
    where lead.launch_id = target_launch_id
      and lead.cycle_number = launch_row.current_cycle_number
    order by lead.created_at, lead.id
  ) as lead;

  csv_content :=
    'nome,email,telefone,primeira_fonte,ultima_fonte,fontes_observadas,tags_observadas,aliases_observados,status,mesclas,criado_em,atualizado_em,platform_snapshots_json'
    || case when body_csv is null or body_csv = '' then '' else E'\n' || body_csv end;

  safe_slug := regexp_replace(coalesce(launch_row.slug, launch_row.name, 'expert'), '[^a-zA-Z0-9_-]+', '-', 'g');

  insert into public.launch_cycle_archives (
    launch_id,
    cycle_number,
    file_name,
    row_count,
    csv_content,
    summary,
    created_by
  )
  values (
    target_launch_id,
    launch_row.current_cycle_number,
    lower(trim(both '-' from safe_slug)) || '-ciclo-' || launch_row.current_cycle_number || '.csv',
    cycle_row_count,
    csv_content,
    jsonb_build_object(
      'expertName', launch_row.name,
      'cycleNumber', launch_row.current_cycle_number,
      'rowCount', cycle_row_count
    ),
    current_user_id
  )
  returning * into archive_row;

  update public.launches
  set current_cycle_number = current_cycle_number + 1,
      current_cycle_started_at = now()
  where id = target_launch_id
  returning current_cycle_number into next_cycle_number;

  return jsonb_build_object(
    'archive_id', archive_row.id,
    'file_name', archive_row.file_name,
    'row_count', archive_row.row_count,
    'previous_cycle_number', launch_row.current_cycle_number,
    'current_cycle_number', next_cycle_number,
    'csv_content', archive_row.csv_content
  );
end;
$$;

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
      'gs_service_account_email', launch_row.gs_service_account_email,
      'gs_private_key', launch_row.gs_private_key,
      'gs_spreadsheet_id', launch_row.gs_spreadsheet_id,
      'gs_sheet_name', launch_row.gs_sheet_name
    ),
    'uchat_workspaces', workspace_rows
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
language plpgsql security definer set search_path = public
as $$
declare updated_row public.launches%rowtype;
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to update expert credentials';
  end if;

  update public.launches
  set ac_api_url = nullif(btrim(next_api_url), ''),
      ac_api_key = nullif(btrim(next_api_key), ''),
      ac_default_list_id = nullif(btrim(next_default_list_id), ''),
      ac_named_tags = coalesce(next_named_tags, '[]'::jsonb)
  where id = target_launch_id
  returning * into updated_row;

  if not found then raise exception 'Expert not found'; end if;

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
    'gs_sheet_name', updated_row.gs_sheet_name
  );
end;
$$;

create or replace function public.update_launch_google_sheets_settings(
  target_launch_id uuid,
  next_enabled boolean default false,
  next_service_account_email text default null,
  next_private_key text default null,
  next_spreadsheet_id text default null,
  next_sheet_name text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare updated_row public.launches%rowtype;
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to update Google Sheets settings';
  end if;

  update public.launches
  set gs_enabled = coalesce(next_enabled, false),
      gs_service_account_email = nullif(btrim(coalesce(next_service_account_email, '')), ''),
      gs_private_key = nullif(next_private_key, ''),
      gs_spreadsheet_id = nullif(btrim(coalesce(next_spreadsheet_id, '')), ''),
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
    'gs_service_account_email', updated_row.gs_service_account_email,
    'gs_private_key', updated_row.gs_private_key,
    'gs_spreadsheet_id', updated_row.gs_spreadsheet_id,
    'gs_sheet_name', updated_row.gs_sheet_name
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
  updated_at timestamp with time zone
)
language sql
security definer
set search_path = public
as $$
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
  order by lead.updated_at desc
  limit greatest(coalesce(limit_count, 100), 1);
$$;

revoke select (
  gs_enabled,
  gs_service_account_email,
  gs_private_key,
  gs_spreadsheet_id,
  gs_sheet_name
) on public.launches from anon, authenticated;

revoke update (
  gs_enabled,
  gs_service_account_email,
  gs_private_key,
  gs_spreadsheet_id,
  gs_sheet_name
) on public.launches from anon, authenticated;

revoke all on function public.advance_launch_cycle(uuid) from public;
revoke all on function public.update_launch_google_sheets_settings(uuid, boolean, text, text, text, text) from public;
revoke all on function public.get_launch_visible_leads(uuid, integer) from public;

grant execute on function public.advance_launch_cycle(uuid) to authenticated;
grant execute on function public.get_launch_sources(uuid) to authenticated;
grant execute on function public.update_launch_activecampaign_settings(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.update_launch_google_sheets_settings(uuid, boolean, text, text, text, text) to authenticated;
grant execute on function public.get_launch_visible_leads(uuid, integer) to authenticated;
