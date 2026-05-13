-- mode='all' and mode='auto' in /drawings/api/iis/generate were paging the
-- existing iis_fetch_tags_page in a loop. Each call recomputes count(*) OVER ()
-- (full table scan) AND walks an LIMIT/OFFSET that grows linearly. With 27K+
-- tags on FGIP2 this exceeded statement_timeout (2 min for authenticated role).
--
-- This bulk fetcher does one pass, no count, no offset, ORDER BY using the
-- iis_loop functional index from migration 017. Returns the full set so the
-- caller can chunk in JS. Same SECURITY DEFINER gating as the paged variant.
--
-- Also raises the in-function statement_timeout because the round-trip happens
-- inside a single API call rather than across many small fetches.

CREATE OR REPLACE FUNCTION drawings.iis_fetch_all_tags(
  p_project_id      int,
  p_loop_mid_letter text   DEFAULT NULL,
  p_columns         text[] DEFAULT NULL  -- NULL = full data jsonb
)
RETURNS TABLE (
  record_id           bigint,
  tag_number          text,
  loop_number         text,
  loop_internal_order text,
  data                jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
SET statement_timeout = '180s'
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
    END
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
    r.data->>'1_TAG NUMBER';
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_all_tags(int, text, text[]) TO authenticated;
