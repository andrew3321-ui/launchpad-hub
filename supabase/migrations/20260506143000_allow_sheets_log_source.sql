alter table public.contact_processing_logs
  drop constraint if exists contact_processing_logs_source_check;

alter table public.contact_processing_logs
  add constraint contact_processing_logs_source_check
  check (source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual', 'sheets'));

alter table public.contact_technical_logs
  drop constraint if exists contact_technical_logs_source_check;

alter table public.contact_technical_logs
  add constraint contact_technical_logs_source_check
  check (source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual', 'sheets'));

update public.platform_alert_settings
set alert_sources = array_append(alert_sources, 'sheets')
where id = 'global'
  and not ('sheets' = any(alert_sources));

create or replace function public.update_discord_alert_settings(
  next_discord_enabled boolean default false,
  next_discord_webhook_url text default null,
  next_alert_levels text[] default array['error']::text[],
  next_alert_sources text[] default array[
    'activecampaign',
    'manychat',
    'typebot',
    'tally',
    'sendflow',
    'uchat',
    'sheets'
  ]::text[],
  next_min_repeat_interval_seconds integer default 300
)
returns table (
  discord_enabled boolean,
  discord_webhook_url text,
  alert_levels text[],
  alert_sources text[],
  min_repeat_interval_seconds integer,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_url text := nullif(btrim(coalesce(next_discord_webhook_url, '')), '');
  normalized_levels text[];
  normalized_sources text[];
  normalized_interval integer := least(greatest(coalesce(next_min_repeat_interval_seconds, 300), 0), 86400);
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Only admins can update alert settings';
  end if;

  if normalized_url is not null
    and normalized_url !~ '^https://(discord(app)?\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_.-]+$' then
    raise exception 'Invalid Discord webhook URL';
  end if;

  select coalesce(array_agg(distinct allowed_level), array['error']::text[])
    into normalized_levels
  from (
    select unnest(coalesce(next_alert_levels, array['error']::text[])) as allowed_level
  ) levels
  where allowed_level in ('info', 'warning', 'error', 'success');

  if normalized_levels is null or cardinality(normalized_levels) = 0 then
    normalized_levels := array['error']::text[];
  end if;

  select coalesce(array_agg(distinct allowed_source), array[
    'activecampaign',
    'manychat',
    'typebot',
    'tally',
    'sendflow',
    'uchat',
    'sheets'
  ]::text[])
    into normalized_sources
  from (
    select unnest(coalesce(next_alert_sources, array[
      'activecampaign',
      'manychat',
      'typebot',
      'tally',
      'sendflow',
      'uchat',
      'sheets'
    ]::text[])) as allowed_source
  ) sources
  where allowed_source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'sheets');

  if normalized_sources is null or cardinality(normalized_sources) = 0 then
    normalized_sources := array['activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'sheets']::text[];
  end if;

  insert into public.platform_alert_settings (
    id,
    discord_enabled,
    discord_webhook_url,
    alert_levels,
    alert_sources,
    min_repeat_interval_seconds,
    updated_by
  )
  values (
    'global',
    coalesce(next_discord_enabled, false),
    normalized_url,
    normalized_levels,
    normalized_sources,
    normalized_interval,
    auth.uid()
  )
  on conflict (id) do update
    set discord_enabled = excluded.discord_enabled,
        discord_webhook_url = excluded.discord_webhook_url,
        alert_levels = excluded.alert_levels,
        alert_sources = excluded.alert_sources,
        min_repeat_interval_seconds = excluded.min_repeat_interval_seconds,
        updated_by = excluded.updated_by;

  return query
  select
    settings.discord_enabled,
    settings.discord_webhook_url,
    settings.alert_levels,
    settings.alert_sources,
    settings.min_repeat_interval_seconds,
    settings.updated_at
  from public.platform_alert_settings as settings
  where settings.id = 'global';
end;
$$;
