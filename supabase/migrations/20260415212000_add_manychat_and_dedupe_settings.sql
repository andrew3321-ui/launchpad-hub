ALTER TABLE public.launches
  ADD COLUMN manychat_api_url TEXT,
  ADD COLUMN manychat_api_key TEXT,
  ADD COLUMN manychat_account_id TEXT;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public.launch_dedupe_settings (
  launch_id UUID PRIMARY KEY REFERENCES public.launches(id) ON DELETE CASCADE,
  compare_digits_only BOOLEAN NOT NULL DEFAULT true,
  auto_add_country_code BOOLEAN NOT NULL DEFAULT true,
  default_country_code TEXT NOT NULL DEFAULT '55',
  auto_add_ninth_digit BOOLEAN NOT NULL DEFAULT true,
  merge_on_exact_phone BOOLEAN NOT NULL DEFAULT true,
  merge_on_exact_email BOOLEAN NOT NULL DEFAULT true,
  auto_merge_duplicates BOOLEAN NOT NULL DEFAULT true,
  prefer_most_complete_record BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.launch_dedupe_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create dedupe settings for their launches"
  ON public.launch_dedupe_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete dedupe settings of their launches"
  ON public.launch_dedupe_settings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = launch_dedupe_settings.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE TRIGGER set_launch_dedupe_settings_updated_at
  BEFORE UPDATE ON public.launch_dedupe_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
