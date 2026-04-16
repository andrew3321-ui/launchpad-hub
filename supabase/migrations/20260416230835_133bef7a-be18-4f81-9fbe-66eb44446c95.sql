ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

UPDATE public.launches
SET webhook_secret = encode(gen_random_bytes(18), 'hex')
WHERE webhook_secret IS NULL OR webhook_secret = '';

ALTER TABLE public.launches
  ALTER COLUMN webhook_secret SET DEFAULT encode(gen_random_bytes(18), 'hex');

ALTER TABLE public.launches
  ALTER COLUMN webhook_secret SET NOT NULL;

ALTER TABLE public.uchat_workspaces
  ADD COLUMN IF NOT EXISTS welcome_subflow_ns TEXT,
  ADD COLUMN IF NOT EXISTS default_tag_name TEXT;

ALTER TABLE public.lead_contact_identities
  DROP CONSTRAINT IF EXISTS lead_contact_identities_source_check;
ALTER TABLE public.lead_contact_identities
  ADD CONSTRAINT lead_contact_identities_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'sendflow', 'uchat', 'manual'));

ALTER TABLE public.inbound_contact_events
  DROP CONSTRAINT IF EXISTS inbound_contact_events_source_check;
ALTER TABLE public.inbound_contact_events
  ADD CONSTRAINT inbound_contact_events_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'sendflow', 'uchat', 'manual'));

ALTER TABLE public.contact_processing_logs
  DROP CONSTRAINT IF EXISTS contact_processing_logs_source_check;
ALTER TABLE public.contact_processing_logs
  ADD CONSTRAINT contact_processing_logs_source_check
  CHECK (source IN ('activecampaign', 'manychat', 'typebot', 'sendflow', 'uchat', 'manual'));

CREATE TABLE IF NOT EXISTS public.contact_routing_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.lead_contacts(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.inbound_contact_events(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_routing_actions_launch_created_at
  ON public.contact_routing_actions (launch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_routing_actions_contact
  ON public.contact_routing_actions (contact_id, created_at DESC);

ALTER TABLE public.contact_routing_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view routing actions of their launches"
    ON public.contact_routing_actions FOR SELECT TO authenticated
    USING (public.user_owns_launch(auth.uid(), launch_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create routing actions of their launches"
    ON public.contact_routing_actions FOR INSERT TO authenticated
    WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update routing actions of their launches"
    ON public.contact_routing_actions FOR UPDATE TO authenticated
    USING (public.user_owns_launch(auth.uid(), launch_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete routing actions of their launches"
    ON public.contact_routing_actions FOR DELETE TO authenticated
    USING (public.user_owns_launch(auth.uid(), launch_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS set_contact_routing_actions_updated_at ON public.contact_routing_actions;
CREATE TRIGGER set_contact_routing_actions_updated_at
  BEFORE UPDATE ON public.contact_routing_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();