-- =============================================================================
-- 029_iis_loop_type_classification.sql
-- =============================================================================
-- Switch IIS classification source from function_key (extracted from tag_number)
-- to 7_LOOP TYPE column in idx.index_record.data.
--
-- 7_LOOP TYPE holds short category strings (PRESSURE, TEMPERATURE, AOV, etc.)
-- and gives more reliable SA form routing than the function key alone — the same
-- function key (e.g. ZSC) can belong to different SA forms depending on loop type.
--
-- Changes:
--   (a) drawings.iis_loop_type_summary   — replaces iis_function_key_summary
--   (b) drawings.iis_fetch_tags_by_loop_types — replaces iis_fetch_tags_by_function_keys
--   (c) DELETE existing iis_classification_rule rows — match_value semantics
--       changed (function key → 7_LOOP TYPE), so prior rules are invalid.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (a) iis_loop_type_summary — distinct 7_LOOP TYPE values per project + counts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drawings.iis_loop_type_summary(p_project_id int)
RETURNS TABLE (loop_type text, n bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.data->>'7_LOOP TYPE'   AS loop_type,
    COUNT(*)::bigint          AS n
  FROM idx.index_record r
  WHERE r.project_id    = p_project_id
    AND r.is_committed  = true
    AND (r.data->>'1_TAG NUMBER')  IS NOT NULL
    AND (r.data->>'7_LOOP TYPE')   IS NOT NULL
  GROUP BY r.data->>'7_LOOP TYPE'
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_loop_type_summary(int) TO authenticated;

-- -----------------------------------------------------------------------------
-- (b) iis_fetch_tags_by_loop_types — filtered bulk fetch (mode=single/all)
-- -----------------------------------------------------------------------------
-- p_loop_types = NULL or empty → no loop-type filter (fetch all committed tags).
CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_by_loop_types(
  p_project_id      int,
  p_loop_types      text[],
  p_loop_mid_letter text   DEFAULT NULL,
  p_columns         text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
SET statement_timeout = '180s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY ord), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY
          r.data->>'5_LOOP NUMBER' NULLS LAST,
          NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
          r.data->>'1_TAG NUMBER'
      ) AS ord,
      jsonb_build_object(
        'record_id',           r.id,
        'tag_number',          r.data->>'1_TAG NUMBER',
        'loop_number',         r.data->>'5_LOOP NUMBER',
        'loop_internal_order', r.data->>'11_INTERNAL LOOP ORDER',
        'data',
          CASE
            WHEN p_columns IS NULL THEN r.data
            ELSE COALESCE(
              (SELECT jsonb_object_agg(k, r.data->k)
                 FROM unnest(p_columns) AS k
                WHERE r.data ? k),
              '{}'::jsonb
            )
          END
      ) AS row_obj
    FROM idx.index_record r
    WHERE r.project_id   = p_project_id
      AND r.is_committed = true
      AND (r.data->>'1_TAG NUMBER') IS NOT NULL
      AND (
        p_loop_mid_letter IS NULL
        OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
      )
      AND (
        p_loop_types IS NULL
        OR cardinality(p_loop_types) = 0
        OR (r.data->>'7_LOOP TYPE') = ANY (p_loop_types)
      )
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_tags_by_loop_types(int, text[], text, text[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- (c) Clear stale rules — match_value semantics changed
-- -----------------------------------------------------------------------------
DELETE FROM drawings.iis_classification_rule;

COMMIT;
