alter table public.hotmart_webhook_settings
  add column if not exists allowed_product_ids text[] not null default '{}'::text[],
  add column if not exists allowed_product_names text[] not null default '{}'::text[],
  add column if not exists allowed_offer_codes text[] not null default '{}'::text[];

create or replace function public.ensure_hotmart_webhook_settings(target_launch_id uuid)
returns table (
  launch_id uuid,
  enabled boolean,
  webhook_token text,
  allowed_product_ids text[],
  allowed_product_names text[],
  allowed_offer_codes text[],
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language sql
security definer
set search_path = public
as $$
  with authorized as (
    select target_launch_id as target_id
    where auth.uid() is not null
      and public.user_owns_launch(auth.uid(), target_launch_id)
  ),
  inserted as (
    insert into public.hotmart_webhook_settings (launch_id)
    select authorized.target_id
    from authorized
    on conflict on constraint hotmart_webhook_settings_pkey do nothing
    returning
      public.hotmart_webhook_settings.launch_id,
      public.hotmart_webhook_settings.enabled,
      public.hotmart_webhook_settings.webhook_token,
      public.hotmart_webhook_settings.allowed_product_ids,
      public.hotmart_webhook_settings.allowed_product_names,
      public.hotmart_webhook_settings.allowed_offer_codes,
      public.hotmart_webhook_settings.created_at,
      public.hotmart_webhook_settings.updated_at
  )
  select
    inserted.launch_id,
    inserted.enabled,
    inserted.webhook_token,
    inserted.allowed_product_ids,
    inserted.allowed_product_names,
    inserted.allowed_offer_codes,
    inserted.created_at,
    inserted.updated_at
  from inserted
  union all
  select
    existing.launch_id,
    existing.enabled,
    existing.webhook_token,
    existing.allowed_product_ids,
    existing.allowed_product_names,
    existing.allowed_offer_codes,
    existing.created_at,
    existing.updated_at
  from public.hotmart_webhook_settings as existing
  where existing.launch_id = target_launch_id
    and exists (select 1 from authorized)
    and not exists (select 1 from inserted);
$$;

create or replace function public.regenerate_hotmart_webhook_token(target_launch_id uuid)
returns table (
  launch_id uuid,
  enabled boolean,
  webhook_token text,
  allowed_product_ids text[],
  allowed_product_names text[],
  allowed_offer_codes text[],
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language sql
security definer
set search_path = public
as $$
  with authorized as (
    select target_launch_id as target_id
    where auth.uid() is not null
      and public.user_owns_launch(auth.uid(), target_launch_id)
  ),
  upserted as (
    insert into public.hotmart_webhook_settings (launch_id, webhook_token)
    select authorized.target_id, encode(extensions.gen_random_bytes(24), 'hex')
    from authorized
    on conflict on constraint hotmart_webhook_settings_pkey do update
      set webhook_token = excluded.webhook_token,
          updated_at = now()
    returning
      public.hotmart_webhook_settings.launch_id,
      public.hotmart_webhook_settings.enabled,
      public.hotmart_webhook_settings.webhook_token,
      public.hotmart_webhook_settings.allowed_product_ids,
      public.hotmart_webhook_settings.allowed_product_names,
      public.hotmart_webhook_settings.allowed_offer_codes,
      public.hotmart_webhook_settings.created_at,
      public.hotmart_webhook_settings.updated_at
  )
  select
    upserted.launch_id,
    upserted.enabled,
    upserted.webhook_token,
    upserted.allowed_product_ids,
    upserted.allowed_product_names,
    upserted.allowed_offer_codes,
    upserted.created_at,
    upserted.updated_at
  from upserted;
$$;

revoke all on function public.ensure_hotmart_webhook_settings(uuid) from public;
revoke all on function public.regenerate_hotmart_webhook_token(uuid) from public;
grant execute on function public.ensure_hotmart_webhook_settings(uuid) to authenticated;
grant execute on function public.regenerate_hotmart_webhook_token(uuid) to authenticated;
