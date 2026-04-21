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
