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

-- 20260416173000_add_webhook_router_actions.sql
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_routing_actions_live_action_key
  ON public.contact_routing_actions (launch_id, contact_id, source, target, action_type, action_key)
  WHERE action_key IS NOT NULL
    AND status IN ('pending', 'success');

ALTER TABLE public.contact_routing_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view routing actions of their launches"
  ON public.contact_routing_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_routing_actions.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create routing actions of their launches"
  ON public.contact_routing_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_routing_actions.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update routing actions of their launches"
  ON public.contact_routing_actions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_routing_actions.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete routing actions of their launches"
  ON public.contact_routing_actions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = contact_routing_actions.launch_id
      AND launches.created_by = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS set_contact_routing_actions_updated_at ON public.contact_routing_actions;

CREATE TRIGGER set_contact_routing_actions_updated_at
  BEFORE UPDATE ON public.contact_routing_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260416195500_fix_uchat_workspace_rls_and_drafts.sql
CREATE OR REPLACE FUNCTION public.user_owns_launch(_user_id uuid, _launch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.launches
    WHERE launches.id = _launch_id
      AND (
        launches.created_by = _user_id
        OR EXISTS (
          SELECT 1
          FROM public.projects
          WHERE projects.id = launches.project_id
            AND projects.created_by = _user_id
        )
      )
  );
$$;

ALTER TABLE public.uchat_workspaces
  ALTER COLUMN bot_id DROP NOT NULL,
  ALTER COLUMN workspace_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can view workspaces of their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can create workspaces for their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can update workspaces of their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can delete workspaces of their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can view their workspaces" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can create their workspaces" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can update their workspaces" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can delete their workspaces" ON public.uchat_workspaces;

CREATE POLICY "Users can view workspaces of their launches"
  ON public.uchat_workspaces FOR SELECT
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

CREATE POLICY "Users can create workspaces for their launches"
  ON public.uchat_workspaces FOR INSERT
  TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));

CREATE POLICY "Users can update workspaces of their launches"
  ON public.uchat_workspaces FOR UPDATE
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id))
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));

CREATE POLICY "Users can delete workspaces of their launches"
  ON public.uchat_workspaces FOR DELETE
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- 20260417223000_harden_auth_approvals_and_first_login.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE;

UPDATE public.profiles AS profiles
SET
  email = lower(coalesce(users.email, profiles.email)),
  full_name = coalesce(nullif(profiles.full_name, ''), users.raw_user_meta_data->>'full_name', profiles.full_name)
FROM auth.users AS users
WHERE users.id = profiles.user_id;

ALTER TABLE public.profiles
  ALTER COLUMN email SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_approval_status_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_email_megafone_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_approval_status_check
  CHECK (approval_status IN ('approved', 'pending', 'rejected'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_email_megafone_check
  CHECK (email ~* '^[^@[:space:]]+@megafone\.digital$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
  ON public.profiles (email);

CREATE INDEX IF NOT EXISTS idx_profiles_approval_status_created_at
  ON public.profiles (approval_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = _user_id
      AND profiles.is_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = _user_id
      AND profiles.approval_status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.validate_allowed_signup_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS NULL OR lower(trim(NEW.email)) !~ '^[^@[:space:]]+@megafone\.digital$' THEN
    RAISE EXCEPTION 'Only @megafone.digital emails can sign up';
  END IF;

  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_allowed_signup_email_on_auth_user ON auth.users;

CREATE TRIGGER validate_allowed_signup_email_on_auth_user
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.validate_allowed_signup_email();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email TEXT := lower(trim(coalesce(NEW.email, '')));
  is_seed_admin BOOLEAN := normalized_email = ANY (
    ARRAY[
      'andrehugo@megafone.digital',
      'victorbezerra@megafone.digital',
      'joaofelipeoliveira@megafone.digital'
    ]
  );
BEGIN
  INSERT INTO public.profiles (
    user_id,
    email,
    full_name,
    is_admin,
    approval_status,
    approval_reviewed_at,
    must_change_password
  )
  VALUES (
    NEW.id,
    normalized_email,
    coalesce(NEW.raw_user_meta_data->>'full_name', ''),
    is_seed_admin,
    CASE WHEN is_seed_admin THEN 'approved' ELSE 'pending' END,
    CASE WHEN is_seed_admin THEN now() ELSE NULL END,
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    is_admin = excluded.is_admin,
    approval_status = CASE
      WHEN public.profiles.approval_status = 'approved' AND public.profiles.is_admin = false THEN public.profiles.approval_status
      ELSE excluded.approval_status
    END,
    approval_reviewed_at = coalesce(public.profiles.approval_reviewed_at, excluded.approval_reviewed_at),
    must_change_password = coalesce(public.profiles.must_change_password, true);

  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET
  is_admin = (
    email = ANY (
      ARRAY[
        'andrehugo@megafone.digital',
        'victorbezerra@megafone.digital',
        'joaofelipeoliveira@megafone.digital'
      ]
    )
  ),
  approval_status = 'approved',
  approval_reviewed_at = coalesce(approval_reviewed_at, now()),
  must_change_password = true
WHERE email IS NOT NULL;

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can review signup profiles" ON public.profiles;

CREATE OR REPLACE FUNCTION public.handle_auth_user_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    UPDATE public.profiles
    SET
      must_change_password = false,
      password_changed_at = now()
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_password_changed ON auth.users;

CREATE TRIGGER on_auth_user_password_changed
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_password_change();

CREATE OR REPLACE FUNCTION public.review_signup_request(target_profile_id UUID, next_status TEXT)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can review signup requests';
  END IF;

  IF next_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid signup review status';
  END IF;

  UPDATE public.profiles
  SET
    approval_status = next_status,
    approval_reviewed_by = auth.uid(),
    approval_reviewed_at = now()
  WHERE id = target_profile_id
    AND is_admin = false
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signup request not found';
  END IF;

  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_signup_requests()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  must_change_password BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    profiles.id,
    profiles.user_id,
    profiles.email,
    profiles.full_name,
    profiles.created_at,
    profiles.must_change_password
  FROM public.profiles
  WHERE public.is_platform_admin(auth.uid())
    AND profiles.approval_status = 'pending'
    AND profiles.is_admin = false
  ORDER BY profiles.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.review_signup_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_signup_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_owns_launch(_user_id uuid, _launch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved_user(_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.launches
      WHERE launches.id = _launch_id
        AND (
          launches.created_by = _user_id
          OR EXISTS (
            SELECT 1
            FROM public.projects
            WHERE projects.id = launches.project_id
              AND projects.created_by = _user_id
          )
        )
    );
$$;

DROP POLICY IF EXISTS "Authenticated users can view launches" ON public.launches;
DROP POLICY IF EXISTS "Users can create launches" ON public.launches;
DROP POLICY IF EXISTS "Users can update their own launches" ON public.launches;
DROP POLICY IF EXISTS "Users can delete their own launches" ON public.launches;
DROP POLICY IF EXISTS "Users can view their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can create their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can update their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can delete their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can view launches of their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can create launches for their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can update launches of their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can delete launches of their projects" ON public.launches;

CREATE POLICY "Users can view their launches"
  ON public.launches FOR SELECT
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), id));

CREATE POLICY "Users can create their launches"
  ON public.launches FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_approved_user(auth.uid())
    AND created_by = auth.uid()
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.projects
        WHERE projects.id = launches.project_id
          AND projects.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update their launches"
  ON public.launches FOR UPDATE
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), id))
  WITH CHECK (
    public.is_approved_user(auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.projects
        WHERE projects.id = launches.project_id
          AND projects.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete their launches"
  ON public.launches FOR DELETE
  TO authenticated
  USING (public.user_owns_launch(auth.uid(), id));
