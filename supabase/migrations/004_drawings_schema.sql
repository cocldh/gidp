-- =============================================================================
-- 004_drawings_schema.sql — JB Wiring / Loop / Hook-up diagram module
-- =============================================================================
-- MVP target: JB Wiring Diagram (Phase 3).
-- EPC domain fields (must not be skipped — draftsman will reject otherwise):
--   terminal.side (F/S), function (+/-/SH/SP), ferrule_text
--   cable.shield (OA/IS/OA+IS/NONE), drain_wire
--   junction_box.is_barrier_box, terminal.barrier_id, terminal.is_spare
--   cable.cable_core_ref (core-to-terminal wiring label)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS drawings;
GRANT USAGE ON SCHEMA drawings TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA drawings
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA drawings
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- -----------------------------------------------------------------------------
-- Junction Box
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.junction_box (
  jb_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  jb_number          TEXT    NOT NULL,
  location           TEXT,
  area               TEXT,
  ex_rating          TEXT,
  is_barrier_box     BOOLEAN NOT NULL DEFAULT false,
  terminal_capacity  INTEGER,
  remark             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, jb_number)
);
CREATE INDEX idx_jb_project ON drawings.junction_box(project_id);

-- -----------------------------------------------------------------------------
-- Cable (point-to-point between JBs / field / DCS)
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.cable (
  cable_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  cable_number     TEXT    NOT NULL,
  cable_type       TEXT,                -- e.g. 1P-1.5 / 2P-1.5 / 12P-1.5
  shield           TEXT    NOT NULL DEFAULT 'NONE'
                   CHECK (shield IN ('OA', 'IS', 'OA+IS', 'NONE')),
  drain_wire       BOOLEAN NOT NULL DEFAULT false,
  cable_core_ref   TEXT,                -- core labeling convention ref
  from_jb_id       BIGINT  REFERENCES drawings.junction_box(jb_id) ON DELETE SET NULL,
  to_jb_id         BIGINT  REFERENCES drawings.junction_box(jb_id) ON DELETE SET NULL,
  from_ref         TEXT,                -- free-text for field / DCS / MCC / non-JB endpoints
  to_ref           TEXT,
  length_m         NUMERIC(8,2),
  remark           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, cable_number)
);
CREATE INDEX idx_cable_project ON drawings.cable(project_id);
CREATE INDEX idx_cable_from    ON drawings.cable(from_jb_id) WHERE from_jb_id IS NOT NULL;
CREATE INDEX idx_cable_to      ON drawings.cable(to_jb_id)   WHERE to_jb_id   IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Terminal (one row per JB strip terminal)
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.terminal (
  terminal_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  jb_id            BIGINT  NOT NULL REFERENCES drawings.junction_box(jb_id) ON DELETE CASCADE,
  terminal_number  TEXT    NOT NULL,
  side             TEXT    NOT NULL CHECK (side IN ('F', 'S')),  -- Field / System
  function         TEXT    NOT NULL CHECK (function IN ('+', '-', 'SH', 'SP')),
  ferrule_text     TEXT,
  barrier_id       BIGINT  REFERENCES drawings.terminal(terminal_id) ON DELETE SET NULL,
  is_spare         BOOLEAN NOT NULL DEFAULT false,
  tag_id           BIGINT  REFERENCES public.tag(tag_id) ON DELETE SET NULL,
  cable_id         BIGINT  REFERENCES drawings.cable(cable_id) ON DELETE SET NULL,
  cable_core       TEXT,
  remark           TEXT,
  UNIQUE (jb_id, side, terminal_number, function)
);
CREATE INDEX idx_terminal_project ON drawings.terminal(project_id);
CREATE INDEX idx_terminal_jb      ON drawings.terminal(jb_id);
CREATE INDEX idx_terminal_tag     ON drawings.terminal(tag_id) WHERE tag_id IS NOT NULL;
CREATE INDEX idx_terminal_cable   ON drawings.terminal(cable_id) WHERE cable_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Drawing template (GS-standard title-block + layer config + DXF block refs)
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.drawing_template (
  template_id    SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  drawing_type   TEXT    NOT NULL CHECK (drawing_type IN ('wiring_jb', 'loop', 'hookup', 'cable_schedule', 'io_list')),
  template_name  TEXT    NOT NULL,
  title_block_ref TEXT,
  layer_config   JSONB   NOT NULL DEFAULT '{}'::jsonb,
  block_refs     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  sheet_size     TEXT    NOT NULL DEFAULT 'A3',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, drawing_type, template_name)
);

-- -----------------------------------------------------------------------------
-- Drawing instance (a generated drawing — JB 123 Wiring rev a)
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.drawing_instance (
  instance_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  template_id     INTEGER REFERENCES drawings.drawing_template(template_id),
  drawing_type    TEXT    NOT NULL CHECK (drawing_type IN ('wiring_jb', 'loop', 'hookup', 'cable_schedule', 'io_list')),
  drawing_number  TEXT    NOT NULL,
  source_jb_id    BIGINT  REFERENCES drawings.junction_box(jb_id)  ON DELETE SET NULL,
  source_loop_id  BIGINT  REFERENCES public.loop(loop_id)          ON DELETE SET NULL,
  source_ids      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  storage_path    TEXT,                       -- Supabase Storage key for latest DXF
  pdf_storage_path TEXT,
  sheet_count     INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'generated', 'issued')),
  generated_at    TIMESTAMPTZ,
  generated_by    UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, drawing_number)
);
CREATE INDEX idx_drawing_project  ON drawings.drawing_instance(project_id);
CREATE INDEX idx_drawing_type     ON drawings.drawing_instance(project_id, drawing_type);
CREATE INDEX idx_drawing_jb       ON drawings.drawing_instance(source_jb_id) WHERE source_jb_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Drawing revision (same shape as iss.document_revision — packages/domain/revision.ts
-- provides a single engine)
-- -----------------------------------------------------------------------------
CREATE TABLE drawings.drawing_revision (
  revision_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id      BIGINT  NOT NULL REFERENCES drawings.drawing_instance(instance_id) ON DELETE CASCADE,
  revision_number  TEXT    NOT NULL,
  revision_type    TEXT    NOT NULL CHECK (revision_type IN ('minor', 'major')),
  note             TEXT,
  storage_path     TEXT,
  pdf_storage_path TEXT,
  committed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_by     UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (instance_id, revision_number)
);
CREATE INDEX idx_drawing_revision_instance ON drawings.drawing_revision(instance_id);

COMMIT;
