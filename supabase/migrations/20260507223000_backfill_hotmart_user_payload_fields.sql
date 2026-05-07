update public.hotmart_events
set
  buyer_name = coalesce(
    nullif(btrim(buyer_name), ''),
    nullif(btrim(raw_payload #>> '{data,user,name}'), ''),
    nullif(btrim(raw_payload #>> '{user,name}'), ''),
    buyer_name
  ),
  buyer_email = coalesce(
    nullif(btrim(buyer_email), ''),
    nullif(btrim(raw_payload #>> '{data,user,email}'), ''),
    nullif(btrim(raw_payload #>> '{user,email}'), ''),
    buyer_email
  ),
  buyer_phone = coalesce(
    nullif(btrim(buyer_phone), ''),
    nullif(btrim(raw_payload #>> '{data,user,phone}'), ''),
    nullif(btrim(raw_payload #>> '{data,user,checkout_phone}'), ''),
    nullif(btrim(raw_payload #>> '{user,phone}'), ''),
    nullif(btrim(raw_payload #>> '{user,checkout_phone}'), ''),
    buyer_phone
  )
where
  raw_payload is not null
  and (
    buyer_name is null
    or btrim(buyer_name) = ''
    or buyer_email is null
    or btrim(buyer_email) = ''
    or buyer_phone is null
    or btrim(buyer_phone) = ''
  );
