-- Bootstrap manual do schema do Launch Hub.
-- Execute este arquivo apenas em um projeto novo, preferencialmente vazio.
-- Se preferir, rode os arquivos de supabase/migrations em ordem cronologica.

-- 20260415202618_f4c6d87b-ee5e-4026-8c56-382b340a36a2.sql
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.launches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.launches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view launches"
  ON public.launches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create launches"
  ON public.launches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own launches"
  ON public.launches FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own launches"
  ON public.launches FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- 20260415203022_5cef5675-e810-4003-8ad0-f5da8fb7c26f.sql
ALTER TABLE public.launches
  ADD COLUMN slug TEXT UNIQUE,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN custom_states JSONB NOT NULL DEFAULT '["cadastrado","boas_vindas_enviado","entrou_grupo","ativo"]'::jsonb,
  ADD COLUMN whatsapp_group_link TEXT,
  ADD COLUMN ac_api_url TEXT,
  ADD COLUMN ac_api_key TEXT,
  ADD COLUMN ac_default_list_id TEXT,
  ADD COLUMN ac_named_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX idx_launches_slug ON public.launches (slug);

CREATE TABLE public.uchat_workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  workspace_name TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  api_token TEXT NOT NULL,
  max_subscribers INTEGER NOT NULL DEFAULT 1000,
  current_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.uchat_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspaces of their launches"
  ON public.uchat_workspaces FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = uchat_workspaces.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create workspaces for their launches"
  ON public.uchat_workspaces FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = uchat_workspaces.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update workspaces of their launches"
  ON public.uchat_workspaces FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = uchat_workspaces.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete workspaces of their launches"
  ON public.uchat_workspaces FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = uchat_workspaces.launch_id
      AND launches.created_by = auth.uid()
    )
  );

-- 20260415212000_add_manychat_and_dedupe_settings.sql
ALTER TABLE public.launches
  ADD COLUMN manychat_api_url TEXT,
  ADD COLUMN manychat_api_key TEXT,
  ADD COLUMN manychat_account_id TEXT;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public.launch_dedupe_settings (
  launch_id UUID PRIMARY KEY REFERENCES public.launches(id) ON DELETE CASCADE,
  compare_digits_only BOOLEAN NOT NULL DEFAULT true,
  auto_add_country_code BOOLEAN NOT NULL DEFAULT true,
  default_country_code TEXT NOT NULL DEFAULT '55',
  auto_add_ninth_digit BOOLEAN NOT NULL DEFAULT true,
  merge_on_exact_phone BOOLEAN NOT NULL DEFAULT true,
  merge_on_exact_email BOOLEAN NOT NULL DEFAULT true,
  auto_merge_duplicates BOOLEAN NOT NULL DEFAULT true,
  prefer_most_complete_record BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.launch_dedupe_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create dedupe settings for their launches"
  ON public.launch_dedupe_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE TRIGGER set_launch_dedupe_settings_updated_at
  BEFORE UPDATE ON public.launch_dedupe_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260415224500_add_contact_processing_pipeline.sql
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

-- 20260416093000_add_platform_sync_runs.sql
CREATE TABLE public.platform_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('activecampaign', 'uchat')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_platform_sync_runs_launch_started
  ON public.platform_sync_runs (launch_id, started_at DESC);

CREATE INDEX idx_platform_sync_runs_launch_source
  ON public.platform_sync_runs (launch_id, source, started_at DESC);

ALTER TABLE public.platform_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync runs of their launches"
  ON public.platform_sync_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create sync runs for their launches"
  ON public.platform_sync_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update sync runs of their launches"
  ON public.platform_sync_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete sync runs of their launches"
  ON public.platform_sync_runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );
