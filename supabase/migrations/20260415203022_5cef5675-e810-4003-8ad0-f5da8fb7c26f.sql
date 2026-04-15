-- Add new columns to launches
ALTER TABLE public.launches
  ADD COLUMN slug TEXT UNIQUE,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN custom_states JSONB NOT NULL DEFAULT '["cadastrado","boas_vindas_enviado","entrou_grupo","ativo"]'::jsonb,
  ADD COLUMN whatsapp_group_link TEXT,
  ADD COLUMN ac_api_url TEXT,
  ADD COLUMN ac_api_key TEXT,
  ADD COLUMN ac_default_list_id TEXT,
  ADD COLUMN ac_named_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Create index on slug
CREATE UNIQUE INDEX idx_launches_slug ON public.launches (slug);

-- Create uchat_workspaces table
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

-- RLS: users can manage workspaces of their own launches
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