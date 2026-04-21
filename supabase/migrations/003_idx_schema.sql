-- =============================================================================
-- 003_idx_schema.sql — Master Instrument Index module
-- =============================================================================
-- Preserves legacy Index app's JSONB-overlay pattern:
--   - idx.index_record.data JSONB holds 200+ columns as raw spreadsheet cells
--   - idx.index_column tracks schema/display order
-- Key additions vs. legacy:
--   - project_id on all tables (single DB, multi-project)
--   - is_tag_core flag on idx.index_column so trigger 006 knows which JSONB
--     keys to sync into public.tag (normalized columns)
--   - is_committed flag on idx.index_record for the "uncommitted changes" UX
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS idx;
GRANT USAGE ON SCHEMA idx TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA idx
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA idx
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- -----------------------------------------------------------------------------
-- Columns (xlsb header metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE idx.index_column (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  column_name  TEXT    NOT NULL,
  order_index  INTEGER NOT NULL,
  is_tag_core  BOOLEAN NOT NULL DEFAULT false,
  tag_core_field TEXT,  -- NULL | 'tag_number' | 'service_description' | 'instrument_type' | 'signal_type' | 'io_type' | 'loop_number' | 'pnid_number' | 'location' | 'ex_rating' | 'ex_certification'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, column_name),
  CHECK (NOT is_tag_core OR tag_core_field IS NOT NULL)
);
CREATE INDEX idx_index_column_project ON idx.index_column(project_id);

-- -----------------------------------------------------------------------------
-- Records (one xlsb row → one JSONB document)
-- -----------------------------------------------------------------------------
CREATE TABLE idx.index_record (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  data          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  is_committed  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_index_record_project ON idx.index_record(project_id);
CREATE INDEX idx_index_record_uncommitted ON idx.index_record(project_id) WHERE NOT is_committed;
-- Fast lookup on arbitrary JSONB keys (e.g. "Tag Number")
CREATE INDEX idx_index_record_data_gin ON idx.index_record USING gin (data jsonb_path_ops);

-- Backfill the FK on public.tag.source_record_id now that idx.index_record exists
ALTER TABLE public.tag
  ADD CONSTRAINT tag_source_record_fk
  FOREIGN KEY (source_record_id) REFERENCES idx.index_record(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Audit log (per-cell changes, tied to commit batches)
-- -----------------------------------------------------------------------------
CREATE TABLE idx.index_audit_log (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  record_id           BIGINT  REFERENCES idx.index_record(id) ON DELETE SET NULL,
  tag_number          TEXT,
  column_name         TEXT    NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  changed_by          UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  commit_description  TEXT
);
CREATE INDEX idx_audit_project_changed    ON idx.index_audit_log(project_id, changed_at DESC);
CREATE INDEX idx_audit_tag_number         ON idx.index_audit_log(project_id, tag_number) WHERE tag_number IS NOT NULL;
CREATE INDEX idx_audit_column_name        ON idx.index_audit_log(project_id, column_name);

-- -----------------------------------------------------------------------------
-- Favorites (saved column-hide views)
-- -----------------------------------------------------------------------------
CREATE TABLE idx.index_favorite (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  hidden_fields  JSONB   NOT NULL DEFAULT '[]'::jsonb,
  created_by     UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_favorite_project ON idx.index_favorite(project_id);

COMMIT;
