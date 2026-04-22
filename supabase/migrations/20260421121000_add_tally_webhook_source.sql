ALTER TABLE public.lead_contact_identities
  DROP CONSTRAINT IF EXISTS lead_contact_identities_source_check;

ALTER TABLE public.lead_contact_identities
  ADD CONSTRAINT lead_contact_identities_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual'));

ALTER TABLE public.inbound_contact_events
  DROP CONSTRAINT IF EXISTS inbound_contact_events_source_check;

ALTER TABLE public.inbound_contact_events
  ADD CONSTRAINT inbound_contact_events_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual'));

ALTER TABLE public.contact_processing_logs
  DROP CONSTRAINT IF EXISTS contact_processing_logs_source_check;

ALTER TABLE public.contact_processing_logs
  ADD CONSTRAINT contact_processing_logs_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'tally', 'sendflow', 'uchat', 'manual'));
