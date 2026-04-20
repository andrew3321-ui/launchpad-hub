CREATE OR REPLACE FUNCTION public.create_launch_metadata(
  next_name TEXT,
  next_slug TEXT,
  next_status TEXT DEFAULT 'active',
  next_custom_states JSONB DEFAULT '["cadastrado","boas_vindas_enviado","entrou_grupo","ativo"]'::jsonb,
  next_whatsapp_group_link TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_row public.launches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_approved_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only approved users can create launches';
  END IF;

  IF NULLIF(BTRIM(next_name), '') IS NULL THEN
    RAISE EXCEPTION 'Launch name is required';
  END IF;

  IF NULLIF(BTRIM(next_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Launch slug is required';
  END IF;

  INSERT INTO public.launches (
    name,
    slug,
    status,
    custom_states,
    whatsapp_group_link,
    created_by
  )
  VALUES (
    BTRIM(next_name),
    NULLIF(BTRIM(next_slug), ''),
    COALESCE(NULLIF(BTRIM(next_status), ''), 'active'),
    COALESCE(next_custom_states, '["cadastrado","boas_vindas_enviado","entrou_grupo","ativo"]'::jsonb),
    NULLIF(BTRIM(next_whatsapp_group_link), ''),
    auth.uid()
  )
  RETURNING * INTO created_row;

  RETURN jsonb_build_object(
    'id', created_row.id,
    'name', created_row.name,
    'slug', created_row.slug,
    'status', created_row.status,
    'created_at', created_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_launch_metadata(
  target_launch_id UUID,
  next_name TEXT DEFAULT NULL,
  next_slug TEXT DEFAULT NULL,
  next_status TEXT DEFAULT NULL,
  next_custom_states JSONB DEFAULT NULL,
  next_whatsapp_group_link TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.launches%ROWTYPE;
  updated_row public.launches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_owns_launch(auth.uid(), target_launch_id) THEN
    RAISE EXCEPTION 'Not authorized to update this launch';
  END IF;

  SELECT *
  INTO current_row
  FROM public.launches
  WHERE id = target_launch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch not found';
  END IF;

  UPDATE public.launches
  SET
    name = COALESCE(NULLIF(BTRIM(next_name), ''), current_row.name),
    slug = COALESCE(NULLIF(BTRIM(next_slug), ''), current_row.slug),
    status = COALESCE(NULLIF(BTRIM(next_status), ''), current_row.status),
    custom_states = COALESCE(next_custom_states, current_row.custom_states),
    whatsapp_group_link = CASE
      WHEN next_whatsapp_group_link IS NULL THEN current_row.whatsapp_group_link
      ELSE NULLIF(BTRIM(next_whatsapp_group_link), '')
    END
  WHERE id = target_launch_id
  RETURNING * INTO updated_row;

  RETURN jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'slug', updated_row.slug,
    'status', updated_row.status,
    'created_at', updated_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_launch_metadata(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_launch_metadata(UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_launch_metadata(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_launch_metadata(UUID, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;
