REVOKE SELECT (
  webhook_secret,
  ac_api_url,
  ac_api_key,
  ac_default_list_id,
  ac_named_tags,
  manychat_api_url,
  manychat_api_key,
  manychat_account_id
) ON public.launches FROM anon, authenticated;

REVOKE UPDATE (
  webhook_secret,
  ac_api_url,
  ac_api_key,
  ac_default_list_id,
  ac_named_tags,
  manychat_api_url,
  manychat_api_key,
  manychat_account_id
) ON public.launches FROM anon, authenticated;

REVOKE SELECT (api_token) ON public.uchat_workspaces FROM anon, authenticated;
REVOKE INSERT (api_token) ON public.uchat_workspaces FROM anon, authenticated;
REVOKE UPDATE (api_token) ON public.uchat_workspaces FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_launch_sources(target_launch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  launch_row public.launches%ROWTYPE;
  workspace_rows JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_owns_launch(auth.uid(), target_launch_id) THEN
    RAISE EXCEPTION 'Not authorized to access launch sources';
  END IF;

  SELECT *
  INTO launch_row
  FROM public.launches
  WHERE id = target_launch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', workspace.id,
        'workspace_name', workspace.workspace_name,
        'workspace_id', workspace.workspace_id,
        'api_token', workspace.api_token,
        'welcome_subflow_ns', workspace.welcome_subflow_ns,
        'default_tag_name', workspace.default_tag_name
      )
      ORDER BY workspace.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO workspace_rows
  FROM public.uchat_workspaces AS workspace
  WHERE workspace.launch_id = target_launch_id;

  RETURN jsonb_build_object(
    'launch',
    jsonb_build_object(
      'id', launch_row.id,
      'name', launch_row.name,
      'project_id', launch_row.project_id,
      'slug', launch_row.slug,
      'webhook_secret', launch_row.webhook_secret,
      'ac_api_url', launch_row.ac_api_url,
      'ac_api_key', launch_row.ac_api_key,
      'ac_default_list_id', launch_row.ac_default_list_id,
      'ac_named_tags', launch_row.ac_named_tags
    ),
    'uchat_workspaces',
    workspace_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_launch_activecampaign_settings(
  target_launch_id UUID,
  next_api_url TEXT DEFAULT NULL,
  next_api_key TEXT DEFAULT NULL,
  next_default_list_id TEXT DEFAULT NULL,
  next_named_tags JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.launches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_owns_launch(auth.uid(), target_launch_id) THEN
    RAISE EXCEPTION 'Not authorized to update launch credentials';
  END IF;

  UPDATE public.launches
  SET
    ac_api_url = NULLIF(BTRIM(next_api_url), ''),
    ac_api_key = NULLIF(BTRIM(next_api_key), ''),
    ac_default_list_id = NULLIF(BTRIM(next_default_list_id), ''),
    ac_named_tags = COALESCE(next_named_tags, '[]'::jsonb)
  WHERE id = target_launch_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch not found';
  END IF;

  RETURN jsonb_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'project_id', updated_row.project_id,
    'slug', updated_row.slug,
    'webhook_secret', updated_row.webhook_secret,
    'ac_api_url', updated_row.ac_api_url,
    'ac_api_key', updated_row.ac_api_key,
    'ac_default_list_id', updated_row.ac_default_list_id,
    'ac_named_tags', updated_row.ac_named_tags
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_launch_uchat_workspaces(
  target_launch_id UUID,
  next_workspaces JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  launch_row public.launches%ROWTYPE;
  workspace_item JSONB;
  sanitized_workspaces JSONB;
  workspace_rows JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_owns_launch(auth.uid(), target_launch_id) THEN
    RAISE EXCEPTION 'Not authorized to manage UChat workspaces';
  END IF;

  SELECT *
  INTO launch_row
  FROM public.launches
  WHERE id = target_launch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch not found';
  END IF;

  sanitized_workspaces := CASE
    WHEN jsonb_typeof(COALESCE(next_workspaces, '[]'::jsonb)) = 'array' THEN COALESCE(next_workspaces, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;

  DELETE FROM public.uchat_workspaces
  WHERE launch_id = target_launch_id;

  FOR workspace_item IN
    SELECT value
    FROM jsonb_array_elements(sanitized_workspaces)
  LOOP
    IF NULLIF(BTRIM(COALESCE(workspace_item->>'workspace_id', '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(workspace_item->>'api_token', '')), '') IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.uchat_workspaces (
      launch_id,
      project_id,
      workspace_name,
      workspace_id,
      bot_id,
      api_token,
      welcome_subflow_ns,
      default_tag_name
    )
    VALUES (
      target_launch_id,
      launch_row.project_id,
      COALESCE(NULLIF(BTRIM(workspace_item->>'workspace_name'), ''), 'Workspace UChat'),
      NULLIF(BTRIM(workspace_item->>'workspace_id'), ''),
      COALESCE(
        NULLIF(BTRIM(workspace_item->>'bot_id'), ''),
        NULLIF(BTRIM(workspace_item->>'workspace_id'), '')
      ),
      NULLIF(BTRIM(workspace_item->>'api_token'), ''),
      NULLIF(BTRIM(workspace_item->>'welcome_subflow_ns'), ''),
      NULLIF(BTRIM(workspace_item->>'default_tag_name'), '')
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', workspace.id,
        'workspace_name', workspace.workspace_name,
        'workspace_id', workspace.workspace_id,
        'api_token', workspace.api_token,
        'welcome_subflow_ns', workspace.welcome_subflow_ns,
        'default_tag_name', workspace.default_tag_name
      )
      ORDER BY workspace.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO workspace_rows
  FROM public.uchat_workspaces AS workspace
  WHERE workspace.launch_id = target_launch_id;

  RETURN workspace_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_launch_sources(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_launch_activecampaign_settings(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_launch_uchat_workspaces(UUID, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_launch_sources(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_launch_activecampaign_settings(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_launch_uchat_workspaces(UUID, JSONB) TO authenticated;
