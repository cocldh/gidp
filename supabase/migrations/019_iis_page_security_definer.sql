-- Switch iis_fetch_tags_page to SECURITY DEFINER so RLS on idx.index_record is
-- not evaluated per-row (the has_module_access predicate was running ~3ms × 2517
-- rows = ~7s and tripping the PostgREST statement_timeout). The function gates
-- access with a single upfront has_module_access check against the calling
-- user via auth.uid(), then trusts p_project_id for the body.

DROP FUNCTION IF EXISTS drawings.iis_fetch_tags_page(int, text, text[], int, int);

CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_page(
  p_project_id      int,
  p_loop_mid_letter text DEFAULT NULL,
  p_columns         text[] DEFAULT NULL,
  p_limit           int DEFAULT 100,
  p_offset          int DEFAULT 0
)
RETURNS TABLE (
  record_id           bigint,
  tag_number          text,
  loop_number         text,
  loop_internal_order text,
  data                jsonb,
  total_count         bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.data->>'1_TAG NUMBER',
    r.data->>'5_LOOP NUMBER',
    r.data->>'11_INTERNAL LOOP ORDER',
    CASE
      WHEN p_columns IS NULL THEN r.data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(k, r.data->k)
           FROM unnest(p_columns) AS k
          WHERE r.data ? k),
        '{}'::jsonb
      )
    END,
    count(*) OVER ()
  FROM idx.index_record r
  WHERE r.project_id = p_project_id
    AND r.is_committed = true
    AND (r.data->>'1_TAG NUMBER') IS NOT NULL
    AND (
      p_loop_mid_letter IS NULL
      OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
    )
  ORDER BY
    r.data->>'5_LOOP NUMBER' NULLS LAST,
    NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
    r.data->>'1_TAG NUMBER'
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_tags_page(int, text, text[], int, int) TO authenticated;
