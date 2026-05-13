-- Server-side tag fetch for IIS generation.
-- Filters by project, committed status, and (optionally) the middle alphabet of the
-- loop number (3rd hyphen-segment). E.g. P = pressure, F = flow, T = temperature.
-- Ordered by loop_number → internal loop order → tag for deterministic pagination.

CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags(
  p_project_id    int,
  p_loop_mid_letter text DEFAULT NULL  -- NULL = no filter
)
RETURNS TABLE (
  record_id           bigint,
  tag_number          text,
  loop_number         text,
  loop_internal_order text,
  data                jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    r.id,
    r.data->>'1_TAG NUMBER'             AS tag_number,
    r.data->>'5_LOOP NUMBER'            AS loop_number,
    r.data->>'11_INTERNAL LOOP ORDER'   AS loop_internal_order,
    r.data
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
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_tags(int, text) TO authenticated;
