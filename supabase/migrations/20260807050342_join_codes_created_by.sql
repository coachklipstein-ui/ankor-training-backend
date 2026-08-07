ALTER TABLE public.join_codes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_join_codes_created_by ON public.join_codes(created_by);
