create table if not exists public.launch_user_assignments (
  id uuid not null default gen_random_uuid() primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  unique (launch_id, user_id)
);

create index if not exists idx_launch_user_assignments_user_id
  on public.launch_user_assignments (user_id, created_at desc);

create index if not exists idx_launch_user_assignments_launch_id
  on public.launch_user_assignments (launch_id, created_at desc);

alter table public.launch_user_assignments enable row level security;

drop policy if exists "Admins can manage expert assignments" on public.launch_user_assignments;
drop policy if exists "Users can view their expert assignments" on public.launch_user_assignments;

create policy "Admins can manage expert assignments"
  on public.launch_user_assignments
  for all
  to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

create policy "Users can view their expert assignments"
  on public.launch_user_assignments
  for select
  to authenticated
  using (
    public.is_approved_user(auth.uid())
    and user_id = auth.uid()
  );

create or replace function public.user_owns_launch(_user_id uuid, _launch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_approved_user(_user_id)
    and (
      public.is_platform_admin(_user_id)
      or exists (
        select 1
        from public.launches
        where launches.id = _launch_id
          and (
            launches.created_by = _user_id
            or exists (
              select 1
              from public.projects
              where projects.id = launches.project_id
                and projects.created_by = _user_id
            )
            or exists (
              select 1
              from public.launch_user_assignments
              where launch_user_assignments.launch_id = launches.id
                and launch_user_assignments.user_id = _user_id
            )
          )
      )
    );
$$;

drop policy if exists "Users can view their launches" on public.launches;
drop policy if exists "Users can update their launches" on public.launches;
drop policy if exists "Users can delete their launches" on public.launches;

create policy "Users can view their launches"
  on public.launches for select
  to authenticated
  using (public.user_owns_launch(auth.uid(), id));

create policy "Users can update their launches"
  on public.launches for update
  to authenticated
  using (public.user_owns_launch(auth.uid(), id))
  with check (public.user_owns_launch(auth.uid(), id));

create policy "Users can delete their launches"
  on public.launches for delete
  to authenticated
  using (public.user_owns_launch(auth.uid(), id));

create or replace function public.list_admin_user_access_overview()
returns table (
  profile_id uuid,
  user_id uuid,
  email text,
  full_name text,
  is_admin boolean,
  approval_status text,
  must_change_password boolean,
  password_changed_at timestamp with time zone,
  created_at timestamp with time zone,
  assigned_experts jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    profiles.id as profile_id,
    profiles.user_id,
    profiles.email,
    profiles.full_name,
    profiles.is_admin,
    profiles.approval_status,
    profiles.must_change_password,
    profiles.password_changed_at,
    profiles.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', launches.id,
            'name', launches.name,
            'slug', launches.slug,
            'status', launches.status,
            'assignedAt', launch_user_assignments.created_at
          )
          order by launches.name asc
        )
        from public.launch_user_assignments
        join public.launches
          on launches.id = launch_user_assignments.launch_id
        where launch_user_assignments.user_id = profiles.user_id
      ),
      '[]'::jsonb
    ) as assigned_experts
  from public.profiles
  where public.is_platform_admin(auth.uid())
  order by profiles.is_admin desc, profiles.created_at desc;
$$;

create or replace function public.set_user_expert_assignments(
  target_user_id uuid,
  target_launch_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_launch_ids uuid[];
  assigned_count integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Only admins can manage expert assignments';
  end if;

  if not exists (select 1 from public.profiles where profiles.user_id = target_user_id) then
    raise exception 'User profile not found';
  end if;

  select coalesce(array_agg(distinct launch_id), '{}'::uuid[])
    into normalized_launch_ids
  from unnest(coalesce(target_launch_ids, '{}'::uuid[])) as requested(launch_id)
  join public.launches on launches.id = requested.launch_id;

  delete from public.launch_user_assignments
  where user_id = target_user_id;

  insert into public.launch_user_assignments (launch_id, user_id, assigned_by)
  select launch_id, target_user_id, auth.uid()
  from unnest(normalized_launch_ids) as selected(launch_id)
  on conflict (launch_id, user_id) do nothing;

  get diagnostics assigned_count = row_count;

  return jsonb_build_object(
    'user_id', target_user_id,
    'assigned_count', assigned_count,
    'launch_ids', coalesce(to_jsonb(normalized_launch_ids), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_admin_user_access_overview() from public;
revoke all on function public.set_user_expert_assignments(uuid, uuid[]) from public;

grant execute on function public.list_admin_user_access_overview() to authenticated;
grant execute on function public.set_user_expert_assignments(uuid, uuid[]) to authenticated;