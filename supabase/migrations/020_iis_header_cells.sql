-- Per-template header cells: where to stamp the auto-computed page number,
-- the user-supplied revision number (may map to multiple cells per sheet),
-- and the document/DCC number. These are template-specific because each
-- Aramco form has its own header layout.

ALTER TABLE drawings.iis_template_layout
  ADD COLUMN IF NOT EXISTS page_no_cell  TEXT,
  ADD COLUMN IF NOT EXISTS rev_no_cells  TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS doc_no_cell   TEXT;

-- SA-2781A header layout (per user spec):
--   DC58 = SHT.NO. (page number, zero-padded to 3 digits)
--   DH58, AS58, BC47 = REV. NO.
--   AZ50 = DCC Number
UPDATE drawings.iis_template_layout
SET page_no_cell = 'DC58',
    rev_no_cells = ARRAY['DH58','AS58','BC47'],
    doc_no_cell  = 'AZ50'
WHERE template_code = 'SA-2781A';
