-- Targeted fetch for mode='all': caller pre-computes the function_keys that
-- belong to the requested template (by evaluating iis_classification_rule in
-- JS, same as the Auto mode preview), then passes the list here. The function
-- filters server-side instead of streaming the full 27K-row set back to the
-- API route.
--
-- p_function_keys = NULL or empty array → no fk filter (acts like a generic
-- single-shot bulk fetch).

CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_by_function_keys(
  p_project_id      int,
  p_function_keys   text[],
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
    WHERE r.project_id = p_project_id
      AND r.is_committed = true
      AND (r.data->>'1_TAG NUMBER') IS NOT NULL
      AND (
        p_loop_mid_letter IS NULL
        OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
      )
      AND (
        p_function_keys IS NULL
        OR cardinality(p_function_keys) = 0
        OR drawings.tag_function_key(r.data->>'1_TAG NUMBER') = ANY (p_function_keys)
      )
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_tags_by_function_keys(int, text[], text, text[]) TO authenticated;
