-- 011_idx_audit_update_policy.sql
-- idx.index_audit_log had INSERT but no UPDATE policy.
-- The commit flow (setting committed=true + commit_description) was silently
-- blocked by RLS, updating 0 rows while returning no error.

CREATE POLICY idx_audit_update ON idx.index_audit_log FOR UPDATE
  USING (public.has_module_access(project_id, 'idx', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));
