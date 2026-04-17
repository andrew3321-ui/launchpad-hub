CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_routing_actions_live_action_key
  ON public.contact_routing_actions (launch_id, contact_id, source, target, action_type, action_key)
  WHERE action_key IS NOT NULL
    AND status IN ('pending', 'success');
