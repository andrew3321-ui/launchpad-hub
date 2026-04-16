
ALTER TABLE public.uchat_workspaces
  ADD COLUMN IF NOT EXISTS launch_id UUID REFERENCES public.launches(id) ON DELETE CASCADE;
