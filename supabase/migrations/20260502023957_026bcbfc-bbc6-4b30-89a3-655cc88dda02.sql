create table if not exists public.platform_rate_limit_windows (
  provider text not null,
  scope_key text not null,
  window_started_at timestamp with time zone not null,
  limit_per_minute integer not null,
  request_count integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  primary key (provider, scope_key, window_started_at)
);

create index if not exists idx_platform_rate_limit_windows_updated_at
  on public.platform_rate_limit_windows (updated_at);

alter table public.platform_rate_limit_windows enable row level security;

create or replace function public.consume_platform_rate_limit(
  p_provider text,
  p_scope_key text,
  p_limit_per_minute integer,
  p_weight integer default 1
)
returns table (
  allowed boolean,
  provider text,
  scope_key text,
  limit_per_minute integer,
  request_count integer,
  retry_after_ms integer,
  window_started_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := lower(trim(coalesce(p_provider, 'unknown')));
  v_scope_key text := trim(coalesce(p_scope_key, 'global'));
  v_limit integer := greatest(coalesce(p_limit_per_minute, 1), 1);
  v_weight integer := greatest(coalesce(p_weight, 1), 1);
  v_window timestamp with time zone := date_trunc('minute', clock_timestamp());
  v_count integer;
  v_retry_after_ms integer;
begin
  if v_weight > v_limit then
    v_weight := v_limit;
  end if;

  delete from public.platform_rate_limit_windows
  where updated_at < clock_timestamp() - interval '10 minutes';

  insert into public.platform_rate_limit_windows (
    provider, scope_key, window_started_at, limit_per_minute, request_count, updated_at
  )
  values (
    v_provider, v_scope_key, v_window, v_limit, 0, clock_timestamp()
  )
  on conflict (provider, scope_key, window_started_at)
  do update set
    limit_per_minute = excluded.limit_per_minute,
    updated_at = public.platform_rate_limit_windows.updated_at;

  update public.platform_rate_limit_windows
  set
    request_count = public.platform_rate_limit_windows.request_count + v_weight,
    limit_per_minute = v_limit,
    updated_at = clock_timestamp()
  where
    platform_rate_limit_windows.provider = v_provider
    and platform_rate_limit_windows.scope_key = v_scope_key
    and platform_rate_limit_windows.window_started_at = v_window
    and platform_rate_limit_windows.request_count + v_weight <= v_limit
  returning platform_rate_limit_windows.request_count
  into v_count;

  if v_count is not null then
    return query select true, v_provider, v_scope_key, v_limit, v_count, 0, v_window;
    return;
  end if;

  select platform_rate_limit_windows.request_count
    into v_count
  from public.platform_rate_limit_windows
  where
    platform_rate_limit_windows.provider = v_provider
    and platform_rate_limit_windows.scope_key = v_scope_key
    and platform_rate_limit_windows.window_started_at = v_window;

  v_retry_after_ms := greatest(
    ceil(extract(epoch from ((v_window + interval '1 minute') - clock_timestamp())) * 1000)::integer,
    250
  );

  return query select false, v_provider, v_scope_key, v_limit, coalesce(v_count, 0), v_retry_after_ms, v_window;
end;
$$;

revoke all on table public.platform_rate_limit_windows from public;
revoke all on function public.consume_platform_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_platform_rate_limit(text, text, integer, integer) to service_role;