update public.contact_routing_actions
set
  status = 'skipped',
  error_message = 'Duplicate Sendflow welcome subflow action collapsed before unique lock creation',
  updated_at = now()
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by launch_id, source, target, action_type, action_key
        order by created_at asc
      ) as duplicate_rank
    from public.contact_routing_actions
    where action_key like 'sendflow-welcome:%'
      and status in ('pending', 'success')
  ) ranked_actions
  where duplicate_rank > 1
);

create unique index if not exists ux_contact_routing_actions_sendflow_welcome_once
  on public.contact_routing_actions (launch_id, source, target, action_type, action_key)
  where action_key is not null
    and action_key like 'sendflow-welcome:%'
    and status in ('pending', 'success');
