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
DROP POLICY IF EXISTS "Users can view workspaces of their projects" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can create workspaces for their projects" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can update workspaces of their projects" ON public.uchat_workspaces;
DROP POLICY IF EXISTS "Users can delete workspaces of their projects" ON public.uchat_workspaces;
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