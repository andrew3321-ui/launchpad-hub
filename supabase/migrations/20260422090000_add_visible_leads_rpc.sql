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
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_owns_launch(auth.uid(), target_launch_id) then
    raise exception 'Not authorized to access visible leads';
  end if;

  return query
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
  where lead.launch_id = target_launch_id
    and exists (
      select 1
      from public.inbound_contact_events as event
      where event.launch_id = target_launch_id
        and event.processed_contact_id = lead.id
        and event.processing_status = 'processed'
        and event.event_type not in ('contact_import', 'subscriber_import')
    )
  order by lead.updated_at desc
  limit greatest(coalesce(limit_count, 100), 1);
end;
$$;

revoke all on function public.get_launch_visible_leads(uuid, integer) from public;
grant execute on function public.get_launch_visible_leads(uuid, integer) to authenticated;
