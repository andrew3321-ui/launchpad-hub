
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS ac_api_url TEXT,
  ADD COLUMN IF NOT EXISTS ac_api_key TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_group_link TEXT;
