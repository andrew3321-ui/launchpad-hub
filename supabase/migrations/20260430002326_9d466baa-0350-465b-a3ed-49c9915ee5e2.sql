create extension if not exists pg_cron;

create or replace function public.cleanup_stale_manychat_incomplete_contacts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  deleted_actions integer := 0;
  deleted_contacts integer := 0;
  deleted_events integer := 0;
  deleted_identities integer := 0;
  deleted_logs integer := 0;
begin
  create temporary table if not exists tmp_stale_manychat_contacts (
    id uuid primary key
  ) on commit drop;

  truncate table tmp_stale_manychat_contacts;

  insert into tmp_stale_manychat_contacts (id)
  select lead.id
  from public.lead_contacts as lead
  where lead.status = 'active'
    and lead.first_source = 'manychat'
    and lead.created_at < now() - interval '90 minutes'
    and nullif(btrim(coalesce(lead.primary_email, '')), '') is null
    and nullif(btrim(coalesce(lead.normalized_phone, lead.primary_phone, '')), '') is null
    and coalesce(lead.data ->> 'manychatCompletionRequired', 'true') = 'true';

  delete from public.contact_processing_logs as log
  using tmp_stale_manychat_contacts as stale
  where log.contact_id = stale.id;
  get diagnostics deleted_logs = row_count;

  delete from public.contact_processing_logs as log
  using public.inbound_contact_events as event, tmp_stale_manychat_contacts as stale
  where log.event_id = event.id
    and event.processed_contact_id = stale.id;
  get diagnostics affected_count = row_count;
  deleted_logs := deleted_logs + affected_count;

  delete from public.contact_routing_actions as action
  using tmp_stale_manychat_contacts as stale
  where action.contact_id = stale.id;
  get diagnostics deleted_actions = row_count;

  delete from public.lead_contact_identities as ident
  using tmp_stale_manychat_contacts as stale
  where ident.contact_id = stale.id;
  get diagnostics deleted_identities = row_count;

  delete from public.inbound_contact_events as event
  using tmp_stale_manychat_contacts as stale
  where event.processed_contact_id = stale.id;
  get diagnostics deleted_events = row_count;

  delete from public.lead_contacts as lead
  using tmp_stale_manychat_contacts as stale
  where lead.id = stale.id;
  get diagnostics deleted_contacts = row_count;

  return jsonb_build_object(
    'deletedActions', deleted_actions,
    'deletedContacts', deleted_contacts,
    'deletedEvents', deleted_events,
    'deletedIdentities', deleted_identities,
    'deletedLogs', deleted_logs,
    'executedAt', now()
  );
end;
$$;

do $$
begin
  perform cron.unschedule('launchhub-manychat-incomplete-cleanup');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'launchhub-manychat-incomplete-cleanup',
  '*/15 * * * *',
  $cron$select public.cleanup_stale_manychat_incomplete_contacts();$cron$
);

revoke all on function public.cleanup_stale_manychat_incomplete_contacts() from public;