-- Add change_reason column to idx.index_audit_log
-- Separate from commit_description: change_reason is set at save time (per-edit rationale),
-- commit_description is set at commit time (batch-level note).
ALTER TABLE idx.index_audit_log
  ADD COLUMN IF NOT EXISTS change_reason TEXT;
