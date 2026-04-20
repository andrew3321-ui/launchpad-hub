CREATE OR REPLACE FUNCTION public.create_launch_metadata(
  next_name text,
  next_slug text DEFAULT NULL,
  next_status text DEFAULT 'active',
  next_custom_states jsonb DEFAULT '["cadastrado", "boas_vindas_enviado", "entrou_grupo", "ativo"]'::jsonb,
  next_whatsapp_group_link text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_row public.launches%ROWTYPE;
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_approved_user(current_user_id) THEN
    RAISE EXCEPTION 'User not approved to create launches';
  END IF;

  IF next_name IS NULL OR btrim(next_name) = '' THEN
    RAISE EXCEPTION 'Launch name is required';
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
    btrim(next_name),
    NULLIF(btrim(coalesce(next_slug, '')), ''),
    coalesce(NULLIF(btrim(next_status), ''), 'active'),
    coalesce(next_custom_states, '["cadastrado", "boas_vindas_enviado", "entrou_grupo", "ativo"]'::jsonb),
    NULLIF(btrim(coalesce(next_whatsapp_group_link, '')), ''),
    current_user_id
  )
  RETURNING * INTO inserted_row;

  RETURN jsonb_build_object(
    'id', inserted_row.id,
    'name', inserted_row.name,
    'slug', inserted_row.slug,
    'status', inserted_row.status,
    'custom_states', inserted_row.custom_states,
    'whatsapp_group_link', inserted_row.whatsapp_group_link,
    'created_at', inserted_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_launch_metadata(
  target_launch_id uuid,
  next_name text DEFAULT NULL,
  next_slug text DEFAULT NULL,
  next_status text DEFAULT NULL,
  next_custom_states jsonb DEFAULT NULL,
  next_whatsapp_group_link text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.launches%ROWTYPE;
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_owns_launch(current_user_id, target_launch_id) THEN
    RAISE EXCEPTION 'Not authorized to update this launch';
  END IF;

  UPDATE public.launches
  SET
    name = COALESCE(NULLIF(btrim(coalesce(next_name, '')), ''), name),
    slug = CASE WHEN next_slug IS NULL THEN slug ELSE NULLIF(btrim(next_slug), '') END,
    status = COALESCE(NULLIF(btrim(coalesce(next_status, '')), ''), status),
    custom_states = COALESCE(next_custom_states, custom_states),
    whatsapp_group_link = CASE WHEN next_whatsapp_group_link IS NULL THEN whatsapp_group_link ELSE NULLIF(btrim(next_whatsapp_group_link), '') END
  WHERE id = target_launch_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch not found';
  END IF;

  RETURN jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'slug', updated_row.slug,
    'status', updated_row.status,
    'custom_states', updated_row.custom_states,
    'whatsapp_group_link', updated_row.whatsapp_group_link,
    'created_at', updated_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_launch_metadata(text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_launch_metadata(uuid, text, text, text, jsonb, text) TO authenticated;