-- =============================================================================
-- 008_iss_default_fields.sql — default_field_def registry + project-seed RPC
-- =============================================================================
-- Global (not project-scoped) admin-managed list of default fields that get
-- copied into iss.field_def whenever a new project is created.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.default_field_def (
  id            SERIAL PRIMARY KEY,
  field_name    TEXT NOT NULL UNIQUE,
  data_kind     TEXT NOT NULL DEFAULT 'TEXT',
  display_order INTEGER NOT NULL DEFAULT 9999
);

ALTER TABLE public.default_field_def ENABLE ROW LEVEL SECURITY;

CREATE POLICY default_field_def_read ON public.default_field_def FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY default_field_def_admin ON public.default_field_def FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- iss_create_project_and_seed
-- Admin-only. Creates public.project row + seeds iss.field_def from
-- default_field_def + grants caller ProjectAdmin role on the new project.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_create_project_and_seed(
  p_code TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id INTEGER;
  v_caller UUID := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required to create a project';
  END IF;

  INSERT INTO public.project (project_code, project_name, description)
  VALUES (p_code, p_name, p_description)
  RETURNING project_id INTO v_project_id;

  -- Seed field_def from default_field_def
  INSERT INTO iss.field_def (project_id, field_name, data_kind, display_order)
  SELECT v_project_id, field_name, data_kind, display_order
  FROM public.default_field_def;

  -- Grant caller ProjectAdmin on new project (idempotent)
  IF v_caller IS NOT NULL THEN
    INSERT INTO public.user_project_role (user_id, project_id, role, assigned_by)
    VALUES (v_caller, v_project_id, 'ProjectAdmin', v_caller)
    ON CONFLICT (user_id, project_id) DO NOTHING;
  END IF;

  RETURN v_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.iss_create_project_and_seed(TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
