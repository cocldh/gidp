-- =============================================================================
-- 005_rls_policies.sql — project_id-based RLS across all business tables
-- =============================================================================
-- Access model:
--   - auth.uid() → public.user_profile.role ('Pending' | 'Active' | 'Admin')
--   - Admin: full access to everything
--   - Active: gated by public.user_project_role.role (ProjectAdmin / Editor / Viewer)
--     AND optionally public.user_project_module.access for per-module ACL
--   - Pending: no data access
-- Helper functions live in public schema so policies across iss/idx/drawings
-- can SECURITY DEFINER-reference them without schema qualifying.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER for RLS re-entry)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = auth.uid() AND role = 'Admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_project_role(p_project_id INTEGER, p_min_role TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  -- Role ordering: Viewer < Editor < ProjectAdmin
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.user_project_role
    WHERE user_id = auth.uid()
      AND project_id = p_project_id
      AND CASE p_min_role
        WHEN 'Viewer'       THEN role IN ('Viewer', 'Editor', 'ProjectAdmin')
        WHEN 'Editor'       THEN role IN ('Editor', 'ProjectAdmin')
        WHEN 'ProjectAdmin' THEN role = 'ProjectAdmin'
        ELSE false
      END
  );
$$;

CREATE OR REPLACE FUNCTION public.has_module_access(
  p_project_id INTEGER, p_module TEXT, p_min_access TEXT
)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  -- When no user_project_module row exists, fall back to user_project_role (project-wide)
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_project_module
      WHERE user_id = auth.uid()
        AND project_id = p_project_id
        AND module = p_module
        AND CASE p_min_access
          WHEN 'Viewer' THEN access IN ('Viewer', 'Editor', 'Admin')
          WHEN 'Editor' THEN access IN ('Editor', 'Admin')
          WHEN 'Admin'  THEN access = 'Admin'
          ELSE false
        END
    )
    OR public.has_project_role(p_project_id,
         CASE p_min_access WHEN 'Admin' THEN 'ProjectAdmin' ELSE p_min_access END);
$$;

-- -----------------------------------------------------------------------------
-- public schema policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.project               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profile          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_role     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_module   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loop                  ENABLE ROW LEVEL SECURITY;

-- project: select if assigned, manage if admin
CREATE POLICY project_select ON public.project FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.user_project_role
    WHERE user_id = auth.uid() AND project_id = project.project_id
  ));
CREATE POLICY project_manage ON public.project FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- user_profile: users read own + admins read all
CREATE POLICY user_profile_self ON public.user_profile FOR SELECT
  USING (id = auth.uid() OR public.is_admin());
CREATE POLICY user_profile_self_update ON public.user_profile FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY user_profile_admin_manage ON public.user_profile FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- user_project_role: users see own, admins see all, project admins manage within project
CREATE POLICY upr_select ON public.user_project_role FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin()
         OR public.has_project_role(project_id, 'ProjectAdmin'));
CREATE POLICY upr_manage ON public.user_project_role FOR ALL
  USING (public.is_admin() OR public.has_project_role(project_id, 'ProjectAdmin'))
  WITH CHECK (public.is_admin() OR public.has_project_role(project_id, 'ProjectAdmin'));

-- user_project_module: same shape as upr
CREATE POLICY upm_select ON public.user_project_module FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin()
         OR public.has_project_role(project_id, 'ProjectAdmin'));
CREATE POLICY upm_manage ON public.user_project_module FOR ALL
  USING (public.is_admin() OR public.has_project_role(project_id, 'ProjectAdmin'))
  WITH CHECK (public.is_admin() OR public.has_project_role(project_id, 'ProjectAdmin'));

-- tag: viewer read, editor write (gated per project)
CREATE POLICY tag_select ON public.tag FOR SELECT
  USING (public.has_project_role(project_id, 'Viewer'));
CREATE POLICY tag_modify ON public.tag FOR ALL
  USING (public.has_project_role(project_id, 'Editor'))
  WITH CHECK (public.has_project_role(project_id, 'Editor'));

CREATE POLICY loop_select ON public.loop FOR SELECT
  USING (public.has_project_role(project_id, 'Viewer'));
CREATE POLICY loop_modify ON public.loop FOR ALL
  USING (public.has_project_role(project_id, 'Editor'))
  WITH CHECK (public.has_project_role(project_id, 'Editor'));

-- -----------------------------------------------------------------------------
-- iss schema policies — has_module_access(project_id, 'iss', ...)
-- -----------------------------------------------------------------------------
ALTER TABLE iss.template                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.field_def                ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.document                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.document_value           ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.document_value_change    ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.mapping_rule             ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.mapping_option           ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.document_revision        ENABLE ROW LEVEL SECURITY;
ALTER TABLE iss.document_revision_detail ENABLE ROW LEVEL SECURITY;

-- Direct project_id tables
CREATE POLICY iss_template_ro ON iss.template FOR SELECT
  USING (public.has_module_access(project_id, 'iss', 'Viewer'));
CREATE POLICY iss_template_rw ON iss.template FOR ALL
  USING (public.has_module_access(project_id, 'iss', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'iss', 'Editor'));

CREATE POLICY iss_field_def_ro ON iss.field_def FOR SELECT
  USING (public.has_module_access(project_id, 'iss', 'Viewer'));
CREATE POLICY iss_field_def_rw ON iss.field_def FOR ALL
  USING (public.has_module_access(project_id, 'iss', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'iss', 'Editor'));

CREATE POLICY iss_document_ro ON iss.document FOR SELECT
  USING (public.has_module_access(project_id, 'iss', 'Viewer'));
CREATE POLICY iss_document_rw ON iss.document FOR ALL
  USING (public.has_module_access(project_id, 'iss', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'iss', 'Editor'));

CREATE POLICY iss_mapping_rule_ro ON iss.mapping_rule FOR SELECT
  USING (public.has_module_access(project_id, 'iss', 'Viewer'));
CREATE POLICY iss_mapping_rule_rw ON iss.mapping_rule FOR ALL
  USING (public.has_module_access(project_id, 'iss', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'iss', 'Editor'));

-- document_value / change / revision / revision_detail / mapping_option
-- derive project through parent FK
CREATE POLICY iss_document_value_ro ON iss.document_value FOR SELECT
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_value.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Viewer')));
CREATE POLICY iss_document_value_rw ON iss.document_value FOR ALL
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_value.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iss.document d
                      WHERE d.document_id = document_value.document_id
                        AND public.has_module_access(d.project_id, 'iss', 'Editor')));

CREATE POLICY iss_dvc_ro ON iss.document_value_change FOR SELECT
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_value_change.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Viewer')));
CREATE POLICY iss_dvc_rw ON iss.document_value_change FOR ALL
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_value_change.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iss.document d
                      WHERE d.document_id = document_value_change.document_id
                        AND public.has_module_access(d.project_id, 'iss', 'Editor')));

CREATE POLICY iss_mapping_option_ro ON iss.mapping_option FOR SELECT
  USING (EXISTS (SELECT 1 FROM iss.mapping_rule m
                 WHERE m.mapping_id = mapping_option.mapping_id
                   AND public.has_module_access(m.project_id, 'iss', 'Viewer')));
CREATE POLICY iss_mapping_option_rw ON iss.mapping_option FOR ALL
  USING (EXISTS (SELECT 1 FROM iss.mapping_rule m
                 WHERE m.mapping_id = mapping_option.mapping_id
                   AND public.has_module_access(m.project_id, 'iss', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iss.mapping_rule m
                      WHERE m.mapping_id = mapping_option.mapping_id
                        AND public.has_module_access(m.project_id, 'iss', 'Editor')));

CREATE POLICY iss_revision_ro ON iss.document_revision FOR SELECT
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_revision.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Viewer')));
CREATE POLICY iss_revision_rw ON iss.document_revision FOR ALL
  USING (EXISTS (SELECT 1 FROM iss.document d
                 WHERE d.document_id = document_revision.document_id
                   AND public.has_module_access(d.project_id, 'iss', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iss.document d
                      WHERE d.document_id = document_revision.document_id
                        AND public.has_module_access(d.project_id, 'iss', 'Editor')));

CREATE POLICY iss_revision_detail_ro ON iss.document_revision_detail FOR SELECT
  USING (EXISTS (SELECT 1 FROM iss.document_revision r
                 JOIN iss.document d ON d.document_id = r.document_id
                 WHERE r.revision_id = document_revision_detail.revision_id
                   AND public.has_module_access(d.project_id, 'iss', 'Viewer')));
CREATE POLICY iss_revision_detail_rw ON iss.document_revision_detail FOR ALL
  USING (EXISTS (SELECT 1 FROM iss.document_revision r
                 JOIN iss.document d ON d.document_id = r.document_id
                 WHERE r.revision_id = document_revision_detail.revision_id
                   AND public.has_module_access(d.project_id, 'iss', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iss.document_revision r
                      JOIN iss.document d ON d.document_id = r.document_id
                      WHERE r.revision_id = document_revision_detail.revision_id
                        AND public.has_module_access(d.project_id, 'iss', 'Editor')));

-- -----------------------------------------------------------------------------
-- idx schema policies
-- -----------------------------------------------------------------------------
ALTER TABLE idx.index_column     ENABLE ROW LEVEL SECURITY;
ALTER TABLE idx.index_record     ENABLE ROW LEVEL SECURITY;
ALTER TABLE idx.index_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE idx.index_favorite   ENABLE ROW LEVEL SECURITY;

CREATE POLICY idx_column_ro ON idx.index_column FOR SELECT
  USING (public.has_module_access(project_id, 'idx', 'Viewer'));
CREATE POLICY idx_column_rw ON idx.index_column FOR ALL
  USING (public.has_module_access(project_id, 'idx', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));

CREATE POLICY idx_record_ro ON idx.index_record FOR SELECT
  USING (public.has_module_access(project_id, 'idx', 'Viewer'));
CREATE POLICY idx_record_rw ON idx.index_record FOR ALL
  USING (public.has_module_access(project_id, 'idx', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));

CREATE POLICY idx_audit_ro ON idx.index_audit_log FOR SELECT
  USING (public.has_module_access(project_id, 'idx', 'Viewer'));
CREATE POLICY idx_audit_insert ON idx.index_audit_log FOR INSERT
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));

CREATE POLICY idx_favorite_ro ON idx.index_favorite FOR SELECT
  USING (public.has_module_access(project_id, 'idx', 'Viewer'));
CREATE POLICY idx_favorite_rw ON idx.index_favorite FOR ALL
  USING (public.has_module_access(project_id, 'idx', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));

-- -----------------------------------------------------------------------------
-- drawings schema policies
-- -----------------------------------------------------------------------------
ALTER TABLE drawings.junction_box       ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.cable              ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.terminal           ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.drawing_template   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.drawing_instance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.drawing_revision   ENABLE ROW LEVEL SECURITY;

CREATE POLICY dw_jb_ro ON drawings.junction_box FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY dw_jb_rw ON drawings.junction_box FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY dw_cable_ro ON drawings.cable FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY dw_cable_rw ON drawings.cable FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY dw_terminal_ro ON drawings.terminal FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY dw_terminal_rw ON drawings.terminal FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY dw_template_ro ON drawings.drawing_template FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY dw_template_rw ON drawings.drawing_template FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY dw_instance_ro ON drawings.drawing_instance FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY dw_instance_rw ON drawings.drawing_instance FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY dw_revision_ro ON drawings.drawing_revision FOR SELECT
  USING (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                 WHERE i.instance_id = drawing_revision.instance_id
                   AND public.has_module_access(i.project_id, 'drawings', 'Viewer')));
CREATE POLICY dw_revision_rw ON drawings.drawing_revision FOR ALL
  USING (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                 WHERE i.instance_id = drawing_revision.instance_id
                   AND public.has_module_access(i.project_id, 'drawings', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                      WHERE i.instance_id = drawing_revision.instance_id
                        AND public.has_module_access(i.project_id, 'drawings', 'Editor')));

COMMIT;
