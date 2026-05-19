drop index if exists public.ux_launch_google_sheet_capture_records_phone_key;

create unique index if not exists ux_launch_google_sheet_capture_records_phone_only
  on public.launch_google_sheet_capture_records (
    launch_id,
    cycle_number,
    spreadsheet_id,
    sheet_name,
    phone_dedupe_key
  )
  where phone_dedupe_key is not null
    and length(trim(phone_dedupe_key)) > 0
    and (primary_email is null or length(trim(primary_email)) = 0);