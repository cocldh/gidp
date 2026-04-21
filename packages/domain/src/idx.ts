import { z } from 'zod';
import { TagCoreFieldEnum } from './public';

export const IndexColumnSchema = z
  .object({
    id: z.coerce.number().optional(),
    project_id: z.number().int().positive(),
    column_name: z.string().min(1),
    order_index: z.number().int(),
    is_tag_core: z.boolean().default(false),
    tag_core_field: TagCoreFieldEnum.nullable().optional(),
    created_at: z.string().datetime().optional(),
  })
  .refine(
    (v) => !v.is_tag_core || v.tag_core_field != null,
    { message: 'tag_core_field is required when is_tag_core is true' },
  );
export type IndexColumn = z.infer<typeof IndexColumnSchema>;

export const IndexRecordSchema = z.object({
  id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  data: z.record(z.unknown()).default({}),
  is_committed: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type IndexRecord = z.infer<typeof IndexRecordSchema>;

export const IndexAuditLogSchema = z.object({
  id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  record_id: z.number().int().nullable().optional(),
  tag_number: z.string().nullable().optional(),
  column_name: z.string().min(1),
  old_value: z.string().nullable().optional(),
  new_value: z.string().nullable().optional(),
  changed_by: z.string().uuid().nullable().optional(),
  changed_at: z.string().datetime().optional(),
  commit_description: z.string().nullable().optional(),
});
export type IndexAuditLog = z.infer<typeof IndexAuditLogSchema>;

export const IndexFavoriteSchema = z.object({
  id: z.coerce.number().optional(),
  project_id: z.number().int().positive(),
  name: z.string().min(1),
  hidden_fields: z.array(z.string()).default([]),
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime().optional(),
});
export type IndexFavorite = z.infer<typeof IndexFavoriteSchema>;
