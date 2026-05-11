-- Canonical IIS tag fetcher: returns one page of tag rows + total filtered count
-- (via window function). A separate scalar count function did not get inlined
-- when called via SELECT fn() and ran ~6s; bundling the count column with the
-- page query keeps a single Index Scan over the iis_loop functional index for
-- both filter and sort, returning in ~150ms.

DROP FUNCTION IF EXISTS drawings.iis_fetch_tags_page(int, text, text[], int, int);

CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_page(
  p_project_id      int,
  p_loop_mid_letter text DEFAULT NULL,
  p_columns         text[] DEFAULT NULL,   -- NULL = full data
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
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION drawings.iis_fetch_tags_page(int, text, text[], int, int) TO authenticated;

-- Earlier 016 / mid-iteration helpers are now redundant.
DROP FUNCTION IF EXISTS drawings.iis_count_tags(int, text);
DROP FUNCTION IF EXISTS drawings.iis_fetch_tags(int, text);
