create or replace function public.ensure_hotmart_webhook_settings(target_launch_id uuid)
returns table (
  launch_id uuid,
  enabled boolean,
  webhook_token text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to manage Hotmart settings';
  end if;

  insert into public.hotmart_webhook_settings (launch_id)
  values (target_launch_id)
  on conflict (launch_id) do nothing;

  return query
  select
    hotmart_settings.launch_id,
    hotmart_settings.enabled,
    hotmart_settings.webhook_token,
    hotmart_settings.created_at,
    hotmart_settings.updated_at
  from public.hotmart_webhook_settings as hotmart_settings
  where hotmart_settings.launch_id = target_launch_id;
end;
$$;

create or replace function public.regenerate_hotmart_webhook_token(target_launch_id uuid)
returns table (
  launch_id uuid,
  enabled boolean,
  webhook_token text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to manage Hotmart settings';
  end if;

  insert into public.hotmart_webhook_settings as hotmart_settings (launch_id)
  values (target_launch_id)
  on conflict (launch_id) do update
    set webhook_token = encode(gen_random_bytes(24), 'hex'),
        updated_at = now();

  return query
  select
    hotmart_settings.launch_id,
    hotmart_settings.enabled,
    hotmart_settings.webhook_token,
    hotmart_settings.created_at,
    hotmart_settings.updated_at
  from public.hotmart_webhook_settings as hotmart_settings
  where hotmart_settings.launch_id = target_launch_id;
end;
$$;

revoke all on function public.ensure_hotmart_webhook_settings(uuid) from public;
revoke all on function public.regenerate_hotmart_webhook_token(uuid) from public;
grant execute on function public.ensure_hotmart_webhook_settings(uuid) to authenticated;
grant execute on function public.regenerate_hotmart_webhook_token(uuid) to authenticated;
