-- =============================================================================
-- 015_iis_schema.sql — IIS (Instrument Installation Schedule) module
-- =============================================================================
-- IIS is a tabular deliverable produced by stamping per-tag rows onto a
-- Saudi Aramco standard xlsx template (SA-2781A~E / SA-2799 / SA-7076).
-- Engine: Node.js + JSZip + xmldom (mirrors apps/iss/src/app/api/generate).
--
-- Tables added:
--   drawings.iis_template_layout   — global per-Aramco-template layout meta
--                                    (data row range, item/tag column letters,
--                                    sheet name, banner, etc.). PK = template_code.
--   drawings.iis_document_meta     — per-instance metadata; 1:1 FK to
--                                    drawings.drawing_instance. Holds title-block
--                                    free-text fields + tag filter / order spec.
--   drawings.iis_column_mapping    — per-project column mapping: output xlsx
--                                    column letter ← idx column OR iss field_def
--                                    OR constant. PSV-specific fields live in iss
--                                    schema, so both source paths are needed.
--
-- Also: drawing_type CHECK on drawing_template / drawing_instance gains 'iis'.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- (a) Extend drawing_type CHECK to include 'iis'
-- -----------------------------------------------------------------------------
ALTER TABLE drawings.drawing_template
  DROP CONSTRAINT IF EXISTS drawing_template_drawing_type_check;
ALTER TABLE drawings.drawing_template
  ADD CONSTRAINT drawing_template_drawing_type_check
  CHECK (drawing_type IN ('wiring_jb','loop','hookup','cable_schedule','io_list','iis'));

ALTER TABLE drawings.drawing_instance
  DROP CONSTRAINT IF EXISTS drawing_instance_drawing_type_check;
ALTER TABLE drawings.drawing_instance
  ADD CONSTRAINT drawing_instance_drawing_type_check
  CHECK (drawing_type IN ('wiring_jb','loop','hookup','cable_schedule','io_list','iis'));

-- -----------------------------------------------------------------------------
-- (b) iis_template_layout — global Aramco-standard layout reference
-- -----------------------------------------------------------------------------
-- Project-agnostic: every Aramco-spec project shares the same 7 templates.
-- title_block_cells JSONB keys (filled in later via mapping UI):
--   plant_no, index_letter, drawing_no_root, unit_name, job_order_no,
--   sheet_no, sheet_total, revision
-- All values are A1-style cell refs (e.g. "AB3"). Engine writes title-block
-- fields by looking up these keys; missing keys mean "skip".
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.iis_template_layout (
  template_code      TEXT    PRIMARY KEY,
  sheet_name         TEXT    NOT NULL,
  banner_text        TEXT    NOT NULL,
  banner_cell        TEXT    NOT NULL,
  data_row_start     INTEGER NOT NULL,
  data_row_end       INTEGER NOT NULL,
  item_col_letter    TEXT,
  tag_col_letter     TEXT    NOT NULL,
  print_width_col    TEXT,
  title_block_cells  JSONB   NOT NULL DEFAULT '{}'::jsonb,
  storage_path       TEXT    NOT NULL,
  description        TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- (c) iis_document_meta — per-instance IIS metadata (1:1 with drawing_instance)
-- -----------------------------------------------------------------------------
-- tag_filter JSONB shape (extensible — engine reads keys it knows):
--   { "instrument_types": ["PT","PI"], "loop_numbers": [...], "tag_ids": [...] }
-- order_by JSONB shape: list of `{ "field": "loop_number", "dir": "asc" }`.
-- Default order: loop_number asc, then loop_internal_order asc.
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.iis_document_meta (
  instance_id      BIGINT  PRIMARY KEY REFERENCES drawings.drawing_instance(instance_id) ON DELETE CASCADE,
  template_code    TEXT    NOT NULL REFERENCES drawings.iis_template_layout(template_code),
  variant_label    TEXT,
  plant_no         TEXT,
  index_letter     TEXT,
  drawing_no_root  TEXT,
  unit_name        TEXT,
  job_order_no     TEXT,
  tag_filter       JSONB   NOT NULL DEFAULT '{}'::jsonb,
  order_by         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- (d) iis_column_mapping — per-project output-column ← source mapping
-- -----------------------------------------------------------------------------
-- Exactly one source must be set per row; enforced by CHECK constraint.
-- transform: opaque hint consumed by engine, e.g. 'upper'|'decimal:2'|'date:YYYY-MM-DD'.
-- output_column_letter: A1-style column letter only (no row — row comes from
-- iis_template_layout.data_row_start..end + per-tag offset).
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.iis_column_mapping (
  mapping_id              BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id              INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_code           TEXT    NOT NULL REFERENCES drawings.iis_template_layout(template_code),
  output_column_letter    TEXT    NOT NULL,
  output_label            TEXT,
  source_idx_column_id    BIGINT  REFERENCES idx.index_column(id) ON DELETE SET NULL,
  source_iss_field_def_id INTEGER REFERENCES iss.field_def(field_id)     ON DELETE SET NULL,
  source_constant         TEXT,
  transform               TEXT,
  display_order           INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_code, output_column_letter),
  CONSTRAINT iis_col_mapping_one_source_chk CHECK (
    (CASE WHEN source_idx_column_id    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN source_iss_field_def_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN source_constant         IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);
CREATE INDEX idx_iis_col_mapping_project ON drawings.iis_column_mapping(project_id, template_code);

-- -----------------------------------------------------------------------------
-- (e) Auto-classification rules — tag prefix → template_code
-- -----------------------------------------------------------------------------
-- Engine uses this to bucket tags into the correct variant when user asks for
-- "generate IIS for all loops" without specifying a template.
-- match_kind = 'prefix' compares against tag.instrument_type (e.g. PT, PSV, MOV).
-- match_kind = 'regex'  matches against tag.tag_number for edge cases.
-- Earlier priority wins (ASC).
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.iis_classification_rule (
  rule_id        BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_code  TEXT    NOT NULL REFERENCES drawings.iis_template_layout(template_code),
  match_kind     TEXT    NOT NULL CHECK (match_kind IN ('prefix','regex')),
  match_value    TEXT    NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 100,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, match_kind, match_value)
);
CREATE INDEX idx_iis_class_rule_project ON drawings.iis_classification_rule(project_id, priority);

-- -----------------------------------------------------------------------------
-- (f) updated_at triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drawings.tg_iis_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER iis_template_layout_touch
  BEFORE UPDATE ON drawings.iis_template_layout
  FOR EACH ROW EXECUTE FUNCTION drawings.tg_iis_touch_updated_at();
CREATE TRIGGER iis_document_meta_touch
  BEFORE UPDATE ON drawings.iis_document_meta
  FOR EACH ROW EXECUTE FUNCTION drawings.tg_iis_touch_updated_at();
CREATE TRIGGER iis_column_mapping_touch
  BEFORE UPDATE ON drawings.iis_column_mapping
  FOR EACH ROW EXECUTE FUNCTION drawings.tg_iis_touch_updated_at();

-- -----------------------------------------------------------------------------
-- (g) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE drawings.iis_template_layout      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.iis_document_meta        ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.iis_column_mapping       ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings.iis_classification_rule  ENABLE ROW LEVEL SECURITY;

-- Template layout is global reference data: any authenticated user can read,
-- only platform Admin can mutate.
CREATE POLICY iis_layout_ro ON drawings.iis_template_layout FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY iis_layout_admin ON drawings.iis_template_layout FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Document meta: project derived through drawing_instance FK.
CREATE POLICY iis_doc_meta_ro ON drawings.iis_document_meta FOR SELECT
  USING (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                 WHERE i.instance_id = iis_document_meta.instance_id
                   AND public.has_module_access(i.project_id, 'drawings', 'Viewer')));
CREATE POLICY iis_doc_meta_rw ON drawings.iis_document_meta FOR ALL
  USING (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                 WHERE i.instance_id = iis_document_meta.instance_id
                   AND public.has_module_access(i.project_id, 'drawings', 'Editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM drawings.drawing_instance i
                      WHERE i.instance_id = iis_document_meta.instance_id
                        AND public.has_module_access(i.project_id, 'drawings', 'Editor')));

-- Column mapping: direct project_id.
CREATE POLICY iis_col_mapping_ro ON drawings.iis_column_mapping FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY iis_col_mapping_rw ON drawings.iis_column_mapping FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

CREATE POLICY iis_class_rule_ro ON drawings.iis_classification_rule FOR SELECT
  USING (public.has_module_access(project_id, 'drawings', 'Viewer'));
CREATE POLICY iis_class_rule_rw ON drawings.iis_classification_rule FOR ALL
  USING (public.has_module_access(project_id, 'drawings', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'drawings', 'Editor'));

-- -----------------------------------------------------------------------------
-- (h) Seed 7 Aramco-standard templates
-- -----------------------------------------------------------------------------
-- Layout matrix derived from the sample xlsx files in docs/samples/iis/.
-- title_block_cells left empty — to be populated when title-block UI lands.
-- -----------------------------------------------------------------------------
INSERT INTO drawings.iis_template_layout
  (template_code, sheet_name, banner_text, banner_cell,
   data_row_start, data_row_end, item_col_letter, tag_col_letter, print_width_col,
   storage_path, description)
VALUES
  ('SA-2781A', 'SA-2781A-ENG', 'PRESSURE INSTRUMENTS',         'CD50',  5, 44, 'A',  'DD', 'DL',
   'templates/iis/SA-2781A.xlsx', 'Pressure instruments (PT/PI/PG/PIT)'),
  ('SA-2781B', 'SA-2781B-ENG', 'TEMPERATURE INSTRUMENTS',      'CD50',  5, 44, 'A',  'DD', 'DL',
   'templates/iis/SA-2781B.xlsx', 'Temperature instruments (TT/TI/TG/TE)'),
  ('SA-2781C', 'SA-2781C-ENG', 'FLOW INSTRUMENTS',             'CD50',  5, 44, 'A',  'DD', 'DL',
   'templates/iis/SA-2781C.xlsx', 'Flow instruments (FT/FI/FE)'),
  ('SA-2781D', 'SA-2781D-ENG', 'LEVEL INSTRUMENTS',            'CD50',  5, 44, 'A',  'DD', 'DL',
   'templates/iis/SA-2781D.xlsx', 'Level instruments (LT/LI/LG/LSH/LSL)'),
  ('SA-2781E', 'SA-2781E-ENG', 'MISCELLANEOUS INSTRUMENTS',    'CD50',  5, 44, 'A',  'DD', 'DL',
   'templates/iis/SA-2781E.xlsx', 'Miscellaneous instruments (analyzers etc.)'),
  ('SA-2799',  'SA-2799-ENG',  'RELIEF VALVES',                'CM50',  6, 45, 'DU', 'G',  'DW',
   'templates/iis/SA-2799.xlsx', 'Pressure safety / relief valves (PSV)'),
  ('SA-7076',  'SA-7076-ENG',  'MOV / AOV / HOV / GOV',        'CD50',  5, 44, 'A',  'DF', 'DL',
   'templates/iis/SA-7076.xlsx', 'On-off / control valves (MOV / AOV / HOV / GOV)');

COMMIT;
