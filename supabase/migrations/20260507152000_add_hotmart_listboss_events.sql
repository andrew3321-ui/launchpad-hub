create table if not exists public.hotmart_webhook_settings (
  launch_id uuid primary key references public.launches(id) on delete cascade,
  enabled boolean not null default true,
  webhook_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists ux_hotmart_webhook_settings_token
  on public.hotmart_webhook_settings (webhook_token);

drop trigger if exists set_hotmart_webhook_settings_updated_at on public.hotmart_webhook_settings;
create trigger set_hotmart_webhook_settings_updated_at
  before update on public.hotmart_webhook_settings
  for each row execute function public.set_updated_at();

alter table public.hotmart_webhook_settings enable row level security;

drop policy if exists "Users can view Hotmart settings of their experts" on public.hotmart_webhook_settings;
drop policy if exists "Users can manage Hotmart settings of their experts" on public.hotmart_webhook_settings;

create policy "Users can view Hotmart settings of their experts"
  on public.hotmart_webhook_settings
  for select
  to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

create policy "Users can manage Hotmart settings of their experts"
  on public.hotmart_webhook_settings
  for all
  to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id))
  with check (public.user_owns_launch(auth.uid(), launch_id));

create table if not exists public.hotmart_events (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  cycle_number integer,
  event_key text not null,
  event_type text not null,
  hotmart_event_id text,
  transaction_code text,
  purchase_status text,
  product_id text,
  product_name text,
  offer_code text,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  price_amount numeric,
  price_currency text,
  occurred_at timestamp with time zone,
  received_at timestamp with time zone not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  unique (launch_id, event_key)
);

create index if not exists idx_hotmart_events_launch_received
  on public.hotmart_events (launch_id, received_at desc);

create index if not exists idx_hotmart_events_launch_event_type
  on public.hotmart_events (launch_id, event_type, received_at desc);

create index if not exists idx_hotmart_events_launch_product
  on public.hotmart_events (launch_id, product_id, received_at desc);

create index if not exists idx_hotmart_events_launch_transaction
  on public.hotmart_events (launch_id, transaction_code, received_at desc)
  where transaction_code is not null;

alter table public.hotmart_events enable row level security;

drop policy if exists "Users can view Hotmart events of their experts" on public.hotmart_events;

create policy "Users can view Hotmart events of their experts"
  on public.hotmart_events
  for select
  to authenticated
  using (public.user_owns_launch(auth.uid(), launch_id));

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
    settings.launch_id,
    settings.enabled,
    settings.webhook_token,
    settings.created_at,
    settings.updated_at
  from public.hotmart_webhook_settings as settings
  where settings.launch_id = target_launch_id;
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

  insert into public.hotmart_webhook_settings (launch_id)
  values (target_launch_id)
  on conflict (launch_id) do update
    set webhook_token = encode(gen_random_bytes(24), 'hex'),
        updated_at = now();

  return query
  select
    settings.launch_id,
    settings.enabled,
    settings.webhook_token,
    settings.created_at,
    settings.updated_at
  from public.hotmart_webhook_settings as settings
  where settings.launch_id = target_launch_id;
end;
$$;

revoke all on function public.ensure_hotmart_webhook_settings(uuid) from public;
revoke all on function public.regenerate_hotmart_webhook_token(uuid) from public;
grant execute on function public.ensure_hotmart_webhook_settings(uuid) to authenticated;
grant execute on function public.regenerate_hotmart_webhook_token(uuid) to authenticated;
