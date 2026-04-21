import { z } from 'zod';

export const RevisionTypeEnum = z.enum(['minor', 'major']);

export const TemplateSchema = z.object({
  template_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_code: z.string().min(1),
  template_name: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const FieldDefSchema = z.object({
  field_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  field_name: z.string().min(1),
  data_kind: z.string().default('TEXT'),
  display_order: z.number().int().default(9999),
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const DocumentSchema = z.object({
  document_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_id: z.number().int().nullable().optional(),
  document_number: z.string().min(1),
  sheet_number: z.string().nullable().optional(),
  revision_number: z.string().nullable().optional(),
  minor_revision: z.string().nullable().optional(),
  tag_id: z.number().int().nullable().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentValueSchema = z.object({
  document_id: z.number().int(),
  field_id: z.number().int(),
  value_text: z.string().nullable().optional(),
});
export type DocumentValue = z.infer<typeof DocumentValueSchema>;

export const MappingRuleSchema = z.object({
  mapping_id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  template_id: z.number().int().nullable().optional(),
  field_id: z.number().int().nullable().optional(),
  data_type: z.string().nullable().optional(),
  target_sheet: z.string().nullable().optional(),
  target_cell: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});
export type MappingRule = z.infer<typeof MappingRuleSchema>;

export const MappingOptionSchema = z.object({
  option_id: z.coerce.number().optional(),
  mapping_id: z.number().int(),
  expected_value: z.string().nullable().optional(),
});
export type MappingOption = z.infer<typeof MappingOptionSchema>;

export const DocumentRevisionSchema = z.object({
  revision_id: z.coerce.number().optional(),
  document_id: z.number().int(),
  revision_number: z.string().min(1),
  revision_type: RevisionTypeEnum,
  note: z.string().nullable().optional(),
  committed_at: z.string().datetime().optional(),
  committed_by: z.string().nullable().optional(),
});
export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;

export const DocumentRevisionDetailSchema = z.object({
  detail_id: z.coerce.number().optional(),
  revision_id: z.number().int(),
  document_number: z.string().min(1),
  tag_number: z.string().nullable().optional(),
  field_name: z.string().min(1),
  previous_value: z.string().nullable().optional(),
  new_value: z.string().nullable().optional(),
  changed_at: z.string().datetime().optional(),
  changed_by: z.string().nullable().optional(),
});
export type DocumentRevisionDetail = z.infer<typeof DocumentRevisionDetailSchema>;
