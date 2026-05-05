create table if not exists public.platform_alert_settings (
  id text not null default 'global' primary key,
  discord_enabled boolean not null default false,
  discord_webhook_url text,
  alert_levels text[] not null default array['error']::text[],
  alert_sources text[] not null default array[
    'activecampaign',
    'manychat',
    'typebot',
    'tally',
    'sendflow',
    'uchat'
  ]::text[],
  min_repeat_interval_seconds integer not null default 300,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint platform_alert_settings_singleton_check check (id = 'global'),
  constraint platform_alert_settings_discord_url_check check (
    discord_webhook_url is null
    or discord_webhook_url ~ '^https://(discord(app)?\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_.-]+$'
  ),
  constraint platform_alert_settings_repeat_interval_check check (
    min_repeat_interval_seconds between 0 and 86400
  )
);

insert into public.platform_alert_settings (id)
values ('global')
on conflict (id) do nothing;

drop trigger if exists set_platform_alert_settings_updated_at on public.platform_alert_settings;
create trigger set_platform_alert_settings_updated_at
before update on public.platform_alert_settings
for each row execute function public.set_updated_at();

alter table public.platform_alert_settings enable row level security;

drop policy if exists "Admins can view platform alert settings" on public.platform_alert_settings;
drop policy if exists "Admins can manage platform alert settings" on public.platform_alert_settings;

create policy "Admins can view platform alert settings"
  on public.platform_alert_settings
  for select
  to authenticated
  using (public.is_platform_admin(auth.uid()));

create policy "Admins can manage platform alert settings"
  on public.platform_alert_settings
  for all
  to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

create table if not exists public.alert_delivery_logs (
  id uuid not null default gen_random_uuid() primary key,
  channel text not null default 'discord',
  launch_id uuid references public.launches(id) on delete cascade,
  source text not null,
  level text not null,
  code text not null,
  dedupe_key text not null,
  status text not null check (status in ('success', 'failed', 'skipped')),
  error_message text,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_alert_delivery_logs_dedupe_lookup
  on public.alert_delivery_logs (channel, dedupe_key, created_at desc);

create index if not exists idx_alert_delivery_logs_launch_created
  on public.alert_delivery_logs (launch_id, created_at desc);

alter table public.alert_delivery_logs enable row level security;

drop policy if exists "Admins can view alert delivery logs" on public.alert_delivery_logs;

create policy "Admins can view alert delivery logs"
  on public.alert_delivery_logs
  for select
  to authenticated
  using (public.is_platform_admin(auth.uid()));

create or replace function public.get_alert_settings()
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
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Only admins can view alert settings';
  end if;

  insert into public.platform_alert_settings (id)
  values ('global')
  on conflict (id) do nothing;

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
    'uchat'
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
    'uchat'
  ]::text[])
    into normalized_sources
  from (
    select unnest(coalesce(next_alert_sources, array[
      'activecampaign',
      'manychat',
      'typebot',
      'tally',
      'sendflow',
      'uchat'
    ]::text[])) as allowed_source
  ) sources
  where allowed_source in ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat');

  if normalized_sources is null or cardinality(normalized_sources) = 0 then
    normalized_sources := array['activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat']::text[];
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

revoke all on function public.get_alert_settings() from public;
revoke all on function public.update_discord_alert_settings(boolean, text, text[], text[], integer) from public;

grant execute on function public.get_alert_settings() to authenticated;
grant execute on function public.update_discord_alert_settings(boolean, text, text[], text[], integer) to authenticated;