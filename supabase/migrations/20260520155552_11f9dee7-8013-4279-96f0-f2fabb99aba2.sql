-- Prevent new webhook records from silently falling back to cycle #1 after a cycle change.
alter table public.lead_contacts
  alter column cycle_number drop default;

alter table public.lead_contact_identities
  alter column cycle_number drop default;

alter table public.inbound_contact_events
  alter column cycle_number drop default;

alter table public.contact_processing_logs
  alter column cycle_number drop default;

alter table public.contact_routing_actions
  alter column cycle_number drop default;

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

-- Backfill events and operational logs created after the current cycle started.
update public.inbound_contact_events as event
set cycle_number = launch.current_cycle_number
from public.launches as launch
where event.launch_id = launch.id
  and event.cycle_number is distinct from launch.current_cycle_number
  and launch.current_cycle_started_at is not null
  and event.received_at >= launch.current_cycle_started_at;

update public.contact_processing_logs as log
set cycle_number = launch.current_cycle_number
from public.launches as launch
where log.launch_id = launch.id
  and log.cycle_number is distinct from launch.current_cycle_number
  and launch.current_cycle_started_at is not null
  and log.created_at >= launch.current_cycle_started_at;

update public.contact_routing_actions as action
set cycle_number = launch.current_cycle_number
from public.launches as launch
where action.launch_id = launch.id
  and action.cycle_number is distinct from launch.current_cycle_number
  and launch.current_cycle_started_at is not null
  and action.created_at >= launch.current_cycle_started_at;

update public.hotmart_events as event
set cycle_number = launch.current_cycle_number
from public.launches as launch
where event.launch_id = launch.id
  and event.cycle_number is distinct from launch.current_cycle_number
  and launch.current_cycle_started_at is not null
  and event.received_at >= launch.current_cycle_started_at;