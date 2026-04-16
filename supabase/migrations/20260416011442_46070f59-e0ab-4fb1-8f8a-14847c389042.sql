
-- Remove AC usage config from projects (keep only credentials)
ALTER TABLE public.projects DROP COLUMN IF EXISTS ac_default_list_id;
ALTER TABLE public.projects DROP COLUMN IF EXISTS ac_named_tags;

-- Remove usage fields from uchat_workspaces (keep only credentials)
ALTER TABLE public.uchat_workspaces DROP COLUMN IF EXISTS max_subscribers;
ALTER TABLE public.uchat_workspaces DROP COLUMN IF EXISTS current_count;

-- Add AC usage config to launches
ALTER TABLE public.launches ADD COLUMN IF NOT EXISTS ac_default_list_id text;
ALTER TABLE public.launches ADD COLUMN IF NOT EXISTS ac_named_tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.launches ADD COLUMN IF NOT EXISTS ac_default_automation_id text;

-- Create launch_uchat_workspaces junction table
CREATE TABLE public.launch_uchat_workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.uchat_workspaces(id) ON DELETE CASCADE,
  max_subscribers integer NOT NULL DEFAULT 1000,
  current_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(launch_id, workspace_id)
);

ALTER TABLE public.launch_uchat_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their launch workspaces"
ON public.launch_uchat_workspaces FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM launches l
  JOIN projects p ON p.id = l.project_id
  WHERE l.id = launch_uchat_workspaces.launch_id AND p.created_by = auth.uid()
));

CREATE POLICY "Users can insert their launch workspaces"
ON public.launch_uchat_workspaces FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM launches l
  JOIN projects p ON p.id = l.project_id
  WHERE l.id = launch_uchat_workspaces.launch_id AND p.created_by = auth.uid()
));

CREATE POLICY "Users can update their launch workspaces"
ON public.launch_uchat_workspaces FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM launches l
  JOIN projects p ON p.id = l.project_id
  WHERE l.id = launch_uchat_workspaces.launch_id AND p.created_by = auth.uid()
));

CREATE POLICY "Users can delete their launch workspaces"
ON public.launch_uchat_workspaces FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM launches l
  JOIN projects p ON p.id = l.project_id
  WHERE l.id = launch_uchat_workspaces.launch_id AND p.created_by = auth.uid()
));
