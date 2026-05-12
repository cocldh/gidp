-- =============================================================================
-- 023_iis_function_key_classification.sql
-- =============================================================================
-- Switch IIS classification model from `tag.instrument_type` (free-text
-- description) to `function_key` extracted from tag_number itself.
--
-- Tag number formats in FGIP2 (project_id=2):
--   4-seg (~99.6%): D44-UUU-FK-SSSS    e.g. D44-403-PT-3005     → FK = 'PT'
--   3-seg (~0.4%):  D44-FK-SSSS        e.g. D44-DS-7001         → FK = 'DS'
-- Function key is always the second-to-last hyphen segment.
--
-- Changes:
--   (a) drawings.tag_function_key()        — immutable extraction helper
--   (b) drawings.iis_function_key_summary  — replaces iis_instrument_type_summary
--   (c) DELETE existing iis_classification_rule rows — match_value semantics
--       changed (instrument_type free text → function key), so prior rules are
--       invalid. User re-enters via the editor.
--
-- Note: iis_classification_rule.match_kind ('prefix'|'regex') is unchanged.
-- match_value is now matched against the extracted function_key, not
-- tag.instrument_type. The seed comment in 015 (.match_kind = 'prefix'
-- compares against tag.instrument_type) is superseded by this migration.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (a) tag_function_key helper
-- -----------------------------------------------------------------------------
-- IMMUTABLE so Postgres can inline / index-eligible. Returns NULL for tags
-- that don't have at least 2 hyphen segments.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drawings.tag_function_key(p_tag text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_tag IS NULL THEN NULL
    WHEN array_length(string_to_array(p_tag, '-'), 1) >= 2
      THEN (string_to_array(p_tag, '-'))[array_length(string_to_array(p_tag, '-'), 1) - 1]
    ELSE NULL
  END
$$;

GRANT EXECUTE ON FUNCTION drawings.tag_function_key(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- (b) iis_function_key_summary — distinct function_keys per project + counts
-- -----------------------------------------------------------------------------
-- Returns one row per distinct function_key extracted from public.tag, with
-- a representative instrument_type to help the user recognise it in the UI.
-- SECURITY DEFINER mirrors iis_instrument_type_summary (single up-front
-- has_module_access check; per-row RLS on ~30K tag rows would be too slow).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS drawings.iis_instrument_type_summary(int);

CREATE OR REPLACE FUNCTION drawings.iis_function_key_summary(p_project_id int)
RETURNS TABLE (function_key text, n bigint, sample_instrument_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, drawings, pg_temp
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    drawings.tag_function_key(t.tag_number) AS function_key,
    COUNT(*)::bigint                        AS n,
    (array_agg(t.instrument_type)
       FILTER (WHERE t.instrument_type IS NOT NULL))[1] AS sample_instrument_type
  FROM public.tag t
  WHERE t.project_id = p_project_id
    AND t.tag_number IS NOT NULL
    AND drawings.tag_function_key(t.tag_number) IS NOT NULL
  GROUP BY drawings.tag_function_key(t.tag_number)
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_function_key_summary(int) TO authenticated;

-- -----------------------------------------------------------------------------
-- (c) Truncate stale rules — match_value semantics changed
-- -----------------------------------------------------------------------------
-- The 42 rows seeded against instrument_type ("PRESSURE RELIEF VALVE",
-- "FLOW", ".*" etc.) won't match function_keys like "PT" / "PSV" / "TI".
-- User re-enters via /drawings/iis/classification.
-- -----------------------------------------------------------------------------
DELETE FROM drawings.iis_classification_rule;

COMMIT;
