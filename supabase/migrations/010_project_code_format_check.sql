-- Project code format constraint: single letter prefix (e=execution, p=proposal)
-- followed by 6 digits. Example: e230350, p230351.
ALTER TABLE public.project
  ADD CONSTRAINT project_code_format_chk
  CHECK (project_code ~ '^[ep][0-9]{6}$');

COMMENT ON CONSTRAINT project_code_format_chk ON public.project IS
  'Project code = single letter prefix (e=execution, p=proposal) + 6 digits. Example: e230350.';
