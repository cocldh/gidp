-- =============================================================================
-- 009_idx_audit_committed_flag.sql — restore legacy cell-level commit UX
-- =============================================================================
-- The legacy Index app used idx.index_audit_log.committed to highlight cells
-- changed since the last commit (yellow). The unified schema 003 put that
-- flag on idx.index_record instead (row-level), which loses the cell-level
-- granularity. This migration adds the flag back on the audit log so the
-- existing UX carries over unchanged.
-- =============================================================================

BEGIN;

ALTER TABLE idx.index_audit_log
  ADD COLUMN IF NOT EXISTS committed BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup for "which cells are uncommitted in this project"
CREATE INDEX IF NOT EXISTS idx_audit_uncommitted
  ON idx.index_audit_log(project_id, record_id, column_name)
  WHERE committed = false;

COMMIT;
