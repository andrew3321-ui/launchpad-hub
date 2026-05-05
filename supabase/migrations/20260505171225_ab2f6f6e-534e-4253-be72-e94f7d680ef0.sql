create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(new.email, '')));
  is_seed_admin boolean := normalized_email = any (
    array[
      'andrehugo@megafone.digital',
      'victorbezerra@megafone.digital',
      'joaofelipeoliveira@megafone.digital',
      'afonsodamasceno@megafone.digital'
    ]
  );
begin
  insert into public.profiles (
    user_id,
    email,
    full_name,
    is_admin,
    approval_status,
    approval_reviewed_at,
    must_change_password
  )
  values (
    new.id,
    normalized_email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    is_seed_admin,
    case when is_seed_admin then 'approved' else 'pending' end,
    case when is_seed_admin then now() else null end,
    true
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    is_admin = excluded.is_admin,
    approval_status = case
      when public.profiles.approval_status = 'approved' and public.profiles.is_admin = false then public.profiles.approval_status
      else excluded.approval_status
    end,
    approval_reviewed_at = coalesce(public.profiles.approval_reviewed_at, excluded.approval_reviewed_at),
    must_change_password = coalesce(public.profiles.must_change_password, true);

  return new;
end;
$$;

update public.profiles
set
  is_admin = true,
  approval_status = 'approved',
  approval_reviewed_at = coalesce(approval_reviewed_at, now()),
  must_change_password = true
where lower(trim(email)) = 'afonsodamasceno@megafone.digital';