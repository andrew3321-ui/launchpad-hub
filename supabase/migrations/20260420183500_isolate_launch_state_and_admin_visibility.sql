CREATE OR REPLACE FUNCTION public.user_owns_launch(_user_id uuid, _launch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved_user(_user_id)
    AND (
      public.is_platform_admin(_user_id)
      OR EXISTS (
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
      )
    );
$$;

DROP POLICY IF EXISTS "Users can view their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can update their launches" ON public.launches;
DROP POLICY IF EXISTS "Users can delete their launches" ON public.launches;

CREATE POLICY "Users can view their launches"
ON public.launches
FOR SELECT
TO authenticated
USING (
  public.is_approved_user(auth.uid())
  AND (
    public.is_platform_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.projects
      WHERE projects.id = launches.project_id
        AND projects.created_by = auth.uid()
    )
  )
);

CREATE POLICY "Users can update their launches"
ON public.launches
FOR UPDATE
TO authenticated
USING (
  public.is_approved_user(auth.uid())
  AND (
    public.is_platform_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.projects
      WHERE projects.id = launches.project_id
        AND projects.created_by = auth.uid()
    )
  )
);

CREATE POLICY "Users can delete their launches"
ON public.launches
FOR DELETE
TO authenticated
USING (
  public.is_approved_user(auth.uid())
  AND (
    public.is_platform_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.projects
      WHERE projects.id = launches.project_id
        AND projects.created_by = auth.uid()
    )
  )
);
