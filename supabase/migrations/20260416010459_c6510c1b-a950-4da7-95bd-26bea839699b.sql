
-- 1. Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL,
  ac_api_url TEXT,
  ac_api_key TEXT,
  ac_default_list_id TEXT,
  ac_named_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_group_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view projects" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create projects" ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their own projects" ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users can delete their own projects" ON public.projects FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- 2. Add project_id to launches
ALTER TABLE public.launches ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- 3. Remove AC/WhatsApp fields from launches
ALTER TABLE public.launches DROP COLUMN IF EXISTS ac_api_url;
ALTER TABLE public.launches DROP COLUMN IF EXISTS ac_api_key;
ALTER TABLE public.launches DROP COLUMN IF EXISTS ac_default_list_id;
ALTER TABLE public.launches DROP COLUMN IF EXISTS ac_named_tags;
ALTER TABLE public.launches DROP COLUMN IF EXISTS whatsapp_group_link;

-- 4. Update launches RLS
DROP POLICY IF EXISTS "Authenticated users can view launches" ON public.launches;
DROP POLICY IF EXISTS "Users can create launches" ON public.launches;
DROP POLICY IF EXISTS "Users can update their own launches" ON public.launches;
DROP POLICY IF EXISTS "Users can delete their own launches" ON public.launches;

CREATE POLICY "Users can view launches of their projects" ON public.launches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can create launches for their projects" ON public.launches FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can update launches of their projects" ON public.launches FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can delete launches of their projects" ON public.launches FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = launches.project_id AND projects.created_by = auth.uid()));

-- 5. Fix uchat_workspaces: drop policies first, then columns, then add project_id
DROP POLICY IF EXISTS "Users can view workspaces of their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can create workspaces for their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can update workspaces of their launches" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can delete workspaces of their launches" ON public.uchat_workspaces;

ALTER TABLE public.uchat_workspaces DROP COLUMN IF EXISTS launch_id;
ALTER TABLE public.uchat_workspaces DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE public.uchat_workspaces DROP COLUMN IF EXISTS bot_id;

ALTER TABLE public.uchat_workspaces ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE POLICY "Users can view workspaces of their projects" ON public.uchat_workspaces FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = uchat_workspaces.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can create workspaces for their projects" ON public.uchat_workspaces FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = uchat_workspaces.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can update workspaces of their projects" ON public.uchat_workspaces FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = uchat_workspaces.project_id AND projects.created_by = auth.uid()));
CREATE POLICY "Users can delete workspaces of their projects" ON public.uchat_workspaces FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = uchat_workspaces.project_id AND projects.created_by = auth.uid()));
