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
