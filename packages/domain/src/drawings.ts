import { z } from 'zod';

export const TerminalSideEnum = z.enum(['F', 'S']);
export const TerminalFunctionEnum = z.enum(['+', '-', 'SH', 'SP']);
export const CableShieldEnum = z.enum(['OA', 'IS', 'OA+IS', 'NONE']);
export const DrawingTypeEnum = z.enum([
  'wiring_jb',
  'loop',
  'hookup',
  'cable_schedule',
  'io_list',
  'iis',
]);
export const DrawingStatusEnum = z.enum(['draft', 'generated', 'issued']);
export const RevisionTypeEnum = z.enum(['minor', 'major']);

export const JunctionBoxSchema = z.object({
  jb_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  jb_number: z.string().min(1),
  location: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  ex_rating: z.string().nullable().optional(),
  is_barrier_box: z.boolean().default(false),
  terminal_capacity: z.number().int().nullable().optional(),
  remark: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type JunctionBox = z.infer<typeof JunctionBoxSchema>;

export const CableSchema = z.object({
  cable_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  cable_number: z.string().min(1),
  cable_type: z.string().nullable().optional(),
  shield: CableShieldEnum.default('NONE'),
  drain_wire: z.boolean().default(false),
  cable_core_ref: z.string().nullable().optional(),
  from_jb_id: z.number().int().nullable().optional(),
  to_jb_id: z.number().int().nullable().optional(),
  from_ref: z.string().nullable().optional(),
  to_ref: z.string().nullable().optional(),
  length_m: z.number().nullable().optional(),
  remark: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type Cable = z.infer<typeof CableSchema>;

export const TerminalSchema = z.object({
  terminal_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  jb_id: z.number().int(),
  terminal_number: z.string().min(1),
  side: TerminalSideEnum,
  function: TerminalFunctionEnum,
  ferrule_text: z.string().nullable().optional(),
  barrier_id: z.number().int().nullable().optional(),
  is_spare: z.boolean().default(false),
  tag_id: z.number().int().nullable().optional(),
  cable_id: z.number().int().nullable().optional(),
  cable_core: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});
export type Terminal = z.infer<typeof TerminalSchema>;

export const DrawingTemplateSchema = z.object({
  template_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  drawing_type: DrawingTypeEnum,
  template_name: z.string().min(1),
  title_block_ref: z.string().nullable().optional(),
  layer_config: z.record(z.unknown()).default({}),
  block_refs: z.record(z.unknown()).default({}),
  sheet_size: z.string().default('A3'),
  created_at: z.string().datetime().optional(),
});
export type DrawingTemplate = z.infer<typeof DrawingTemplateSchema>;

export const DrawingInstanceSchema = z.object({
  instance_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_id: z.number().int().nullable().optional(),
  drawing_type: DrawingTypeEnum,
  drawing_number: z.string().min(1),
  source_jb_id: z.number().int().nullable().optional(),
  source_loop_id: z.number().int().nullable().optional(),
  source_ids: z.record(z.unknown()).default({}),
  storage_path: z.string().nullable().optional(),
  pdf_storage_path: z.string().nullable().optional(),
  sheet_count: z.number().int().default(1),
  status: DrawingStatusEnum.default('draft'),
  generated_at: z.string().datetime().nullable().optional(),
  generated_by: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type DrawingInstance = z.infer<typeof DrawingInstanceSchema>;

export const DrawingRevisionSchema = z.object({
  revision_id: z.coerce.number().optional(),
  instance_id: z.number().int(),
  revision_number: z.string().min(1),
  revision_type: RevisionTypeEnum,
  note: z.string().nullable().optional(),
  storage_path: z.string().nullable().optional(),
  pdf_storage_path: z.string().nullable().optional(),
  committed_at: z.string().datetime().optional(),
  committed_by: z.string().uuid().nullable().optional(),
});
export type DrawingRevision = z.infer<typeof DrawingRevisionSchema>;

// ---------------------------------------------------------------------------
// IIS (Instrument Installation Schedule) — see supabase/migrations/015
// ---------------------------------------------------------------------------

// A1-style column letter (one or two uppercase letters), used for output xlsx
// column position in iis_column_mapping. Loose upper bound: 'ZZ'.
const ColumnLetterSchema = z.string().regex(/^[A-Z]{1,2}$/, 'expected A1-style column letter');
// A1-style cell ref (column letters + row number), e.g. "CD50" or "AB3".
const CellRefSchema = z.string().regex(/^[A-Z]{1,2}[1-9][0-9]*$/, 'expected A1-style cell ref');

export const IisTemplateLayoutSchema = z.object({
  template_code: z.string().min(1),
  sheet_name: z.string().min(1),
  banner_text: z.string().min(1),
  banner_cell: CellRefSchema,
  data_row_start: z.number().int().positive(),
  data_row_end: z.number().int().positive(),
  item_col_letter: ColumnLetterSchema.nullable().optional(),
  tag_col_letter: ColumnLetterSchema,
  print_width_col: ColumnLetterSchema.nullable().optional(),
  title_block_cells: z.record(CellRefSchema).default({}),
  storage_path: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
}).refine((v) => v.data_row_end >= v.data_row_start, {
  message: 'data_row_end must be >= data_row_start',
  path: ['data_row_end'],
});
export type IisTemplateLayout = z.infer<typeof IisTemplateLayoutSchema>;

// tag_filter — only keys the engine recognizes are honored; unknown keys ignored.
export const IisTagFilterSchema = z.object({
  instrument_types: z.array(z.string()).optional(),
  loop_numbers: z.array(z.string()).optional(),
  tag_ids: z.array(z.number().int()).optional(),
}).partial();
export type IisTagFilter = z.infer<typeof IisTagFilterSchema>;

export const IisOrderEntrySchema = z.object({
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type IisOrderEntry = z.infer<typeof IisOrderEntrySchema>;

export const IisDocumentMetaSchema = z.object({
  instance_id: z.coerce.number().int(),
  template_code: z.string().min(1),
  variant_label: z.string().nullable().optional(),
  plant_no: z.string().nullable().optional(),
  index_letter: z.string().nullable().optional(),
  drawing_no_root: z.string().nullable().optional(),
  unit_name: z.string().nullable().optional(),
  job_order_no: z.string().nullable().optional(),
  tag_filter: IisTagFilterSchema.default({}),
  order_by: z.array(IisOrderEntrySchema).default([]),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type IisDocumentMeta = z.infer<typeof IisDocumentMetaSchema>;

export const IisColumnMappingSchema = z.object({
  mapping_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_code: z.string().min(1),
  output_column_letter: ColumnLetterSchema,
  output_label: z.string().nullable().optional(),
  source_idx_column_id: z.number().int().nullable().optional(),
  source_iss_field_def_id: z.number().int().nullable().optional(),
  source_constant: z.string().nullable().optional(),
  transform: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
}).refine((v) => {
  const sources = [v.source_idx_column_id, v.source_iss_field_def_id, v.source_constant]
    .filter((x) => x !== null && x !== undefined);
  return sources.length === 1;
}, { message: 'exactly one of source_idx_column_id / source_iss_field_def_id / source_constant must be set' });
export type IisColumnMapping = z.infer<typeof IisColumnMappingSchema>;

export const IisClassificationMatchKindEnum = z.enum(['prefix', 'regex']);

export const IisClassificationRuleSchema = z.object({
  rule_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_code: z.string().min(1),
  match_kind: IisClassificationMatchKindEnum,
  match_value: z.string().min(1),
  priority: z.number().int().default(100),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
});
export type IisClassificationRule = z.infer<typeof IisClassificationRuleSchema>;
