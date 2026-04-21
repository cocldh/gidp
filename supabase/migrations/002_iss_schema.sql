-- =============================================================================
-- 002_iss_schema.sql — ISS (Instrument Specification Sheet) module
-- =============================================================================
-- Key change vs. legacy ISS:
--   - Schema renamed from {proj_code}.document → iss.document + project_id column
--   - tag_id FK points to public.tag (unified master) instead of per-project tag
--   - Otherwise identical EAV shape (document / document_value / field_def / template)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS iss;
GRANT USAGE ON SCHEMA iss TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA iss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA iss
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- -----------------------------------------------------------------------------
-- Template (Excel ISS sheet definition)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.template (
  template_id    SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_code  TEXT    NOT NULL,
  template_name  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_code)
);
CREATE INDEX idx_iss_template_project ON iss.template(project_id);

-- -----------------------------------------------------------------------------
-- Field definition (spec sheet field metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.field_def (
  field_id      SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  field_name    TEXT    NOT NULL,
  data_kind     TEXT    DEFAULT 'TEXT',
  display_order INTEGER DEFAULT 9999,
  UNIQUE (project_id, field_name)
);
CREATE INDEX idx_iss_field_project ON iss.field_def(project_id);

-- -----------------------------------------------------------------------------
-- Document (one ISS spec sheet instance)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.document (
  document_id      SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_id      INTEGER REFERENCES iss.template(template_id),
  document_number  TEXT    NOT NULL,
  sheet_number     TEXT,
  revision_number  TEXT,
  minor_revision   TEXT,
  tag_id           BIGINT  REFERENCES public.tag(tag_id) ON DELETE SET NULL
);
CREATE INDEX idx_iss_document_project  ON iss.document(project_id);
CREATE INDEX idx_iss_document_tag      ON iss.document(tag_id);
CREATE INDEX idx_iss_document_template ON iss.document(template_id);

-- -----------------------------------------------------------------------------
-- Document value (EAV body of the spec sheet)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.document_value (
  document_id INTEGER NOT NULL REFERENCES iss.document(document_id) ON DELETE CASCADE,
  field_id    INTEGER NOT NULL REFERENCES iss.field_def(field_id)  ON DELETE CASCADE,
  value_text  TEXT,
  PRIMARY KEY (document_id, field_id)
);

CREATE TABLE iss.document_value_change (
  document_id    INTEGER NOT NULL REFERENCES iss.document(document_id) ON DELETE CASCADE,
  field_id       INTEGER NOT NULL REFERENCES iss.field_def(field_id)  ON DELETE CASCADE,
  tag_number     TEXT,
  template_code  TEXT,
  field_name     TEXT,
  previous_value TEXT,
  new_value      TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by     TEXT,
  PRIMARY KEY (document_id, field_id)
);

-- -----------------------------------------------------------------------------
-- Template-level mapping rules (which field goes to which sheet/cell)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.mapping_rule (
  mapping_id   SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_id  INTEGER REFERENCES iss.template(template_id) ON DELETE CASCADE,
  field_id     INTEGER REFERENCES iss.field_def(field_id),
  data_type    TEXT,
  target_sheet TEXT,
  target_cell  TEXT,
  remark       TEXT
);
CREATE INDEX idx_iss_mapping_rule_template ON iss.mapping_rule(template_id);

CREATE TABLE iss.mapping_option (
  option_id      SERIAL PRIMARY KEY,
  mapping_id     INTEGER NOT NULL REFERENCES iss.mapping_rule(mapping_id) ON DELETE CASCADE,
  expected_value TEXT
);

-- -----------------------------------------------------------------------------
-- Revision control (minor: a/b/c, major: 0/1/2)
-- -----------------------------------------------------------------------------
CREATE TABLE iss.document_revision (
  revision_id      SERIAL PRIMARY KEY,
  document_id      INTEGER NOT NULL REFERENCES iss.document(document_id) ON DELETE CASCADE,
  revision_number  TEXT    NOT NULL,
  revision_type    TEXT    NOT NULL CHECK (revision_type IN ('minor', 'major')),
  note             TEXT,
  committed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_by     TEXT
);
CREATE INDEX idx_iss_revision_document ON iss.document_revision(document_id);

CREATE TABLE iss.document_revision_detail (
  detail_id       SERIAL PRIMARY KEY,
  revision_id     INTEGER NOT NULL REFERENCES iss.document_revision(revision_id) ON DELETE CASCADE,
  document_number TEXT    NOT NULL,
  tag_number      TEXT,
  field_name      TEXT    NOT NULL,
  previous_value  TEXT,
  new_value       TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by      TEXT
);
CREATE INDEX idx_iss_revision_detail_revision ON iss.document_revision_detail(revision_id);

COMMIT;
