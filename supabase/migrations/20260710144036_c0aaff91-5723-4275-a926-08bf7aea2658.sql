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
    '',
    jsonb_build_object(
      'expertName', launch_row.name,
      'cycleNumber', launch_row.current_cycle_number,
      'rowCount', cycle_row_count,
      'csvPending', true
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
    'csv_pending', true
  );
end;
$$;

revoke all on function public.advance_launch_cycle(uuid) from public;
revoke all on function public.advance_launch_cycle(uuid) from anon;
grant execute on function public.advance_launch_cycle(uuid) to authenticated;

create or replace function public.build_launch_cycle_archive_csv(target_archive_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  archive_row public.launch_cycle_archives%rowtype;
  body_csv text;
  generated_csv text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into archive_row
  from public.launch_cycle_archives
  where id = target_archive_id;

  if not found then
    raise exception 'Archive not found';
  end if;

  if not public.user_owns_launch(auth.uid(), archive_row.launch_id) then
    raise exception 'Not authorized';
  end if;

  if archive_row.csv_content is not null and length(archive_row.csv_content) > 0 then
    return jsonb_build_object(
      'archive_id', archive_row.id,
      'file_name', archive_row.file_name,
      'row_count', archive_row.row_count,
      'csv_content', archive_row.csv_content
    );
  end if;

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
    where lead.launch_id = archive_row.launch_id
      and lead.cycle_number = archive_row.cycle_number
    order by lead.created_at, lead.id
  ) as lead;

  generated_csv :=
    'nome,email,telefone,primeira_fonte,ultima_fonte,fontes_observadas,tags_observadas,aliases_observados,status,mesclas,criado_em,atualizado_em,platform_snapshots_json'
    || case when body_csv is null or body_csv = '' then '' else E'\n' || body_csv end;

  update public.launch_cycle_archives
  set csv_content = generated_csv,
      summary = coalesce(summary, '{}'::jsonb) - 'csvPending'
  where id = archive_row.id;

  return jsonb_build_object(
    'archive_id', archive_row.id,
    'file_name', archive_row.file_name,
    'row_count', archive_row.row_count,
    'csv_content', generated_csv
  );
end;
$$;

revoke all on function public.build_launch_cycle_archive_csv(uuid) from public;
revoke all on function public.build_launch_cycle_archive_csv(uuid) from anon;
grant execute on function public.build_launch_cycle_archive_csv(uuid) to authenticated;