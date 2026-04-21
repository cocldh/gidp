-- =============================================================================
-- 007_iss_rpc_functions.sql — ISS module RPCs (project-scoped)
-- =============================================================================
-- Port of legacy ISS per-schema RPCs to unified schema:
--   - Everything lives in `public` so client .rpc() needs no schema qualifier
--   - Every function takes p_project_id and filters iss.* via that column
--   - SECURITY DEFINER with has_module_access() as gatekeeper (RLS passthrough)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- get_field_columns — distinct (field_id, field_name) used by a template
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_get_field_columns(
  p_project_id INTEGER,
  p_template_id INTEGER DEFAULT NULL
)
RETURNS TABLE(field_id INTEGER, field_name TEXT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT DISTINCT f.field_id, f.field_name
  FROM iss.field_def f
  JOIN iss.document_value dv ON dv.field_id = f.field_id
  JOIN iss.document d         ON d.document_id = dv.document_id
  WHERE d.project_id = p_project_id
    AND f.project_id = p_project_id
    AND (p_template_id IS NULL OR d.template_id = p_template_id)
    AND public.has_module_access(p_project_id, 'iss', 'Viewer')
  ORDER BY f.field_name;
$$;

-- -----------------------------------------------------------------------------
-- get_browser_data — pivot-style (tag + document + jsonb field_values)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_get_browser_data(
  p_project_id INTEGER,
  p_template_id INTEGER DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  tag_id          BIGINT,
  tag_number      TEXT,
  document_id     INTEGER,
  document_number TEXT,
  template_code   TEXT,
  sheet_number    TEXT,
  revision_number TEXT,
  minor_revision  TEXT,
  field_values    JSONB
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    t.tag_id,
    t.tag_number,
    d.document_id,
    d.document_number,
    tmpl.template_code,
    d.sheet_number,
    d.revision_number,
    d.minor_revision,
    COALESCE(
      jsonb_object_agg(f.field_name, dv.value_text)
        FILTER (WHERE f.field_name IS NOT NULL AND dv.value_text IS NOT NULL),
      '{}'::jsonb
    ) AS field_values
  FROM iss.document d
  LEFT JOIN public.tag t       ON t.tag_id = d.tag_id
  LEFT JOIN iss.template tmpl  ON tmpl.template_id = d.template_id
  LEFT JOIN iss.document_value dv ON dv.document_id = d.document_id
  LEFT JOIN iss.field_def f    ON f.field_id = dv.field_id
  WHERE d.project_id = p_project_id
    AND (p_template_id IS NULL OR d.template_id = p_template_id)
    AND (p_search IS NULL OR t.tag_number ILIKE '%' || p_search || '%')
    AND public.has_module_access(p_project_id, 'iss', 'Viewer')
  GROUP BY t.tag_id, t.tag_number, d.document_id, d.document_number,
           tmpl.template_code, d.sheet_number, d.revision_number, d.minor_revision
  ORDER BY t.tag_number NULLS LAST, d.document_number
  LIMIT p_limit OFFSET p_offset;
$$;

-- -----------------------------------------------------------------------------
-- get_tag_field_values — merged field values for a document with tag-pool fallback
-- Used by XLSX export: document's own values win, then any other document on
-- the same tag fills in the gaps.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_get_tag_field_values(p_document_id INTEGER)
RETURNS TABLE(field_name TEXT, value_text TEXT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT DISTINCT ON (f.field_name)
      f.field_name,
      dv.value_text
  FROM iss.document_value dv
  JOIN iss.field_def f ON f.field_id = dv.field_id
  JOIN iss.document d  ON d.document_id = dv.document_id
  WHERE dv.document_id IN (
      SELECT d2.document_id FROM iss.document d2
      WHERE d2.tag_id = (SELECT tag_id FROM iss.document WHERE document_id = p_document_id)
  )
  AND public.has_module_access(d.project_id, 'iss', 'Viewer')
  AND dv.value_text IS NOT NULL
  AND TRIM(dv.value_text) <> ''
  ORDER BY f.field_name,
           CASE WHEN dv.document_id = p_document_id THEN 0 ELSE 1 END;
$$;

-- -----------------------------------------------------------------------------
-- merge_fields — admin-only field consolidation within a project
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_merge_fields(
  p_project_id INTEGER,
  p_source_field_id INTEGER,
  p_target_field_id INTEGER
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'iss', 'Admin') THEN
    RAISE EXCEPTION 'iss Admin required to merge fields';
  END IF;

  -- Sanity check both fields belong to the same project
  IF NOT EXISTS (
    SELECT 1 FROM iss.field_def
    WHERE field_id = p_source_field_id AND project_id = p_project_id
  ) OR NOT EXISTS (
    SELECT 1 FROM iss.field_def
    WHERE field_id = p_target_field_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Source and target field must belong to project %', p_project_id;
  END IF;

  -- Move document_value rows (skip where target already present)
  UPDATE iss.document_value
     SET field_id = p_target_field_id
   WHERE field_id = p_source_field_id
     AND document_id NOT IN (
       SELECT document_id FROM iss.document_value WHERE field_id = p_target_field_id
     );

  DELETE FROM iss.document_value WHERE field_id = p_source_field_id;

  UPDATE iss.mapping_rule
     SET field_id = p_target_field_id
   WHERE field_id = p_source_field_id;

  DELETE FROM iss.field_def WHERE field_id = p_source_field_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- refresh_browser_mv — no-op shim for legacy callers (no MV exists)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iss_refresh_browser_mv()
RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.iss_get_field_columns(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iss_get_browser_data(INTEGER, INTEGER, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iss_get_tag_field_values(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iss_merge_fields(INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iss_refresh_browser_mv() TO authenticated;

COMMIT;
