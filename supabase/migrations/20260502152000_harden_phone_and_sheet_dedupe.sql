create or replace function public.launchhub_phone_dedupe_key(input_phone text)
returns text
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(input_phone, ''), '\D', '', 'g');
  local_digits text;
begin
  if digits = '' then
    return null;
  end if;

  digits := regexp_replace(digits, '^0+', '');

  if left(digits, 2) = '55' and length(digits) between 12 and 13 then
    local_digits := substr(digits, 3);
  else
    local_digits := digits;
  end if;

  if length(local_digits) = 11
     and substr(local_digits, 3, 1) = '9'
     and substr(local_digits, 4, 1) ~ '^[6-9]$' then
    local_digits := substr(local_digits, 1, 2) || substr(local_digits, 4);
  end if;

  if length(local_digits) in (10, 11) then
    return 'br:' || local_digits;
  end if;

  return 'raw:' || digits;
end;
$$;

alter table public.launch_google_sheet_capture_records
  add column if not exists phone_dedupe_key text,
  add column if not exists append_status text not null default 'appended',
  add column if not exists claimed_at timestamp with time zone not null default now();

update public.launch_google_sheet_capture_records
set
  phone_dedupe_key = public.launchhub_phone_dedupe_key(normalized_phone),
  append_status = coalesce(nullif(append_status, ''), 'appended'),
  claimed_at = coalesce(claimed_at, created_at, now())
where phone_dedupe_key is null
   or append_status is null
   or claimed_at is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by launch_id, cycle_number, spreadsheet_id, sheet_name, lower(primary_email)
      order by created_at asc, id asc
    ) as rn
  from public.launch_google_sheet_capture_records
  where primary_email is not null and length(trim(primary_email)) > 0
)
delete from public.launch_google_sheet_capture_records
using ranked
where public.launch_google_sheet_capture_records.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by launch_id, cycle_number, spreadsheet_id, sheet_name, phone_dedupe_key
      order by created_at asc, id asc
    ) as rn
  from public.launch_google_sheet_capture_records
  where phone_dedupe_key is not null and length(trim(phone_dedupe_key)) > 0
)
delete from public.launch_google_sheet_capture_records
using ranked
where public.launch_google_sheet_capture_records.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by launch_id, cycle_number, spreadsheet_id, sheet_name, active_contact_id
      order by created_at asc, id asc
    ) as rn
  from public.launch_google_sheet_capture_records
  where active_contact_id is not null and length(trim(active_contact_id)) > 0
)
delete from public.launch_google_sheet_capture_records
using ranked
where public.launch_google_sheet_capture_records.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists ux_launch_google_sheet_capture_records_email
  on public.launch_google_sheet_capture_records (
    launch_id,
    cycle_number,
    spreadsheet_id,
    sheet_name,
    lower(primary_email)
  )
  where primary_email is not null and length(trim(primary_email)) > 0;

create unique index if not exists ux_launch_google_sheet_capture_records_phone_key
  on public.launch_google_sheet_capture_records (
    launch_id,
    cycle_number,
    spreadsheet_id,
    sheet_name,
    phone_dedupe_key
  )
  where phone_dedupe_key is not null and length(trim(phone_dedupe_key)) > 0;

create unique index if not exists ux_launch_google_sheet_capture_records_active_id
  on public.launch_google_sheet_capture_records (
    launch_id,
    cycle_number,
    spreadsheet_id,
    sheet_name,
    active_contact_id
  )
  where active_contact_id is not null and length(trim(active_contact_id)) > 0;
