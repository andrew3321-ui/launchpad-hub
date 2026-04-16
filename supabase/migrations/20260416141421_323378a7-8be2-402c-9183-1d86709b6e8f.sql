
CREATE TABLE IF NOT EXISTS public.platform_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  merged_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync runs of their launches"
  ON public.platform_sync_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM launches WHERE launches.id = platform_sync_runs.launch_id AND launches.created_by = auth.uid()));

CREATE POLICY "Users can create sync runs for their launches"
  ON public.platform_sync_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM launches WHERE launches.id = platform_sync_runs.launch_id AND launches.created_by = auth.uid()));

CREATE POLICY "Users can update sync runs of their launches"
  ON public.platform_sync_runs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM launches WHERE launches.id = platform_sync_runs.launch_id AND launches.created_by = auth.uid()));

CREATE TRIGGER set_platform_sync_runs_updated_at
  BEFORE UPDATE ON public.platform_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
