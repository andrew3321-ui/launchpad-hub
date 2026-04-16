CREATE TABLE public.platform_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('activecampaign', 'uchat')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_platform_sync_runs_launch_started
  ON public.platform_sync_runs (launch_id, started_at DESC);

CREATE INDEX idx_platform_sync_runs_launch_source
  ON public.platform_sync_runs (launch_id, source, started_at DESC);

ALTER TABLE public.platform_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync runs of their launches"
  ON public.platform_sync_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create sync runs for their launches"
  ON public.platform_sync_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update sync runs of their launches"
  ON public.platform_sync_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete sync runs of their launches"
  ON public.platform_sync_runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.launches
      WHERE launches.id = platform_sync_runs.launch_id
      AND launches.created_by = auth.uid()
    )
  );
