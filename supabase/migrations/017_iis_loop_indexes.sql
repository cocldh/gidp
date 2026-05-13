-- Functional index for the IIS tag-fetch query pattern:
--   WHERE project_id = ? AND is_committed
--     AND split_part(data->>'5_LOOP NUMBER', '-', 3) = ?
--   ORDER BY data->>'5_LOOP NUMBER', NULLIF(data->>'11_INTERNAL LOOP ORDER','')::int, data->>'1_TAG NUMBER'
--
-- Without this, the 27k-row table forces a Seq Scan that materializes every
-- JSONB to evaluate the filter — that hit ~5s and timed out the RPC. With the
-- index in place the same scan returns in ~20ms.
CREATE INDEX IF NOT EXISTS idx_index_record_iis_loop
  ON idx.index_record (
    project_id,
    (split_part(data->>'5_LOOP NUMBER', '-', 3)),
    (data->>'5_LOOP NUMBER'),
    (data->>'1_TAG NUMBER')
  )
  WHERE is_committed = true;
