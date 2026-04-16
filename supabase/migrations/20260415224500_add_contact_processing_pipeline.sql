CREATE TABLE public.lead_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  primary_name TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  normalized_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'invalid')),
  merged_from_count INTEGER NOT NULL DEFAULT 0,
  first_source TEXT,
  last_source TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_contacts_launch_id ON public.lead_contacts (launch_id);
CREATE INDEX idx_lead_contacts_launch_email ON public.lead_contacts (launch_id, primary_email);
CREATE INDEX idx_lead_contacts_launch_phone ON public.lead_contacts (launch_id, normalized_phone);

ALTER TABLE public.lead_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts of their launches"
  ON public.lead_contacts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contacts.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create contacts for their launches"
  ON public.lead_contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contacts.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update contacts of their launches"
  ON public.lead_contacts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contacts.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete contacts of their launches"
  ON public.lead_contacts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contacts.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE TRIGGER set_lead_contacts_updated_at
  BEFORE UPDATE ON public.lead_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.lead_contact_identities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.lead_contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('activecampaign', 'manychat', 'uchat', 'manual')),
  external_contact_id TEXT,
  external_email TEXT,
  external_phone TEXT,
  normalized_phone TEXT,
  raw_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_contact_identities_launch_contact ON public.lead_contact_identities (launch_id, contact_id);
CREATE INDEX idx_lead_contact_identities_launch_source_external_id ON public.lead_contact_identities (launch_id, source, external_contact_id);
CREATE INDEX idx_lead_contact_identities_launch_phone ON public.lead_contact_identities (launch_id, normalized_phone);
CREATE UNIQUE INDEX idx_lead_contact_identities_unique_external
  ON public.lead_contact_identities (launch_id, source, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

ALTER TABLE public.lead_contact_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view identities of their launches"
  ON public.lead_contact_identities FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contact_identities.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create identities for their launches"
  ON public.lead_contact_identities FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contact_identities.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update identities of their launches"
  ON public.lead_contact_identities FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contact_identities.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete identities of their launches"
  ON public.lead_contact_identities FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = lead_contact_identities.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE TRIGGER set_lead_contact_identities_updated_at
  BEFORE UPDATE ON public.lead_contact_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.inbound_contact_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('activecampaign', 'manychat', 'uchat', 'manual')),
  event_type TEXT NOT NULL,
  external_contact_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'ignored', 'error')),
  processed_contact_id UUID REFERENCES public.lead_contacts(id) ON DELETE SET NULL,
  processing_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_inbound_contact_events_launch_received ON public.inbound_contact_events (launch_id, received_at DESC);
CREATE INDEX idx_inbound_contact_events_launch_status ON public.inbound_contact_events (launch_id, processing_status);

ALTER TABLE public.inbound_contact_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inbound events of their launches"
  ON public.inbound_contact_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = inbound_contact_events.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create inbound events for their launches"
  ON public.inbound_contact_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = inbound_contact_events.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update inbound events of their launches"
  ON public.inbound_contact_events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = inbound_contact_events.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE TABLE public.contact_processing_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.inbound_contact_events(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.lead_contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('activecampaign', 'manychat', 'uchat', 'manual')),
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error', 'success')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_processing_logs_launch_created ON public.contact_processing_logs (launch_id, created_at DESC);
CREATE INDEX idx_contact_processing_logs_launch_source ON public.contact_processing_logs (launch_id, source);
CREATE INDEX idx_contact_processing_logs_launch_level ON public.contact_processing_logs (launch_id, level);

ALTER TABLE public.contact_processing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view processing logs of their launches"
  ON public.contact_processing_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_processing_logs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create processing logs for their launches"
  ON public.contact_processing_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_processing_logs.launch_id
      AND launches.created_by = auth.uid()
    )
  );
