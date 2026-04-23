-- idx.index_record keyset pagination index
-- Keyset query pattern: WHERE project_id = ? AND id > cursor ORDER BY id LIMIT n
-- The existing (project_id) index forces a separate sort pass on id, causing
-- statement timeouts on large tables. A composite (project_id, id) index makes
-- the query a straight index range scan with no sort.
CREATE INDEX IF NOT EXISTS idx_index_record_project_id
  ON idx.index_record(project_id, id);
