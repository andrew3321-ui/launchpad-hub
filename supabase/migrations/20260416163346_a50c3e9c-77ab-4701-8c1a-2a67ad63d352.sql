
-- Fix launches policies to allow direct created_by access
DROP POLICY IF EXISTS "Users can view launches of their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can create launches for their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can update launches of their projects" ON public.launches;
DROP POLICY IF EXISTS "Users can delete launches of their projects" ON public.launches;

CREATE POLICY "Users can view their launches" ON public.launches FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));

CREATE POLICY "Users can create their launches" ON public.launches FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their launches" ON public.launches FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));

CREATE POLICY "Users can delete their launches" ON public.launches FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));

-- Helper function to check launch ownership
CREATE OR REPLACE FUNCTION public.user_owns_launch(_user_id uuid, _launch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM launches
    WHERE id = _launch_id
      AND (created_by = _user_id OR EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = _user_id))
  )
$$;

-- Fix launch_dedupe_settings policies
DROP POLICY IF EXISTS "Users can view dedupe settings of their launches" ON public.launch_dedupe_settings;
DROP POLICY IF EXISTS "Users can create dedupe settings for their launches" ON public.launch_dedupe_settings;
DROP POLICY IF EXISTS "Users can update dedupe settings of their launches" ON public.launch_dedupe_settings;
DROP POLICY IF EXISTS "Users can delete dedupe settings of their launches" ON public.launch_dedupe_settings;

CREATE POLICY "Users can view dedupe settings of their launches" ON public.launch_dedupe_settings FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create dedupe settings for their launches" ON public.launch_dedupe_settings FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update dedupe settings of their launches" ON public.launch_dedupe_settings FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can delete dedupe settings of their launches" ON public.launch_dedupe_settings FOR DELETE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- Fix lead_contacts policies
DROP POLICY IF EXISTS "Users can view contacts of their launches" ON public.lead_contacts;
DROP POLICY IF EXISTS "Users can create contacts for their launches" ON public.lead_contacts;
DROP POLICY IF EXISTS "Users can update contacts of their launches" ON public.lead_contacts;
DROP POLICY IF EXISTS "Users can delete contacts of their launches" ON public.lead_contacts;

CREATE POLICY "Users can view contacts of their launches" ON public.lead_contacts FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create contacts for their launches" ON public.lead_contacts FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update contacts of their launches" ON public.lead_contacts FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can delete contacts of their launches" ON public.lead_contacts FOR DELETE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- Fix lead_contact_identities policies
DROP POLICY IF EXISTS "Users can view identities of their launches" ON public.lead_contact_identities;
DROP POLICY IF EXISTS "Users can create identities for their launches" ON public.lead_contact_identities;
DROP POLICY IF EXISTS "Users can update identities of their launches" ON public.lead_contact_identities;
DROP POLICY IF EXISTS "Users can delete identities of their launches" ON public.lead_contact_identities;

CREATE POLICY "Users can view identities of their launches" ON public.lead_contact_identities FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create identities for their launches" ON public.lead_contact_identities FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update identities of their launches" ON public.lead_contact_identities FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can delete identities of their launches" ON public.lead_contact_identities FOR DELETE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- Fix inbound_contact_events policies
DROP POLICY IF EXISTS "Users can view inbound events of their launches" ON public.inbound_contact_events;
DROP POLICY IF EXISTS "Users can create inbound events for their launches" ON public.inbound_contact_events;
DROP POLICY IF EXISTS "Users can update inbound events of their launches" ON public.inbound_contact_events;

CREATE POLICY "Users can view inbound events of their launches" ON public.inbound_contact_events FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create inbound events for their launches" ON public.inbound_contact_events FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update inbound events of their launches" ON public.inbound_contact_events FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- Fix contact_processing_logs policies
DROP POLICY IF EXISTS "Users can view processing logs of their launches" ON public.contact_processing_logs;
DROP POLICY IF EXISTS "Users can create processing logs for their launches" ON public.contact_processing_logs;

CREATE POLICY "Users can view processing logs of their launches" ON public.contact_processing_logs FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create processing logs for their launches" ON public.contact_processing_logs FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));

-- Fix platform_sync_runs policies
DROP POLICY IF EXISTS "Users can view sync runs of their launches" ON public.platform_sync_runs;
DROP POLICY IF EXISTS "Users can create sync runs for their launches" ON public.platform_sync_runs;
DROP POLICY IF EXISTS "Users can update sync runs of their launches" ON public.platform_sync_runs;
DROP POLICY IF EXISTS "Users can delete sync runs of their launches" ON public.platform_sync_runs;

CREATE POLICY "Users can view sync runs of their launches" ON public.platform_sync_runs FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can create sync runs for their launches" ON public.platform_sync_runs FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update sync runs of their launches" ON public.platform_sync_runs FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can delete sync runs of their launches" ON public.platform_sync_runs FOR DELETE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));

-- Fix launch_uchat_workspaces policies
DROP POLICY IF EXISTS "Users can view their launch workspaces" ON public.launch_uchat_workspaces;
DROP POLICY IF EXISTS "Users can insert their launch workspaces" ON public.launch_uchat_workspaces;
DROP POLICY IF EXISTS "Users can update their launch workspaces" ON public.launch_uchat_workspaces;
DROP POLICY IF EXISTS "Users can delete their launch workspaces" ON public.launch_uchat_workspaces;

CREATE POLICY "Users can view their launch workspaces" ON public.launch_uchat_workspaces FOR SELECT TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can insert their launch workspaces" ON public.launch_uchat_workspaces FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can update their launch workspaces" ON public.launch_uchat_workspaces FOR UPDATE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
CREATE POLICY "Users can delete their launch workspaces" ON public.launch_uchat_workspaces FOR DELETE TO authenticated
  USING (public.user_owns_launch(auth.uid(), launch_id));
