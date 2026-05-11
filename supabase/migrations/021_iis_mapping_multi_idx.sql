-- Multi-idx concatenation for iis_column_mapping.
--
-- Some templates (e.g. SA-7076 column AY "TYPE SIZE RATING") need a single
-- output cell stamped from the concatenation of multiple idx columns. The
-- original schema only supported one source per mapping row.
--
-- This migration adds:
--   - source_idx_column_ids BIGINT[]  — ordered list of idx column ids whose
--     values get joined into the output cell. NULL or empty array = use the
--     legacy single-source path (source_idx_column_id).
--   - concat_separator TEXT          — string inserted between values when
--     joining. Defaults to one space.
--
-- The existing exactly-one-source CHECK is replaced so the array counts as
-- the same "idx" bucket as the scalar column (still mutually exclusive with
-- iss / constant). Scalar + array on the same row is disallowed by an
-- additional constraint to avoid ambiguity.

ALTER TABLE drawings.iis_column_mapping
  ADD COLUMN IF NOT EXISTS source_idx_column_ids BIGINT[],
  ADD COLUMN IF NOT EXISTS concat_separator      TEXT NOT NULL DEFAULT ' ';

ALTER TABLE drawings.iis_column_mapping
  DROP CONSTRAINT IF EXISTS iis_col_mapping_one_source_chk;

ALTER TABLE drawings.iis_column_mapping
  ADD CONSTRAINT iis_col_mapping_one_source_chk CHECK (
    (CASE
       WHEN source_idx_column_id IS NOT NULL
         OR (source_idx_column_ids IS NOT NULL AND cardinality(source_idx_column_ids) > 0)
       THEN 1 ELSE 0 END)
    + (CASE WHEN source_iss_field_def_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN source_constant         IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

ALTER TABLE drawings.iis_column_mapping
  ADD CONSTRAINT iis_col_mapping_idx_scalar_xor_chk CHECK (
    NOT (
      source_idx_column_id IS NOT NULL
      AND source_idx_column_ids IS NOT NULL
      AND cardinality(source_idx_column_ids) > 0
    )
  );
